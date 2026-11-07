import { describe, expect, it } from 'vitest';
import type { Format } from '../src/core/ast';
import { collectPalette, findHexColors, findPaletteRefs, resolveColor } from '../src/core/palette';
import { parse } from '../src/core/parse';

const cases: [Format, string][] = [
  ['json', '{"palette": {"base": "#d3d5d9", "alias": "p:base"}, "palettes": {"list": {"dark": {"base": "#000"}}}, "x": "{{if .Root}}p:base{{end}} http://p:no", "y": "<#fff>a</>"}'],
  ['yaml', "palette:\n  base: '#d3d5d9'\n  alias: p:base\npalettes:\n  list:\n    dark:\n      base: '#000'\nx: '{{if .Root}}p:base{{end}} http://p:no'\ny: '<#fff>a</>'\n"],
  ['toml', "x = '{{if .Root}}p:base{{end}} http://p:no'\ny = '<#fff>a</>'\n[palette]\nbase = '#d3d5d9'\nalias = 'p:base'\n[palettes.list.dark]\nbase = '#000'\n"],
];

describe('パレット', () => {
  it.each(cases)('%s でパレット定義と参照を集める', (format, text) => {
    const root = parse(text, format).root;
    const entries = collectPalette(root, text);
    expect(entries.map((e) => `${e.list ?? '-'}:${e.name}`).sort()).toEqual(['-:alias', '-:base', 'dark:base']);
    for (const e of entries) expect(text.slice(e.nameSpan.start, e.nameSpan.end)).toBe(e.name);

    const refs = findPaletteRefs(root, text);
    expect(refs.map((r) => text.slice(r.span.start, r.span.end))).toEqual(['p:base', 'p:base']);
    expect(resolveColor(entries, 'alias')).toBe('#d3d5d9');

    expect(findHexColors(root, text).map((c) => c.hex).sort()).toEqual(['#000', '#d3d5d9', '#fff']);
  });
});
