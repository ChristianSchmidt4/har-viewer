# Table module (`src/table/`)

The filterable request list (left pane), highlight rules, and custom columns.

## Files

| File | Responsibility |
| --- | --- |
| `RequestTable.ts` | Windowed request table. Owns the filter input, multi-select (click, Ctrl/Cmd, Shift), column widths, and highlight classes. |
| `HighlightBar.ts` | Highlight rule input and chips below the table, plus the custom-column header rendering. |
| `highlightRules.ts` | Parses `<filter> => [toggle|add|remove] <class>...` rules and computes row classes. Lists `NAMED_COLORS`, `HIGHLIGHT_EMOJIS` and text-style classes. |
| `customColumns.ts` | Custom column model and `evaluateCustomColumn` (`reqheader:`, `resheader:`, `reqcookie:`, `rescookie:`). |
| `virtualWindow.ts` | `computeWindowRange`, the row slice math for windowed rendering. |
| `table.css` | Table, highlight and column styles. |

## Key behaviour

- Only the rows inside the viewport (plus overscan) are in the DOM. Row height
  must stay fixed (`nowrap`), because the estimate depends on it.
- Rows come from `HarStore`. The table keeps only matching indices, and reads
  rows for the visible window.
- Every color in `NAMED_COLORS` needs a `#requests-table tbody tr.hl-<name>`
  rule in `table.css`. `tests/table/highlightRules.test.ts` enforces this.

## Adding a column

See `CLAUDE.md` ("Adding a Column to the Request Table"). The `<th>` is built
in `RequestTable.renderHeader`, and the `<td>` in `buildRow`.

## Tests

`tests/table/` (`highlightRules`, `virtualWindow`).
