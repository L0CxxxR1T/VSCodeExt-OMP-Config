// VSCODE_EXECUTABLE があればその VS Code を、なければダウンロードした VS Code を別プロファイルで起動して動作を確認する
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';

// VS Code の拡張ホスト内から起動すると残る変数で、Code.exe が Node として動いてしまう
delete process.env.ELECTRON_RUN_AS_NODE;

const root = join(import.meta.dirname, '..', '..');
const temp = mkdtempSync(join(tmpdir(), 'omp-ext-test-'));

await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
  extensionDevelopmentPath: root,
  extensionTestsPath: join(import.meta.dirname, 'suite.cjs'),
  launchArgs: [join(root, 'test', 'fixtures'), '--user-data-dir', join(temp, 'user'), '--extensions-dir', join(temp, 'ext'), '--disable-workspace-trust'],
});
