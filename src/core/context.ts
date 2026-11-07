import { getLocation, type Node as JsonNode } from 'jsonc-parser';
import type { AstNode, Format, Path, Span } from './ast';
import { forEachScalar, getProperty, nodeAtPath } from './ast';
import { parse } from './parse';

/** 補完位置の種類。root は補完のために組み立て直した構文木で、元の文書とオフセットがずれていることがある。 */
export type CursorContext =
  | {
      kind: 'key';
      root: AstNode | undefined;
      parentPath: Path;
      existing: Set<string>;
      replace: Span;
      /** 既存のキーを書き換えている途中で、後ろに : や = が続いている */
      keyOnly: boolean;
      /** YAML で子要素を書くときのインデント */
      indent: string;
    }
  | { kind: 'value'; root: AstNode | undefined; path: Path; replace: Span; quote: string | null }
  | { kind: 'palette'; root: AstNode | undefined; replace: Span };

const PLACEHOLDER = '__omp_cursor__';
const PALETTE_BEFORE = /(?<![\w:/.])p:([\w.-]*)$/;
const WORD_AFTER = /^[\w.-]*/;

export function getCursorContext(text: string, offset: number, format: Format): CursorContext | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEndRaw = text.indexOf('\n', offset);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  const before = text.slice(lineStart, offset);
  const after = text.slice(offset, lineEnd).replace(/\r$/, '');

  switch (format) {
    case 'json':
      return jsonContext(text, offset, before, after);
    case 'yaml':
      return yamlContext(text, offset, lineStart, lineEnd, before, after);
    case 'toml':
      return tomlContext(text, offset, lineStart, lineEnd, before, after);
  }
}

function paletteContext(root: AstNode | undefined, offset: number, before: string, after: string): CursorContext | undefined {
  const m = before.match(PALETTE_BEFORE);
  if (!m) return undefined;
  const start = offset - m[0].length;
  const end = offset + (after.match(WORD_AFTER)?.[0].length ?? 0);
  return { kind: 'palette', root, replace: { start, end } };
}

function jsonContext(text: string, offset: number, before: string, after: string): CursorContext | undefined {
  const root = parse(text, 'json').root;
  const location = getLocation(text, offset);
  const prev: JsonNode | undefined = location.previousNode;
  const prevSpan = prev ? { start: prev.offset, end: prev.offset + prev.length } : undefined;
  const onPrev = prevSpan !== undefined && prevSpan.start < offset && offset <= prevSpan.end;

  if (onPrev && prev?.type === 'string' && !location.isAtPropertyKey) {
    const palette = paletteContext(root, offset, before, after);
    if (palette) return palette;
  }

  if (location.isAtPropertyKey) {
    const parentPath = location.path.slice(0, -1);
    const replace = onPrev && prev?.type === 'string' ? prevSpan! : { start: offset, end: offset };
    const keyOnly = /^\s*:/.test(text.slice(replace.end, replace.end + 200));
    return { kind: 'key', root, parentPath, existing: existingKeys(root, parentPath), replace, keyOnly, indent: '' };
  }

  const isScalar = prev && prev.type !== 'object' && prev.type !== 'array' && prev.type !== 'property';
  const replace = onPrev && isScalar ? prevSpan! : { start: offset, end: offset };
  return { kind: 'value', root, path: location.path, replace, quote: null };
}

