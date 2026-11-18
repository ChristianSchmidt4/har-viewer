// Per-file IndexedDB storage for the entries of one loaded HAR file.
// Rows are keyed by their index in log.entries and kept as the raw HAR
// objects. Only indices (plus the request table's view state) stay in
// memory: rows are read back from the database when they are rendered, and
// filters are evaluated by scanning the rows and returning matching indices.
import { HarParser } from './harParser.js';
import { compileFilterQuery } from './filterParser.js';
import { isInvalidItem } from './jsonArraySplitter.js';
import type { HarEntryRaw, InvalidItem, ParsedEntry } from '@/types/har';
import type { CustomColumn } from './customColumns.js';

const DB_VERSION = 2;
const DB_PREFIX = 'har:';
const ROWS = 'rows';
const META = 'meta';
// Saved filters (the filter tree), one record per node with its row indices.
const FILTERS = 'filters';
const META_KEY = 'meta';
const CUSTOM_COLUMNS_KEY = 'customColumns';
const HIGHLIGHT_RULES_KEY = 'highlightRules';
// Key of the last filter result in the META store (kept apart from meta so
// filter changes do not rewrite the whole metadata record).
const FILTER_CACHE_KEY = 'filterCache';
// Key of the id of the filter node being viewed in the META store.
const CURRENT_FILTER_KEY = 'currentFilter';
// Id of the implicit root of the filter tree: all rows of the database.
export const ROOT_FILTER_ID = 0;
// Number of rows read per transaction while filtering a saved filter's rows.
const FILTER_CHUNK_SIZE = 5000;
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

// Filter query of the request table, plus the indices matching it once a full
// pass over a complete database has been made (so reopening does not rescan).
// ids is absent until that pass happened.
export interface FilterCache {
  query: string;
  count?: number;
  ids?: number[];
}

function isValidFilterCache(value: unknown): value is FilterCache {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<FilterCache> & Record<string, unknown>;
  if (typeof record.query !== 'string' || record.query.trim() === '') return false;
  if (record.count !== undefined && typeof record.count !== 'number') return false;
  return record.ids === undefined || Array.isArray(record.ids);
}

// Rows passing a filter. ids is null when no filter applies: every row
// 0..count-1 then matches and the indices are not loaded.
export interface FilterResult {
  count: number;
  ids: number[] | null;
}

function getFilterCacheValue(store: IDBObjectStore): Promise<FilterCache | null> {
  return request<unknown>(store.get(FILTER_CACHE_KEY)).then(value => (isValidFilterCache(value) ? value : null));
}

// A saved filter: a child of the node with id parentId (ROOT_FILTER_ID for
// the first level) holding the indices of the rows that passed its query
// within the parent's rows. Stored in the FILTERS store under an auto key.
export interface FilterNode {
  id: number;
  parentId: number;
  query: string;
  ids: number[];
}

// A node of the filter tree as shown to the user.
export interface FilterSummary {
  id: number;
  query: string;
  count: number;
}

