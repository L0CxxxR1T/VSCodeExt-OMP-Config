import type { AstNode, Format, Path } from './ast';
import type { CursorContext } from './context';
import type { PaletteEntry } from './palette';
import { resolveColor } from './palette';
import type { ExpandedSchema, SchemaModel, SchemaObject } from './schema';

export type CandidateKind = 'property' | 'enum' | 'value' | 'palette';

export interface Candidate {
  label: string;
  kind: CandidateKind;
  /** スニペット形式の挿入文字列 */
  insertText: string;
  detail?: string;
  documentation?: string;
  /** パレット候補の色。VS Code の色見本表示に使う */
  color?: string;
  deprecated?: boolean;
  sortText?: string;
  filterText?: string;
}

export interface SchemaInfo {
  title?: string;
  description?: string;
  types: Set<string>;
  enumValues: unknown[];
  defaultValue?: unknown;
  deprecated: boolean;
  /** 色やパレット参照を受け付ける位置か */
  acceptsColor: boolean;
}

const COLOR_POINTERS = ['/definitions/color', '/definitions/palette_reference', '/definitions/palette_color'];

export function describe(schemas: ExpandedSchema[]): SchemaInfo {
  const info: SchemaInfo = { types: new Set(), enumValues: [], deprecated: false, acceptsColor: false };
  for (const { schema, pointer } of schemas) {
    info.title ??= str(schema.title);
    info.description ??= str(schema.description);
    if (typeof schema.type === 'string') info.types.add(schema.type);
    if (Array.isArray(schema.type)) schema.type.forEach((t: unknown) => info.types.add(String(t)));
    if (Array.isArray(schema.enum)) info.enumValues.push(...schema.enum);
    if ('const' in schema) info.enumValues.push(schema.const);
    if (info.defaultValue === undefined && 'default' in schema) info.defaultValue = schema.default;
    if (schema.deprecated === true) info.deprecated = true;
    if (COLOR_POINTERS.includes(pointer)) info.acceptsColor = true;
  }
  info.enumValues = [...new Map(info.enumValues.map((v) => [JSON.stringify(v), v])).values()];
  return info;
}

/**
 * if: { properties: { key: { const } } } と then の組から、値ごとの説明を集める。
 * セグメント種別の一覧に「Git Segment」のような説明を付けるために使う。
 */
export function branchDocs(parents: ExpandedSchema[], key: string): Map<string, { title?: string; description?: string }> {
  const docs = new Map<string, { title?: string; description?: string }>();
  for (const { schema } of parents) {
    if (!Array.isArray(schema.allOf)) continue;
    for (const branch of schema.allOf as SchemaObject[]) {
      const cond = branch?.if?.properties;
      if (!cond || Object.keys(cond).length !== 1 || !(key in cond) || !('const' in cond[key])) continue;
      const then = branch.then ?? {};
      const value = String(cond[key].const);
      if (!docs.has(value) && (then.title || then.description)) docs.set(value, { title: str(then.title), description: str(then.description) });
    }
  }
  return docs;
}

export function buildCandidates(
  ctx: CursorContext,
  format: Format,
  schema: SchemaModel,
  palette: PaletteEntry[],
): Candidate[] {
  switch (ctx.kind) {
    case 'palette':
      return paletteCandidates(palette, (name) => `p:${name}`);
    case 'key':
      return keyCandidates(ctx, format, schema);
    case 'value':
      return valueCandidates(ctx, format, schema, palette);
  }
}

function keyCandidates(ctx: Extract<CursorContext, { kind: 'key' }>, format: Format, schema: SchemaModel): Candidate[] {
  const parents = schema.schemasAt(ctx.root, ctx.parentPath);
  const keys = new Set<string>();
  for (const { schema: s } of parents) for (const k of Object.keys(s.properties ?? {})) keys.add(k);

  const candidates: Candidate[] = [];
  for (const key of keys) {
    if (ctx.existing.has(key)) continue;
    const info = describe(schema.childSchemas(parents, key, undefined));
    candidates.push({
      label: key,
      kind: 'property',
      insertText: ctx.keyOnly ? keyText(key, format) : keyInsert(key, info, format, ctx.indent),
      detail: info.title,
      documentation: docText(info),
      deprecated: info.deprecated,
      filterText: format === 'json' ? `"${key}"` : key,
    });
  }
  return candidates;
}

