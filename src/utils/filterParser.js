// Parses and applies a simple, Fiddler/DevTools-like filter query against
// HAR entries.
//
// Supported syntax:
//   plain text            -> substring match against the full URL
//   field:value            -> exact/substring match on a known field
//   -field:value           -> negated match
//   field:>value, field:<value, field:>=value, field:<=value
//                           -> numeric comparison (status, duration, size)
//   multiple terms are combined with AND (space separated)
//
// Known fields: method, status, host, path, protocol, type (content-type),
// duration (ms), size (bytes). Unknown field prefixes fall back to a plain
// substring match on the URL so the filter never "breaks".
//
// Examples:
//   status:200 method:GET
//   host:example.com -type:image
//   duration:>100 size:<10kb
//   .json

const NUMERIC_FIELDS = new Set(['status', 'duration', 'size']);
const FIELD_ALIASES = {
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

function parseSizeToBytes(value) {
  const match = /^([\d.]+)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return parseFloat(value) || 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const multipliers = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return num * (multipliers[unit] || 1);
}

function parseDurationToMs(value) {
  const match = /^([\d.]+)\s*(ms|s)?$/i.exec(value.trim());
  if (!match) return parseFloat(value) || 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  return unit === 's' ? num * 1000 : num;
}

// Tokenizes the raw query string into words, respecting "quoted phrases".
function tokenize(query) {
  const tokens = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function parseToken(token) {
  let negate = false;
  let raw = token;
  if (raw.startsWith('-') && raw.length > 1) {
    negate = true;
    raw = raw.slice(1);
  }

  const colonIndex = raw.indexOf(':');
  if (colonIndex === -1) {
    return { negate, field: null, operator: 'contains', value: raw.toLowerCase() };
  }

  const rawField = raw.slice(0, colonIndex).toLowerCase();
  let value = raw.slice(colonIndex + 1);
  const field = FIELD_ALIASES[rawField] || null;

  if (!field) {
    // Unknown field prefix - treat the whole token as plain text.
    return { negate, field: null, operator: 'contains', value: raw.toLowerCase() };
  }

  let operator = 'equals';
  if (NUMERIC_FIELDS.has(field)) {
    const opMatch = /^(>=|<=|>|<)(.+)$/.exec(value);
    if (opMatch) {
      operator = opMatch[1];
      value = opMatch[2];
    } else {
      operator = 'equals';
    }
  } else {
    operator = 'contains';
  }

  return { negate, field, operator, value };
}

function getFieldValue(entry, field) {
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

function coerceNumericValue(field, value) {
  if (field === 'size') return parseSizeToBytes(value);
  if (field === 'duration') return parseDurationToMs(value);
  return parseFloat(value) || 0;
}

function matchesClause(entry, clause) {
  let matched;

  if (clause.field === null) {
    // Plain text search across URL + method.
    const haystack = `${entry.request.method} ${entry.request.url}`.toLowerCase();
    matched = haystack.includes(clause.value);
  } else if (NUMERIC_FIELDS.has(clause.field)) {
    const fieldValue = getFieldValue(entry, clause.field);
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

// Parses a raw query string into a list of clauses (exported for testing).
export function parseFilterQuery(query) {
  return tokenize((query || '').trim()).map(parseToken);
}

// Returns a filtered array of entries matching the given query string.
// All clauses are combined with AND semantics.
export function filterEntries(entries, query) {
  const clauses = parseFilterQuery(query);
  if (!clauses.length) return entries;
  return entries.filter(entry => clauses.every(clause => matchesClause(entry, clause)));
}
