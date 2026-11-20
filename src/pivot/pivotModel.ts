// Pure pivot logic: field keys, value coercion, aggregation, nested grouping,
// heatmap colors and cell filter queries. No DOM or IndexedDB access.
import type { ParsedEntry } from '@/common/types/har';
import { evaluateCustomColumn, type CustomColumn } from '@/table/customColumns';

// Built-in grouping fields. Custom columns are referenced as `custom:<id>`.
export const BUILTIN_FIELDS = [
  'statusRange',
  'status',
  'method',
  'host',
  'path',
  'basePath',
  'basePathStart',
  'basePathSegment2',
  'basePathSegment3',
  'basePathSegment4',
  'basePathLast',
  'protocol',
  'contentType',
  'side'
] as const;
export type BuiltinField = (typeof BUILTIN_FIELDS)[number];
export type PivotFieldId = BuiltinField | `custom:${string}`;

export const PIVOT_SIDES = ['request', 'response'] as const;
export type PivotSide = (typeof PIVOT_SIDES)[number];

// One half of a HAR entry. Every entry yields a request and a response record.
export interface PivotRecord {
  entry: ParsedEntry;
  side: PivotSide;
  // Milliseconds of the side's timings (see `splitEntry`).
  time: number;
  // Content-Length header of this side in bytes (0 when absent).
  contentLength: number;
  // Header size in bytes of this side: sum of name and value lengths.
  headerSize: number;
  // Cookie size in bytes of this side: sum of name and value lengths.
  cookieSize: number;
  // URL path without host, query string, or fragment, e.g. `/api/items`.
  basePath: string;
}

// Numeric sources for the Values zone.
export const NUMERIC_SOURCES = ['time', 'contentLength', 'headerSize', 'cookieSize', 'status'] as const;
export type NumericSource = (typeof NUMERIC_SOURCES)[number];
export type ValueSource = NumericSource | `custom:${string}`;

export const AGGREGATIONS = [
  'count',
  'distinct',
  'percentOfTotal',
  'sum',
  'min',
  'max',
  'avg',
  'median',
  'p75',
  'p90',
  'p95',
  'p99',
  'stddev'
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

// `from => to` rule applied before numeric conversion. `to` null means the
// value counts as empty and is ignored.
export interface ConversionRule {
  from: string;
  to: number | null;
}

export interface ValueField {
  source: ValueSource;
  aggregation: Aggregation;
  conversions: ConversionRule[];
}

// Include-only selection on a field (the Filter zone).
export interface FieldFilter {
  field: PivotFieldId;
  values: string[];
}

// Excludes the records that match every term (a cell's row and column values).
export interface ExclusionFilter {
  exclude: FieldFilter[];
}

export type PivotFilter = FieldFilter | ExclusionFilter;

export function isExclusionFilter(filter: PivotFilter): filter is ExclusionFilter {
  return 'exclude' in filter;
}

export interface HeatmapConfig {
  low: string;
  mid: string;
  high: string;
}

export interface PivotConfig {
  rows: PivotFieldId[];
  columns: PivotFieldId[];
  values: ValueField[];
  filters: PivotFilter[];
  heatmap: HeatmapConfig | null;
}

// Base set: a saved filter (by node id) or a custom query over all rows.
export type BaseSet = { kind: 'filter'; id: number } | { kind: 'custom'; query: string };

// Pivot state kept per database: the chosen base set and the layout.
export interface PivotState {
  base: BaseSet | null;
  config: PivotConfig;
}

// Layout used until the user changes it: the Content-Length sum, so a chosen base set renders at once.
export function defaultPivotConfig(): PivotConfig {
  return {
    rows: [],
    columns: [],
    values: [{ source: 'contentLength', aggregation: 'sum', conversions: [] }],
    filters: [],
    heatmap: null
  };
}

export const EMPTY_KEY = '(empty)';

export function statusRangeKey(status: number): string {
  if (!Number.isFinite(status) || status < 100 || status > 599) return EMPTY_KEY;
  return `${Math.floor(status / 100)}xx`;
}

// Splits an entry into its request and response records. Timings: the request
// side is blocked + dns + connect + ssl + send, the response side is wait +
// receive, so the two sides add up to the entry's phases. Both sides keep the
// entry's attributes (method, host, status, ...).
export function splitEntry(entry: ParsedEntry): PivotRecord[] {
  const timings = entry.timings;
  const requestTime = (timings.blocked ?? 0) + (timings.dns ?? 0) + (timings.connect ?? 0)
    + (timings.ssl ?? 0) + (timings.send ?? 0);
  const responseTime = (timings.wait ?? 0) + (timings.receive ?? 0);
  const request = entry.request;
  const response = entry.response;
  const basePath = basePathOf(request.url);
  return [
    {
      entry, side: 'request', time: requestTime, contentLength: contentLengthOf(request.headers),
      headerSize: stringSize(request.headers), cookieSize: stringSize(request.cookies), basePath
    },
    {
      entry, side: 'response', time: responseTime, contentLength: contentLengthOf(response.headers),
      headerSize: stringSize(response.headers), cookieSize: stringSize(response.cookies), basePath
    }
  ];
}

// The path of the URL without host, query string, or fragment, e.g. `/api/items`.
export function basePathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
  }
}

