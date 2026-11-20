# Pivot module (`src/pivot/`)

A fullscreen pivot table over a base set of requests. Opened from the header
**Pivot** button. It groups requests by user-chosen fields (rows and columns) and
aggregates a value per cell. Built-in status-range fields and a heatmap make
correlations easy to spot.

## Files

| File | Responsibility |
| --- | --- |
| `pivotModel.ts` | Pure logic, no DOM: field keys, status ranges, number coercion, aggregations, `buildPivot`, heatmap colors, and the filter query for a cell. |
| `PivotOverlay.ts` | The overlay UI: base-set picker, field zones, table, cell details, copy actions. |
| `pivot.css` | Overlay styles (fullscreen, sticky headers, zones). |

## Base set

Every pivot works on a base set, which is required (the full database is never
pivoted directly):

- **Saved filter**: a node of the filter tree, chosen from a dropdown that shows
  the tree (depth-first, indented). Its rows come from `HarStore.idsInScope`.
- **Custom filter**: a query typed into the overlay, evaluated over all rows.

If the saved filter is deleted while the overlay is open, the base set is
cleared and the user must choose another one. Rows, columns, and values are kept.

The overlay refreshes whenever the filter tree or the custom columns change
(`PivotOverlay.refresh()`, called from `src/index.ts`).

## Fields and zones

Four zones, similar to Excel: **Filters**, **Rows**, **Columns**, **Values**, plus the **Attributes** pool that feeds Rows and Columns.

- **Built-in fields**: `BUILTIN_FIELDS` in `pivotModel.ts`, including
  `Status range` (2xx, 3xx, 4xx, 5xx, plus an empty bucket) and exact `Status`
  (with status codes as subgroups of their range), `Method`, `Host`, `Path`,
  `Base path` (URL path without query and fragment, so `/api` groups `/api?x=1`
  with `/api`), `Base path start` (first path segment, e.g. `api`), the 2nd,
  3rd and 4th segments (`Base path 2nd/3rd/4th segment`; empty when missing),
  `Base path last segment` (the last non-empty segment),
  `Protocol`, `Content type`, and `Side`.
- **Request/response records**: each HAR entry is split into two records before
  pivoting (`splitEntry` in `pivotModel.ts`). The `request` record has the
  timings `blocked`, `dns`, `connect`, `ssl`, `send` as its `time`, and
  `Content-Length` request header. The `response` record has `wait` and `receive`, and
  its `Content-Length` response header. A missing header counts as 0. Both records keep the entry's method, host, path, status,
  status range, protocol and content type. `Side` (`request`/`response`) is a
  synthetic attribute. Counts are per record, so each entry contributes two.
  Cells on the `Side` field have no click-to-filter query.
- **Custom columns**: the request table's custom columns are available as fields
  (`custom:<id>`).
- Rows and columns can be nested. Each prefix of the field list gets its own
  subtotal, so `Status range > Status` shows range totals above their codes.
- **Filters** zone: restricts the base set to chosen values of a field
  (include only). It is in-memory and does not change the saved filter tree.
  Each cell has a ⊘ button (visible on hover) that adds an exclusion: a
  `NOT (row values and column values)` entry that drops the records matching
  all of that cell's row and column values. The grand total cannot be excluded.
  Exclusions appear as `NOT …` chips and are removed like other chips.
  Each cell also has a ⊕ button next to the ⊘ on its left edge (visible on hover) that adds
  one include term per row and column value, so only that cell's records stay.
  The grand total has no cell filter.
  For `Side`, the values are a dropdown (`request`/`response`) instead of
  free text.

Zones are edited with add and remove chips. Rows and Columns chips can be dragged to reorder within their zone or moved to
the other zone (`moveItem` / `transferItem`). Dropping on the empty area of a
zone appends the chip. Values chips reorder only within the Values zone; `canDrop`
rejects any other combination.

Row and column attributes are not chosen from dropdowns. The **Attributes** strip
sits above the Rows and Columns panels only, and lists every field not in Rows or Columns. Dragging an
attribute into Rows or Columns moves it there. Removing it (×) or dragging it
back to the strip returns it to the strip, so an attribute is never in both
zones at once. The strip is derived from the Rows and Columns state
(`availableFields`).

### Persistence and default value

The base set and layout are stored per database (`pivotState` META key, via
`DbView.pivot`). `PivotOverlay.setState` restores them when a database opens;
each recompute reports the state through `onStateChange`, which `index.ts`
saves without refreshing the pivot. A new pivot starts with the sum of Content-Length
(`defaultPivotConfig`), so a base set renders as soon as it is chosen.

The Filter and Values add forms keep their dropdown choices when the view
re-renders, so adding one entry does not reset the next.

