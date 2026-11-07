import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Format } from '../src/core/ast';
import { parse } from '../src/core/parse';
import { SchemaModel } from '../src/core/schema';

const schema = new SchemaModel(JSON.parse(readFileSync(join(__dirname, '..', 'schemas', 'oh-my-posh.schema.json'), 'utf8')));
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function validate(text: string, format: Format) {
  return schema.validate(parse(text, format).root).map((i) => ({ ...i, text: text.slice(i.span.start, i.span.end) }));
}

describe('スキーマ検証', () => {
  it.each(['l0c.omp.json', 'l0c.omp.yaml', 'l0c.omp.toml'])('%s を検証する', (name) => {
    const format = name.split('.').pop() as Format;
    const issues = validate(fixture(name), format);
    expect(issues).toEqual([]);
  });

  it('未知のセグメント種別を enum エラーにする', () => {
    const text = 'blocks:\n  - type: prompt\n    alignment: left\n    segments:\n      - type: gti\n        style: plain\n';
    const issues = validate(text, 'yaml');
    expect(issues).toHaveLength(1);
    expect(issues[0].text).toBe('gti');
    expect(issues[0].message).toContain('指定できる値は');
  });

  it('セグメントに存在しないオプションをキーの位置で報告する', () => {
    const text = 'blocks:\n  - type: prompt\n    alignment: left\n    segments:\n      - type: claude\n        style: plain\n        options:\n          nope: 1\n';
    const issues = validate(text, 'yaml');
    expect(issues.map((i) => i.text)).toEqual(['nope']);
  });

  it('色の形式エラーを1件にまとめる', () => {
    const text = '{"blocks": [{"type": "prompt", "alignment": "left", "segments": [{"type": "text", "style": "plain", "foreground": "#12"}]}]}';
    const issues = validate(text, 'json');
    expect(issues).toHaveLength(1);
    expect(issues[0].text).toBe('"#12"');
  });

  it('必須プロパティの欠落を報告する', () => {
    const issues = validate('[[blocks]]\ntype = "prompt"\nalignment = "left"\n[[blocks.segments]]\ntype = "path"\n', 'toml');
    expect(issues.map((i) => i.message)).toEqual(['必須プロパティ「style」がありません。']);
  });

  it('if/then を値に応じて展開する', () => {
    const root = parse('blocks:\n  - segments:\n      - type: git\n        options: {}\n', 'yaml').root;
    const schemas = schema.schemasAt(root, ['blocks', 0, 'segments', 0, 'options']);
    const keys = new Set(schemas.flatMap((s) => Object.keys(s.schema.properties ?? {})));
    expect(keys.has('branch_icon')).toBe(true);
    expect(keys.has('gauge_marked_char')).toBe(false);
  });
});
