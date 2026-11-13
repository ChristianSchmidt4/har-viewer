// Per-file IndexedDB storage for the entries of one loaded HAR file.
// Rows are keyed by their index in log.entries and kept as the raw HAR
// objects. Only indices (plus the request table's view state) stay in
// memory: rows are read back from the database when they are rendered, and
// filters are evaluated by scanning the rows and returning matching indices.
import { HarParser } from './harParser.js';
import { compileFilterQuery } from './filterParser.js';
import { isInvalidItem } from './jsonArraySplitter.js';
import type { HarEntryRaw, InvalidItem, ParsedEntry } from '../types/har.js';
import type { CustomColumn } from './customColumns.js';

const DB_VERSION = 1;
const DB_PREFIX = 'har:';
const ROWS = 'rows';
const META = 'meta';
const META_KEY = 'meta';
// Key of the last filter result in the META store (kept apart from meta so
// filter changes do not rewrite the whole metadata record).
const FILTER_CACHE_KEY = 'filterCache';
// Number of rows read per transaction while exporting.
const EXPORT_CHUNK_SIZE = 500;

export type StoredRow = HarEntryRaw | InvalidItem;

// Request-table view state kept with the database and restored on open.
export interface DbView {
  // Filter query of the request table.
  filter: string;
  customColumns: CustomColumn[];
  // Highlight rules as their text (re-parsed when the database is opened).
  highlightRules: string[];
}

export function emptyDbView(): DbView {
  return { filter: '', customColumns: [], highlightRules: [] };
}

// Indices matching the filter query of a complete database, kept so reopening
// the database does not have to scan every row again.
export interface FilterCache {
  query: string;
  count: number;
  ids: number[];
}

interface HarMeta {
  fileName: string;
  fileSize: number;
  // File modification time (ms since epoch) the database was created from.
  fileModified: number;
  // Time (ms since epoch) the database was imported or last opened. Null for
  // databases stored before this was tracked.
  lastUsedMs: number | null;
  // Free-text comment entered by the user.
  comment: string;
  uncompressedSize: number | null;
  count: number;
  firstStartMs: number | null;
  complete: boolean;
  // The HAR document with log.entries removed.
  root: Record<string, unknown>;
  // Absent in databases stored before view state was kept here.
  view?: DbView;
}

export interface DatabaseSummary {
  name: string;
  fileName: string;
  fileSize: number;
  fileModified: number;
  lastUsedMs: number | null;
  comment: string;
  uncompressedSize: number | null;
  count: number;
  complete: boolean;
}

