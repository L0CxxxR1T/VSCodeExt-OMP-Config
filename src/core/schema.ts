import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import type { AstNode, Path, PathSegment, Span } from './ast';
import { getProperty, nodeAtPath, nodesAlongPath, pointerToPath, toValue } from './ast';

// スキーマは外部 JSON なので、キーワードの有無を実行時に調べながら読む
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaObject = Record<string, any>;

export interface ExpandedSchema {
  schema: SchemaObject;
  pointer: string;
}

export interface SchemaIssue {
  message: string;
  span: Span;
}

const TYPE_NAMES: Record<string, string> = {
  string: '文字列',
  integer: '整数',
  number: '数値',
  boolean: '真偽値',
  object: 'オブジェクト',
  array: '配列',
  null: 'null',
};

const MAX_EXPAND_DEPTH = 24;

export class SchemaModel {
  private readonly ajv: Ajv2020;
  private readonly validateFn: ValidateFunction;
  private readonly ifCache = new Map<string, ValidateFunction | undefined>();
  readonly id: string;

  constructor(readonly root: SchemaObject) {
    this.id = typeof root.$id === 'string' ? root.$id : 'urn:oh-my-posh-schema';
    this.ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true, validateSchema: false });
    // format: color はパターン側で検証しているので、ここでは判定しない
    this.ajv.addFormat('color', true);
    this.validateFn = this.ajv.compile({ ...root, $id: this.id });
  }

  validate(rootNode: AstNode | undefined): SchemaIssue[] {
    if (!rootNode) return [];
    this.validateFn(toValue(rootNode));
    const errors = reduceErrors(this.validateFn.errors ?? []);
    const seen = new Set<string>();
    const issues: SchemaIssue[] = [];
    for (const error of errors) {
      const issue = toIssue(rootNode, error);
      const key = `${issue.span.start}:${issue.span.end}:${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
    return issues;
  }

  /** root から path までたどり、その位置に適用されるスキーマを列挙する。 */
  schemasAt(rootNode: AstNode | undefined, path: Path): ExpandedSchema[] {
    const nodes = nodesAlongPath(rootNode, path);
    let current = this.expand(this.root, '', valueOf(nodes[0]));
    for (let i = 0; i < path.length; i++) {
      current = this.childSchemas(current, path[i], valueOf(nodes[i + 1]));
      if (current.length === 0) break;
    }
    return current;
  }

  childSchemas(parents: ExpandedSchema[], segment: PathSegment, childValue: unknown): ExpandedSchema[] {
    const out: ExpandedSchema[] = [];
    for (const { schema, pointer } of parents) {
      if (typeof segment === 'string') {
        let matched = false;
        if (schema.properties && typeof schema.properties[segment] === 'object') {
          this.expandInto(schema.properties[segment], `${pointer}/properties/${escapePointer(segment)}`, childValue, out);
          matched = true;
        }
        for (const [pattern, sub] of Object.entries<SchemaObject>(schema.patternProperties ?? {})) {
          if (safeTest(pattern, segment)) {
            this.expandInto(sub, `${pointer}/patternProperties/${escapePointer(pattern)}`, childValue, out);
            matched = true;
          }
        }
        if (!matched && typeof schema.additionalProperties === 'object') {
          this.expandInto(schema.additionalProperties, `${pointer}/additionalProperties`, childValue, out);
        }
      } else {
        if (Array.isArray(schema.prefixItems) && segment < schema.prefixItems.length) {
          this.expandInto(schema.prefixItems[segment], `${pointer}/prefixItems/${segment}`, childValue, out);
        } else if (typeof schema.items === 'object') {
          this.expandInto(schema.items, `${pointer}/items`, childValue, out);
        }
      }
    }
    return dedupe(out);
  }

  expand(schema: SchemaObject, pointer: string, value: unknown): ExpandedSchema[] {
    const out: ExpandedSchema[] = [];
    this.expandInto(schema, pointer, value, out);
    return dedupe(out);
  }

  /** $ref・allOf・anyOf・oneOf・if/then/else を展開する。anyOf と oneOf は補完候補を広く出すため全分岐を含める。 */
  private expandInto(schema: unknown, pointer: string, value: unknown, out: ExpandedSchema[], depth = 0): void {
    if (!isObject(schema) || depth > MAX_EXPAND_DEPTH) return;
    out.push({ schema, pointer });
    if (typeof schema.$ref === 'string') {
      const target = this.resolveRef(schema.$ref);
      if (target) this.expandInto(target.schema, target.pointer, value, out, depth + 1);
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const list = schema[keyword];
      if (Array.isArray(list)) list.forEach((sub, i) => this.expandInto(sub, `${pointer}/${keyword}/${i}`, value, out, depth + 1));
    }
    if (isObject(schema.if)) {
      const branch = this.matchesIf(`${pointer}/if`, value) ? 'then' : 'else';
      if (isObject(schema[branch])) this.expandInto(schema[branch], `${pointer}/${branch}`, value, out, depth + 1);
    }
  }

  private matchesIf(pointer: string, value: unknown): boolean {
    let fn = this.ifCache.get(pointer);
    if (!this.ifCache.has(pointer)) {
      try {
        fn = this.ajv.compile({ $ref: `${this.id}#${pointer}` });
      } catch (e) {
        console.warn(`[oh-my-posh] if 条件をコンパイルできませんでした: ${pointer}`, e);
        fn = undefined;
      }
      this.ifCache.set(pointer, fn);
    }
    // 判定できない条件は候補を減らしすぎないよう成立扱いにする
    return fn ? Boolean(fn(value ?? {})) : true;
  }

  private resolveRef(ref: string): ExpandedSchema | undefined {
    const hash = ref.indexOf('#');
    const base = hash >= 0 ? ref.slice(0, hash) : ref;
    if (base !== '' && base !== this.id) return undefined;
    const pointer = hash >= 0 ? ref.slice(hash + 1) : '';
    let node: unknown = this.root;
    for (const part of pointer.split('/').slice(1)) {
      if (!isObject(node)) return undefined;
      node = node[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return isObject(node) ? { schema: node, pointer } : undefined;
  }
}

function valueOf(node: AstNode | undefined): unknown {
  return node ? toValue(node) : undefined;
}

function isObject(v: unknown): v is SchemaObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function escapePointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

function safeTest(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(text);
  } catch {
    return false;
  }
}