// The `index`-th (0-based) non-empty segment of a base path, e.g. `items` for
// index 1 of `/api/items/x`; empty when the path has fewer segments.
export function basePathSegment(basePath: string, index: number): string {
  return basePath.split('/').filter(segment => segment !== '')[index] ?? '';
}

// The last non-empty segment of a base path, e.g. `y` for `/api/items/x/y`.
export function basePathLastSegment(basePath: string): string {
  const segments = basePath.split('/').filter(segment => segment !== '');
  return segments[segments.length - 1] ?? '';
}

// Row groups at depth 0 (the grand total) and 1 are expanded by default, so
// only the first two levels show.
export const DEFAULT_EXPANDED_DEPTH = 2;

// Whether a row group is expanded: `overrides` holds the user's toggles,
// keyed by `rowToggleKey`, and everything else follows the default.
export function isRowExpanded(path: string[], overrides: Map<string, boolean>, rowFields: PivotFieldId[]): boolean {
  return overrides.get(rowToggleKey(path, rowFields)) ?? path.length < DEFAULT_EXPANDED_DEPTH;
}

// Key for a row group's toggle state; the row fields are part of it so that
// toggles do not carry over to another row layout.
export function rowToggleKey(path: string[], rowFields: PivotFieldId[]): string {
  return JSON.stringify([rowFields, path]);
}

// A row is shown when every group above it is expanded.
export function isRowVisible(path: string[], isExpanded: (prefix: string[]) => boolean): boolean {
  for (let depth = 1; depth < path.length; depth++) {
    if (!isExpanded(path.slice(0, depth))) return false;
  }
  return true;
}

// Sum of the name and value string lengths of a header or cookie list.
// Content-Length header value in bytes; 0 when the header is absent or not a number.
function contentLengthOf(headers: ReadonlyArray<{ name: string; value: string }>): number {
  const header = headers.find(item => item.name.toLowerCase() === 'content-length');
  const value = Number(header?.value.trim());
  return header && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringSize(items: ReadonlyArray<{ name: string; value: string }>): number {
  return items.reduce((sum, item) => sum + item.name.length + item.value.length, 0);
}

// Returns a copy of `list` with the item at `from` moved to position `to`.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from === to || from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item!);
  return result;
}

// Removes the item at `sourceIndex` from `source` and inserts it into `target` at `targetIndex`
// (clamped to the end of `target`).
export function transferItem<T>(
  source: readonly T[],
  sourceIndex: number,
  target: readonly T[],
  targetIndex: number
): { source: T[]; target: T[] } {
  if (sourceIndex < 0 || sourceIndex >= source.length) return { source: [...source], target: [...target] };
  const item = source[sourceIndex]!;
  const newTarget = [...target];
  newTarget.splice(Math.min(Math.max(targetIndex, 0), newTarget.length), 0, item);
  return { source: source.filter((_, i) => i !== sourceIndex), target: newTarget };
}

// Key of a grouping field for one record. `columns` resolves custom columns.
// Include filters need the record's field value to be selected; an exclusion
// drops the record when it matches all of its terms.
export function recordPassesFilters(record: PivotRecord, filters: PivotFilter[], columns: CustomColumn[]): boolean {
  const matches = (filter: FieldFilter) => filter.values.includes(fieldKey(filter.field, record, columns));
  return filters.every(filter => (isExclusionFilter(filter) ? !filter.exclude.every(matches) : matches(filter)));
}