// One database per file: the name is the file name plus its modification
// time, so loading the same file again maps to the same stored copy.
export function dbNameFor(fileName: string, lastModified: number): string {
  return `${DB_PREFIX}${fileName}:${lastModified}`;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ROWS);
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Lets another tab delete this database without being blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export class HarStore {
  readonly name: string;
  fileName: string;
  readonly fileSize: number;
  readonly fileModified: number;
  lastUsedMs: number | null;
  comment: string;
  uncompressedSize: number | null;
  // Rows with index < count are written and readable.
  count: number;
  firstStartMs: number | null;
  complete: boolean;
  view: DbView;

  private root: Record<string, unknown>;
  private filterCache: FilterCache | null;
  private readonly db: IDBDatabase;
  private readonly parser: HarParser;

  private constructor(name: string, db: IDBDatabase, meta: HarMeta) {
    this.name = name;
    this.db = db;
    this.parser = new HarParser();
    this.fileName = meta.fileName;
    this.fileSize = meta.fileSize;
    this.fileModified = meta.fileModified;
    this.lastUsedMs = meta.lastUsedMs ?? null;
    this.comment = meta.comment;
    this.uncompressedSize = meta.uncompressedSize;
    this.count = meta.count;
    this.firstStartMs = meta.firstStartMs;
    this.complete = meta.complete;
    this.view = meta.view ?? emptyDbView();
    this.root = meta.root;
    this.filterCache = null;
  }

  // Returns the stored metadata when a complete copy exists, otherwise null.
  static async inspect(name: string): Promise<HarMeta | null> {
    const meta = await HarStore.readMeta(name);
    return meta?.complete ? meta : null;
  }

  // Lists every HAR database (complete or incomplete), sorted by file name.
  static async list(): Promise<DatabaseSummary[]> {
    const infos = await indexedDB.databases();
    const names = infos
      .map(info => info.name)
      .filter((name): name is string => !!name && name.startsWith(DB_PREFIX));
    const summaries: DatabaseSummary[] = [];
    for (const name of names) {
      const meta = await HarStore.readMeta(name);
      if (!meta) continue;
      summaries.push({
        name,
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileModified: meta.fileModified,
        lastUsedMs: meta.lastUsedMs ?? null,
        comment: meta.comment,
        uncompressedSize: meta.uncompressedSize,
        count: meta.count,
        complete: meta.complete
      });
    }
    return summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  // Opens a stored database (complete or still importing) for reading.
  static async open(name: string): Promise<HarStore> {
    const db = await openDatabase(name);
    const metaStore = db.transaction(META, 'readonly').objectStore(META);
    const meta = await request<HarMeta | undefined>(metaStore.get(META_KEY));
    if (!meta) {
      db.close();
      throw new Error('The stored database could not be read');
    }
    const store = new HarStore(name, db, meta);
    store.filterCache = (await request<FilterCache | undefined>(
      db.transaction(META, 'readonly').objectStore(META).get(FILTER_CACHE_KEY)
    )) ?? null;
    return store;
  }

  // Starts a fresh (empty) store, replacing anything stored under this name.
  static async create(name: string, fileName: string, fileSize: number, fileModified: number): Promise<HarStore> {
    await HarStore.deleteDatabase(name);
    const db = await openDatabase(name);
    const store = new HarStore(name, db, {
      fileName,
      fileSize,
      fileModified,
      // Importing a file counts as using the database.
      lastUsedMs: Date.now(),
      comment: '',
      uncompressedSize: null,
      count: 0,
      firstStartMs: null,
      complete: false,
      root: {},
      view: emptyDbView()
    });
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(store.toMeta(false), META_KEY);
    await transactionDone(tx);
    return store;
  }

  static deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Replaces the comment of a stored database that is not being imported.
  // Databases being imported must use the instance method, so the comment is not
  // overwritten by the import's metadata writes.
  static async updateComment(name: string, comment: string): Promise<void> {
    const db = await openDatabase(name);
    try {
      const tx = db.transaction(META, 'readwrite');
      const metaStore = tx.objectStore(META);
      const meta = await request<HarMeta | undefined>(metaStore.get(META_KEY));
      if (!meta) throw new Error('The stored database could not be read');
      metaStore.put({ ...meta, comment }, META_KEY);
      await transactionDone(tx);
    } finally {
      db.close();
    }
  }

  // Sets the name and comment of this store in one write (used while it is being imported too).
  async setDetails(fileName: string, comment: string): Promise<void> {
    this.fileName = fileName;
    this.comment = comment;
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(this.toMeta(this.complete), META_KEY);
    await transactionDone(tx);
  }

  // Sets the comment of this store (used while it is being imported too).
  async setComment(comment: string): Promise<void> {
    this.comment = comment;
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(this.toMeta(this.complete), META_KEY);
    await transactionDone(tx);
  }

  // Records that the database was used now (opened for viewing).
  async markUsed(): Promise<void> {
    const now = Date.now();
    this.lastUsedMs = now;
    const tx = this.db.transaction(META, 'readwrite');
    const metaStore = tx.objectStore(META);
    const meta = await request<HarMeta | undefined>(metaStore.get(META_KEY));
    if (!meta) throw new Error('The stored database could not be read');
    metaStore.put({ ...meta, lastUsedMs: now }, META_KEY);
    await transactionDone(tx);
  }

  // Stores the view state (filter, custom columns, highlight rules) in the
  // metadata. Only the view field is replaced, so a comment changed through
  // another connection is kept.
  async setView(view: DbView): Promise<void> {
    this.view = view;
    const tx = this.db.transaction(META, 'readwrite');
    const metaStore = tx.objectStore(META);
    const meta = await request<HarMeta | undefined>(metaStore.get(META_KEY));
    if (!meta) throw new Error('The stored database could not be read');
    metaStore.put({ ...meta, view }, META_KEY);
    await transactionDone(tx);
  }

  private static async readMeta(name: string): Promise<HarMeta | null> {
    const db = await openDatabase(name);
    try {
      const meta = await request<HarMeta | undefined>(
        db.transaction(META, 'readonly').objectStore(META).get(META_KEY)
      );
      return meta ?? null;
    } finally {
      db.close();
    }
  }

  // Appends rows after the ones already written. The row count is stored in
  // the same transaction, so an interrupted import still reports what it has.
  async writeBatch(items: StoredRow[]): Promise<void> {
    if (items.length === 0) return;

    for (const item of items) {
      const startedMs = isInvalidItem(item) ? NaN : this.parser.toTimestamp(item.startedDateTime);
      if (Number.isFinite(startedMs) && (this.firstStartMs === null || startedMs < this.firstStartMs)) {
        this.firstStartMs = startedMs;
      }
    }

    const start = this.count;
    const newCount = start + items.length;
    const tx = this.db.transaction([ROWS, META], 'readwrite');
    const rows = tx.objectStore(ROWS);
    items.forEach((item, i) => rows.put(item, start + i));
    tx.objectStore(META).put({ ...this.toMeta(false), count: newCount }, META_KEY);
    await transactionDone(tx);
    this.count = newCount;
  }

  // Marks the load as complete and stores the document without its entries.
  async finish(root: Record<string, unknown>, uncompressedSize: number | null): Promise<void> {
    const log = { ...(root.log as Record<string, unknown>) };
    delete log.entries;
    this.root = { ...root, log };
    // The HAR's own log.comment becomes the comment, unless the user already set one.
    if (!this.comment && typeof log.comment === 'string') this.comment = log.comment;
    this.uncompressedSize = uncompressedSize;
    this.complete = true;
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(this.toMeta(true), META_KEY);
    await transactionDone(tx);
  }

  // Parsed entries for the given indices, in the same order (missing rows are skipped).
  async getEntries(ids: number[]): Promise<ParsedEntry[]> {
    const values = await this.readValues(ids);
    const entries: ParsedEntry[] = [];
    values.forEach((value, i) => {
      if (value !== undefined) entries.push(this.toParsed(value as StoredRow, ids[i]!));
    });
    return entries;
  }

  // Indices in [from, to) whose entry matches the filter query, ascending.
  // A full pass over a complete database is cached in its metadata, so the
  // same query is answered from the cache when the database is reopened.
  async filterIds(query: string, from: number, to: number): Promise<number[]> {
    if (to <= from) return [];
    if (!query.trim()) return this.allKeys(from, to);

    const cacheable = this.complete && from === 0 && to === this.count;
    const cache = this.filterCache;
    if (cacheable && cache && cache.query === query && cache.count === to) return cache.ids;

    const matches = compileFilterQuery(query);
    const ids: number[] = [];
    const tx = this.db.transaction(ROWS, 'readonly');
    const cursorReq = tx.objectStore(ROWS).openCursor(IDBKeyRange.bound(from, to - 1));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const id = cursor.key as number;
      if (matches(this.toParsed(cursor.value as StoredRow, id))) ids.push(id);
      cursor.continue();
    };
    await transactionDone(tx);
    if (cacheable) {
      this.filterCache = { query, count: to, ids };
      // A failed write only costs a rescan on the next open.
      this.saveFilterCache().catch(error => console.error('Could not cache the filter result', error));
    }
    return ids;
  }

  // Writes the in-memory filter cache under its own key of the META store.
  private async saveFilterCache(): Promise<void> {
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(this.filterCache, FILTER_CACHE_KEY);
    await transactionDone(tx);
  }

  // Builds a standalone HAR file holding the given entries (invalid entries
  // are skipped). Chunks are read from the database, so the whole export is
  // never held as one string.
  async exportBlob(ids: number[]): Promise<Blob> {
    const marker = `__har_viewer_entries_${Math.random().toString(36).slice(2)}__`;
    const log: Record<string, unknown> = { ...(this.root.log as Record<string, unknown>), entries: marker };
    // The comment is the user's (possibly edited) version of log.comment.
    if (this.comment) log.comment = this.comment;
    else delete log.comment;
    const [head = '', tail = ''] = JSON.stringify({ ...this.root, log }).split(`"${marker}"`);

    const parts: BlobPart[] = [head, '['];
    let wroteAny = false;
    for (let i = 0; i < ids.length; i += EXPORT_CHUNK_SIZE) {
      const values = await this.readValues(ids.slice(i, i + EXPORT_CHUNK_SIZE));
      const pieces = values.flatMap(value =>
        value === undefined || isInvalidItem(value) ? [] : [JSON.stringify(value)]
      );
      if (pieces.length) {
        parts.push(wroteAny ? ',' + pieces.join(',') : pieces.join(','));
        wroteAny = true;
      }
    }
    parts.push(']', tail);
    return new Blob(parts, { type: 'application/json' });
  }

  close(): void {
    this.db.close();
  }

  private toMeta(complete: boolean): HarMeta {
    return {
      fileName: this.fileName,
      fileSize: this.fileSize,
      fileModified: this.fileModified,
      lastUsedMs: this.lastUsedMs,
      comment: this.comment,
      uncompressedSize: this.uncompressedSize,
      count: this.count,
      firstStartMs: this.firstStartMs,
      complete,
      root: this.root,
      view: this.view
    };
  }

  private async readValues(ids: number[]): Promise<unknown[]> {
    const tx = this.db.transaction(ROWS, 'readonly');
    const rows = tx.objectStore(ROWS);
    const values: unknown[] = new Array(ids.length);
    ids.forEach((id, i) => {
      rows.get(id).onsuccess = (event) => {
        values[i] = (event.target as IDBRequest).result;
      };
    });
    await transactionDone(tx);
    return values;
  }

  private async allKeys(from: number, to: number): Promise<number[]> {
    const tx = this.db.transaction(ROWS, 'readonly');
    const keys = await request(tx.objectStore(ROWS).getAllKeys(IDBKeyRange.bound(from, to - 1)));
    return keys as number[];
  }

  private toParsed(row: StoredRow, id: number): ParsedEntry {
    const [entry] = this.parser.parseEntries([row], id);
    if (this.firstStartMs !== null) this.parser.assignRelativeTimings([entry!], this.firstStartMs);
    return entry!;
  }
}
