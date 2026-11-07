import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type Node, type YAMLError } from 'yaml';
import type { AstNode, ParseIssue, ParseResult, PropertyNode, Span } from '../ast';

const ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_KEY: 'キーが重複しています。',
  BAD_INDENT: 'インデントが正しくありません。',
  TAB_AS_INDENT: 'インデントにタブは使えません。',
  MISSING_CHAR: '必要な文字がありません。',
  BLOCK_AS_IMPLICIT_KEY: 'ブロックをキーとして使うことはできません。',
  MULTILINE_IMPLICIT_KEY: 'キーは1行で書く必要があります。',
  UNEXPECTED_TOKEN: '予期しないトークンです。',
  BAD_SCALAR_START: 'この文字から始まる値は引用符で囲む必要があります。',
};

export function parseYaml(text: string): ParseResult {
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true, keepSourceTokens: false });
  const errors: ParseIssue[] = doc.errors.map(toIssue);
  const contents = doc.contents as Node | null;
  return { root: contents ? convert(contents, doc) : undefined, errors };
}

function toIssue(e: YAMLError): ParseIssue {
  const base = ERROR_MESSAGES[e.code] ?? 'YAML の構文エラーです。';
  return { message: `${base}（${e.message}）`, span: { start: e.pos[0], end: Math.max(e.pos[1], e.pos[0] + 1) } };
}

function spanOf(node: Node): Span {
  const [start, valueEnd] = node.range ?? [0, 0];
  return { start, end: valueEnd };
}

function convert(node: Node, doc: Document, depth = 0): AstNode {
  // アンカーの循環参照で無限に展開しないよう深さを制限する
  if (isAlias(node) && depth < 32) {
    const target = node.resolve(doc);
    if (target) return { ...convert(target as Node, doc, depth + 1), span: spanOf(node) };
  }
  if (isMap(node)) {
    const properties: PropertyNode[] = [];
    for (const pair of node.items) {
      const keyNode = pair.key as Node | null;
      if (!keyNode) continue;
      const key = isScalar(keyNode) ? String(keyNode.value) : String(keyNode.toJSON());
      const valueNode = pair.value as Node | null;
      properties.push({ key, keySpan: spanOf(keyNode), value: valueNode ? convert(valueNode, doc, depth) : undefined });
    }
    return { kind: 'object', span: spanOf(node), properties };
  }
  if (isSeq(node)) {
    return { kind: 'array', span: spanOf(node), items: node.items.map((item) => convert(item as Node, doc, depth)) };
  }
  if (isScalar(node)) {
    const v = node.value;
    const value = v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
    return { kind: 'scalar', span: spanOf(node), value };
  }
  return { kind: 'scalar', span: spanOf(node), value: null };
}
