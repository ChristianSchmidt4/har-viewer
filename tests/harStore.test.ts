/**
 * @jest-environment node
 */
// Runs in the Node environment with fake-indexeddb providing IndexedDB.
import 'fake-indexeddb/auto';
import { HarStore, dbNameFor } from '../src/utils/harStore.js';
import type { HarEntryRaw } from '../src/types/har.js';
import { parseJsonFileStreaming } from '../src/utils/fileLoader.js';
import { computeHighlightClasses, parseHighlightRule } from '../src/utils/highlightRules.js';

const entry = (startedDateTime: string, time: number, method: string, url: string, status: number): HarEntryRaw =>
  ({
    startedDateTime,
    time,
    request: { method, url, httpVersion: 'HTTP/1.1', headers: [] },
    response: { status, statusText: '', httpVersion: 'HTTP/1.1', headers: [], content: { mimeType: 'text/html' } },
  }) as unknown as HarEntryRaw;

const ENTRIES: HarEntryRaw[] = [
  entry('2023-01-01T12:00:00.000Z', 150, 'GET', 'https://example.com/a', 200),
  entry('2023-01-01T12:00:01.000Z', 80, 'POST', 'https://api.example.org/b', 500),
  entry('2023-01-01T12:00:02.000Z', 300, 'GET', 'https://example.com/c', 404),
];

const root = (entries: unknown[]) => ({ log: { version: '1.2', creator: { name: 't', version: '1' }, entries } });

let counter = 0;
const freshName = () => `har:test-${++counter}`;

// Raw access to a key of the META store, for checking what is persisted.
const openRaw = (name: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const readMetaKey = async (name: string, key: string): Promise<any> => {
  const db = await openRaw(name);
  const value = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
};
const writeMetaKey = async (name: string, key: string, value: unknown): Promise<void> => {
  const db = await openRaw(name);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

// Loads the given items into a new store, the way handleFile does.
const load = async (name: string, items: unknown[]) => {
  const store = await HarStore.create(name, 'file.har', 1234, 1000);
  await store.writeBatch(items as HarEntryRaw[]);
  await store.finish(root([]), 123);
  return store;
};

describe('dbNameFor', () => {
  it('derives the same name for the same file name and modification time', () => {
    expect(dbNameFor('a.har', 1000)).toBe(dbNameFor('a.har', 1000));
    expect(dbNameFor('a.har', 1000)).not.toBe(dbNameFor('a.har', 1001));
    expect(dbNameFor('a.har', 1000)).not.toBe(dbNameFor('b.har', 1000));
  });
});

describe('HarStore', () => {
  it('reports no complete copy until the load is finished', async () => {
    const name = freshName();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    await store.writeBatch(ENTRIES.slice(0, 1));
    store.close();
    expect(await HarStore.inspect(name)).toBeNull();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed?.complete).toBe(false);
    expect(listed?.count).toBe(1);
    expect(listed?.fileSize).toBe(1234);
  });

  it('opens an incomplete copy while it is still being imported', async () => {
    const name = freshName();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    await store.writeBatch(ENTRIES.slice(0, 2));
    store.close();
    const reopened = await HarStore.open(name);
    expect(reopened.complete).toBe(false);
    expect(reopened.count).toBe(2);
    reopened.close();
  });

  it('lists stored databases with file name and size', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ fileName: 'file.har', fileSize: 1234, count: 3, complete: true });
  });

  it('lists the file time and comment, and updates the comment', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();
    await HarStore.updateComment(name, 'checkout flow');
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ fileModified: 1000, comment: 'checkout flow' });
  });

  it('uses the HAR log comment as the comment unless one is already set', async () => {
    const first = freshName();
    const store = await HarStore.create(first, 'file.har', 1234, 1000);
    await store.finish({ log: { comment: 'from file', entries: [] } }, null);
    store.close();
    const second = freshName();
    const edited = await HarStore.create(second, 'file.har', 1234, 1000);
    await edited.setComment('mine');
    await edited.finish({ log: { comment: 'from file', entries: [] } }, null);
    edited.close();
    const listed = await HarStore.list();
    expect(listed.find(d => d.name === first)?.comment).toBe('from file');
    expect(listed.find(d => d.name === second)?.comment).toBe('mine');
  });

  it('keeps the comment when a running import writes its rows', async () => {
    const name = freshName();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    await store.setComment('from import');
    await store.writeBatch(ENTRIES as unknown as HarEntryRaw[]);
    await store.finish(root([]), 123);
    store.close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ comment: 'from import', complete: true });
  });

  it('keeps a finished copy that can be reopened', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();

    const meta = await HarStore.inspect(name);
    expect(meta?.complete).toBe(true);
    expect(meta?.count).toBe(3);

    const reopened = await HarStore.open(name);
    expect(reopened.count).toBe(3);
    expect(reopened.complete).toBe(true);
    expect(reopened.uncompressedSize).toBe(123);
    reopened.close();
  });

  it('recreating a store replaces the previous content', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    expect(store.count).toBe(0);
    store.close();
    expect(await HarStore.inspect(name)).toBeNull();
  });

  it('returns parsed entries with ids and relative times', async () => {
    const store = await load(freshName(), ENTRIES);
    const [first, second] = await store.getEntries([0, 1]);
    expect(first!.id).toBe(0);
    expect(first!.host).toBe('example.com');
    expect(first!.relativeStartMs).toBe(0);
    expect(second!.relativeStartMs).toBe(1000);
    expect(second!.response.status).toBe(500);
    store.close();
  });

  it('filters ids by query within a range', async () => {
    const store = await load(freshName(), ENTRIES);
    expect(await store.filterIds('', 0, 3)).toEqual([0, 1, 2]);
    expect(await store.filterIds('status:200', 0, 3)).toEqual([0]);
    expect(await store.filterIds('method:get', 0, 3)).toEqual([0, 2]);
    expect(await store.filterIds('method:get', 1, 3)).toEqual([2]);
    expect(await store.filterIds('', 2, 2)).toEqual([]);
    store.close();
  });

  it('caches the filter result under its own key and reuses it for the same query on reopen', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();

    const store = await HarStore.open(name);
    expect(await store.filterIds('method:get', 0, 3)).toEqual([0, 2]);
    store.close();
    expect(await readMetaKey(name, 'filterCache')).toEqual({ query: 'method:get', count: 3, ids: [0, 2] });
    expect(await readMetaKey(name, 'meta')).not.toHaveProperty('filterCache');

    // Replace the cached ids to show a reopened store answers from the cache.
    await writeMetaKey(name, 'filterCache', { query: 'method:get', count: 3, ids: [9] });
    const reopened = await HarStore.open(name);
    expect(await reopened.filterIds('method:get', 0, 3)).toEqual([9]);
    expect(await reopened.filterIds('status:404', 0, 3)).toEqual([2]);
    reopened.close();
    expect(await readMetaKey(name, 'filterCache')).toEqual({ query: 'status:404', count: 3, ids: [2] });
  });

  it('exports the given entries as a HAR document and skips invalid items', async () => {
    const items = [ENTRIES[0], { invalid: true, reason: 'bad', raw: '{' }, ENTRIES[2]];
    const store = await load(freshName(), items);
    const blob = await store.exportBlob([0, 1, 2]);
    const parsed = JSON.parse(await blob.text());
    expect(parsed.log.version).toBe('1.2');
    expect(parsed.log.entries).toEqual([ENTRIES[0], ENTRIES[2]]);
    store.close();
  });

  it('exports the stored comment as log.comment, or none when cleared', async () => {
    const store = await HarStore.create(freshName(), 'file.har', 1234, 1000);
    await store.finish({ log: { comment: 'from file', entries: [] } }, null);
    await store.setComment('edited');
    expect(JSON.parse(await (await store.exportBlob([])).text()).log.comment).toBe('edited');
    await store.setComment('');
    expect(JSON.parse(await (await store.exportBlob([])).text()).log).not.toHaveProperty('comment');
    store.close();
  });
});

