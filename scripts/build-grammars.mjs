// TOML 文法とテンプレート注入文法を生成する。正規表現を String.raw で書くため、JSON を直接編集せずここで管理する。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const r = String.raw;
const out = (name, grammar) =>
  writeFileSync(join(import.meta.dirname, '..', 'syntaxes', name), JSON.stringify(grammar, null, 2) + '\n');

const KEY = r`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const DOTTED_KEY = r`${KEY}(?:\s*\.\s*${KEY})*`;
const ESCAPE = { match: r`\\(?:[btnfre"\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|x[0-9A-Fa-f]{2})`, name: 'constant.character.escape.toml' };

out('omp-toml.tmLanguage.json', {
  name: 'Oh My Posh (TOML)',
  scopeName: 'source.omp.toml',
  patterns: [{ include: '#comment' }, { include: '#table' }, { include: '#entry' }, { include: '#value' }],
  repository: {
    comment: {
      match: r`(#).*$`,
      name: 'comment.line.number-sign.toml',
      captures: { 1: { name: 'punctuation.definition.comment.toml' } },
    },
    table: {
      patterns: [
        {
          match: r`^\s*(\[\[)\s*(${DOTTED_KEY})\s*(\]\])`,
          captures: {
            1: { name: 'punctuation.definition.table.array.toml' },
            2: { name: 'entity.name.tag.table.array.toml' },
            3: { name: 'punctuation.definition.table.array.toml' },
          },
        },
        {
          match: r`^\s*(\[)\s*(${DOTTED_KEY})\s*(\])`,
          captures: {
            1: { name: 'punctuation.definition.table.toml' },
            2: { name: 'entity.name.tag.table.toml' },
            3: { name: 'punctuation.definition.table.toml' },
          },
        },
      ],
    },
    entry: {
      match: r`^\s*(${DOTTED_KEY})\s*(=)`,
      captures: {
        1: { name: 'support.type.property-name.toml' },
        2: { name: 'punctuation.separator.key-value.toml' },
      },
    },
    'inline-entry': {
      match: r`(${DOTTED_KEY})\s*(=)`,
      captures: {
        1: { name: 'support.type.property-name.toml' },
        2: { name: 'punctuation.separator.key-value.toml' },
      },
    },
    value: {
      patterns: [
        { include: '#string' },
        { include: '#datetime' },
        { match: r`\b(?:true|false)\b`, name: 'constant.language.boolean.toml' },
        { include: '#number' },
        { include: '#array' },
        { include: '#inline-table' },
      ],
    },
    string: {
      patterns: [
        {
          begin: '"""',
          end: '"{3,5}',
          name: 'string.quoted.triple.basic.block.toml',
          patterns: [ESCAPE, { match: r`\\\s*$`, name: 'constant.character.escape.toml' }],
        },
        { begin: "'''", end: "'{3,5}", name: 'string.quoted.triple.literal.block.toml' },
        { begin: '"', end: '"', name: 'string.quoted.double.basic.line.toml', patterns: [ESCAPE] },
        { begin: "'", end: "'", name: 'string.quoted.single.literal.line.toml' },
      ],
    },
    datetime: {
      match: r`\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?`,
      name: 'constant.other.datetime.toml',
    },
    number: {
      patterns: [
        { match: r`[+-]?\b(?:inf|nan)\b`, name: 'constant.numeric.float.toml' },
        { match: r`\b0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*\b`, name: 'constant.numeric.hex.toml' },
        { match: r`\b0o[0-7](?:_?[0-7])*\b`, name: 'constant.numeric.octal.toml' },
        { match: r`\b0b[01](?:_?[01])*\b`, name: 'constant.numeric.binary.toml' },
        { match: r`[+-]?\b\d(?:_?\d)*(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?\b`, name: 'constant.numeric.toml' },
      ],
    },
    array: {
      begin: r`\[`,
      end: r`\]`,
      beginCaptures: { 0: { name: 'punctuation.definition.array.begin.toml' } },
      endCaptures: { 0: { name: 'punctuation.definition.array.end.toml' } },
      patterns: [{ include: '#comment' }, { include: '#value' }, { match: ',', name: 'punctuation.separator.array.toml' }],
    },
    'inline-table': {
      begin: r`\{`,
      end: r`\}`,
      beginCaptures: { 0: { name: 'punctuation.definition.table.inline.begin.toml' } },
      endCaptures: { 0: { name: 'punctuation.definition.table.inline.end.toml' } },
      patterns: [{ include: '#inline-entry' }, { include: '#value' }, { match: ',', name: 'punctuation.separator.table.inline.toml' }],
    },
  },
});

// 文字列の中に注入する。閉じていない {{ が文字列の外まで続かないよう、引用符の手前と行末でも終わらせる。
out('omp-template.injection.tmLanguage.json', {
  scopeName: 'source.omp.template-injection',
  injectionSelector: [
    'L:source.omp.json string.quoted.double.json',
    'L:source.omp.yaml string.quoted',
    'L:source.omp.yaml string.unquoted',
    'L:source.omp.toml string',
  ].join(', '),
  patterns: [{ include: '#comment' }, { include: '#template' }, { include: '#color-tag' }, { include: '#palette-ref' }],
  repository: {
    comment: {
      match: r`\{\{-?\s*/\*.*?\*/\s*-?\}\}`,
      name: 'comment.block.go-template',
    },
    template: {
      begin: r`\{\{-?`,
      end: r`-?\}\}|(?=(?<!\\)["'])|$`,
      applyEndPatternLast: true,
      beginCaptures: { 0: { name: 'punctuation.section.embedded.begin.go-template' } },
      endCaptures: { 0: { name: 'punctuation.section.embedded.end.go-template' } },
      name: 'meta.embedded.inline.go-template',
      patterns: [
        { match: r`\\"(?:[^"\\]|\\[^"])*\\"`, name: 'string.quoted.double.go-template' },
        { match: r`"(?:[^"\\]|\\.)*"`, name: 'string.quoted.double.go-template' },
        { match: '`[^`]*`', name: 'string.quoted.raw.go-template' },
        { match: r`\b(?:if|else|end|range|with|define|template|block|break|continue)\b`, name: 'keyword.control.go-template' },
        { match: r`\b(?:true|false|nil)\b`, name: 'constant.language.go-template' },
        { match: r`-?\b\d+(?:\.\d+)?\b`, name: 'constant.numeric.go-template' },
        { match: r`\$[A-Za-z_]\w*|\$`, name: 'variable.other.go-template' },
        { match: r`\.[A-Za-z_]\w*`, name: 'variable.other.property.go-template' },
        { match: r`\.(?!\w)`, name: 'variable.language.dot.go-template' },
        { match: r`\b[A-Za-z_]\w*\b`, name: 'support.function.go-template' },
        { match: r`:=|=|\|`, name: 'keyword.operator.go-template' },
        { match: r`[()]`, name: 'punctuation.parenthesis.go-template' },
      ],
    },
    'color-tag': {
      match: r`(<)(/?)((?:#[0-9A-Fa-f]{3,6}|p:[\w.-]+|[A-Za-z]+)?(?:,(?:#[0-9A-Fa-f]{3,6}|p:[\w.-]+|[A-Za-z]+))?)(>)`,
      captures: {
        1: { name: 'punctuation.definition.tag.begin.omp' },
        2: { name: 'punctuation.definition.tag.omp' },
        3: { name: 'entity.name.tag.omp' },
        4: { name: 'punctuation.definition.tag.end.omp' },
      },
    },
    'palette-ref': {
      match: r`(?<![\w:/.])(p:)([\w-]+(?:\.[\w-]+)*)`,
      captures: {
        1: { name: 'storage.modifier.palette.omp' },
        2: { name: 'variable.other.constant.palette.omp' },
      },
    },
  },
});
