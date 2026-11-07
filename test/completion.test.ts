import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Format } from '../src/core/ast';
import { findHit } from '../src/core/ast';
import { buildCandidates, hoverFor } from '../src/core/completion';
import { getCursorContext } from '../src/core/context';
import { collectPalette } from '../src/core/palette';
import { parse } from '../src/core/parse';
import { SchemaModel } from '../src/core/schema';

const schema = new SchemaModel(JSON.parse(readFileSync(join(__dirname, '..', 'schemas', 'oh-my-posh.schema.json'), 'utf8')));

/** | の位置をカーソルとして補完候補を返す */
function complete(source: string, format: Format) {
  const offset = source.indexOf('|');
  const text = source.slice(0, offset) + source.slice(offset + 1);
  const ctx = getCursorContext(text, offset, format);
  if (!ctx) return { ctx, labels: [] as string[], candidates: [] };
  const candidates = buildCandidates(ctx, format, schema, collectPalette(ctx.root, text));
  return { ctx, text, labels: candidates.map((c) => c.label), candidates };
}

const PALETTE = { json: '"palette": {"base": "#fff"}', yaml: 'palette:\n  base: "#fff"\n', toml: '[palette]\nbase = "#fff"\n' };

describe('補完', () => {
  it.each<[Format, string]>([
    ['json', '{"blocks": [{"type": "prompt", "segments": [{"type": "git", "options": {"|"}}]}]}'],
    ['yaml', 'blocks:\n  - type: prompt\n    segments:\n      - type: git\n        options:\n          bra|\n'],
    ['toml', '[[blocks]]\ntype = "prompt"\n[[blocks.segments]]\ntype = "git"\n[blocks.segments.options]\nbra|\n'],
  ])('%s でセグメント種別に応じたオプションのキーを出す', (format, source) => {
    const { ctx, labels } = complete(source, format);
    expect(ctx?.kind).toBe('key');
    expect(labels).toContain('branch_icon');
    expect(labels).not.toContain('gauge_marked_char');
  });

  it.each<[Format, string]>([
    ['json', '{"blocks": [{"segments": [{"type": "|"}]}]}'],
    ['yaml', 'blocks:\n  - segments:\n      - type: |\n'],
    ['toml', '[[blocks]]\n[[blocks.segments]]\ntype = |\n'],
  ])('%s でセグメント種別の値を説明付きで出す', (format, source) => {
    const { ctx, candidates } = complete(source, format);
    expect(ctx?.kind).toBe('value');
    const git = candidates.find((c) => c.label === 'git');
    expect(git?.detail).toMatch(/Git/);
  });

  it('既存キーは候補から外し、YAML の入れ子にはインデントを付ける', () => {
    const { labels, candidates } = complete('blocks:\n  - type: prompt\n    |\n', 'yaml');
    expect(labels).not.toContain('type');
    expect(candidates.find((c) => c.label === 'segments')?.insertText).toBe('segments:\n      - $1');
  });

  it('TOML の文字列値は引用符付きで挿入する', () => {
    const { candidates } = complete('[[blocks]]\nalignment = |\n', 'toml');
    expect(candidates.find((c) => c.label === 'left')?.insertText).toBe("'left'");
  });

  it('入力済みの引用符の内側だけを置き換える', () => {
    const { ctx, candidates } = complete("[[blocks]]\nalignment = 'le|'\n", 'toml');
    expect(ctx?.replace).toEqual({ start: 24, end: 26 });
    expect(candidates.find((c) => c.label === 'left')?.insertText).toBe('left');
  });

  it.each<[Format, string]>([
    ['json', `{${PALETTE.json}, "blocks": [{"segments": [{"foreground": "|"}]}]}`],
    ['yaml', `${PALETTE.yaml}blocks:\n  - segments:\n      - foreground: |\n`],
    ['toml', `${PALETTE.toml}[[blocks]]\n[[blocks.segments]]\nforeground = |\n`],
  ])('%s で色の位置にパレット参照を出す', (format, source) => {
    const { candidates } = complete(source, format);
    const ref = candidates.find((c) => c.label === 'p:base');
    expect(ref?.color).toBe('#fff');
  });

  it.each<[Format, string]>([
    ['json', `{${PALETTE.json}, "blocks": [{"segments": [{"foreground_templates": ["{{if .Root}}p:|{{end}}"]}]}]}`],
    ['yaml', `${PALETTE.yaml}blocks:\n  - segments:\n      - foreground_templates:\n          - '{{if .Root}}p:b|{{end}}'\n`],
    ['toml', `${PALETTE.toml}[[blocks]]\n[[blocks.segments]]\nbackground_templates = ['{{if .Root}}p:|{{end}}']\n`],
  ])('%s でテンプレート内の p: に続けてパレット名を出す', (format, source) => {
    const { ctx, labels } = complete(source, format);
    expect(ctx?.kind).toBe('palette');
    expect(labels).toEqual(['p:base']);
  });
});

describe('ホバー', () => {
  it('セグメント種別の値にセグメントの説明を出す', () => {
    const text = 'blocks:\n  - segments:\n      - type: git\n';
    const root = parse(text, 'yaml').root;
    const hit = findHit(root, text.indexOf('git') + 1);
    expect(hit?.type).toBe('value');
    const hover = hoverFor(root, hit!.path, 'git', schema);
    expect(hover?.markdown).toMatch(/Git Segment/);
  });
});