describe('HarStore filtering on sub-attributes', () => {
  const withHeaders = (url: string, reqHeaders: unknown[], resHeaders: unknown[], cookies: unknown[] = []) =>
    ({
      startedDateTime: '2023-01-01T12:00:00.000Z',
      time: 10,
      request: { method: 'GET', url, httpVersion: 'HTTP/1.1', headers: reqHeaders, cookies },
      response: { status: 200, statusText: '', httpVersion: 'HTTP/1.1', headers: resHeaders, cookies: [], content: { mimeType: 'text/html' } },
    }) as unknown as HarEntryRaw;

  const HEADER_ITEMS: HarEntryRaw[] = [
    withHeaders('https://ex.com/a', [{ name: 'User-Agent', value: 'Chromium/120' }], [{ name: 'X-Execution-Id', value: 'abc' }], [{ name: 'sid', value: 'xyz' }]),
    withHeaders('https://ex.com/b', [{ name: 'User-Agent', value: 'Firefox/120' }], []),
    withHeaders('https://ex.com/c', [], [{ name: 'Set-Cookie', value: 'x' }]),
  ];

  it('matches request and response headers stored in the database', async () => {
    const store = await load(freshName(), HEADER_ITEMS);
    expect(await store.filterIds('reqheader:user-agent=chromium', 0, 3)).toEqual([0]);
    expect(await store.filterIds('reqheader:user-agent', 0, 3)).toEqual([0, 1]);
    expect(await store.filterIds('resheader:x-execution-id', 0, 3)).toEqual([0]);
    expect(await store.filterIds('reqheader:user-agent=chromium or resheader:set-cookie', 0, 3)).toEqual([0, 2]);
    store.close();
  });

  it('matches request and response cookies stored in the database', async () => {
    const store = await load(freshName(), HEADER_ITEMS);
    expect(await store.filterIds('reqcookie:sid=xy', 0, 3)).toEqual([0]);
    expect(await store.filterIds('rescookie:sid', 0, 3)).toEqual([]);
    expect(await store.filterIds('not reqheader:user-agent=firefox', 0, 3)).toEqual([0, 2]);
    store.close();
  });

  it('combines field clauses with header clauses and respects the id range', async () => {
    const store = await load(freshName(), HEADER_ITEMS);
    expect(await store.filterIds('method:get and reqheader:user-agent', 0, 3)).toEqual([0, 1]);
    expect(await store.filterIds('reqheader:user-agent', 1, 3)).toEqual([1]);
    store.close();
  });
});

