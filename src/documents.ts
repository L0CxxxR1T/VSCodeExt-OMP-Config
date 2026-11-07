import * as vscode from 'vscode';
import type { Format, ParseResult, Span } from './core/ast';
import { parse } from './core/parse';

export const LANGUAGE_FORMATS: Record<string, Format> = {
  'omp-json': 'json',
  'omp-yaml': 'yaml',
  'omp-toml': 'toml',
};

export const SELECTOR: vscode.DocumentSelector = Object.keys(LANGUAGE_FORMATS).map((language) => ({ language }));

export function formatOf(document: vscode.TextDocument): Format | undefined {
  return LANGUAGE_FORMATS[document.languageId];
}

export interface ParsedDocument extends ParseResult {
  format: Format;
  text: string;
}

/** 各プロバイダーが同じ版のドキュメントを何度もパースしないようにキャッシュする。 */
export class DocumentCache {
  private readonly cache = new Map<string, { version: number; languageId: string; parsed: ParsedDocument }>();

  get(document: vscode.TextDocument): ParsedDocument | undefined {
    const format = formatOf(document);
    if (!format) return undefined;
    const key = document.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === document.version && hit.languageId === document.languageId) return hit.parsed;
    const text = document.getText();
    const parsed = { ...parse(text, format), format, text };
    this.cache.set(key, { version: document.version, languageId: document.languageId, parsed });
    return parsed;
  }

  delete(document: vscode.TextDocument): void {
    this.cache.delete(document.uri.toString());
  }
}

export function toRange(document: vscode.TextDocument, span: Span): vscode.Range {
  return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
}
