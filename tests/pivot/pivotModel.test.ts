import {
  aggregate,
  basePathOf,
  basePathLastSegment,
  basePathSegment,
  buildPivot,
  cellFilterQuery,
  cellExclusion,
  cellTerms,
  cellKey,
  coerceNumber,
  defaultPivotConfig,
  heatmapColor,
  heatmapPosition,
  isRowExpanded,
  isRowVisible,
  moveItem,
  recordPassesFilters,
  pivotLimitMessage,
  MAX_PIVOT_CELLS,
  MAX_PIVOT_COLUMNS,
  transferItem,
  PivotRecord,
  splitEntry,
  statusRangeKey,
  type PivotConfig,
  type PivotResult
} from '@/pivot/pivotModel';
import type { ParsedEntry } from '@/common/types/har';

function entry(over: {
  method?: string;
  url?: string;
  status?: number;
  host?: string;
  reqHeaders?: { name: string; value: string }[];
  resHeaders?: { name: string; value: string }[];
  reqCookies?: { name: string; value: string }[];
  resCookies?: { name: string; value: string }[];
  timings?: Partial<ParsedEntry['timings']>;
}): ParsedEntry {
  return {
    id: 0,
    startedDateTime: '',
    startedTimeMs: 0,
    relativeStartMs: 0,
    time: 0,
    request: {
      method: over.method ?? 'GET',
      url: over.url ?? '',
      bodySize: -1,
      headers: over.reqHeaders ?? [],
      cookies: over.reqCookies ?? []
    } as unknown as ParsedEntry['request'],
    response: {
      status: over.status ?? 200,
      bodySize: -1,
      headers: over.resHeaders ?? [],
      cookies: over.resCookies ?? []
    } as unknown as ParsedEntry['response'],
    cache: {},
    timings: { blocked: 0, dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0, ...over.timings },
    serverIPAddress: '',
    connection: '',
    comment: '',
    protocol: 'http/1.1',
    host: over.host ?? 'a.test',
    path: '/',
    contentType: 'json'
  };
}

const base: PivotConfig = {
  rows: ['statusRange', 'status'],
  columns: ['method'],
  values: [{ source: 'time', aggregation: 'count', conversions: [] }],
  filters: [],
  heatmap: null
};

describe('statusRangeKey', () => {
  it('buckets status codes into classes and marks missing ones', () => {
    expect(statusRangeKey(204)).toBe('2xx');
    expect(statusRangeKey(404)).toBe('4xx');
    expect(statusRangeKey(503)).toBe('5xx');
    expect(statusRangeKey(0)).toBe('(empty)');
  });
});

describe('coerceNumber', () => {
  it('parses numbers and numeric strings and rejects the rest', () => {
    expect(coerceNumber(12, [])).toBe(12);
    expect(coerceNumber(' 3.5 ', [])).toBe(3.5);
    expect(coerceNumber('abc', [])).toBeUndefined();
    expect(coerceNumber('', [])).toBeUndefined();
  });

  it('applies from => to rules before parsing', () => {
    const rules = [{ from: '-1', to: null }];
    expect(coerceNumber(-1, rules)).toBeUndefined();
    expect(coerceNumber('-1', [{ from: '-1', to: 0 }])).toBe(0);
  });
});

describe('aggregate', () => {
  const nums = [1, 2, 3, 4];
  it('computes basic statistics', () => {
    expect(aggregate('sum', nums, [], 4, 4)).toBe(10);
    expect(aggregate('min', nums, [], 4, 4)).toBe(1);
    expect(aggregate('max', nums, [], 4, 4)).toBe(4);
    expect(aggregate('avg', nums, [], 4, 4)).toBe(2.5);
    expect(aggregate('median', nums, [], 4, 4)).toBe(2.5);
    expect(aggregate('stddev', [2, 4, 4, 4, 5, 5, 7, 9], [], 8, 8)).toBe(2);
  });

  it('interpolates percentiles', () => {
    expect(aggregate('p90', [0, 10], [], 2, 2)).toBe(9);
    expect(aggregate('p75', [0, 10], [], 2, 2)).toBe(7.5);
    expect(aggregate('p99', [5], [], 1, 1)).toBe(5);
  });

  it('counts, distinct values and percent of the base set', () => {
    expect(aggregate('count', [], ['a', 'a'], 2, 8)).toBe(2);
    expect(aggregate('distinct', [], ['a', 'a', 'b'], 3, 3)).toBe(2);
    expect(aggregate('percentOfTotal', [], [], 2, 8)).toBe(25);
  });

  it('returns null when there are no numbers', () => {
    expect(aggregate('sum', [], [], 1, 1)).toBeNull();
  });
});

