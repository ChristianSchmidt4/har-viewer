// Parses and applies a Fiddler/DevTools-like filter query against HAR
// entries.
//
// Supported syntax:
//   plain text              -> substring match against method + URL
//   field:value              -> match on a known field
//   -field:value             -> negated match
//   not field:value          -> negated match (keyword form)
//   field:>value, field:<value, field:>=value, field:<=value
//                             -> numeric comparison (status, duration, size)
//   a and b, a or b, (a or b) and c
//                             -> logical AND / OR / grouping; space between
//                                clauses with no keyword means AND
//   reqheader:name=value      -> request header "name" contains "value"
//   resheader:name=value      -> response header "name" contains "value"
//   reqcookie:name=value      -> request cookie "name" contains "value"
//   rescookie:name=value      -> response cookie "name" contains "value"
//   reqheader:name (no =)     -> request header "name" is present (any value)
//                                (same presence-check form for resheader/
//                                reqcookie/rescookie)
//
// Known plain fields: method, status, host, path, protocol, type
// (content-type), duration (ms), size (bytes). Unknown field prefixes fall
// back to a plain substring match on the URL so the filter never "breaks".
//
// Examples:
//   status:200 method:GET
//   host:example.com -type:image
//   duration:>100 size:<10kb
//   reqheader:user-agent=chromium
//   reqheader:x-execution-id=ADFEEx01 or resheader:x-execution-id
//   (status:>=400 or duration:>500) and -type:image
import type { HarHeader, HarCookie, ParsedEntry } from '../types/har.js';

type FieldName = 'method' | 'status' | 'host' | 'path' | 'protocol' | 'contentType' | 'duration' | 'size';
type HeaderCookieSide = 'reqHeader' | 'resHeader' | 'reqCookie' | 'resCookie';
type NumericOperator = '>' | '<' | '>=' | '<=';

interface PlainClause {
  kind: 'plain';
  negate: boolean;
  value: string;
}

interface FieldClause {
  kind: 'field';
  negate: boolean;
  field: FieldName;
  operator: 'equals' | 'contains' | NumericOperator;
  value: string;
}

interface HeaderCookieClause {
  kind: 'headerCookie';
  side: HeaderCookieSide;
  negate: boolean;
  operator: 'exists' | 'contains';
  name: string;
  value?: string;
}

type Clause = PlainClause | FieldClause | HeaderCookieClause;

type AstNode =
  | { type: 'and'; left: AstNode; right: AstNode }
  | { type: 'or'; left: AstNode; right: AstNode }
  | { type: 'not'; node: AstNode }
  | { type: 'clause'; clause: Clause };

type Token = { type: 'word'; value: string } | { type: '(' } | { type: ')' };

const NUMERIC_FIELDS = new Set<FieldName>(['status', 'duration', 'size']);
const FIELD_ALIASES: Record<string, FieldName> = {
  method: 'method',
  status: 'status',
  code: 'status',
  host: 'host',
  domain: 'host',
  path: 'path',
  protocol: 'protocol',
  proto: 'protocol',
  type: 'contentType',
  mime: 'contentType',
  duration: 'duration',
  time: 'duration',
  size: 'size'
};

const HEADER_COOKIE_ALIASES: Record<string, HeaderCookieSide> = {
  reqheader: 'reqHeader',
  requestheader: 'reqHeader',
  resheader: 'resHeader',
  responseheader: 'resHeader',
  reqcookie: 'reqCookie',
  requestcookie: 'reqCookie',
  rescookie: 'resCookie',
  responsecookie: 'resCookie'
};

function parseSizeToBytes(value: string): number {
  const match = /^([\d.]+)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return parseFloat(value) || 0;
  const num = parseFloat(match[1]!);
  const unit = (match[2] || 'b').toLowerCase();
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return num * (multipliers[unit] || 1);
}

function parseDurationToMs(value: string): number {
  const match = /^([\d.]+)\s*(ms|s)?$/i.exec(value.trim());
  if (!match) return parseFloat(value) || 0;
  const num = parseFloat(match[1]!);
  const unit = (match[2] || 'ms').toLowerCase();
  return unit === 's' ? num * 1000 : num;
}

// Tokenizes the raw query string into words/parens, respecting "quoted
// phrases" (exported for testing).
export function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\()|(\))|([^\s()]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query)) !== null) {
    if (match[1] !== undefined) tokens.push({ type: 'word', value: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: 'word', value: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: '(' });
    else if (match[4] !== undefined) tokens.push({ type: ')' });
    else tokens.push({ type: 'word', value: match[5]! });
  }
  return tokens;
}

function parseLeafClause(token: string): Clause {
  let negate = false;
  let raw = token;
  if (raw.startsWith('-') && raw.length > 1) {
    negate = true;
    raw = raw.slice(1);
  }

  const colonIndex = raw.indexOf(':');
  if (colonIndex === -1) {
    return { kind: 'plain', negate, value: raw.toLowerCase() };
  }

  const rawField = raw.slice(0, colonIndex).toLowerCase();
  let value = raw.slice(colonIndex + 1);

  const hcField = HEADER_COOKIE_ALIASES[rawField];
  if (hcField) {
    const eqIndex = value.indexOf('=');
    if (eqIndex === -1) {
      return { kind: 'headerCookie', side: hcField, negate, operator: 'exists', name: value.toLowerCase() };
    }
    return {
      kind: 'headerCookie',
      side: hcField,
      negate,
      operator: 'contains',
      name: value.slice(0, eqIndex).toLowerCase(),
      value: value.slice(eqIndex + 1)
    };
  }

  const field = FIELD_ALIASES[rawField] || null;
  if (!field) {
    return { kind: 'plain', negate, value: raw.toLowerCase() };
  }

  let operator: FieldClause['operator'] = 'equals';
  if (NUMERIC_FIELDS.has(field)) {
    const opMatch = /^(>=|<=|>|<)(.+)$/.exec(value);
    if (opMatch) {
      operator = opMatch[1] as NumericOperator;
      value = opMatch[2]!;
    }
  } else {
    operator = 'contains';
  }

  return { kind: 'field', negate, field, operator, value };
}