function dedupe(list: ExpandedSchema[]): ExpandedSchema[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.pointer) ? false : (seen.add(s.pointer), true)));
}

/**
 * Ajv のエラーを利用者向けに絞り込む。
 * anyOf の各分岐のエラーは $ref 先の schemaPath で報告されるため、schemaPath ではなく instancePath でまとめる。
 */
function reduceErrors(errors: ErrorObject[]): ErrorObject[] {
  const filtered = errors.filter((e) => e.keyword !== 'if');
  const unionAt = new Map<string, ErrorObject>();
  for (const e of filtered) {
    if (e.keyword !== 'anyOf' && e.keyword !== 'oneOf') continue;
    const prev = unionAt.get(e.instancePath);
    // 入れ子の anyOf では title を持つ方が説明に使える
    if (!prev || (!prev.parentSchema?.title && e.parentSchema?.title)) unionAt.set(e.instancePath, e);
  }
  return filtered.filter((e) => {
    const union = unionAt.get(e.instancePath);
    return !union || union === e;
  });
}

function toIssue(root: AstNode, error: ErrorObject): SchemaIssue {
  const path = pointerToPath(root, error.instancePath);
  const params = error.params as Record<string, unknown>;
  const title = typeof error.parentSchema?.title === 'string' ? error.parentSchema.title : undefined;

  switch (error.keyword) {
    case 'unevaluatedProperties':
    case 'additionalProperties': {
      const name = String(params.unevaluatedProperty ?? params.additionalProperty);
      const prop = getProperty(nodeAtPath(root, path), name);
      return { message: `プロパティ「${name}」はここでは使えません。`, span: prop?.keySpan ?? spanForNode(root, path) };
    }
    case 'required':
      return { message: `必須プロパティ「${String(params.missingProperty)}」がありません。`, span: spanForNode(root, path) };
    case 'type': {
      const types = String(params.type)
        .split(',')
        .map((t) => TYPE_NAMES[t] ?? t)
        .join('または');
      return { message: `型が正しくありません。${types}を指定してください。`, span: spanForNode(root, path) };
    }
    case 'enum':
      return { message: `値が正しくありません。指定できる値は ${formatList(params.allowedValues)} です。`, span: spanForNode(root, path) };
    case 'const':
      return { message: `値は ${JSON.stringify(params.allowedValue)} である必要があります。`, span: spanForNode(root, path) };
    case 'pattern':
    case 'anyOf':
    case 'oneOf':
      return {
        message: title ? `値が「${title}」の形式に一致しません。` : '値の形式が正しくありません。',
        span: spanForNode(root, path),
      };
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum': {
      const words = { minimum: '以上', maximum: '以下', exclusiveMinimum: 'より大きい値', exclusiveMaximum: 'より小さい値' };
      return { message: `値は ${String(params.limit)} ${words[error.keyword]}である必要があります。`, span: spanForNode(root, path) };
    }
    case 'minItems':
      return { message: `要素は ${String(params.limit)} 個以上必要です。`, span: spanForNode(root, path) };
    case 'maxItems':
      return { message: `要素は ${String(params.limit)} 個以下にしてください。`, span: spanForNode(root, path) };
    case 'minLength':
      return { message: `${String(params.limit)} 文字以上で指定してください。`, span: spanForNode(root, path) };
    case 'maxLength':
      return { message: `${String(params.limit)} 文字以下で指定してください。`, span: spanForNode(root, path) };
    case 'uniqueItems':
      return { message: '配列に重複した要素があります。', span: spanForNode(root, path) };
    default:
      return { message: `スキーマに一致しません。（${error.message ?? error.keyword}）`, span: spanForNode(root, path) };
  }
}

function formatList(values: unknown): string {
  const list = Array.isArray(values) ? values.map((v) => String(v)) : [];
  const head = list.slice(0, 12).join('、');
  return list.length > 12 ? `${head} ほか ${list.length - 12} 件` : head;
}

/**
 * エラー位置を決める。オブジェクトや配列の全体に下線を引くと読みにくいので、キー名かその先頭に寄せる。
 */
function spanForNode(root: AstNode, path: Path): Span {
  const node = nodeAtPath(root, path);
  if (node?.kind === 'scalar') return node.span;
  const last = path[path.length - 1];
  if (typeof last === 'string') {
    const prop = getProperty(nodeAtPath(root, path.slice(0, -1)), last);
    if (prop) return prop.keySpan;
  }
  if (node?.kind === 'object' && node.properties.length > 0) return node.properties[0].keySpan;
  const start = node?.span.start ?? 0;
  return { start, end: start + 1 };
}
