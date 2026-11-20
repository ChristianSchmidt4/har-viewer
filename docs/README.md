# HAR Viewer - Developer Documentation

HAR Viewer is a client-side viewer for HTTP Archive (`.har`) files. Files are
read and stored in the browser's IndexedDB; nothing is uploaded.

The code is grouped into **feature modules**, one directory per feature under
`src/`. Each module has its own `README.md` (files, responsibilities, CSS) and
its tests live in the matching `tests/<module>/` directory.

| Module | Directory | Responsibility | Docs |
| --- | --- | --- | --- |
| HAR data | `src/har/` | Parsing, IndexedDB store, streamed file loading | [src/har/README.md](../src/har/README.md) |
| Filter | `src/filter/` | Filter query language and the saved-filter tree | [src/filter/README.md](../src/filter/README.md) |
| Table | `src/table/` | Request table, highlight rules, custom columns | [src/table/README.md](../src/table/README.md) |
| Detail | `src/detail/` | Request/response detail panel, multi-select stats | [src/detail/README.md](../src/detail/README.md) |
| Start | `src/start/` | Landing screen: upload panel, stored-database list | [src/start/README.md](../src/start/README.md) |
| Pivot | `src/pivot/` | Fullscreen pivot table over a saved or custom filter (opened from the header) | [src/pivot/README.md](../src/pivot/README.md) |
| Common | `src/common/` | Shared dialogs, resizer, DOM helpers, HAR types, base CSS | [src/common/README.md](../src/common/README.md) |

`src/index.ts` is the orchestration layer. It wires the modules together and
owns the app state (current database, selection, import jobs).

## Shared concepts

- **Types**: HAR shapes live in `src/common/types/har.ts`. Parsed entries are
  `ParsedEntry`.
- **Path alias**: `@/` maps to `src/` (Vite, Jest, and tsconfig). Relative
  imports keep an explicit `.js` extension in source files.
- **Styles**: each module imports its own stylesheet. `src/common/base.css`
  (variables, layout, dialogs) is imported first by `src/index.ts`, so the
  cascade order is base → start → filter → table → detail → pivot.
- **Persistence**: all view state (filter cache, custom columns, highlight
  rules, current filter node) lives in the per-database `META` store
  (see `src/har/README.md`).

## Other documentation

- [HAR format reference](HAR_FORMAT.md)
- [Project guide for agents](../CLAUDE.md)
- [Main README](../README.md)