describe('HarStore highlighting of database rows', () => {
  it('applies highlight rules to the entries read back from the database', async () => {
    const store = await load(freshName(), [...ENTRIES, entry('2023-01-01T12:00:03.000Z', 5, 'GET', 'https://ex.com/d', 500)]);
    const rule = parseHighlightRule('status:>=500 => red bold');
    if (!('rule' in rule)) throw new Error(rule.error);
    const rules = [rule.rule];

    const [ok, server] = await store.getEntries([0, 3]);
    expect(computeHighlightClasses(rules, ok!)).toEqual([]);
    expect(computeHighlightClasses(rules, server!).sort()).toEqual(['bold', 'red']);
    store.close();
  });
});

describe('HarStore view state', () => {
  it('keeps the view state in the metadata and restores it on open', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();
    const reopened = await HarStore.open(name);
    expect(reopened.view).toEqual({ filter: '', customColumns: [], highlightRules: [] });
    const view = {
      filter: 'status:200',
      customColumns: [{ id: 'c1', label: 'Req/x', expression: 'reqheader:x' }],
      highlightRules: ['status:200 => red'],
    };
    await reopened.setView(view);
    reopened.close();
    const again = await HarStore.open(name);
    expect(again.view).toEqual(view);
    again.close();
    expect((await HarStore.inspect(name))?.view).toEqual(view);
  });

  it('keeps a comment changed through another connection when the view is saved', async () => {
    const name = freshName();
    const store = await load(name, ENTRIES);
    await HarStore.updateComment(name, 'changed elsewhere');
    await store.setView({ filter: 'method:get', customColumns: [], highlightRules: [] });
    store.close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ comment: 'changed elsewhere' });
    expect((await HarStore.inspect(name))?.view?.filter).toBe('method:get');
  });
});

// Mirrors index.ts runImport: stream the File in batches into the store, then finish.
const upload = async (name: string, json: string, batchSize: number) => {
  const store = await HarStore.create(name, 'upload.har', json.length, 42);
  const file = new File([json], 'upload.har');
  const { value, uncompressedSize } = await parseJsonFileStreaming(file, false, () => {}, {
    batchSize,
    onBatch: items => store.writeBatch(items as HarEntryRaw[]),
  });
  await store.finish(value as Record<string, unknown>, uncompressedSize);
  return store;
};