export function fieldKey(field: PivotFieldId, record: PivotRecord, columns: CustomColumn[]): string {
  const entry = record.entry;
  switch (field) {
    case 'statusRange':
      return statusRangeKey(entry.response.status);
    case 'status':
      return entry.response.status > 0 ? String(entry.response.status) : EMPTY_KEY;
    case 'method':
      return entry.request.method || EMPTY_KEY;
    case 'host':
      return entry.host || EMPTY_KEY;
    case 'path':
      return entry.path || EMPTY_KEY;
    case 'basePath':
      return record.basePath || EMPTY_KEY;
    case 'basePathStart':
      return basePathSegment(record.basePath, 0) || EMPTY_KEY;
    case 'basePathSegment2':
      return basePathSegment(record.basePath, 1) || EMPTY_KEY;
    case 'basePathSegment3':
      return basePathSegment(record.basePath, 2) || EMPTY_KEY;
    case 'basePathSegment4':
      return basePathSegment(record.basePath, 3) || EMPTY_KEY;
    case 'basePathLast':
      return basePathLastSegment(record.basePath) || EMPTY_KEY;
    case 'protocol':
      return entry.protocol || EMPTY_KEY;
    case 'contentType':
      return entry.contentType || EMPTY_KEY;
    case 'side':
      return record.side;
  }
  const column = customColumnFor(field, columns);
  if (!column) return EMPTY_KEY;
  return evaluateCustomColumn(column, entry) || EMPTY_KEY;
}

function customColumnFor(field: string, columns: CustomColumn[]): CustomColumn | undefined {
  const id = field.slice('custom:'.length);
  return columns.find(column => column.id === id);
}

// Raw value of a value source (before conversion).
function rawSourceValue(source: ValueSource, record: PivotRecord, columns: CustomColumn[]): unknown {
  switch (source) {
    case 'time':
      return record.time;
    case 'contentLength':
      return record.contentLength;
    case 'headerSize':
      return record.headerSize;
    case 'cookieSize':
      return record.cookieSize;
    case 'status':
      return record.entry.response.status;
  }
  const column = customColumnFor(source, columns);
  return column ? evaluateCustomColumn(column, record.entry) : '';
}

// Converts a raw value to a finite number, or undefined when it is empty or
// not numeric. Conversion rules are checked first (exact text match).
export function coerceNumber(raw: unknown, rules: ConversionRule[]): number | undefined {
  const text = String(raw ?? '').trim();
  const rule = rules.find(candidate => candidate.from.trim() === text);
  if (rule) return rule.to ?? undefined;
  if (text === '') return undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Linear-interpolated percentile of a sorted, non-empty list.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

// Aggregates one cell. `numbers` are the coerced numeric values, `rawValues`
// the raw texts of all entries in the cell, `entryCount` the entries in the
// cell and `baseCount` the entries in the base set. `percentOfTotal` is the
// cell's entry count as a percentage of the base set.
export function aggregate(
  aggregation: Aggregation,
  numbers: number[],
  rawValues: string[],
  entryCount: number,
  baseCount: number
): number | null {
  switch (aggregation) {
    case 'count':
      return entryCount;
    case 'distinct':
      return new Set(rawValues).size;
    case 'percentOfTotal':
      return baseCount > 0 ? (entryCount / baseCount) * 100 : null;
  }
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, value) => total + value, 0);
  switch (aggregation) {
    case 'sum':
      return sum;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    case 'avg':
      return sum / numbers.length;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  switch (aggregation) {
    case 'median':
      return percentile(sorted, 50);
    case 'p75':
      return percentile(sorted, 75);
    case 'p90':
      return percentile(sorted, 90);
    case 'p95':
      return percentile(sorted, 95);
    case 'p99':
      return percentile(sorted, 99);
    case 'stddev': {
      const mean = sum / numbers.length;
      const variance = numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length;
      return Math.sqrt(variance);
    }
  }
  return null;
}

// Every statistic of one cell's values, kept unrounded for the cell tooltip.
export interface CellStatistics {
  entries: number;
  baseShare: number | null;
  numeric: number;
  distinct: number;
  sum: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  stddev: number | null;
}

export function cellStatistics(bucket: Bucket, valueIndex: number, baseCount: number): CellStatistics {
  const numbers = bucket.numbers[valueIndex]!;
  const raw = bucket.raw[valueIndex]!;
  const entries = bucket.entries;
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((total, value) => total + value, 0);
  const hasNumbers = numbers.length > 0;
  const avg = hasNumbers ? sum / numbers.length : null;
  const variance = hasNumbers ? numbers.reduce((total, value) => total + (value - avg!) ** 2, 0) / numbers.length : null;
  return {
    entries,
    baseShare: baseCount > 0 ? (entries / baseCount) * 100 : null,
    numeric: numbers.length,
    distinct: new Set(raw).size,
    sum: hasNumbers ? sum : null,
    min: hasNumbers ? sorted[0]! : null,
    max: hasNumbers ? sorted[sorted.length - 1]! : null,
    avg,
    median: hasNumbers ? percentile(sorted, 50) : null,
    p75: hasNumbers ? percentile(sorted, 75) : null,
    p90: hasNumbers ? percentile(sorted, 90) : null,
    p95: hasNumbers ? percentile(sorted, 95) : null,
    p99: hasNumbers ? percentile(sorted, 99) : null,
    stddev: variance === null ? null : Math.sqrt(variance)
  };
}

