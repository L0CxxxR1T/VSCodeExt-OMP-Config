/**
 * JSON / YAML / TOML を共通に扱うための構文木。
 * 位置はすべてドキュメント先頭からのオフセット（UTF-16 単位）で持つ。
 */

export type Format = 'json' | 'yaml' | 'toml';

export interface Span {
  start: number;
  end: number;
}

export type PathSegment = string | number;
export type Path = PathSegment[];

export interface PropertyNode {
  key: string;
  keySpan: Span;
  value: AstNode | undefined;
}

export interface ObjectNode {
  kind: 'object';
  span: Span;
  properties: PropertyNode[];
}

export interface ArrayNode {
  kind: 'array';
  span: Span;
  items: AstNode[];
}

export interface ScalarNode {
  kind: 'scalar';
  span: Span;
  value: string | number | boolean | null;
}

export type AstNode = ObjectNode | ArrayNode | ScalarNode;

export interface ParseIssue {
  message: string;
  span: Span;
}

export interface ParseResult {
  root: AstNode | undefined;
  errors: ParseIssue[];
}

export function toValue(node: AstNode | undefined): unknown {
  if (!node) return null;
  switch (node.kind) {
    case 'scalar':
      return node.value;
    case 'array':
      return node.items.map(toValue);
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const prop of node.properties) obj[prop.key] = toValue(prop.value);
      return obj;
    }
  }
}

export function getProperty(node: AstNode | undefined, key: string): PropertyNode | undefined {
  if (node?.kind !== 'object') return undefined;
  // 重複キーは後勝ちにする（各パーサーの値の解決と同じ）
  for (let i = node.properties.length - 1; i >= 0; i--) {
    if (node.properties[i].key === key) return node.properties[i];
  }
  return undefined;
}

export function getChild(node: AstNode | undefined, segment: PathSegment): AstNode | undefined {
  if (!node) return undefined;
  if (typeof segment === 'number') return node.kind === 'array' ? node.items[segment] : undefined;
  return getProperty(node, segment)?.value;
}

export function nodeAtPath(root: AstNode | undefined, path: Path): AstNode | undefined {
  let node = root;
  for (const segment of path) {
    node = getChild(node, segment);
    if (!node) return undefined;
  }
  return node;
}

/** 経路上の各ノード（root を含む）を返す。途中で見つからなければそこで打ち切る。 */
export function nodesAlongPath(root: AstNode | undefined, path: Path): AstNode[] {
  const nodes: AstNode[] = [];
  let node = root;
  if (!node) return nodes;
  nodes.push(node);
  for (const segment of path) {
    node = getChild(node, segment);
    if (!node) break;
    nodes.push(node);
  }
  return nodes;
}

export function contains(span: Span, offset: number): boolean {
  return span.start <= offset && offset <= span.end;
}

export type Hit =
  | { type: 'key'; path: Path; property: PropertyNode; parent: ObjectNode }
  | { type: 'value'; path: Path; node: ScalarNode };

/**
 * offset 上にあるキーまたはスカラー値を探す。
 * TOML のテーブルは範囲が飛び飛びになるため、範囲で枝刈りせず全体をたどる。
 */
export function findHit(root: AstNode | undefined, offset: number): Hit | undefined {
  let found: Hit | undefined;
  const visit = (node: AstNode, path: Path): void => {
    if (node.kind === 'scalar') {
      if (contains(node.span, offset)) found = { type: 'value', path, node };
      return;
    }
    if (node.kind === 'array') {
      node.items.forEach((item, i) => visit(item, [...path, i]));
      return;
    }
    for (const prop of node.properties) {
      if (contains(prop.keySpan, offset)) found = { type: 'key', path: [...path, prop.key], property: prop, parent: node };
      if (prop.value) visit(prop.value, [...path, prop.key]);
    }
  };
  if (root) visit(root, []);
  return found;
}

export function forEachScalar(root: AstNode | undefined, fn: (node: ScalarNode, path: Path) => void): void {
  const visit = (node: AstNode, path: Path): void => {
    if (node.kind === 'scalar') fn(node, path);
    else if (node.kind === 'array') node.items.forEach((item, i) => visit(item, [...path, i]));
    else for (const prop of node.properties) if (prop.value) visit(prop.value, [...path, prop.key]);
  };
  if (root) visit(root, []);
}

/** JSON Pointer（Ajv の instancePath）をパスに変換する。数値に見える区切りは配列のときだけ添字として扱う。 */
export function pointerToPath(root: AstNode | undefined, pointer: string): Path {
  if (pointer === '') return [];
  const parts = pointer
    .slice(1)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  const path: Path = [];
  let node = root;
  for (const part of parts) {
    const segment: PathSegment = node?.kind === 'array' && /^\d+$/.test(part) ? Number(part) : part;
    path.push(segment);
    node = getChild(node, segment);
  }
  return path;
}
