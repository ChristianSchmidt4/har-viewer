/**
 * @jest-environment node
 */
// Runs in the Node environment with fake-indexeddb providing IndexedDB.
import 'fake-indexeddb/auto';
import { HarStore, dbNameFor } from '../src/utils/harStore.js';
import type { HarEntryRaw } from '../src/types/har.js';

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