describe('splitEntry', () => {
  it('yields a request and a response record with their own timing and size', () => {
    const [request, response] = splitEntry(
      entry({ reqHeaders: [{ name: 'content-length', value: '120' }], timings: { blocked: 1, dns: 2, connect: 3, ssl: 4, send: 5, wait: 20, receive: 10 } })
    );
    expect(request).toMatchObject({ side: 'request', time: 15, contentLength: 120 });
    expect(response).toMatchObject({ side: 'response', time: 30, contentLength: 0 });
  });

  it('reads Content-Length case-insensitively and counts a missing one as zero', () => {
    const [request, response] = splitEntry(
      entry({ resHeaders: [{ name: 'Content-Length', value: ' 42 ' }] })
    );
    expect(response).toMatchObject({ contentLength: 42 });
    expect(request).toMatchObject({ contentLength: 0 });
  });

  it('sums header and cookie name and value lengths per side', () => {
    const [request, response] = splitEntry(
      entry({
        reqHeaders: [{ name: 'a', value: 'bc' }, { name: 'dd', value: '' }],
        reqCookies: [{ name: 'sid', value: 'xyz' }],
        resHeaders: [{ name: 'content-type', value: 'text/html' }]
      })
    );
    expect(request).toMatchObject({ headerSize: 1 + 2 + 2, cookieSize: 6 });
    expect(response).toMatchObject({ headerSize: 12 + 9, cookieSize: 0 });
  });

  it('gives both sides the URL path without query and fragment as basePath', () => {
    const [request, response] = splitEntry(
      entry({ url: 'https://example.com/api/items?page=2#top' })
    ) as [PivotRecord, PivotRecord];
    expect(request.basePath).toBe('/api/items');
    expect(response.basePath).toBe('/api/items');
  });
});

describe('exclusion filters', () => {
  const record = splitEntry(entry({ method: 'GET', url: 'https://example.com/api/users', status: 404 }))[1]!;
  const other = splitEntry(entry({ method: 'POST', url: 'https://example.com/login', status: 200 }))[1]!;

  it('builds one term per row and column level of the cell path', () => {
    expect(cellExclusion(['statusRange'], ['4xx'], ['method'], ['GET'])).toEqual({
      exclude: [
        { field: 'statusRange', values: ['4xx'] },
        { field: 'method', values: ['GET'] }
      ]
    });
  });

  it('gives one include term per cell level and none for the grand total', () => {
    expect(cellTerms(['statusRange'], ['4xx'], ['method'], ['GET'])).toEqual([
      { field: 'statusRange', values: ['4xx'] },
      { field: 'method', values: ['GET'] }
    ]);
    expect(cellTerms(['status'], [], ['method'], [])).toEqual([]);
  });

  it('has no exclusion for the grand total', () => {
    expect(cellExclusion(['status'], [], ['method'], [])).toBeNull();
  });

  it('drops a record only when it matches every term', () => {
    const exclusion = cellExclusion(['statusRange'], ['4xx'], ['method'], ['GET'])!;
    expect(recordPassesFilters(record, [exclusion], [])).toBe(false);
    expect(recordPassesFilters(other, [exclusion], [])).toBe(true);
  });

  it('keeps only the cell when its terms are applied as include filters', () => {
    const terms = cellTerms(['statusRange'], ['4xx'], ['method'], ['GET']);
    expect(recordPassesFilters(record, terms, [])).toBe(true);
    expect(recordPassesFilters(other, terms, [])).toBe(false);
  });

  it('combines with include filters', () => {
    const include = { field: 'method' as const, values: ['GET', 'POST'] };
    const exclusion = { exclude: [{ field: 'statusRange' as const, values: ['4xx'] }] };
    expect(recordPassesFilters(record, [include, exclusion], [])).toBe(false);
    expect(recordPassesFilters(other, [include, exclusion], [])).toBe(true);
  });
});

