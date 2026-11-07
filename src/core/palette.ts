import type { AstNode, ObjectNode, Span } from './ast';
import { forEachScalar, getProperty } from './ast';

export interface PaletteEntry {
  name: string;
  /** 引用符を除いたキー名の範囲 */
  nameSpan: Span;
  value: string | undefined;
  /** palette なら undefined、palettes.list.<名前> ならその名前 */
  list: string | undefined;
}

export interface PaletteRef {
  name: string;
  /** p: を含む範囲 */
  span: Span;
  nameSpan: Span;
}

export interface HexColor {
  span: Span;
  hex: string;
}

// URL の "http://" や "ftp:" などを拾わないよう、直前が英数字・コロン・スラッシュ・ドットのときは除外する
const REF_PATTERN = /(?<![\w:/.])p:([\w-]+(?:\.[\w-]+)*)/g;
const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w])/g;
export const PALETTE_NAME_PATTERN = /^[\w-]+(?:\.[\w-]+)*$/;

export function collectPalette(root: AstNode | undefined, text: string): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  const add = (obj: AstNode | undefined, list: string | undefined): void => {
    if (obj?.kind !== 'object') return;
    for (const prop of obj.properties) {
      entries.push({
        name: prop.key,
        nameSpan: unquotedSpan(text, prop.keySpan),
        value: prop.value?.kind === 'scalar' && typeof prop.value.value === 'string' ? prop.value.value : undefined,
        list,
      });
    }
  };
  add(getProperty(root, 'palette')?.value, undefined);
  const lists = getProperty(getProperty(root, 'palettes')?.value, 'list')?.value;
  if (lists?.kind === 'object') for (const prop of (lists as ObjectNode).properties) add(prop.value, prop.key);
  return entries;
}

/** 文字列値の中にある p:名前 を、元のテキスト上の位置で返す。 */
export function findPaletteRefs(root: AstNode | undefined, text: string): PaletteRef[] {
  const refs: PaletteRef[] = [];
  forEachScalar(root, (node) => {
    if (typeof node.value !== 'string') return;
    const raw = text.slice(node.span.start, node.span.end);
    for (const m of raw.matchAll(REF_PATTERN)) {
      const start = node.span.start + m.index;
      refs.push({ name: m[1], span: { start, end: start + m[0].length }, nameSpan: { start: start + 2, end: start + m[0].length } });
    }
  });
  return refs;
}

export function findHexColors(root: AstNode | undefined, text: string): HexColor[] {
  const colors: HexColor[] = [];
  forEachScalar(root, (node) => {
    if (typeof node.value !== 'string') return;
    const raw = text.slice(node.span.start, node.span.end);
    for (const m of raw.matchAll(HEX_PATTERN)) {
      const start = node.span.start + m.index;
      colors.push({ span: { start, end: start + m[0].length }, hex: m[0] });
    }
  });
  return colors;
}

/** パレットの値が別の p: 参照なら辿って、最終的な色を返す。 */
export function resolveColor(entries: PaletteEntry[], name: string, list?: string): string | undefined {
  const seen = new Set<string>();
  let current = name;
  while (!seen.has(current)) {
    seen.add(current);
    const entry = entries.find((e) => e.name === current && e.list === list) ?? entries.find((e) => e.name === current);
    const value = entry?.value;
    if (!value) return undefined;
    const m = value.match(/^p:(.+)$/);
    if (!m) return value;
    current = m[1];
  }
  return undefined;
}

export function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
  const m = hex.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function unquotedSpan(text: string, span: Span): Span {
  const first = text[span.start];
  if ((first === '"' || first === "'") && text[span.end - 1] === first && span.end - span.start >= 2) {
    return { start: span.start + 1, end: span.end - 1 };
  }
  return span;
}