// One row or column header: the field values from the outermost group down
// to this level. An empty path is the grand total.
export interface PivotPath {
  path: string[];
  depth: number;
}

export interface Bucket {
  entries: number;
  numbers: number[][];
  raw: string[][];
}

export interface PivotResult {
  baseCount: number;
  rows: PivotPath[];
  columns: PivotPath[];
  values: ValueField[];
  // Aggregated value per value field, keyed by cellKey(rowPath, colPath, valueIndex).
  cells: Map<string, number | null>;
  // Min and max of each value field across all its cells (for heatmaps).
  ranges: { min: number; max: number }[];
  // Full statistics per cell, keyed like cells.
  stats: Map<string, CellStatistics>;
}

// Largest pivot the view renders: column headers (including subtotals) and
// rendered cells (rows x columns x values).
export const MAX_PIVOT_COLUMNS = 200;
export const MAX_PIVOT_CELLS = 40000;

// Explains why a pivot is too large to render, or returns null when it is within limits.
export function pivotLimitMessage(result: PivotResult): string | null {
  const columns = result.columns.length;
  const cells = result.rows.length * columns * result.values.length;
  if (columns > MAX_PIVOT_COLUMNS) {
    return `Pivot too large: ${columns} columns (limit ${MAX_PIVOT_COLUMNS}). Remove or reorder Columns, or narrow the base set.`;
  }
  if (cells > MAX_PIVOT_CELLS) {
    return `Pivot too large: ${cells.toLocaleString('en-US')} cells (limit ${MAX_PIVOT_CELLS.toLocaleString('en-US')}). Remove Rows or Values, or narrow the base set.`;
  }
  return null;
}

export function cellKey(rowPath: string[], colPath: string[], valueIndex: number): string {
  return JSON.stringify([rowPath, colPath, valueIndex]);
}

// Enumerates the paths of a grouping: the grand total, then each prefix of
// every distinct key combination, sorted level by level.
function enumeratePaths(paths: string[][]): PivotPath[] {
  const seen = new Map<string, string[]>();
  for (const path of paths) {
    for (let depth = 0; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth);
      seen.set(JSON.stringify(prefix), prefix);
    }
  }
  const all = [...seen.values()];
  all.sort((a, b) => {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      const cmp = (a[i] ?? '').localeCompare(b[i] ?? '', undefined, { numeric: true });
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  });
  return all.map(path => ({ path, depth: path.length }));
}

// Builds the pivot for the given records (the base set after the Filter zone).
export function buildPivot(records: PivotRecord[], config: PivotConfig, columns: CustomColumn[]): PivotResult {
  const values = config.values;
  const rowKeys: string[][] = [];
  const colKeys: string[][] = [];
  const buckets = new Map<string, Bucket>();

  for (const record of records) {
    const row = config.rows.map(field => fieldKey(field, record, columns));
    const col = config.columns.map(field => fieldKey(field, record, columns));
    const rawPerValue = values.map(value => rawSourceValue(value.source, record, columns));
    rowKeys.push(row);
    colKeys.push(col);

    // Every row/column prefix (including the grand total) gets this entry.
    for (let r = 0; r <= row.length; r++) {
      for (let c = 0; c <= col.length; c++) {
        const key = JSON.stringify([row.slice(0, r), col.slice(0, c)]);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { entries: 0, numbers: values.map(() => []), raw: values.map(() => []) };
          buckets.set(key, bucket);
        }
        bucket.entries++;
        values.forEach((value, v) => {
          const raw = rawPerValue[v];
          bucket!.raw[v]!.push(String(raw ?? ''));
          const number = coerceNumber(raw, value.conversions);
          if (number !== undefined) bucket!.numbers[v]!.push(number);
        });
      }
    }
  }

  const cells = new Map<string, number | null>();
  const stats = new Map<string, CellStatistics>();
  const emptyRange = () => ({ min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY });
  const ranges = values.map(emptyRange);
  for (const [key, bucket] of buckets) {
    const [rowPath, colPath] = JSON.parse(key) as [string[], string[]];
    values.forEach((value, v) => {
      const result = aggregate(value.aggregation, bucket.numbers[v]!, bucket.raw[v]!, bucket.entries, records.length);
      cells.set(cellKey(rowPath, colPath, v), result);
      stats.set(cellKey(rowPath, colPath, v), cellStatistics(bucket, v, records.length));
      if (result === null) return;
      const range = ranges[v]!;
      range.min = Math.min(range.min, result);
      range.max = Math.max(range.max, result);
    });
  }

  return {
    baseCount: records.length,
    rows: enumeratePaths(rowKeys),
    columns: enumeratePaths(colKeys),
    values,
    cells,
    ranges,
    stats
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Heatmap color for a value within its range: low → mid → high, interpolated
// in RGB. Undefined when the value is null, the range is degenerate or a
// color is not a 6-digit hex.
// Position of a value within its range as a fraction in [0, 1], or null when
// the value is null or the range is empty. A flat range (all values equal,
// e.g. after an include filter leaves one cell) sits at the neutral middle.
export function heatmapPosition(value: number | null, range: { min: number; max: number }): number | null {
  if (value === null || !Number.isFinite(range.min)) return null;
  if (range.max <= range.min) return 0.5;
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
}

export function heatmapColor(
  value: number | null,
  range: { min: number; max: number },
  scale: HeatmapConfig
): string | undefined {
  const t = heatmapPosition(value, range);
  if (t === null) return undefined;
  const [from, to, local] = t < 0.5 ? [scale.low, scale.mid, t * 2] : [scale.mid, scale.high, (t - 0.5) * 2];
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return undefined;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * local);
  return `rgb(${mix(a[0], b[0])}, ${mix(a[1], b[1])}, ${mix(a[2], b[2])})`;
}

