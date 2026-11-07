import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { describe, expect, it } from 'vitest';
import { parse as parseYamlRef } from 'yaml';
import { findHit, toValue } from '../src/core/ast';
import { parse } from '../src/core/parse';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('パーサー', () => {
  it('JSON を JSON.parse と同じ値に変換する', () => {
    const text = fixture('l0c.omp.json');
    const result = parse(text, 'json');
    expect(result.errors).toEqual([]);
    expect(toValue(result.root)).toEqual(JSON.parse(text));
  });

  it('YAML を yaml ライブラリと同じ値に変換する', () => {
    const text = fixture('l0c.omp.yaml');
    const result = parse(text, 'yaml');
    expect(result.errors).toEqual([]);
    expect(toValue(result.root)).toEqual(parseYamlRef(text));
  });

  it('TOML の配列テーブルとネストしたテーブルを組み立てる', () => {
    const text = fixture('l0c.omp.toml');
    const result = parse(text, 'toml');
    expect(result.errors).toEqual([]);
    expect(toValue(result.root)).toEqual(getStaticTOMLValue(parseTOML(text)));
  });

  it('TOML のドット付きキーとインラインテーブルを扱う', () => {
    const text = 'a.b = 1\nc = { d = "x", e.f = true }\n[[t]]\nk = 1\n[[t]]\nk = 2\n[t.sub]\nz = [1, 2]\n';
    expect(toValue(parse(text, 'toml').root)).toEqual(getStaticTOMLValue(parseTOML(text)));
  });

  it.each([
    ['json', '{"blocks": [{"type": "prompt"}]}'],
    ['yaml', 'blocks:\n  - type: prompt\n'],
    ['toml', '[[blocks]]\ntype = "prompt"\n'],
  ] as const)('%s でキーと値の位置からパスを求める', (format, text) => {
    const result = parse(text, format);
    const keyHit = findHit(result.root, text.indexOf('type') + 1);
    expect(keyHit).toMatchObject({ type: 'key', path: ['blocks', 0, 'type'] });
    const valueHit = findHit(result.root, text.indexOf('prompt') + 1);
    expect(valueHit).toMatchObject({ type: 'value', path: ['blocks', 0, 'type'] });
  });

  it('構文エラーを位置付きで返す', () => {
    expect(parse('{"a": }', 'json').errors.length).toBeGreaterThan(0);
    expect(parse('a: [1, 2', 'yaml').errors.length).toBeGreaterThan(0);
    const toml = parse('a = = 1', 'toml');
    expect(toml.root).toBeUndefined();
    expect(toml.errors[0].span.start).toBeGreaterThan(0);
  });
});