// Recursive-descent parser: or < and (implicit or explicit) < not < atom.
function parseExpr(tokens: Token[]): AstNode | null {
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function isKeyword(tok: Token | undefined, word: string): boolean {
    return !!tok && tok.type === 'word' && tok.value.toLowerCase() === word;
  }

  function parseOr(): AstNode {
    let left = parseAnd();
    while (isKeyword(peek(), 'or')) {
      pos++;
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  function parseAnd(): AstNode {
    let left = parseNot();
    while (peek() && peek()!.type !== ')' && !isKeyword(peek(), 'or')) {
      if (isKeyword(peek(), 'and')) pos++;
      const right = parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  function parseNot(): AstNode {
    if (isKeyword(peek(), 'not')) {
      pos++;
      return { type: 'not', node: parseNot() };
    }
    return parseAtom();
  }

  function parseAtom(): AstNode {
    const tok = peek();
    if (!tok) return { type: 'clause', clause: { kind: 'plain', negate: false, value: '' } };
    if (tok.type === '(') {
      pos++;
      const node = parseOr();
      if (peek() && peek()!.type === ')') pos++;
      return node;
    }
    pos++;
    return { type: 'clause', clause: parseLeafClause((tok as { type: 'word'; value: string }).value) };
  }

  if (!tokens.length) return null;
  return parseOr();
}

function getFieldValue(entry: ParsedEntry, field: FieldName): string | number {
  switch (field) {
    case 'method': return entry.request.method || '';
    case 'status': return entry.response.status || 0;
    case 'host': return entry.host || '';
    case 'path': return entry.path || '';
    case 'protocol': return entry.protocol || '';
    case 'contentType': return entry.contentType || '';
    case 'duration': return entry.time || 0;
    case 'size': return entry.response.bodySize >= 0 ? entry.response.bodySize : 0;
    default: return '';
  }
}

function coerceNumericValue(field: FieldName, value: string): number {
  if (field === 'size') return parseSizeToBytes(value);
  if (field === 'duration') return parseDurationToMs(value);
  return parseFloat(value) || 0;
}

function getHeaderCookieList(entry: ParsedEntry, side: HeaderCookieSide): (HarHeader | HarCookie)[] {
  switch (side) {
    case 'reqHeader': return entry.request.headers || [];
    case 'resHeader': return entry.response.headers || [];
    case 'reqCookie': return entry.request.cookies || [];
    case 'resCookie': return entry.response.cookies || [];
    default: return [];
  }
}

function matchesClause(entry: ParsedEntry, clause: Clause): boolean {
  let matched: boolean;

  if (clause.kind === 'plain') {
    const haystack = `${entry.request.method} ${entry.request.url}`.toLowerCase();
    matched = haystack.includes(clause.value);
  } else if (clause.kind === 'headerCookie') {
    const list = getHeaderCookieList(entry, clause.side);
    if (clause.operator === 'exists') {
      matched = list.some(h => (h.name || '').toLowerCase() === clause.name);
    } else {
      matched = list.some(h => (h.name || '').toLowerCase() === clause.name
        && (h.value || '').toLowerCase().includes((clause.value || '').toLowerCase()));
    }
  } else if (NUMERIC_FIELDS.has(clause.field)) {
    const fieldValue = getFieldValue(entry, clause.field) as number;
    const compareValue = coerceNumericValue(clause.field, clause.value);
    switch (clause.operator) {
      case '>': matched = fieldValue > compareValue; break;
      case '<': matched = fieldValue < compareValue; break;
      case '>=': matched = fieldValue >= compareValue; break;
      case '<=': matched = fieldValue <= compareValue; break;
      default: matched = fieldValue === compareValue; break;
    }
  } else {
    const fieldValue = String(getFieldValue(entry, clause.field)).toLowerCase();
    matched = fieldValue.includes(clause.value.toLowerCase());
  }

  return clause.negate ? !matched : matched;
}

function evaluate(node: AstNode | null, entry: ParsedEntry): boolean {
  if (!node) return true;
  switch (node.type) {
    case 'and': return evaluate(node.left, entry) && evaluate(node.right, entry);
    case 'or': return evaluate(node.left, entry) || evaluate(node.right, entry);
    case 'not': return !evaluate(node.node, entry);
    case 'clause': return matchesClause(entry, node.clause);
    default: return true;
  }
}

// Parses a raw query string into an AST (exported for testing).
export function parseFilterQuery(query: string): AstNode | null {
  return parseExpr(tokenize((query || '').trim()));
}

// Returns a filtered array of entries matching the given query string.
export function filterEntries(entries: ParsedEntry[], query: string): ParsedEntry[] {
  const ast = parseFilterQuery(query);
  if (!ast) return entries;
  return entries.filter(entry => evaluate(ast, entry));
}
