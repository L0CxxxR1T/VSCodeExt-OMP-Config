import { parseTOML, type AST } from 'toml-eslint-parser';
import type { ArrayNode, AstNode, ObjectNode, ParseResult, PropertyNode, Span } from '../ast';
import { getProperty } from '../ast';

export function parseToml(text: string): ParseResult {
  let program: AST.TOMLProgram;
  try {
    program = parseTOML(text, { tomlVersion: '1.0' });
  } catch (e) {
    const err = e as { index?: number; message?: string };
    const index = typeof err.index === 'number' ? err.index : 0;
    return {
      root: undefined,
      errors: [{ message: `TOML の構文エラーです。（${err.message ?? String(e)}）`, span: { start: index, end: index + 1 } }],
    };
  }

  const root: ObjectNode = { kind: 'object', span: { start: 0, end: text.length }, properties: [] };
  for (const item of program.body[0].body) {
    if (item.type === 'TOMLKeyValue') insertKeyValue(root, item);
    else insertTable(root, item);
  }
  return { root, errors: [] };
}

function spanOf(node: { range: [number, number] }): Span {
  return { start: node.range[0], end: node.range[1] };
}

function keyName(part: AST.TOMLBare | AST.TOMLQuoted): string {
  return part.type === 'TOMLBare' ? part.name : part.value;
}

function extend(node: AstNode, span: Span): void {
  node.span = { start: Math.min(node.span.start, span.start), end: Math.max(node.span.end, span.end) };
}

function insertKeyValue(container: ObjectNode, kv: AST.TOMLKeyValue): void {
  const parts = kv.key.keys;
  let current = container;
  for (let i = 0; i < parts.length - 1; i++) {
    const name = keyName(parts[i]);
    let prop = getProperty(current, name);
    if (!prop || prop.value?.kind !== 'object') {
      prop = { key: name, keySpan: spanOf(parts[i]), value: { kind: 'object', span: spanOf(kv), properties: [] } };
      current.properties.push(prop);
    }
    current = prop.value as ObjectNode;
    extend(current, spanOf(kv));
  }
  const last = parts[parts.length - 1];
  current.properties.push({ key: keyName(last), keySpan: spanOf(last), value: convertValue(kv.value) });
}

function convertValue(node: AST.TOMLContentNode): AstNode {
  const span = spanOf(node);
  if (node.type === 'TOMLArray') return { kind: 'array', span, items: node.elements.map(convertValue) };
  if (node.type === 'TOMLInlineTable') {
    const obj: ObjectNode = { kind: 'object', span, properties: [] };
    for (const kv of node.body) insertKeyValue(obj, kv);
    return obj;
  }
  switch (node.kind) {
    case 'string':
    case 'integer':
    case 'float':
    case 'boolean':
      return { kind: 'scalar', span, value: node.value };
    default:
      return { kind: 'scalar', span, value: node.datetime };
  }
}

/**
 * [a.b] や [[a.b]] を root からたどって配置する。
 * resolvedKey には配列テーブルの添字も含まれるため、文字列の区切りだけを key.keys と対応させる。
 */
function insertTable(root: ObjectNode, table: AST.TOMLTable): void {
  const tableSpan = spanOf(table);
  const parts = table.key.keys;
  const resolved = table.resolvedKey;
  let current: AstNode = root;
  let partIndex = 0;

  for (let i = 0; i < resolved.length; i++) {
    const segment = resolved[i];
    const isLast = i === resolved.length - 1;
    const nextIsIndex = !isLast && typeof resolved[i + 1] === 'number';

    if (typeof segment === 'string') {
      const part = parts[partIndex++];
      const obj = current as ObjectNode;
      let prop: PropertyNode | undefined = getProperty(obj, segment);
      if (!prop || !prop.value) {
        const value: AstNode = nextIsIndex
          ? { kind: 'array', span: { ...tableSpan }, items: [] }
          : { kind: 'object', span: { ...tableSpan }, properties: [] };
        prop = { key: segment, keySpan: part ? spanOf(part) : { ...tableSpan }, value };
        obj.properties.push(prop);
      }
      current = prop.value as AstNode;
    } else {
      const arr = current as ArrayNode;
      while (arr.items.length <= segment) arr.items.push({ kind: 'object', span: { ...tableSpan }, properties: [] });
      current = arr.items[segment];
    }
    extend(current, tableSpan);
  }

  if (current.kind !== 'object') return;
  for (const kv of table.body) insertKeyValue(current, kv);
}
