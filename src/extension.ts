import { format as formatJson } from 'jsonc-parser';
import * as vscode from 'vscode';
import { DocumentCache } from './documents';
import { registerLanguageToggle } from './languageToggle';
import { registerCompletion } from './providers/completion';
import { registerDiagnostics } from './providers/diagnostics';
import { registerHover } from './providers/hover';
import { registerPalette } from './providers/palette';
import { SchemaStore } from './schemaStore';

export function activate(context: vscode.ExtensionContext): void {
  const cache = new DocumentCache();
  const schemas = new SchemaStore(context);
  context.subscriptions.push(schemas);

  registerLanguageToggle(context);
  registerDiagnostics(context, cache, schemas);
  registerCompletion(context, schemas);
  registerHover(context, cache, schemas);
  registerPalette(context, cache);

  // 独自の言語 ID にしたことで組み込みの JSON 整形が使えなくなるため、ここで提供する
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'omp-json' }, {
      provideDocumentFormattingEdits(document, options) {
        const edits = formatJson(document.getText(), undefined, {
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
          eol: document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
        });
        return edits.map(
          (e) => new vscode.TextEdit(new vscode.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)), e.content),
        );
      },
    }),
    vscode.commands.registerCommand('ohMyPosh.updateSchema', () => schemas.update()),
  );
}

export function deactivate(): void {}
