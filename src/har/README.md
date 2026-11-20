# HAR data module (`src/har/`)

Reads HAR files, parses entries and stores them in IndexedDB.

## Files

| File | Responsibility |
| --- | --- |
| `harParser.ts` | Turns raw HAR entries into `ParsedEntry` objects (host, path, protocol, content type, relative start time, normalized timings). Provides the `format*` helpers. |
| `harStore.ts` | Per-file IndexedDB store. Import batches, the saved-filter tree, filter results, view state (`META`), export. |
| `fileLoader.ts` | Reads a local file in chunks (optional gzip via `DecompressionStream`) with progress reporting. |
| `jsonArraySplitter.ts` | Parses the `log.entries` array item by item, so the whole file is never one JS string. |

No CSS.

## Key behaviour

- A database is named `har:<name>:<lastModified>` (`dbNameFor`). Entries are
  keyed by array index, and databases are immutable once complete.
- `HarStore.filterResult(query)` returns `{ count, ids }`. An empty query returns
  `ids: null`, so no keys are read. A full scan is cached as `filterCache`.
- Filter tree: each saved filter stores the matching row indices of its parent
  scope. Filters can be navigated and deleted, but not edited.
- `harStore.ts` imports types from `table/customColumns` and `filter/filterParser`.
  These are the only cross-module dependencies from this module.

## Tests

`tests/har/` (store tests use `fake-indexeddb`, gzip tests run in the Node
environment).
