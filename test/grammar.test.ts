import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import * as oniguruma from 'vscode-oniguruma';
import { INITIAL, parseRawGrammar, Registry, type IGrammar } from 'vscode-textmate';
import { beforeAll, describe, expect, it } from 'vitest';

/** 組み込みの JSON / YAML 文法を読むため、インストール済み VS Code の extensions フォルダを探す */
function findBuiltinExtensions(): string | undefined {
  const candidates: string[] = [];
  if (process.env.VSCODE_BUILTIN_EXTENSIONS) candidates.push(process.env.VSCODE_BUILTIN_EXTENSIONS);
  try {
    const cmd = process.platform === 'win32' ? 'where code' : 'which code';
    const codeBin = execSync(cmd, { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    const installDir = dirname(dirname(codeBin));
    for (const entry of readdirSync(installDir)) candidates.push(join(installDir, entry, 'resources', 'app', 'extensions'));
    candidates.push(join(installDir, 'resources', 'app', 'extensions'));
  } catch {
    // code コマンドがない環境では環境変数だけを見る
  }
  return candidates.find((c) => existsSync(join(c, 'json', 'package.json')));
}

const builtin = findBuiltinExtensions();
const root = join(__dirname, '..');

function grammarPaths(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (extDir: string) => {
    const pkg = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8'));
    for (const g of pkg.contributes?.grammars ?? []) map.set(g.scopeName, join(extDir, g.path));
  };
  add(join(builtin!, 'json'));
  add(join(builtin!, 'yaml'));
  add(root);
  return map;
}

describe.skipIf(!builtin)('文法', () => {
  const grammars = new Map<string, IGrammar>();

  beforeAll(async () => {
    const wasm = readFileSync(join(root, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const paths = grammarPaths();
    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner: (s) => new oniguruma.OnigScanner(s), createOnigString: (s) => new oniguruma.OnigString(s) }),
      loadGrammar: async (scope) => {
        const p = paths.get(scope);
        return p ? parseRawGrammar(readFileSync(p, 'utf8'), p) : null;
      },
      getInjections: (scope) => (scope.startsWith('source.omp.') && scope !== 'source.omp.template-injection' ? ['source.omp.template-injection'] : undefined),
    });
    for (const scope of ['source.omp.json', 'source.omp.yaml', 'source.omp.toml']) {
      const g = await registry.loadGrammar(scope);
      if (!g) throw new Error(`文法を読めませんでした: ${scope}`);
      grammars.set(scope, g);
    }
  });

  /** text 中の各トークンについて、指定した部分文字列に付いたスコープを返す */
  function scopesOf(scope: string, text: string): (needle: string) => string[] {
    const grammar = grammars.get(scope)!;
    const tokens: { text: string; scopes: string[] }[] = [];
    let stack = INITIAL;
    for (const line of text.split('\n')) {
      const result = grammar.tokenizeLine(line, stack);
      for (const t of result.tokens) tokens.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
      stack = result.ruleStack;
    }
    return (needle) => tokens.find((t) => t.text === needle)?.scopes ?? [`(${needle} が見つかりません: ${tokens.map((t) => t.text).join('|')})`];
  }

  it.each([
    ['source.omp.json', '{\n  "template": "{{if .Root}}x{{ else }}<b>{{ .UserName }}</b>{{end}}",\n  "foreground_templates": ["{{if eq .Shell \\"pwsh\\"}}p:rd{{end}}"]\n}'],
    ['source.omp.yaml', "template: '{{if .Root}}x{{ else }}<b>{{ .UserName }}</b>{{end}}'\nforeground_templates:\n  - '{{if eq .Shell \"pwsh\"}}p:rd{{end}}'\n"],
    ['source.omp.toml', "template = '{{if .Root}}x{{ else }}<b>{{ .UserName }}</b>{{end}}'\nforeground_templates = [\"{{if eq .Shell \\\"pwsh\\\"}}p:rd{{end}}\"]\n"],
  ])('%s の文字列でテンプレートを色分けする', (scope, text) => {
    const s = scopesOf(scope, text);
    expect(s('if')).toContain('keyword.control.go-template');
    expect(s('.Root')).toContain('variable.other.property.go-template');
    expect(s('.UserName')).toContain('variable.other.property.go-template');
    expect(s('eq')).toContain('support.function.go-template');
    expect(s('rd')).toContain('variable.other.constant.palette.omp');
    expect(s('b')).toContain('entity.name.tag.omp');
    expect(s('{{')).toContain('punctuation.section.embedded.begin.go-template');
  });

  it('閉じていない {{ が次の行に続かない', () => {
    const s = scopesOf('source.omp.json', '{\n  "template": "{{ .Foo",\n  "style": "plain"\n}');
    expect(s('style').join(' ')).not.toContain('go-template');
    expect(s('style').join(' ')).toContain('support.type.property-name.json');
  });

  it('TOML のテーブル・キー・値を色分けする', () => {
    const s = scopesOf('source.omp.toml', "version = 4\n[[blocks.segments]]\n  type = 'git' # コメント\n[palette]\n  base = '#fff'\n");
    expect(s('blocks.segments')).toContain('entity.name.tag.table.array.toml');
    expect(s('palette')).toContain('entity.name.tag.table.toml');
    expect(s('type')).toContain('support.type.property-name.toml');
    expect(s('4')).toContain('constant.numeric.toml');
    expect(s(' コメント')).toContain('comment.line.number-sign.toml');
  });
});
