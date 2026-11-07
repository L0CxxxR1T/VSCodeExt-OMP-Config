import * as vscode from 'vscode';
import { contains, findHit } from '../core/ast';
import { hoverFor } from '../core/completion';
import { collectPalette, findPaletteRefs, resolveColor } from '../core/palette';
import { type DocumentCache, SELECTOR, toRange } from '../documents';
import type { SchemaStore } from '../schemaStore';

export function registerHover(context: vscode.ExtensionContext, cache: DocumentCache, schemas: SchemaStore): void {
  const provider: vscode.HoverProvider = {
    async provideHover(document, position) {
      const parsed = cache.get(document);
      if (!parsed?.root) return undefined;
      const offset = document.offsetAt(position);

      const ref = findPaletteRefs(parsed.root, parsed.text).find((r) => contains(r.span, offset));
      if (ref) {
        const all = collectPalette(parsed.root, parsed.text);
        const entries = all.filter((e) => e.name === ref.name);
        const md = new vscode.MarkdownString();
        if (entries.length === 0) {
          md.appendMarkdown(`パレットに \`${ref.name}\` は定義されていません。`);
        } else {
          md.appendMarkdown(`**パレット** \`${ref.name}\`\n\n`);
          for (const e of entries) {
            const resolved = resolveColor(all, e.name, e.list);
            const label = e.list ? `palettes.list.${e.list}` : 'palette';
            const tail = resolved && resolved !== e.value ? ` → \`${resolved}\`` : '';
            md.appendMarkdown(`- ${label}: \`${e.value ?? '(文字列以外)'}\`${tail}\n`);
          }
        }
        return new vscode.Hover(md, toRange(document, ref.span));
      }

      const hit = findHit(parsed.root, offset);
      if (!hit) return undefined;
      const model = await schemas.get();
      const value = hit.type === 'value' ? hit.node.value : undefined;
      const info = hoverFor(parsed.root, hit.path, value ?? undefined, model);
      if (!info) return undefined;
      const span = hit.type === 'key' ? hit.property.keySpan : hit.node.span;
      return new vscode.Hover(new vscode.MarkdownString(info.markdown), toRange(document, span));
    },
  };
  context.subscriptions.push(vscode.languages.registerHoverProvider(SELECTOR, provider));
}
