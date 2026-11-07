import * as vscode from 'vscode';
import { contains } from '../core/ast';
import { collectPalette, findHexColors, findPaletteRefs, PALETTE_NAME_PATTERN, parseHex, resolveColor } from '../core/palette';
import { type DocumentCache, formatOf, type ParsedDocument, SELECTOR, toRange } from '../documents';

/** カーソル位置がパレット参照かパレットのキー名なら、その名前を返す。 */
function nameAt(parsed: ParsedDocument, offset: number): { name: string; span: { start: number; end: number } } | undefined {
  const ref = findPaletteRefs(parsed.root, parsed.text).find((r) => contains(r.nameSpan, offset) || contains(r.span, offset));
  if (ref) return { name: ref.name, span: ref.nameSpan };
  const entry = collectPalette(parsed.root, parsed.text).find((e) => contains(e.nameSpan, offset));
  return entry ? { name: entry.name, span: entry.nameSpan } : undefined;
}

export function registerPalette(context: vscode.ExtensionContext, cache: DocumentCache): void {
  const definition: vscode.DefinitionProvider = {
    provideDefinition(document, position) {
      const parsed = cache.get(document);
      if (!parsed?.root) return undefined;
      const target = nameAt(parsed, document.offsetAt(position));
      if (!target) return undefined;
      return collectPalette(parsed.root, parsed.text)
        .filter((e) => e.name === target.name)
        .map((e) => new vscode.Location(document.uri, toRange(document, e.nameSpan)));
    },
  };

  const references: vscode.ReferenceProvider = {
    provideReferences(document, position, ctx) {
      const parsed = cache.get(document);
      if (!parsed?.root) return undefined;
      const target = nameAt(parsed, document.offsetAt(position));
      if (!target) return undefined;
      const spans = findPaletteRefs(parsed.root, parsed.text)
        .filter((r) => r.name === target.name)
        .map((r) => r.nameSpan);
      if (ctx.includeDeclaration) {
        spans.push(...collectPalette(parsed.root, parsed.text).filter((e) => e.name === target.name).map((e) => e.nameSpan));
      }
      return spans.map((s) => new vscode.Location(document.uri, toRange(document, s)));
    },
  };

  const rename: vscode.RenameProvider = {
    prepareRename(document, position) {
      const parsed = cache.get(document);
      const target = parsed?.root ? nameAt(parsed, document.offsetAt(position)) : undefined;
      if (!target) throw new Error('パレットの名前の上で実行してください。');
      return { range: toRange(document, target.span), placeholder: target.name };
    },
    provideRenameEdits(document, position, newName) {
      const parsed = cache.get(document);
      if (!parsed?.root) return undefined;
      const target = nameAt(parsed, document.offsetAt(position));
      if (!target) return undefined;
      // TOML ではドットがキーの区切りになるため、名前に含めない
      const valid = formatOf(document) === 'toml' ? /^[\w-]+$/.test(newName) : PALETTE_NAME_PATTERN.test(newName);
      if (!valid) throw new Error('パレット名には英数字・アンダースコア・ハイフンを使ってください。');

      const edit = new vscode.WorkspaceEdit();
      for (const r of findPaletteRefs(parsed.root, parsed.text)) {
        if (r.name === target.name) edit.replace(document.uri, toRange(document, r.nameSpan), newName);
      }
      for (const e of collectPalette(parsed.root, parsed.text)) {
        if (e.name === target.name) edit.replace(document.uri, toRange(document, e.nameSpan), newName);
      }
      return edit;
    },
  };

  const colors: vscode.DocumentColorProvider = {
    provideDocumentColors(document) {
      const parsed = cache.get(document);
      if (!parsed?.root) return [];
      return findHexColors(parsed.root, parsed.text).flatMap((c) => {
        const rgb = parseHex(c.hex);
        return rgb ? [new vscode.ColorInformation(toRange(document, c.span), new vscode.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255, 1))] : [];
      });
    },
    provideColorPresentations(color) {
      // Oh My Posh は透明度付きの16進表記を受け付けないため、アルファは捨てる
      const hex = [color.red, color.green, color.blue].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      return [new vscode.ColorPresentation(`#${hex}`)];
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(SELECTOR, definition),
    vscode.languages.registerReferenceProvider(SELECTOR, references),
    vscode.languages.registerRenameProvider(SELECTOR, rename),
    vscode.languages.registerColorProvider(SELECTOR, colors),
  );
  registerSwatches(context, cache);
}

/** p:名前 の手前に、解決した色の見本を表示する。 */
function registerSwatches(context: vscode.ExtensionContext, cache: DocumentCache): void {
  const types = new Map<string, vscode.TextEditorDecorationType>();
  let timer: NodeJS.Timeout | undefined;

  const typeFor = (hex: string): vscode.TextEditorDecorationType => {
    let type = types.get(hex);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType({ before: { contentText: '■', color: hex, margin: '0 0.15em 0 0' } });
      types.set(hex, type);
    }
    return type;
  };

  const update = (editor: vscode.TextEditor): void => {
    const parsed = cache.get(editor.document);
    const byColor = new Map<string, vscode.Range[]>();
    if (parsed?.root) {
      const entries = collectPalette(parsed.root, parsed.text);
      for (const ref of findPaletteRefs(parsed.root, parsed.text)) {
        const color = resolveColor(entries, ref.name);
        if (!color || !parseHex(color)) continue;
        const hex = color.toLowerCase();
        byColor.set(hex, [...(byColor.get(hex) ?? []), toRange(editor.document, ref.span)]);
      }
    }
    // 前回付けた色が消えた場合も外すため、作成済みの全種類を更新する
    for (const [hex, type] of types) editor.setDecorations(type, byColor.get(hex) ?? []);
    for (const [hex, ranges] of byColor) if (!types.has(hex)) editor.setDecorations(typeFor(hex), ranges);
  };

  const updateVisible = (): void => {
    for (const editor of vscode.window.visibleTextEditors) if (formatOf(editor.document)) update(editor);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(updateVisible),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!formatOf(e.document)) return;
      clearTimeout(timer);
      timer = setTimeout(updateVisible, 200);
    }),
    vscode.workspace.onDidOpenTextDocument(updateVisible),
    { dispose: () => (clearTimeout(timer), types.forEach((t) => t.dispose())) },
  );
  updateVisible();
}
