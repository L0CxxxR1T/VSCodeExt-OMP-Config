import * as vscode from 'vscode';
import { collectPalette, findPaletteRefs } from '../core/palette';
import { type DocumentCache, formatOf, toRange } from '../documents';
import type { SchemaStore } from '../schemaStore';

const SOURCE = 'oh-my-posh';
const DEBOUNCE_MS = 300;

export function registerDiagnostics(context: vscode.ExtensionContext, cache: DocumentCache, schemas: SchemaStore): void {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  const timers = new Map<string, NodeJS.Timeout>();

  const run = async (document: vscode.TextDocument): Promise<void> => {
    if (!formatOf(document)) {
      collection.delete(document.uri);
      return;
    }
    const parsed = cache.get(document);
    if (!parsed) return;
    const config = vscode.workspace.getConfiguration('ohMyPosh', document);
    const diagnostics: vscode.Diagnostic[] = [];

    for (const error of parsed.errors) {
      diagnostics.push(withSource(new vscode.Diagnostic(toRange(document, error.span), error.message, vscode.DiagnosticSeverity.Error)));
    }

    if (config.get<boolean>('validate.enable', true)) {
      const model = await schemas.get();
      for (const issue of model.validate(parsed.root)) {
        diagnostics.push(withSource(new vscode.Diagnostic(toRange(document, issue.span), issue.message, vscode.DiagnosticSeverity.Warning)));
      }
    }

    if (config.get<boolean>('palette.warnUndefined', true) && parsed.root) {
      const names = new Set(collectPalette(parsed.root, parsed.text).map((e) => e.name));
      for (const ref of findPaletteRefs(parsed.root, parsed.text)) {
        if (names.has(ref.name)) continue;
        diagnostics.push(
          withSource(
            new vscode.Diagnostic(toRange(document, ref.span), `パレットに「${ref.name}」が定義されていません。`, vscode.DiagnosticSeverity.Warning),
          ),
        );
      }
    }

    // 待っている間に編集された場合は古い結果を捨てる
    if (document.isClosed || cache.get(document) !== parsed) return;
    collection.set(document.uri, diagnostics);
  };

  const runSafely = (document: vscode.TextDocument): void => {
    run(document).catch((e) => console.error('[oh-my-posh] 検証に失敗しました。', e));
  };

  const schedule = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        runSafely(document);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(runSafely),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimeout(timers.get(document.uri.toString()));
      collection.delete(document.uri);
      cache.delete(document);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ohMyPosh')) vscode.workspace.textDocuments.forEach(runSafely);
    }),
    schemas.onDidChange(() => vscode.workspace.textDocuments.forEach(runSafely)),
    { dispose: () => timers.forEach(clearTimeout) },
  );

  vscode.workspace.textDocuments.forEach(runSafely);
}

function withSource(d: vscode.Diagnostic): vscode.Diagnostic {
  d.source = SOURCE;
  return d;
}