describe('HarStore upload', () => {
  it('stores every entry in batches and marks the copy complete', async () => {
    const items = Array.from({ length: 25 }, (_, i) => entry(`2023-01-01T12:00:${String(i % 60).padStart(2, '0')}.000Z`, i, 'GET', `https://ex.com/${i}`, 200));
    const name = freshName();
    const store = await upload(name, JSON.stringify(root(items)), 10);
    expect(store.count).toBe(25);
    expect(await store.filterIds('', 0, 25)).toHaveLength(25);
    const [last] = await store.getEntries([24]);
    expect(last!.request.url).toBe('https://ex.com/24');
    store.close();

    const inspected = await HarStore.inspect(name);
    expect(inspected?.complete).toBe(true);
    expect(inspected?.count).toBe(25);
    expect(inspected?.fileModified).toBe(42);
  });

  it('stores invalid entries as placeholders instead of failing the upload', async () => {
    const json = JSON.stringify(root([ENTRIES[0], 'not an object', ENTRIES[2]])).replace('"not an object"', '{"broken": }');
    const store = await upload(freshName(), json, 2);
    expect(store.count).toBe(3);
    const rows = await store.getEntries([0, 1, 2]);
    expect(rows[0]!.id).toBe(0);
    expect(rows[2]!.id).toBe(2);
    store.close();
  });

  it('keeps the document and the HAR comment from the file', async () => {
    const doc = { log: { version: '1.2', comment: 'from upload', entries: ENTRIES } };
    const store = await upload(freshName(), JSON.stringify(doc), 1000);
    expect(store.comment).toBe('from upload');
    expect(store.count).toBe(3);
    store.close();
  });
});
describe('HarStore upload at scale', () => {
  const SCALE_COUNT = 100_000;
  const METHODS = ['GET', 'POST', 'PUT'] as const;
  const STATUSES = [200, 201, 404, 500] as const;
  const MIMES = ['text/html', 'application/json', 'text/plain', 'image/png'] as const;

  // Deterministic body length: mostly small, with ~1% large (8-16 KB) bodies.
  const bodyLength = (i: number, salt: number) =>
    (i * salt) % 100 === 0 ? 8192 + ((i * 13 + salt) % 8192) : (i * 31 + salt) % 600;

  const scaleEntry = (i: number) => {
    const method = METHODS[i % METHODS.length]!;
    const reqLen = method === 'GET' ? 0 : bodyLength(i, 3);
    const respLen = bodyLength(i, 7);
    return {
      startedDateTime: new Date(Date.UTC(2023, 0, 1, 12) + i * 1000).toISOString(),
      time: (i * 17) % 500,
      request: {
        method,
        url: `https://ex.com/${i}`,
        httpVersion: 'HTTP/1.1',
        headers: [],
        bodySize: reqLen,
        ...(reqLen > 0 ? { postData: { mimeType: 'application/json', text: 'p'.repeat(reqLen) } } : {}),
      },
      response: {
        status: STATUSES[i % STATUSES.length],
        statusText: '',
        httpVersion: 'HTTP/1.1',
        headers: [],
        bodySize: respLen,
        content: { size: respLen, mimeType: MIMES[i % MIMES.length], text: 'r'.repeat(respLen) },
      },
    };
  };

  it('imports 100k entries of varying size in batches and reads them back', async () => {
    const items = Array.from({ length: SCALE_COUNT }, (_, i) => scaleEntry(i));
    const name = freshName();
    const json = JSON.stringify(root(items));

    const store = await upload(name, json, 1000);
    expect(store.count).toBe(SCALE_COUNT);

    const sampleIds = [0, 1, 49, 50, 99_998, 99_999];
    const rows = await store.getEntries(sampleIds);
    sampleIds.forEach((i, k) => {
      const expected = scaleEntry(i);
      const row = rows[k]!;
      expect(row.id).toBe(i);
      expect(row.request.url).toBe(`https://ex.com/${i}`);
      expect(row.request.method).toBe(expected.request.method);
      expect(row.request.postData?.text.length ?? 0).toBe(expected.request.bodySize);
      expect(row.response.content.size).toBe(expected.response.content.size);
      expect(row.response.content.text.length).toBe(expected.response.content.size);
    });

    const expectedPosts = Array.from({ length: SCALE_COUNT }, (_, i) => i).filter(i => i % 3 === 1).length;
    expect(await store.filterIds('method:post', 0, SCALE_COUNT)).toHaveLength(expectedPosts);
    expect(await store.filterIds('', 0, SCALE_COUNT)).toHaveLength(SCALE_COUNT);
    store.close();

    const inspected = await HarStore.inspect(name);
    expect(inspected?.complete).toBe(true);
    expect(inspected?.count).toBe(SCALE_COUNT);
  }, 300_000);
});

describe('HarStore last used', () => {
  it('sets the last-used time on import and updates it when the database is opened', async () => {
    const name = freshName();
    (await load(name, ENTRIES)).close();
    const created = (await HarStore.list()).find(d => d.name === name);
    expect(created?.lastUsedMs).toEqual(expect.any(Number));
    await new Promise(resolve => setTimeout(resolve, 5));
    const reopened = await HarStore.open(name);
    await reopened.markUsed();
    expect(reopened.lastUsedMs).toBeGreaterThan(created!.lastUsedMs!);
    reopened.close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed?.lastUsedMs).toBe(reopened.lastUsedMs);
    expect(listed?.comment).toBe('');
  });
});

describe('HarStore name and comment on import', () => {
  it('stores the name and comment chosen in the import dialog', async () => {
    const name = freshName();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    await store.setDetails('My checkout', 'checkout flow');
    await store.writeBatch(ENTRIES as unknown as HarEntryRaw[]);
    await store.finish(root([]), 123);
    store.close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ fileName: 'My checkout', comment: 'checkout flow', complete: true });
  });
  it('keeps the HAR log comment when the dialog comment is left empty', async () => {
    const name = freshName();
    const store = await HarStore.create(name, 'file.har', 1234, 1000);
    await store.setDetails('file.har', '');
    await store.finish({ log: { comment: 'from file', entries: [] } }, null);
    store.close();
    const listed = (await HarStore.list()).find(d => d.name === name);
    expect(listed).toMatchObject({ fileName: 'file.har', comment: 'from file' });
  });
});
