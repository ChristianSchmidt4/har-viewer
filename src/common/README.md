# Common module (`src/common/`)

Code shared by several feature modules.

## Files

| File | Responsibility |
| --- | --- |
| `ChoiceDialog.ts` | Modal dialogs: `askChoice`, `askText`, `askFields`. Each resolves to the chosen value, or `null` on cancel. |
| `resizer.ts` | `makeResizer`, drag-to-resize splitters for the list/detail and request/response panes. |
| `domUtils.ts` | `escapeHtml`, `truncateUrl`, `truncateText`. |
| `types/har.ts` | Raw HAR 1.2 types (`HarData`, `HarEntryRaw`, ...) and parsed types (`ParsedEntry`, `ParsedTimings`, ...). |
| `base.css` | Root CSS variables, reset, app layout and header, dialogs, toast, and media queries. Imported first by `src/index.ts`. |

## Rule

Only move code here when two or more modules use it. Feature-specific code
stays in its feature module.

## Tests

No dedicated tests. Dialog and resizer behaviour is covered by the e2e suite
(`tests/e2e/`).