function yamlContext(
  text: string,
  offset: number,
  lineStart: number,
  lineEnd: number,
  before: string,
  after: string,
): CursorContext | undefined {
  if (/^\s*#/.test(before)) return undefined;

  // key: value の値側
  const valueMatch = before.match(/^(\s*(?:-\s+)*)((?:[\w.-]+|"[^"]*"|'[^']*'))(\s*:\s+)(.*)$/);
  if (valueMatch) {
    const valueStart = lineStart + valueMatch[1].length + valueMatch[2].length + valueMatch[3].length;
    const patched = text.slice(0, valueStart) + PLACEHOLDER + text.slice(lineEnd);
    const parsed = parse(patched, 'yaml').root;
    const path = findPlaceholderValue(parsed);
    const palette = paletteContext(parsed, offset, before, after);
    if (palette) return palette;
    if (!path) return undefined;
    return { kind: 'value', root: parsed, path, ...quotedReplace(text, valueStart, offset, lineEnd) };
  }

  // - 'value' のような配列要素
  const itemMatch = before.match(/^(\s*(?:-\s+)+)(["'])(.*)$/);
  if (itemMatch) {
    const valueStart = lineStart + itemMatch[1].length;
    const patched = text.slice(0, valueStart) + PLACEHOLDER + text.slice(lineEnd);
    const parsed = parse(patched, 'yaml').root;
    const palette = paletteContext(parsed, offset, before, after);
    if (palette) return palette;
    const path = findPlaceholderValue(parsed);
    if (!path) return undefined;
    return { kind: 'value', root: parsed, path, ...quotedReplace(text, valueStart, offset, lineEnd) };
  }

  const keyMatch = before.match(/^(\s*)((?:-\s+)*)([\w-]*)$/);
  if (keyMatch) {
    const wordStart = offset - keyMatch[3].length;
    const wordEnd = offset + (after.match(/^[\w-]*/)?.[0].length ?? 0);
    const keyOnly = /^\s*:/.test(text.slice(wordEnd, lineEnd));
    const patched = text.slice(0, wordStart) + `${PLACEHOLDER}: 0` + text.slice(lineEnd);
    const parsed = parse(patched, 'yaml').root;
    const found = findPlaceholderKey(parsed);
    if (!found) return undefined;
    const indent = ' '.repeat(keyMatch[1].length + keyMatch[2].length);
    return {
      kind: 'key',
      root: parsed,
      parentPath: found.parentPath,
      existing: found.siblings,
      replace: { start: wordStart, end: wordEnd },
      keyOnly,
      indent,
    };
  }
  return undefined;
}

function tomlContext(
  text: string,
  offset: number,
  lineStart: number,
  lineEnd: number,
  before: string,
  after: string,
): CursorContext | undefined {
  if (/^\s*(#|\[)/.test(before)) return undefined;
  const keyPattern = String.raw`(?:[\w-]+|"[^"]*"|'[^']*')`;

  const valueMatch = before.match(new RegExp(String.raw`^(\s*${keyPattern}(?:\s*\.\s*${keyPattern})*\s*=\s*)(.*)$`));
  if (valueMatch) {
    const valueStart = lineStart + valueMatch[1].length;
    const patched = text.slice(0, valueStart) + `'${PLACEHOLDER}'` + text.slice(lineEnd);
    const parsed = parse(patched, 'toml').root;
    const palette = paletteContext(parsed, offset, before, after);
    if (palette) return palette;
    const path = findPlaceholderValue(parsed);
    if (!path) return undefined;
    return { kind: 'value', root: parsed, path, ...quotedReplace(text, valueStart, offset, lineEnd) };
  }

  const keyMatch = before.match(/^(\s*)((?:[\w-]+\s*\.\s*)*)([\w-]*)$/);
  if (keyMatch) {
    const wordStart = offset - keyMatch[3].length;
    const wordEnd = offset + (after.match(/^[\w-]*/)?.[0].length ?? 0);
    const keyOnly = /^\s*=/.test(text.slice(wordEnd, lineEnd));
    const patched = text.slice(0, wordStart) + `${PLACEHOLDER} = 0` + text.slice(lineEnd);
    const parsed = parse(patched, 'toml').root;
    const found = findPlaceholderKey(parsed);
    if (!found) return undefined;
    return {
      kind: 'key',
      root: parsed,
      parentPath: found.parentPath,
      existing: found.siblings,
      replace: { start: wordStart, end: wordEnd },
      keyOnly,
      indent: '',
    };
  }
  return undefined;
}

/** 入力済みの引用符の内側だけを置き換える範囲を求める。 */
function quotedReplace(text: string, valueStart: number, offset: number, lineEnd: number): { replace: Span; quote: string | null } {
  const first = text[valueStart];
  if (first === '"' || first === "'") {
    const closing = text.indexOf(first, offset);
    const end = closing >= 0 && closing <= lineEnd ? closing : offset;
    return { replace: { start: valueStart + 1, end }, quote: first };
  }
  const rest = text.slice(valueStart, lineEnd).replace(/\s+#.*$/, '').replace(/\s+$/, '');
  return { replace: { start: valueStart, end: Math.max(offset, valueStart + rest.length) }, quote: null };
}

function existingKeys(root: AstNode | undefined, path: Path): Set<string> {
  const node = nodeAtPath(root, path);
  return new Set(node?.kind === 'object' ? node.properties.map((p) => p.key) : []);
}

function findPlaceholderKey(root: AstNode | undefined): { parentPath: Path; siblings: Set<string> } | undefined {
  let result: { parentPath: Path; siblings: Set<string> } | undefined;
  const visit = (node: AstNode, path: Path): void => {
    if (result) return;
    if (node.kind === 'array') node.items.forEach((item, i) => visit(item, [...path, i]));
    if (node.kind !== 'object') return;
    if (getProperty(node, PLACEHOLDER)) {
      result = { parentPath: path, siblings: new Set(node.properties.map((p) => p.key).filter((k) => k !== PLACEHOLDER)) };
      return;
    }
    for (const prop of node.properties) if (prop.value) visit(prop.value, [...path, prop.key]);
  };
  if (root) visit(root, []);
  return result;
}

function findPlaceholderValue(root: AstNode | undefined): Path | undefined {
  let result: Path | undefined;
  forEachScalar(root, (node, path) => {
    if (!result && node.value === PLACEHOLDER) result = path;
  });
  return result;
}
