# Start module (`src/start/`)

The landing screen: the upload panel and the list of stored databases.

## Files

| File | Responsibility |
| --- | --- |
| `FileDropZone.ts` | "HAR Upload" panel: drag and drop, or the "Select File…" picker. Validates the file and passes it to `index.ts`. |
| `DatabaseList.ts` | Stored-database rows: status badge, progress, last used, comment, open, delete, drag-to-reorder. |
| `dbOrder.ts` | Persists the start-page order in localStorage and computes moves. |
| `start.css` | Landing screen, upload panel, database list styles. |

`DatabaseList.ts` imports `start.css`, since `FileDropZone` has no stylesheet of its own.

## Tests

`tests/start/dbOrder.test.ts`.
