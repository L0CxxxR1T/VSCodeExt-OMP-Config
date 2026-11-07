import * as vscode from 'vscode';
import { type Candidate, buildCandidates } from '../core/completion';
import { getCursorContext } from '../core/context';
import { collectPalette } from '../core/palette';
import { formatOf, SELECTOR, toRange } from '../documents';
import type { SchemaStore } from '../schemaStore';

const KIND: Record<Candidate['kind'], vscode.CompletionItemKind> = {
  property: vscode.CompletionItemKind.Property,
  enum: vscode.CompletionItemKind.EnumMember,
  value: vscode.CompletionItemKind.Value,
  palette: vscode.CompletionItemKind.Color,
};

export function registerCompletion(context: vscode.ExtensionContext, schemas: SchemaStore): void {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const format = formatOf(document);
      if (!format) return undefined;
      const text = document.getText();
      const ctx = getCursorContext(text, document.offsetAt(position), format);
      if (!ctx) return undefined;
      const model = await schemas.get();
      // 補完用に組み直した構文木から読むので、入力途中でパースが壊れていてもパレットを拾える
      const candidates = buildCandidates(ctx, format, model, collectPalette(ctx.root, text));
      const range = toRange(document, ctx.replace);
      return candidates.map((c) => toItem(c, range));
    },
  };
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(SELECTOR, provider, '"', ':', "'"));
}

function toItem(c: Candidate, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(c.label, KIND[c.kind]);
  item.insertText = new vscode.SnippetString(c.insertText);
  item.range = range;
  item.detail = c.detail;
  // 色の候補は documentation に色文字列を入れると候補一覧に色見本が出る
  if (c.color) item.documentation = c.color;
  else if (c.documentation) item.documentation = new vscode.MarkdownString(c.documentation);
  if (c.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
  item.sortText = c.sortText;
  item.filterText = c.filterText;
  return item;
}
