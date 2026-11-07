const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vscode = require('vscode');

const fixtures = path.join(__dirname, '..', 'fixtures');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`タイムアウト: ${label}`);
    await wait(100);
  }
}

async function open(file) {
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  return doc;
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('*.omp.* を各言語として開く', async () => {
  for (const [f, id] of [['l0c.omp.json', 'omp-json'], ['l0c.omp.yaml', 'omp-yaml'], ['l0c.omp.toml', 'omp-toml']]) {
    const doc = await open(path.join(fixtures, f));
    assert.strictEqual(doc.languageId, id);
  }
});

check('手持ちの設定ファイルに診断が出ない', async () => {
  for (const f of ['l0c.omp.json', 'l0c.omp.yaml', 'l0c.omp.toml']) {
    const doc = await open(path.join(fixtures, f));
    await wait(800);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(doc.uri).map((d) => d.message), [], f);
  }
});

let tmpDir;
check('スキーマ違反と未定義パレットを診断する', async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-int-'));
  const file = path.join(tmpDir, 'bad.omp.yaml');
  fs.writeFileSync(file, 'blocks:\n  - type: prompt\n    alignment: left\n    segments:\n      - type: gti\n        style: plain\n        foreground: p:nope\n');
  const doc = await open(file);
  const diags = await waitFor(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d.length >= 2 ? d : undefined;
  }, '診断');
  const messages = diags.map((d) => d.message);
  assert.ok(messages.some((m) => m.includes('指定できる値は')), messages.join('\n'));
  assert.ok(messages.some((m) => m.includes('「nope」が定義されていません')), messages.join('\n'));
});

check('補完でセグメント種別ごとのオプションを出す', async () => {
  const file = path.join(tmpDir, 'comp.omp.toml');
  fs.writeFileSync(file, "[[blocks]]\ntype = 'prompt'\n[[blocks.segments]]\ntype = 'git'\n[blocks.segments.options]\nbra\n");
  const doc = await open(file);
  const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(5, 3));
  const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(labels.includes('branch_icon'), labels.slice(0, 20).join(','));
});

check('ホバーでセグメントの説明を出す', async () => {
  const doc = await open(path.join(fixtures, 'l0c.omp.yaml'));
  const pos = doc.positionAt(doc.getText().indexOf('type: git') + 7);
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos);
  const text = hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
  assert.match(text, /Git/);
});

check('パレット参照から定義へジャンプする', async () => {
  const doc = await open(path.join(fixtures, 'l0c.omp.json'));
  const pos = doc.positionAt(doc.getText().indexOf('p:base') + 3);
  const locs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos);
  assert.strictEqual(locs.length, 1);
  assert.strictEqual(doc.getText(locs[0].range), 'base');
});

check('16進カラーを色として返す', async () => {
  const doc = await open(path.join(fixtures, 'l0c.omp.toml'));
  const colors = await vscode.commands.executeCommand('vscode.executeDocumentColorProvider', doc.uri);
  assert.ok(colors.length >= 10, String(colors.length));
});

check('パレット名を変更すると参照もまとめて変わる', async () => {
  const doc = await open(path.join(fixtures, 'l0c.omp.yaml'));
  const pos = doc.positionAt(doc.getText().indexOf('p:sub') + 3);
  const edit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', doc.uri, pos, 'subtle');
  const edits = edit.get(doc.uri);
  assert.strictEqual(edits.length, 1 + (doc.getText().match(/p:sub\b/g) || []).length);
});

check('JSON を整形する', async () => {
  const file = path.join(tmpDir, 'fmt.omp.json');
  fs.writeFileSync(file, '{"version":4,"blocks":[]}');
  const doc = await open(file);
  const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 2, insertSpaces: true });
  assert.ok(edits.length > 0);
});

check('通常の YAML を手動で切り替え、解除できる', async () => {
  const file = path.join(tmpDir, 'plain.yaml');
  fs.writeFileSync(file, 'blocks: []\n');
  let doc = await open(file);
  assert.strictEqual(doc.languageId, 'yaml');
  await vscode.commands.executeCommand('ohMyPosh.useAsConfig');
  doc = await waitFor(() => vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase() === file.toLowerCase() && d.languageId === 'omp-yaml'), '切替');
  await vscode.commands.executeCommand('ohMyPosh.revertLanguage');
  await waitFor(() => vscode.workspace.textDocuments.find((d) => d.uri.fsPath.toLowerCase() === file.toLowerCase() && d.languageId === 'yaml'), '解除');
});

exports.run = async function run() {
  const failures = [];
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
    } catch (e) {
      console.log(`  NG  ${name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`);
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`${failures.length} 件失敗しました`);
};
