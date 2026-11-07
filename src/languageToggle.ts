import * as vscode from 'vscode';
import { formatOf } from './documents';

const STATE_KEY = 'ohMyPosh.manualFiles';

const BY_EXTENSION: Record<string, string> = {
  json: 'omp-json',
  jsonc: 'omp-json',
  yaml: 'omp-yaml',
  yml: 'omp-yaml',
  toml: 'omp-toml',
};

const ORIGINAL: Record<string, string> = {
  'omp-json': 'json',
  'omp-yaml': 'yaml',
  'omp-toml': 'toml',
};

/**
 * *.omp.* 以外のファイルを手動で Oh My Posh 設定として扱う。
 * setTextDocumentLanguage は開いている間しか効かないため、URI を覚えておき次に開いたときにも切り替える。
 */
export function registerLanguageToggle(context: vscode.ExtensionContext): void {
  const remembered = (): string[] => context.globalState.get<string[]>(STATE_KEY, []);
  const save = (list: string[]) => context.globalState.update(STATE_KEY, [...new Set(list)]);

  const apply = async (document: vscode.TextDocument): Promise<void> => {
    if (formatOf(document) || !remembered().includes(document.uri.toString())) return;
    const language = languageFor(document);
    if (language) await vscode.languages.setTextDocumentLanguage(document, language);
  };

  const applySafely = (document: vscode.TextDocument): void => {
    apply(document).catch((e) => console.error('[oh-my-posh] 言語モードを切り替えられませんでした。', e));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('ohMyPosh.useAsConfig', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document) return;
      const language = languageFor(document) ?? (await pickLanguage());
      if (!language) return;
      await vscode.languages.setTextDocumentLanguage(document, language);
      if (!document.isUntitled) await save([...remembered(), document.uri.toString()]);
    }),
    vscode.commands.registerCommand('ohMyPosh.revertLanguage', async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || !formatOf(document)) return;
      await save(remembered().filter((uri) => uri !== document.uri.toString()));
      const known = await vscode.languages.getLanguages();
      const original = ORIGINAL[document.languageId];
      await vscode.languages.setTextDocumentLanguage(document, known.includes(original) ? original : 'plaintext');
    }),
    vscode.workspace.onDidOpenTextDocument(applySafely),
  );
  vscode.workspace.textDocuments.forEach(applySafely);
}

function languageFor(document: vscode.TextDocument): string | undefined {
  const ext = document.uri.path.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext];
}

async function pickLanguage(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'JSON', language: 'omp-json' },
      { label: 'YAML', language: 'omp-yaml' },
      { label: 'TOML', language: 'omp-toml' },
    ],
    { placeHolder: '設定ファイルの形式を選んでください。' },
  );
  return picked?.language;
}