describe('defaultPivotConfig', () => {
  it('starts with the Content-Length sum and empty layout', () => {
    expect(defaultPivotConfig()).toEqual({
      rows: [],
      columns: [],
      values: [{ source: 'contentLength', aggregation: 'sum', conversions: [] }],
      filters: [],
      heatmap: null
    });
  });

  it('returns a fresh object on each call', () => {
    const a = defaultPivotConfig();
    a.values.push({ source: 'time', aggregation: 'sum', conversions: [] });
    expect(defaultPivotConfig().values).toHaveLength(1);
  });
});

describe('basePathOf', () => {
  it('returns the path without host, query, or fragment', () => {
    expect(basePathOf('https://a.test/x/y')).toBe('/x/y');
    expect(basePathOf('https://a.test/x?q=1&r=2')).toBe('/x');
    expect(basePathOf('https://a.test/x#frag?not-query')).toBe('/x');
    expect(basePathOf('https://a.test/x?q=1#frag')).toBe('/x');
    expect(basePathOf('https://a.test/')).toBe('/');
    expect(basePathOf('/relative/p?q=1')).toBe('/relative/p');
    expect(basePathOf('')).toBe('');
  });
});

describe('moveItem', () => {
  it('moves an item forward and backward without mutating the input', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns a copy unchanged for no-op or out-of-range moves', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('transferItem', () => {
  it('moves an item between lists at the given index', () => {
    const result = transferItem(['a', 'b', 'c'], 1, ['x', 'y'], 1);
    expect(result).toEqual({ source: ['a', 'c'], target: ['x', 'b', 'y'] });
  });

  it('appends when the target index is past the end', () => {
    expect(transferItem(['a'], 0, ['x'], Number.MAX_SAFE_INTEGER).target).toEqual(['x', 'a']);
  });

  it('leaves both lists unchanged for an invalid source index', () => {
    expect(transferItem(['a'], 3, ['x'], 0)).toEqual({ source: ['a'], target: ['x'] });
  });
});

describe('buildPivot', () => {
  const entries = [
    entry({ method: 'GET', status: 200 }),
    entry({ method: 'POST', status: 200 }),
    entry({ method: 'GET', status: 404 }),
    entry({ method: 'GET', status: 500 })
  ];
  const pivot = buildPivot(entries.flatMap(splitEntry), base, []);

  it('adds subtotal rows for each status class and a grand total', () => {
    const rowPaths = pivot.rows.map(row => row.path);
    expect(rowPaths).toContainEqual([]);
    expect(rowPaths).toContainEqual(['2xx']);
    expect(rowPaths).toContainEqual(['2xx', '200']);
    expect(rowPaths).toContainEqual(['4xx', '404']);
  });

  it('counts request and response records per row and column path', () => {
    const get = (r: string[], c: string[]) => pivot.cells.get(cellKey(r, c, 0));
    expect(get([], [])).toBe(8);
    expect(get(['2xx'], [])).toBe(4);
    expect(get(['2xx'], ['GET'])).toBe(2);
    expect(get(['2xx', '200'], ['POST'])).toBe(2);
    expect(get(['4xx'], ['POST'])).toBeUndefined();
  });

  it('splits records by side as a grouping field', () => {
    const bySide = buildPivot(entries.flatMap(splitEntry), { ...base, rows: [], columns: ['side'] }, []);
    expect(bySide.cells.get(cellKey([], ['request'], 0))).toBe(4);
    expect(bySide.cells.get(cellKey([], ['response'], 0))).toBe(4);
  });

  it('sums each side timing separately', () => {
    const timed = buildPivot(
      [entry({ timings: { send: 5, wait: 20, receive: 10 } })].flatMap(splitEntry),
      {
        ...base,
        rows: [],
        columns: ['side'],
        values: [{ source: 'time', aggregation: 'sum', conversions: [] }]
      },
      []
    );
    expect(timed.cells.get(cellKey([], ['request'], 0))).toBe(5);
    expect(timed.cells.get(cellKey([], ['response'], 0))).toBe(30);
  });

  it('gives average over numeric values, ignoring rules-empty cells', () => {
    const timed = buildPivot(
      [entry({ timings: { wait: 10 } }), entry({ timings: { wait: 30 } }), entry({ timings: { wait: -1 } })]
        .flatMap(splitEntry),
      {
        ...base,
        rows: [],
        columns: ['side'],
        values: [{ source: 'time', aggregation: 'avg', conversions: [{ from: '-1', to: null }] }]
      },
      []
    );
    expect(timed.cells.get(cellKey([], ['response'], 0))).toBe(20);
  });

  it('keeps the min and max over all cells for heatmaps', () => {
    const ranges = pivot.ranges[0]!;
    expect(ranges.min).toBeLessThanOrEqual(ranges.max);
  });
});

describe('cell statistics', () => {
  const sized = [
    entry({ method: 'GET', resHeaders: [{ name: 'content-length', value: '10' }] }),
    entry({ method: 'GET', resHeaders: [{ name: 'content-length', value: '20' }] }),
    entry({ method: 'GET', resHeaders: [{ name: 'content-length', value: '40' }] }),
    entry({ method: 'POST', resHeaders: [{ name: 'content-length', value: '5' }] })
  ];
  const records = sized.flatMap(splitEntry).filter(record => record.side === 'response');
  const pivot = buildPivot(
    records,
    { ...base, rows: ['method'], columns: [], values: [{ source: 'contentLength', aggregation: 'sum', conversions: [] }] },
    []
  );

  it('computes the full set of statistics for a cell', () => {
    const get = pivot.stats.get(cellKey(['GET'], [], 0))!;
    expect(get.entries).toBe(3);
    expect(get.numeric).toBe(3);
    expect(get.distinct).toBe(3);
    expect(get.sum).toBe(70);
    expect(get.min).toBe(10);
    expect(get.max).toBe(40);
    expect(get.avg).toBeCloseTo(70 / 3);
    expect(get.median).toBe(20);
    expect(get.p75).toBe(30);
    expect(get.baseShare).toBeCloseTo(75);
  });

  it('measures the share against all split request/response rows', () => {
    const both = buildPivot(
      sized.flatMap(splitEntry),
      { ...base, rows: ['method'], columns: [], values: [{ source: 'contentLength', aggregation: 'sum', conversions: [] }] },
      []
    );
    expect(both.baseCount).toBe(8);
    expect(both.stats.get(cellKey(['GET'], [], 0))!.baseShare).toBeCloseTo(75);
  });
});

describe('heatmapPosition', () => {
  it('gives the fraction of the way from min to max, clamped', () => {
    expect(heatmapPosition(5, { min: 0, max: 20 })).toBe(0.25);
    expect(heatmapPosition(30, { min: 0, max: 20 })).toBe(1);
    expect(heatmapPosition(null, { min: 0, max: 20 })).toBeNull();
    expect(heatmapPosition(null, { min: 3, max: 3 })).toBeNull();
  });

  it('puts a flat range (single or equal values) at the middle', () => {
    expect(heatmapPosition(3, { min: 3, max: 3 })).toBe(0.5);
  });
});

describe('heatmapColor', () => {
  const scale = { low: '#000000', mid: '#808080', high: '#ffffff' };
  it('maps the ends and middle of the range', () => {
    const range = { min: 0, max: 10 };
    expect(heatmapColor(0, range, scale)).toBe('rgb(0, 0, 0)');
    expect(heatmapColor(5, range, scale)).toBe('rgb(128, 128, 128)');
    expect(heatmapColor(10, range, scale)).toBe('rgb(255, 255, 255)');
  });

  it('returns undefined for null values and the middle color for a flat range', () => {
    expect(heatmapColor(null, { min: 0, max: 10 }, scale)).toBeUndefined();
    expect(heatmapColor(3, { min: 3, max: 3 }, scale)).toBe('rgb(128, 128, 128)');
  });
});

describe('cellFilterQuery', () => {
  it('builds a status range and method clause', () => {
    expect(cellFilterQuery(['statusRange'], ['4xx'], ['method'], ['POST'])).toBe(
      'status:>=400 status:<500 method:POST'
    );
  });

  it('quotes values with spaces and returns null for custom columns', () => {
    expect(cellFilterQuery(['host'], ['my host'], [], [])).toBe('host:"my host"');
    expect(cellFilterQuery(['custom:c1'], ['x'], [], [])).toBeNull();
    expect(cellFilterQuery(['status'], ['(empty)'], [], [])).toBeNull();
    expect(cellFilterQuery(['side'], ['request'], [], [])).toBeNull();
  });
});

describe('pivotLimitMessage', () => {
  const fake = (columns: number, rows: number, values: number) => ({
    baseCount: 0,
    rows: Array.from({ length: rows }, () => []),
    columns: Array.from({ length: columns }, () => []),
    values: Array.from({ length: values }, () => ({})),
    cells: new Map(),
    ranges: {}
  }) as unknown as PivotResult;

  it('allows a pivot at exactly the column and cell limits', () => {
    expect(pivotLimitMessage(fake(MAX_PIVOT_COLUMNS, 1, 1))).toBeNull();
    expect(pivotLimitMessage(fake(1, 4000, 10))).toBeNull();
  });

  it('reports too many columns', () => {
    expect(pivotLimitMessage(fake(MAX_PIVOT_COLUMNS + 1, 1, 1))).toMatch(/201 columns/);
  });

  it('reports too many cells', () => {
    expect(pivotLimitMessage(fake(1, 4001, 10))).toMatch(/40,010 cells/);
  });
});

describe('basePathSegment', () => {
  it('returns the n-th non-empty segment of a base path', () => {
    expect(basePathSegment('/api/items/x/y', 0)).toBe('api');
    expect(basePathSegment('/api/items/x/y', 1)).toBe('items');
    expect(basePathSegment('/api/items/x/y', 2)).toBe('x');
    expect(basePathSegment('/api/items/x/y', 3)).toBe('y');
  });

  it('returns an empty string when the path has fewer segments', () => {
    expect(basePathSegment('/api', 1)).toBe('');
    expect(basePathSegment('/', 0)).toBe('');
    expect(basePathSegment('', 0)).toBe('');
  });
});

describe('basePathLastSegment', () => {
  it('returns the last non-empty segment of a base path', () => {
    expect(basePathLastSegment('/api/items/x/y')).toBe('y');
    expect(basePathLastSegment('/api/items/')).toBe('items');
    expect(basePathLastSegment('/')).toBe('');
  });
});

describe('row tree expansion', () => {
  it('expands the grand total and first level by default, collapsing from the second level', () => {
    const overrides = new Map<string, boolean>();
    const fields = ['basePathStart', 'basePathSegment2', 'basePathSegment3'] as const;
    expect(isRowExpanded([], overrides, [...fields])).toBe(true);
    expect(isRowExpanded(['api'], overrides, [...fields])).toBe(true);
    expect(isRowExpanded(['api', 'items'], overrides, [...fields])).toBe(false);
  });

  it('shows a row only when every group above it is expanded', () => {
    const overrides = new Map<string, boolean>();
    const fields = ['basePathStart', 'basePathSegment2', 'basePathSegment3'] as const;
    const expanded = (path: string[]) => isRowExpanded(path, overrides, [...fields]);
    expect(isRowVisible(['api'], expanded)).toBe(true);
    expect(isRowVisible(['api', 'items'], expanded)).toBe(true);
    expect(isRowVisible(['api', 'items', 'x'], expanded)).toBe(false);
  });
});