function summarize(node: FilterNode): FilterSummary {
  return { id: node.id, query: node.query, count: node.ids.length };
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

// Reads every saved filter node of a database.
function readFilterNodes(db: IDBDatabase): Promise<FilterNode[]> {
  const nodes: FilterNode[] = [];
  const tx = db.transaction(FILTERS, 'readonly');
  const done = transactionDone(tx);
  const cursorReq = tx.objectStore(FILTERS).openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const id = cursor.primaryKey as number;
    const value = cursor.value as Omit<FilterNode, 'id'>;
    nodes.push({ ...value, id });
    cursor.continue();
  };
  return done.then(() => nodes);
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(FILTERS)) db.createObjectStore(FILTERS, { autoIncrement: true });
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
  // Saved filters by id. Ids are assigned by the FILTERS store and never reused.
  private filterNodes: Map<number, FilterNode>;
  // Id of the filter node whose rows are shown (ROOT_FILTER_ID: all rows).
  private currentFilterId: number;
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
    this.view = emptyDbView();
    this.root = meta.root;
    this.filterCache = null;
    this.filterNodes = new Map();
    this.currentFilterId = ROOT_FILTER_ID;
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
    store.view = await HarStore.readView(metaStore, meta);
    store.filterCache = await getFilterCacheValue(db.transaction(META, 'readonly').objectStore(META));
    const nodes = await readFilterNodes(db);
    store.filterNodes = new Map(nodes.map(node => [node.id, node]));
    const savedFilter = await request<unknown>(db.transaction(META, 'readonly').objectStore(META).get(CURRENT_FILTER_KEY));
    store.currentFilterId = store.filterNodes.has(savedFilter as number) ? (savedFilter as number) : ROOT_FILTER_ID;
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
      root: {}
    });
    const tx = db.transaction(META, 'readwrite');
    const metaStore = tx.objectStore(META);
    metaStore.put(store.toMeta(false), META_KEY);
    metaStore.put(store.view.customColumns, CUSTOM_COLUMNS_KEY);
    metaStore.put(store.view.highlightRules, HIGHLIGHT_RULES_KEY);
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

  // Stores the view state (filter, custom columns, highlight rules) as separate
  // records so the main metadata row remains compact and legacy nested view data
  // can be ignored. The filter is kept with the cached full-filter result, so it
  // lives under the same FILTER_CACHE_KEY row instead of needing its own key.
  async setView(view: DbView): Promise<void> {
    this.view = view;
    const tx = this.db.transaction(META, 'readwrite');
    const metaStore = tx.objectStore(META);
    if (!view.filter.trim()) {
      this.filterCache = null;
      metaStore.delete(FILTER_CACHE_KEY);
    } else {
      // Keeps the ids of a matching cache; otherwise only the query is stored,
      // so the next filter pass scans instead of reusing a placeholder.
      const kept = this.filterCache?.query === view.filter ? this.filterCache : null;
      this.filterCache = kept ?? { query: view.filter, count: this.count };
      metaStore.put(this.filterCache, FILTER_CACHE_KEY);
    }
    metaStore.put(view.customColumns, CUSTOM_COLUMNS_KEY);
    metaStore.put(view.highlightRules, HIGHLIGHT_RULES_KEY);
    await transactionDone(tx);
  }

  private static async readView(metaStore: IDBObjectStore, meta: HarMeta): Promise<DbView> {
    const legacyView = 'view' in meta ? (meta as HarMeta & { view?: DbView }).view : undefined;
    const [filterCache, customColumns, highlightRules] = await Promise.all([
      getFilterCacheValue(metaStore),
      request<CustomColumn[] | undefined>(metaStore.get(CUSTOM_COLUMNS_KEY)),
      request<string[] | undefined>(metaStore.get(HIGHLIGHT_RULES_KEY)),
    ]);
    return {
      filter: filterCache?.query ?? legacyView?.filter ?? '',
      customColumns: customColumns ?? legacyView?.customColumns ?? [],
      highlightRules: highlightRules ?? legacyView?.highlightRules ?? []
    };
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

  // Number of rows passing the filter and, for a non-empty query, their indices.
  // An empty query needs no key list: the count comes from meta.
  // A full pass over a complete database is cached for reuse when it is opened.
  async filterResult(query: string): Promise<FilterResult> {
    const node = this.currentNode();
    if (node) return this.filterNodeRows(node, query);

    const count = this.count;
    if (!query.trim()) {
      this.filterCache = null;
      return { count, ids: null };
    }
    if (count === 0) return { count: 0, ids: [] };

    const cacheable = this.complete;
    const cache = this.filterCache;
    if (cacheable && cache && cache.query === query && cache.count === count && Array.isArray(cache.ids)) {
      return { count: cache.ids.length, ids: cache.ids };
    }

    const matches = compileFilterQuery(query);
    const ids: number[] = [];
    const tx = this.db.transaction(ROWS, 'readonly');
    const cursorReq = tx.objectStore(ROWS).openCursor(IDBKeyRange.bound(0, count - 1));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const id = cursor.key as number;
      if (matches(this.toParsed(cursor.value as StoredRow, id))) ids.push(id);
      cursor.continue();
    };
    await transactionDone(tx);
    if (cacheable) {
      this.filterCache = { query, count: this.count, ids };
      // A failed write only costs a rescan on the next open.
      this.saveFilterCache().catch(error => console.error('Could not cache the filter result', error));
    }
    return { count: ids.length, ids };
  }

  // The saved filter whose rows are shown, or undefined for all rows.
  private currentNode(): FilterNode | undefined {
    return this.filterNodes.get(this.currentFilterId);
  }

  // Rows of a saved filter that pass the query. An empty query gives the rows
  // of the node itself. Not cached: a saved filter's rows are already a subset.
  private async filterNodeRows(node: FilterNode, query: string): Promise<FilterResult> {
    if (!query.trim()) return { count: node.ids.length, ids: node.ids };
    const matches = compileFilterQuery(query);
    const ids: number[] = [];
    for (let i = 0; i < node.ids.length; i += FILTER_CHUNK_SIZE) {
      const chunk = node.ids.slice(i, i + FILTER_CHUNK_SIZE);
      const values = await this.readValues(chunk);
      values.forEach((value, j) => {
        const id = chunk[j]!;
        if (value !== undefined && matches(this.toParsed(value as StoredRow, id))) ids.push(id);
      });
    }
    return { count: ids.length, ids };
  }

  // Number of rows in the current scope: all rows at the root, otherwise the
  // rows of the saved filter being viewed.
  get scopeCount(): number {
    return this.currentNode()?.ids.length ?? this.count;
  }

  // The filter tree path from all rows down to the current filter (inclusive).
  filterPath(): FilterSummary[] {
    const path: FilterSummary[] = [];
    for (let node = this.currentNode(); node; node = this.filterNodes.get(node.parentId)) {
      path.unshift(summarize(node));
    }
    return [{ id: ROOT_FILTER_ID, query: '', count: this.count }, ...path];
  }

  // The saved filters directly below the current filter.
  filterChildren(): FilterSummary[] {
    return this.childNodes(this.currentFilterId).map(summarize);
  }

  private childNodes(parentId: number): FilterNode[] {
    return [...this.filterNodes.values()]
      .filter(node => node.parentId === parentId)
      .sort((a, b) => a.ids.length - b.ids.length || a.id - b.id);
  }

  // Number of saved filters below the current one (all levels).
  currentDescendantCount(): number {
    return this.descendantIds(this.currentFilterId).length;
  }

  // Ids of all saved filters below a node, children before their own children.
  private descendantIds(id: number): number[] {
    const found: number[] = [];
    const queue = [id];
    for (const parent of queue) {
      for (const child of this.childNodes(parent)) {
        found.push(child.id);
        queue.push(child.id);
      }
    }
    return found;
  }

  // Deletes the current saved filter together with all its subfilters (their
  // rows are subsets of it), then makes its parent the current level.
  async deleteCurrentFilter(): Promise<void> {
    const node = this.currentNode();
    if (!node) throw new Error('The root cannot be deleted.');
    const removed = [node.id, ...this.descendantIds(node.id)];
    const tx = this.db.transaction([FILTERS, META], 'readwrite');
    for (const id of removed) tx.objectStore(FILTERS).delete(id);
    tx.objectStore(META).put(node.parentId, CURRENT_FILTER_KEY);
    await transactionDone(tx);
    for (const id of removed) this.filterNodes.delete(id);
    this.currentFilterId = node.parentId;
  }

  // Makes a saved filter (or the root, ROOT_FILTER_ID) the current level.
  async navigateFilter(id: number): Promise<void> {
    if (id !== ROOT_FILTER_ID && !this.filterNodes.has(id)) throw new Error('This filter no longer exists');
    const tx = this.db.transaction(META, 'readwrite');
    tx.objectStore(META).put(id, CURRENT_FILTER_KEY);
    await transactionDone(tx);
    this.currentFilterId = id;
  }

  // Saves a filter as a child of the current level, holding the rows that pass
  // the query within the current scope, and makes it the current level. Empty
  // results and expressions already used by the parent or a sibling are rejected.
  async persistFilter(query: string): Promise<FilterSummary> {
    const expression = query.trim();
    if (!expression) throw new Error('Enter a filter before saving it.');
    const parentId = this.currentFilterId;
    const parent = this.currentNode();
    if (parent?.query === expression || this.childNodes(parentId).some(node => node.query === expression)) {
      throw new Error('A filter with this expression already exists at this level.');
    }
    const { ids } = await this.filterResult(expression);
    if (!ids || ids.length === 0) throw new Error('No requests match this filter, so it was not saved.');

    const record: Omit<FilterNode, 'id'> = { parentId, query: expression, ids };

    const tx = this.db.transaction([FILTERS, META], 'readwrite');
    const key = await request<IDBValidKey>(tx.objectStore(FILTERS).add(record));
    const node: FilterNode = { ...record, id: key as number };
    tx.objectStore(META).put(node.id, CURRENT_FILTER_KEY);
    await transactionDone(tx);
    this.filterNodes.set(node.id, node);
    this.currentFilterId = node.id;
    return summarize(node);
  }

  // Writes the in-memory filter cache under its own key of the META store.
  // Empty/no-op filters are not cached: they should fall back to the full id set.
  private async saveFilterCache(): Promise<void> {
    const tx = this.db.transaction(META, 'readwrite');
    const metaStore = tx.objectStore(META);
    if (!this.filterCache || this.filterCache.query.trim() === '' || !Array.isArray(this.filterCache.ids)) {
      metaStore.delete(FILTER_CACHE_KEY);
      await transactionDone(tx);
      return;
    }
    this.filterCache = { ...this.filterCache, count: this.count };
    metaStore.put(this.filterCache, FILTER_CACHE_KEY);
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
      root: this.root
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

  private toParsed(row: StoredRow, id: number): ParsedEntry {
    const [entry] = this.parser.parseEntries([row], id);
    if (this.firstStartMs !== null) this.parser.assignRelativeTimings([entry!], this.firstStartMs);
    return entry!;
  }
}
