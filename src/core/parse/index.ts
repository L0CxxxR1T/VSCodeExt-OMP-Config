import type { Format, ParseResult } from '../ast';
import { parseJson } from './json';
import { parseToml } from './toml';
import { parseYaml } from './yaml';

export function parse(text: string, format: Format): ParseResult {
  switch (format) {
    case 'json':
      return parseJson(text);
    case 'yaml':
      return parseYaml(text);
    case 'toml':
      return parseToml(text);
  }
}