// Filter query selecting the entries of one cell: one clause per grouping
// level on the row and column paths. Returns null when a level cannot be
// expressed as a filter (custom columns, the empty bucket).
export function cellFilterQuery(
  rowFields: PivotFieldId[],
  rowPath: string[],
  colFields: PivotFieldId[],
  colPath: string[]
): string | null {
  const clauses: string[] = [];
  for (let i = 0; i < rowPath.length; i++) {
    const clause = clauseFor(rowFields[i]!, rowPath[i]!);
    if (clause === undefined) return null;
    clauses.push(clause);
  }
  for (let i = 0; i < colPath.length; i++) {
    const clause = clauseFor(colFields[i]!, colPath[i]!);
    if (clause === undefined) return null;
    clauses.push(clause);
  }
  return clauses.join(' ');
}

// Exclusion of the records in one cell: one term per row and column level of
// its path. Null for the grand total, which has no terms.
// One single-value term per row and column level of a cell (empty for the grand total).
export function cellTerms(
  rowFields: PivotFieldId[],
  rowPath: string[],
  colFields: PivotFieldId[],
  colPath: string[]
): FieldFilter[] {
  return [
    ...rowPath.map((value, i) => ({ field: rowFields[i]!, values: [value] })),
    ...colPath.map((value, i) => ({ field: colFields[i]!, values: [value] }))
  ];
}

export function cellExclusion(
  rowFields: PivotFieldId[],
  rowPath: string[],
  colFields: PivotFieldId[],
  colPath: string[]
): ExclusionFilter | null {
  const exclude = cellTerms(rowFields, rowPath, colFields, colPath);
  return exclude.length === 0 ? null : { exclude };
}

// Query clause for a single field value, or undefined when not expressible.
function clauseFor(field: PivotFieldId, value: string): string | undefined {
  if (value === EMPTY_KEY) return undefined;
  switch (field) {
    case 'statusRange': {
      const digit = Number(value[0]);
      if (!Number.isFinite(digit)) return undefined;
      return `status:>=${digit * 100} status:<${(digit + 1) * 100}`;
    }
    case 'status':
      return `status:${value}`;
    case 'method':
      return `method:${quoteValue(value)}`;
    case 'host':
      return `host:${quoteValue(value)}`;
    case 'path':
      return `path:${quoteValue(value)}`;
    // The filter's `path:` clause is a substring match on path and query, so this
    // also matches longer paths. There is no exact base-path clause.
    case 'basePath':
      return `path:${quoteValue(value)}`;
    // Segment cells use the same substring match, bounded by slashes.
    case 'basePathStart':
    case 'basePathSegment2':
    case 'basePathSegment3':
    case 'basePathSegment4':
    case 'basePathLast':
      return `path:${quoteValue(`/${value}/`)}`;
    case 'protocol':
      return `protocol:${quoteValue(value)}`;
    case 'contentType':
      return `type:${quoteValue(value)}`;
    // A side is not a property of the entry, so a side cell has no filter.
    case 'side':
      return undefined;
  }
  return undefined;
}

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