function valueCandidates(
  ctx: Extract<CursorContext, { kind: 'value' }>,
  format: Format,
  schema: SchemaModel,
  palette: PaletteEntry[],
): Candidate[] {
  const schemas = schema.schemasAt(ctx.root, ctx.path);
  const info = describe(schemas);
  const last = ctx.path[ctx.path.length - 1];
  const docs = typeof last === 'string' ? branchDocs(schema.schemasAt(ctx.root, ctx.path.slice(0, -1)), last) : new Map();
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const push = (value: unknown, kind: CandidateKind, detail?: string, documentation?: string): void => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return;
    seen.add(key);
    const insertText = escapeSnippet(valueText(value, format, ctx.quote));
    candidates.push({ label: String(value), kind, insertText, detail, documentation, filterText: ctx.quote || format !== 'json' ? undefined : insertText });
  };

  for (const value of info.enumValues) {
    const doc = docs.get(String(value));
    push(value, 'enum', doc?.title, doc?.description);
  }
  if (info.types.has('boolean')) {
    push(true, 'value');
    push(false, 'value');
  }
  if (info.defaultValue !== undefined && info.defaultValue !== '' && typeof info.defaultValue !== 'object') {
    push(info.defaultValue, 'value', '既定値');
  }
  if (info.acceptsColor) {
    for (const c of paletteCandidates(palette, (name) => escapeSnippet(valueText(`p:${name}`, format, ctx.quote)))) {
      if (!seen.has(JSON.stringify(c.label))) candidates.push(c);
    }
  }
  return candidates;
}

function paletteCandidates(palette: PaletteEntry[], insert: (name: string) => string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const entry of palette) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    const color = resolveColor(palette, entry.name);
    out.push({
      label: `p:${entry.name}`,
      kind: 'palette',
      insertText: insert(entry.name),
      detail: entry.value,
      color: color && /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : undefined,
      sortText: `0_${entry.name}`,
    });
  }
  return out;
}

function keyText(key: string, format: Format): string {
  if (format === 'json') return `"${key}"`;
  return /^[\w-]+$/.test(key) ? key : JSON.stringify(key);
}

function keyInsert(key: string, info: SchemaInfo, format: Format, indent: string): string {
  const k = escapeSnippet(keyText(key, format));
  const type = info.types.has('object') ? 'object' : info.types.has('array') ? 'array' : info.types.values().next().value;
  switch (format) {
    case 'json':
      if (type === 'object') return `${k}: {$1}`;
      if (type === 'array') return `${k}: [$1]`;
      if (type === 'string') return `${k}: "$1"`;
      return `${k}: $1`;
    case 'yaml':
      if (type === 'object') return `${k}:\n${indent}  $1`;
      if (type === 'array') return `${k}:\n${indent}  - $1`;
      return `${k}: $1`;
    case 'toml':
      if (type === 'object') return `${k} = { $1 }`;
      if (type === 'array') return `${k} = [$1]`;
      if (type === 'string') return `${k} = '$1'`;
      return `${k} = $1`;
  }
}

/** 値をフォーマットに合わせて書き出す。quote があれば入力済みの引用符の内側に入る文字列だけを返す。 */
export function valueText(value: unknown, format: Format, quote: string | null): string {
  if (typeof value !== 'string') return format === 'yaml' && value === null ? 'null' : JSON.stringify(value);
  if (quote) return quote === '"' ? JSON.stringify(value).slice(1, -1) : value.replace(/'/g, format === 'yaml' ? "''" : "'");
  switch (format) {
    case 'json':
      return JSON.stringify(value);
    case 'toml':
      return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
    case 'yaml':
      return needsYamlQuote(value) ? `'${value.replace(/'/g, "''")}'` : value;
  }
}

function needsYamlQuote(value: string): boolean {
  return (
    value === '' ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /: |\s#|\s$/.test(value) ||
    /^(true|false|null|yes|no|on|off|~|[-+]?\d[\d._]*(e[-+]?\d+)?)$/i.test(value)
  );
}

function escapeSnippet(s: string): string {
  return s.replace(/[\\$}]/g, (c) => `\\${c}`);
}

function docText(info: SchemaInfo): string | undefined {
  const lines: string[] = [];
  if (info.description) lines.push(info.description);
  const meta: string[] = [];
  if (info.types.size > 0) meta.push(`型: ${[...info.types].join(' | ')}`);
  if (info.defaultValue !== undefined && info.defaultValue !== '') meta.push(`既定値: \`${JSON.stringify(info.defaultValue)}\``);
  if (meta.length > 0) lines.push(meta.join(' / '));
  return lines.length > 0 ? lines.join('\n\n') : undefined;
}

export interface HoverInfo {
  markdown: string;
}

/** キーや値の位置にある説明を Markdown で返す。 */
export function hoverFor(root: AstNode | undefined, path: Path, onValue: unknown, schema: SchemaModel): HoverInfo | undefined {
  const info = describe(schema.schemasAt(root, path));
  const parts: string[] = [];
  if (info.title) parts.push(`**${info.title}**`);
  if (info.description) parts.push(info.description);

  const last = path[path.length - 1];
  if (onValue !== undefined && typeof last === 'string') {
    const doc = branchDocs(schema.schemasAt(root, path.slice(0, -1)), last).get(String(onValue));
    if (doc) parts.push(`---\n\n**${doc.title ?? String(onValue)}**${doc.description ? `\n\n${doc.description}` : ''}`);
  }
  const meta = docText({ ...info, description: undefined });
  if (meta) parts.push(meta);
  return parts.length > 0 ? { markdown: parts.join('\n\n') } : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}