### Row tree and collapsing

Rows form a tree: each row group is a prefix of the row fields (`isRowVisible`,
`isRowExpanded`). Only row groups below the grand total have toggles (▸/▾ on each group that has children); the grand total is always expanded. The grand total row has "Collapse all" and "Expand all" icon buttons (tooltip only)
(`collapse-all`) that sets every group's toggle to collapsed, and an "Expand all" button (`expand-all`) that expands every group.
By default the grand total and the first level are expanded, so the first two
levels show. Toggles are kept per row layout (`rowToggleKey`) in the overlay and
are not persisted. Collapsing hides the rows below a group, but the group's
own aggregates still include them. Row headers are cut off at 200px with an ellipsis (`.pivot-row-label`; full label in the tooltip). All rows stay in the DOM: a toggle only sets
`hidden` on them (`applyRowVisibility`), so the scroll position is kept. A full
re-render also restores the table's scroll position.

### Scrolling and sticky header

The table sits in `.pivot-table-wrap`, the scroll container. It fills the space
left by the controls (`.pivot-body` is a flex column with `min-height: 0`), so
it scrolls vertically and horizontally. The `thead` is sticky at the top of that
wrap, so both header rows stay visible; the corner cell is also sticky on the left.

### Size limits

The table is only rendered when it stays within `MAX_PIVOT_COLUMNS` (200
column headers, including subtotals) and `MAX_PIVOT_CELLS` (40,000 =
rows × columns × values). Otherwise `pivotLimitMessage` returns a message that
the overlay shows in place of the table. Changing the configuration recomputes
the pivot and the message updates.

## Values and aggregations

`AGGREGATIONS` in `pivotModel.ts`: `count`, `distinct`, `percentOfTotal`,
`sum`, `min`, `max`, `avg`, `median` (50th percentile), `p75`, `p90`, `p95`, `p99`, `stddev`.

- Numeric aggregations use `NUMERIC_SOURCES` (`time`, `contentLength`, `headerSize`,
  `cookieSize`, `status`). `time`, `contentLength`, `headerSize` and `cookieSize`
  take their per-side value from the record.
- `headerSize` and `cookieSize` are the sum of `name.length + value.length` over
  the side's own headers (or cookies), computed in `splitEntry`.
- Duration and size values are shown human-readable (`2m 05s`, `1.18 MB`);
  hovering a cell shows the exact value (ms with separators, or bytes with
  thousands separators). Count, distinct, percent and status values stay plain numbers.
- `coerceNumber` accepts numbers and numeric strings. Other values are ignored.
  The HAR `-1` sentinel is not special-cased.
- A value field can have **conversions** (`from => to`, comma-separated, `empty`
  for null). Parsed by `parseConversions` in `PivotOverlay.ts`. Rules apply to the
  source value before coercion.
- `percentOfTotal` is the cell's count divided by the base set's count.

## Heatmap

Optional (`DEFAULT_HEATMAP`: green to yellow to red, using `heatmapColor`).
Each value field has one data-driven scale (`ranges`): the lowest and highest
value across all its cells, including subtotals and the grand total, so the
highest value is red. Each cell's tooltip shows its position on that scale
(percent) with the scale's min and max. When all visible values are equal
(for example after an include filter leaves one cell), the scale is flat: the
cell gets the neutral middle color and its tooltip says all values are equal.

## Cell statistics tooltip

Every cell's `title` also lists its statistics (`cellStatistics` in
`pivotModel.ts`, exposed as `PivotResult.stats`): rows (split request/response
records), their share of all split rows in the base set (`baseCount`, two per
HAR entry), numeric count, distinct values, sum, min, max, average, 50th percentile (median), 75th percentile, p90, p95,
p99 and standard deviation. Values use full precision (up to 6 fraction digits)
and the value's unit (ms, B).

## Cell filters

Clicking a cell shows the filter query that selects its rows (`cellFilterQuery`),
with a **Copy filter** button. Host, path, and method clauses use the filter
engine's "contains" matching, so they are substring matches, not exact matches. The
base path clause is `path:`, so it also matches longer paths and URLs with a query.

## Export

No data export. **Copy JSON** writes the view definition to the clipboard:
`{ "version": 1, "base": ..., "config": ... }`. The `version` key lets the format
change later.

## Known limitations (v1)

- Cell filters can only be copied, not saved to the filter tree.
- Pivot views cannot be saved yet (planned: an own IndexedDB store per database).

## Tests

- `tests/pivot/pivotModel.test.ts`: status ranges, coercion, aggregations,
  nested subtotals, heatmap, cell filters.
- The base-set helpers `allFilters` and `idsInScope` are tested in
  `tests/har/harStore.test.ts`.
