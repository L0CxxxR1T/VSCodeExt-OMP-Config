import { parseTree, ParseErrorCode, type Node, type ParseError } from 'jsonc-parser';
import type { AstNode, ParseIssue, ParseResult, PropertyNode } from '../ast';

const ERROR_MESSAGES: Partial<Record<ParseErrorCode, string>> = {
  [ParseErrorCode.InvalidSymbol]: '不正な記号です。',
  [ParseErrorCode.InvalidNumberFormat]: '数値の形式が正しくありません。',
  [ParseErrorCode.PropertyNameExpected]: 'プロパティ名が必要です。',
  [ParseErrorCode.ValueExpected]: '値が必要です。',
  [ParseErrorCode.ColonExpected]: 'コロンが必要です。',
  [ParseErrorCode.CommaExpected]: 'カンマが必要です。',
  [ParseErrorCode.CloseBraceExpected]: '閉じ波かっこ } が必要です。',
  [ParseErrorCode.CloseBracketExpected]: '閉じ角かっこ ] が必要です。',
  [ParseErrorCode.EndOfFileExpected]: 'ファイルの終端が必要です。',
  [ParseErrorCode.UnexpectedEndOfComment]: 'コメントが閉じられていません。',
  [ParseErrorCode.UnexpectedEndOfString]: '文字列が閉じられていません。',
  [ParseErrorCode.UnexpectedEndOfNumber]: '数値が途中で終わっています。',
  [ParseErrorCode.InvalidUnicode]: 'Unicode エスケープが正しくありません。',
  [ParseErrorCode.InvalidEscapeCharacter]: 'エスケープ文字が正しくありません。',
  [ParseErrorCode.InvalidCharacter]: '不正な文字です。',
};

export function parseJson(text: string): ParseResult {
  const rawErrors: ParseError[] = [];
  const tree = parseTree(text, rawErrors, { allowTrailingComma: false, disallowComments: false, allowEmptyContent: true });
  const errors: ParseIssue[] = rawErrors.map((e) => ({
    message: ERROR_MESSAGES[e.error] ?? 'JSON の構文エラーです。',
    span: { start: e.offset, end: e.offset + Math.max(e.length, 1) },
  }));
  return { root: tree ? convert(tree) : undefined, errors };
}

function convert(node: Node): AstNode {
  const span = { start: node.offset, end: node.offset + node.length };
  switch (node.type) {
    case 'object': {
      const properties: PropertyNode[] = [];
      for (const child of node.children ?? []) {
        const [keyNode, valueNode] = child.children ?? [];
        if (!keyNode) continue;
        properties.push({
          key: String(keyNode.value),
          keySpan: { start: keyNode.offset, end: keyNode.offset + keyNode.length },
          value: valueNode ? convert(valueNode) : undefined,
        });
      }
      return { kind: 'object', span, properties };
    }
    case 'array':
      return { kind: 'array', span, items: (node.children ?? []).map(convert) };
    default:
      return { kind: 'scalar', span, value: node.value ?? null };
  }
}
