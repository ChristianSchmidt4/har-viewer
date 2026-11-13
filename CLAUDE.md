# Claude Code Project Guide

This document provides specific guidance for using Claude Code with this HAR Viewer project.

## Keeping This Document Current

This file (and any other agentic-instruction file in this repo, e.g. a
future `AGENTS.md` or per-directory `CLAUDE.md`) must be kept in sync with
the code as part of the same change — not as a follow-up. Whenever a change
adds, removes, or alters a component, utility, syntax, workflow, or
convention described here, update the relevant section(s) in this same
commit. This includes (non-exhaustively):
- Adding/removing a component or utility, or changing its public behavior
- Changing the filter query syntax, HAR parsing, or detail panel tabs
- Adding/removing a "Common Tasks" how-to, or changing its steps
- Changing testing, build, or deployment setup

If unsure whether a change is doc-worthy, err toward updating this file.

A shared hook (`.github/hooks/minor-version-docs.mjs`, registered for Copilot
CLI in `.github/hooks/minor-version-docs.json` and for Claude Code in
`.claude/settings.json`) watches edits to `package.json`. When the minor
version rises relative to `HEAD` and `CHANGELOG.md` has no `## [x.y.z]`
section yet, it prompts the agent to update `CHANGELOG.md`, `README.md` and
`CLAUDE.md`. Bumps made outside the agent's edit tools (e.g. `npm version minor`)
do not trigger it.

## Project Overview

This is a client-side HTTP Archive (HAR) viewer inspired by Fiddler. A user
drags a `.har` file onto the landing screen (or picks one via a file
dialog); the file is read and parsed entirely in the browser (chunked reads;
each `log.entries` item is `JSON.parse`d separately, so the whole file is never
one JS string, which V8 cannot hold for multi-GB HARs) — **it is never uploaded to a server**. The dev
server and production build only ever serve static files.

The app is written in **TypeScript** (strict mode) and served as native ES
modules by Vite, which transpiles `.ts` on the fly — no separate build step
is needed for development. See [TypeScript](#typescript) below.

## Key Components

### Utilities (`src/utils/`)
1. **HarParser** (`harParser.ts`) - Parses HAR JSON into structured entries;
   also derives `host`, `path`, `protocol`, `contentType`, `relativeStartMs`
   (time since the first request in the archive) and normalized `timings`
   (`blocked`/`dns`/`connect`/`ssl`/`send`/`wait`/`receive`, with HAR's `-1`
   "not applicable" sentinel normalized to `0`) per entry. `contentType` is `''` when the
   response has neither a MIME type nor a body (`getContentType(mime, hasBody)`)
   and `other` for a body with an unknown MIME type. Provides
   `formatBytes` / `formatTime` / `formatRelativeTime` / `formatDateTime` /
   `formatClockTime` (`HH:MM:SS.mmm`) / `formatDurationClock` (`HH:MM:SS.mmm`
   duration, used by the aggregate Stats panel).
2. **filterParser** (`filterParser.ts`) - Parses and applies the request
   table's filter query syntax (`parseFilterQuery`, `filterEntries`).
3. **httpFormatter** (`httpFormatter.ts`) - Builds raw wire-format HTTP text
   (`buildRawRequest`, `buildRawResponse`) and lightweight JSON/HTML syntax
   highlighting (`highlightSyntax`) for the detail panel's Raw/Syntax tabs.
4. **domUtils** (`domUtils.ts`) - Shared `escapeHtml`, `truncateUrl`,
   `truncateText` helpers.
6. **highlightRules** (`highlightRules.ts`) - Parses highlight rules of the
   form `<filter> => [toggle|add|remove] <class>...` (action defaults to
   `add`; split on the last `=>`;
   the filter part uses `compileFilterQuery`). `computeHighlightClasses`
   applies rules in order to an entry. `NAMED_COLORS` lists all 148 CSS
   color names, `HIGHLIGHT_EMOJIS` maps emoji class names to symbols, and
   `TEXT_STYLE_CLASSES` (`bold`, `italic`, `underline`, `strikethrough`) have CSS rules.
   Each color needs a matching `#requests-table tbody tr.hl-<color>` rule in
   `main.css`; `tests/highlightRules.test.ts` enforces this.
5. **aggregateStats** (`aggregateStats.ts`) - `computeAggregateStats(entries)`
   reduces a set of entries into request count, bytes sent/received (split
   into headers/body), start/end timestamps, sequence vs. aggregate session
   duration, response code tally, and response bytes by content-type - the
   data behind the multi-select detail panel's Stats tab.
5b. **dbOrder** (`dbOrder.ts`) - Start-page order of the stored databases.
   The order is a list of DB names in localStorage (`har-viewer-db-order`);
   `applyDbOrder` sorts by it (unknown/new names go last), and `moveName`
   computes the new order for a drag-and-drop move.
6. **customColumns** (`customColumns.ts`) - Persistence and evaluation for
   request-table custom columns: `loadCustomColumns`/`saveCustomColumns`
   (localStorage key `har-viewer-custom-columns`), `addCustomColumn`,
   `removeCustomColumn`, and `evaluateCustomColumn(column, entry)`, which
   resolves expressions `reqheader:name`, `resheader:name`, `reqcookie:name`
   and `rescookie:name` to a cell value.
7. **resizer** (`resizer.ts`) - `makeResizer({ splitterEl, targetEl,
   containerEl, direction, min })` drag-resizes a pane via a splitter element
   (used for the main list/detail split and the Request/Response split).
8. **virtualWindow** (`virtualWindow.ts`) - `computeWindowRange(scrollTop,
   viewportHeight, rowHeight, total, overscan)` returns the `[start, end)`
   row slice to render for a fixed-row-height list (used by `RequestTable`).
9. **fileLoader** (`fileLoader.ts`) - `parseJsonFileStreaming(file, isGzipped, onProgress, options?)`
   reads a local file in chunks (`file.stream()`, optional `DecompressionStream`,
   `TextDecoderStream`) and passes them to `jsonArraySplitter.parseJsonWithArray`
   (`['log','entries']`, `options` = `{ batchSize, onBatch }`). Progress
   is reported in [0, 1] on compressed bytes, and it returns the
   uncompressed size for `.gz`. Also `readFileAsText(file, onProgress)` and
   `readGzipFileAsText(file, onProgress)` (FileReader / text-based helpers), plus
   `nextPaint()`, which yields so progress UI can repaint before a
   synchronous step.

### Types (`src/types/`)
- **har.ts** - Shared TypeScript interfaces for the raw HAR 1.2 JSON shape
  (`HarData`, `HarEntryRaw`, `HarRequestRaw`, `HarResponseRaw`,
  `HarTimingsRaw`, ...) and the structured shape `HarParser` produces
  (`ParsedHar`, `ParsedEntry`, `ParsedRequest`, `ParsedResponse`,
  `ParsedTimings`, ...). Import `ParsedEntry` whenever you need the type of
  an entry flowing through the table/filter/detail panel.

### Components (`src/components/`)
1. **FileDropZone** (`FileDropZone.ts`) - The import target ("HAR Upload"
   panel, below the stored-database list on the landing screen): drag-and-drop plus a "Select File…" button (native file picker).
   Validates the file looks like a `.har`/JSON file, then hands the raw `File`
   object back via `onFileSelected` (wired to `index.ts` `importFile`). It only
   imports; it never opens a file for viewing.
1b. **DatabaseList** (`DatabaseList.ts`) - The landing screen's list of stored
   databases (`HarStore.list()`). Each row is a CSS grid: status badge
   (Complete / Incomplete / Importing, colored) | name + file time
   (human-readable `formatDateTime`) + details or progress bar | comment |
   icon-only buttons (Open, Delete) | drag grip. Open is enabled only for
   complete databases; Delete is disabled while importing. The edit-comment
   icon sits next to the comment and is visible only on hover/focus
   (`.db-comment-cell`); it calls `onEditComment`, which `index.ts` routes to
   `editComment` (opens `askText`). Icon buttons carry `title` and `aria-label`.
   `index.ts` `renderDatabaseList` fills the list; `onOpen`/`onDelete` route to
   `showDatabase`/`deleteDatabase` (delete asks via `ChoiceDialog`).
   `.db-list` scrolls only when it exceeds `min(60vh, 460px)`.
   Reordering uses a grip handle (`.db-drag-handle`, right edge of the row)
   as the only drag source, so text in a row stays selectable. Dropping on
   another row shows a before/after
   indicator and calls `onReorder(names)`, which `index.ts` saves via
   `dbOrder.ts` and re-renders.
2. **RequestTable** (`RequestTable.ts`) - Left-pane filterable table. Owns
   the filter input, debounces keystrokes 250ms before re-filtering via
   `filterParser`, and renders rows with columns: index, response code,
   protocol, host, path, body size (request + response body bytes, with
   unknown `-1` sizes counted as 0; `N/A` only if both are unknown),
   content-type, duration, and relative start time. Column widths are fixed
   (`table-layout: fixed`) and set on the header cells (`COLUMNS[].width`,
   `CUSTOM_COLUMN_WIDTH_PX`), so they don't change between pages; the
   Path and custom columns have a `.col-resizer` drag handle on their right
   edge (widths kept in `columnWidths`), and a trailing `.col-fill` column
   absorbs spare width. Supports multi-select: plain click selects one row
   (`onSelect(entry)`), Ctrl/Cmd-click toggles a row in/out of the selection,
   and Shift-click selects the range from the last-touched row; 0 or 1
   selected rows fire `onSelect`/an empty `onMultiSelect([])`, 2+ fire
   `onMultiSelect(entries)`. Rows live in the IndexedDB store (`HarStore`):
   the table keeps only the list of matching indices (`visibleIds`), filters
   incrementally via `HarStore.filterIds`, and reads the rows it displays with
   `HarStore.getEntries`. `setStore(store)` attaches a file, `refresh()`
   re-filters, `getVisibleIds()` gives the current filter result (used by
   export), and `selectSingleEntry(id)` lets the detail panel's timeline
   select one row programmatically.
   **Windowed rendering**: only the rows inside the `.request-table-scroll`
   viewport (plus `OVERSCAN_ROWS` above/below) are in the DOM; the rest is
   represented by `tr.spacer` rows whose heights keep the scrollbar at full
   list height. `renderWindow()` runs on scroll and on resize (ResizeObserver)
   and re-renders only when the visible index range changes. `rowHeight` is
   measured from the first rendered row (default 28px) - keep row CSS
   (`#requests-table tbody td`) fixed-height/`nowrap` so the estimate holds.
   The range math lives in `utils/virtualWindow.ts` (`computeWindowRange`).
   **Highlighting**: `setHighlightRules(rules)` stores the rules;
   `buildRow` adds the `hl-<class>` classes from `computeHighlightClasses`
   to the `<tr>` and prepends the `hl-emoji` span for emoji classes to the
   `#` cell.
4. **HighlightBar** (`HighlightBar.ts`) - The input below the request table
   (`#highlight-input`), with chips (`#highlight-rules`, each removable with
   `×`), an error line (`#highlight-error`) and a syntax/examples popup
   (`#highlight-hint`, toggled on focus). Enter adds a rule and fires
   `onChange(rules)` (wired to `setHighlightRules` in `index.ts`). Rules are
   kept in memory only.
   **Custom columns**: the `<thead>` is generated by `renderHeader()` from the
   built-in `COLUMNS` array followed by one `<th class="col-custom">` per
   custom column (with a `×` button, `.col-custom-remove`, that fires
   `onCustomColumnRemove(columnId)`). `setCustomColumns`/`getCustomColumns`
   manage them, and each row appends `evaluateCustomColumn` cells (`—` when
   empty).
3. **DetailPanel** (`DetailPanel.ts`) - Right-pane detail view with two
   modes: `render(entry)` for a single selected request (Request/Response
   sides, each with independent Headers / Raw / Cookies / Syntax sub-tabs,
   plus Image (response side, `image/*`) and Font (response side,
   `contentType === 'font'`) preview tabs; state remembered per side across
   selections; the Syntax tab is hidden when that side has no body), and
   `renderMultiSelect(entries)` for 2+ selected requests, which replaces the
   Request/Response layout with an aggregate view with **Timeline** and
   **Stats** tabs (state remembered in `activeAggregateTab`):
   - **Timeline**: a waterfall - one row per request, a track showing each
     request positioned/sized by its absolute start time and duration
     within the selection's time range, segmented by the Fiddler-style
     timing phases (blocked/DNS/connect/SSL/send/wait/receive;  see
     https://www.telerik.com/fiddler/fiddler-classic/documentation/knowledge-base/timeline).
     Requests with no phase timings (all zero) fall back to a single "Wait"
     segment sized to the request's total time. The x-axis shows absolute
     clock time (`HarParser.formatClockTime`) at the start/end and evenly
     spaced relative `+Nms`/`+Ns` ticks in between, at an automatically
     chosen "nice" step (`pickNiceTickStep`: 1/2/5 x a power of ten,
     targeting ~6 ticks); matching faint gridlines run down each row's
     track. The **Fixed time scale** checkbox (next to the tab strip, only
     shown on the Timeline tab) switches from auto-fit (the full range
     scaled to 100% width) to a constant pixel width per tick
     (`FIXED_SCALE_PX_PER_TICK`), wrapping the axis+rows in a horizontally
     scrollable `.timeline-scroll` once the content is wider than the
     panel - useful for comparing timings precisely across a wide time
     range instead of having everything squeezed to fit. Hovering a row
     (`buildTimelineRowTooltip`) shows a full-detail tooltip: method + URL,
     status, absolute start time, total time, every non-zero timing phase,
     and request/response header/body sizes. Clicking a row selects only
     that entry in the request table (`RequestTable.selectSingleEntry`,
     scrolling it into view) and the detail panel switches to its
     single-request view; wired via the `onTimelineRowClick` option of
     `DetailPanel`.
   - **Stats**: renders `computeAggregateStats` as Fiddler's classic
     "Statistics" text block - request count; bytes sent/received (with
     headers/body breakdown); actual performance (start/end clock times,
     sequence duration, aggregate session duration); response code tally;
     response bytes by content-type.

10. **HarStore** (`harStore.ts`) - Per-file IndexedDB store of raw HAR entries
   (`rows` keyed by array index, `meta` for file name/size, file modification
   time, comment, completion, count and root). `dbNameFor(name, lastModified)`, `HarStore.list()` (all stored
   DBs, complete or not), `HarStore.inspect` (complete only), `HarStore.open`
   (used by the app only for complete DBs), `create(name, fileName, fileSize, fileModified)` (replaces
   an existing DB of that name), `HarStore.updateComment(name, comment)` (for DBs not
   being imported) and the instance `setComment(comment)` (for running imports, so
   batch writes keep the comment), `deleteDatabase`, `writeBatch` (rows and count
   in one transaction), `finish`, `getEntries(ids)`, `filterIds(query, from, to)`
   (uses `compileFilterQuery`), and `exportBlob(ids)`.
11. **ChoiceDialog** (`components/ChoiceDialog.ts`) - `askChoice(message, choices)`
   and `askText(message, defaultValue)` show a modal `<dialog>` and resolve to
   the chosen value / entered text, or `null` on cancel. Both are centered on
   screen (`.choice-dialog` in `main.css`).

### Orchestration
- **Main Application** (`src/index.ts`) - Reads the file locally in batches
  (`BATCH_SIZE`, via `parseJsonFileStreaming` with `onBatch`), parses each batch
  with `HarParser.parseEntries`, and wires `FileDropZone` → `RequestTable` → `DetailPanel`
  (`onSelect` → `detailPanel.render`, `onMultiSelect` →
  `detailPanel.renderMultiSelect`/`showEmptyState` when the selection is
  cleared). Also implements the header's **Export** button (`exportData`),
  which downloads the entries currently passing the request table's filter
  (via `RequestTable.getVisibleIds`, streamed out of `HarStore.exportBlob`)
  as a standalone `.har` (JSON) file, named `<database name>.filtered.har`
  (the name entered at import, not the original file name). The export also
  carries the stored comment as `log.comment`.
  Export is only offered for complete databases (the button shows a toast otherwise). The button's `title` tooltip states
  what/format is exported; keep it in sync if the export format or scope
  changes. After a file loads, `displayTimeRange` fills `#time-range`
  (next to `#file-info`, before the header buttons) with the first
  request's start time and the archive's total duration (first request's
  start to last request's end), via `HarParser.formatDateTime`/`formatTime`.
  `.har.gz`/`.gz` files are gunzipped in the browser while reading
  (`parseJsonFileStreaming`, which uses `DecompressionStream`), and the header then shows the
  uncompressed size. The custom-column input (`#custom-col-input`) adds a
  column on Enter when its expression is a valid `reqheader:`/`resheader:`/
  `reqcookie:`/`rescookie:` expression; the label is derived from it, and the
  list is persisted with `saveCustomColumns`.
  The app version is shown in the bottom-right corner (`#app-version`, filled
  in `DOMContentLoaded` from `package.json`'s `version` via a JSON import), so
  bump `package.json`'s version to change what users see.

## Development Workflow with Claude Code

### Recommended Commands

- Use `/run` to start the development server
- Use `/code-review` before committing changes
- Use `/simplify` to optimize code structure
- Use `/artifact-diagramming` when adding visual components

### File Organization Guidelines

Follow these patterns when adding new features:

1. **New Utilities**: Place in `src/utils/` with clear, single-responsibility functions
2. **UI Components**: Place in `src/components/` as modular, reusable elements
3. **Shared Types**: Add/extend interfaces in `src/types/har.ts` rather than
   inlining object shapes; import them with `import type { ... }`
4. **Styles**: Add to `src/styles/main.css` (all styling, including the
   drop screen, lives in this one file; split it out only if it grows
   unwieldy)
5. **Tests**: Place in `tests/` directory mirroring the `src/` structure, as `.test.ts` files

## Architecture Notes

### Data Flow
1. On the landing screen, the user imports by dragging a file onto
   `FileDropZone` or picking one via "Select File…" (`.har`, `.har.gz`/`.gz` or
   JSON), or opens/deletes an existing DB from `DatabaseList`. Opening a DB
   shows the table; the rest of the app only performs DB operations.
2. `index.ts` reads and parses the file locally via `utils/fileLoader.ts`
   (`parseJsonFileStreaming`, gunzipping first for `.gz`). The `log.entries`
   items are parsed with native `JSON.parse` one at a time via
   `utils/jsonArraySplitter.ts` (a token-level parser such as stream-json was
   ~50x slower) and delivered in batches of 1000 (`BATCH_SIZE`). Items that fail
   to parse become `{ invalid: true, reason, raw }` placeholders, which the
   table renders as invalid rows. Import runs as a background job
   (`index.ts` `importFile`/`runImport`): each batch is written to the file's
   IndexedDB store (`HarStore.writeBatch`, one DB per file name + lastModified,
   keyed by array index). The import does not open a table: the user stays on
   the start page, where the DB list shows the import percentage and request
   count. The header (`updateFileInfo`) only describes complete DBs. If a complete stored copy already
   exists, the user is asked (`ChoiceDialog.askChoice`) to reuse it or override
   it. Otherwise the user is asked for a database name (`ChoiceDialog.askText`,
   prefilled with the file name). The chosen name is only the display name
   (`fileName` in meta); duplicate detection still uses the original file name +
   lastModified. On completion a toast (`showMessage(..., 'info')`) reports the file
   sizes and request count. A failed import leaves an incomplete DB, which is
   shown as such on the start page and cannot be opened. Only one
   job per DB name runs at a time. `nextPaint()` yields between batches.
3. Rows are parsed on demand: `HarStore.getEntries` runs `HarParser.parseEntries`
   and `assignRelativeTimings` on the rows it reads (`id` = index in `log.entries`)
4. `RequestTable.refresh` filters the store incrementally and renders the
   visible window from it; `DetailPanel` starts in its empty state
5. Selecting a single row calls `DetailPanel.render(entry)`, which renders
   both sides' active sub-tab (Headers/Raw/Cookies/Syntax, plus Image/Font
   on the response side when applicable); selecting 2+
   rows (Ctrl/Cmd-click or Shift-click) calls
   `DetailPanel.renderMultiSelect(entries)`, which renders the aggregate
   Timeline/Stats view instead

### State Management
All HAR entries live in IndexedDB (`utils/harStore.ts`, one database per file
named `har:<name>:<lastModified>`); only index lists and view state are kept
in memory. Filtering and export read from the database. Highlights are applied
at render time. No external state management libraries are used, and no
network requests are made — the project is a pure static site
(`npm run build` → static `dist/`, servable by any static file server).

### Filter Query Syntax (`filterParser.ts`)
Parsed by a tokenizer + recursive-descent parser into an AST
(`parseFilterQuery` returns the AST; `filterEntries` evaluates it per entry).
Clauses with no explicit operator between them are ANDed.

- `field:value` — known fields: `method`, `status`/`code`, `host`/`domain`,
  `path`, `protocol`/`proto`, `type`/`mime`, `duration`/`time`, `size`
- `-field:value` or `not field:value` — negates the clause
- Numeric fields (`status`, `duration`, `size`) support `>`, `<`, `>=`, `<=`
  (e.g. `duration:>100`, `size:<10kb`)
- `and` / `or` / `(...)` — logical combinators and grouping; precedence is
  `not` > `and` > `or`, and adjacent clauses with no keyword default to `and`
- `reqheader:name=value` / `resheader:name=value` — request/response header
  `name` contains `value` (case-insensitive)
- `reqcookie:name=value` / `rescookie:name=value` — request/response cookie
  `name` contains `value`
- `reqheader:name` / `resheader:name` / `reqcookie:name` / `rescookie:name`
  (no `=value`) — checks the header/cookie is present, regardless of value
- Plain text with no `field:` prefix matches against the request method + URL
- Unknown field prefixes degrade gracefully to a plain-text match (the
  filter never throws on bad input)

Examples:
- `status:200 method:GET` — AND of two field clauses
- `host:example.com -type:image` — negated clause
- `duration:>100 size:<10kb` — numeric comparisons with unit suffixes
- `(status:>=400 or duration:>500) and -type:image` — grouping with AND/OR
- `not host:cdn.example.com` — keyword negation
- `reqheader:user-agent=chromium` — request header value match
- `reqheader:x-execution-id=ADFEEx01 or resheader:x-execution-id` — header
  value match OR’d with a presence-only check
- `reqcookie:session=abc123` — request cookie value match
- `rescookie:track and status:200` — response cookie presence/value AND’d
  with a field clause

### Highlight Rule Syntax (`highlightRules.ts`)
`<filter> => [<action>] <class>...`, where `<filter>` is any filter query and
`<action>` is optional: `toggle`, `add` (the default) or `remove`. Classes
are separated by spaces or commas. Each class becomes `hl-<class>` on the
row; colors and text styles (`bold`, `italic`, `underline`, `strikethrough`) are styled in
`main.css`, emojis are prefixed in the `#` cell.

Examples:
- `status:>=400 => red` — red background on errors (implicit `add`)
- `method:POST => lightblue fire` — color plus an emoji
- `status:500 => red bold underline` — several classes at once
- `status:301 => strikethrough` — text style on its own
- `host:cdn.example.com => toggle gray` — flip the class on and off
- `status:200 => remove red` — drop a class added by an earlier rule

### Styling Approach
Uses CSS custom properties (`:root` in `main.css`) for consistent theming.
Layout is a full-height flex column (header, filter bar, two-pane body);
panes stack vertically under 900px width.

## Common Tasks

### Adding a Column to the Request Table
1. Add an entry to the `COLUMNS` array in `RequestTable.ts` (its `<th>` is
   generated by `renderHeader`, not `index.html`)
2. Update `RequestTable.buildRow` in `RequestTable.ts` to add the matching `<td>`
3. Ensure the value is available on the parsed entry (extend `HarParser`
   and the `ParsedEntry` interface in `src/types/har.ts` if not)

Note: user-defined columns are a different mechanism (see
`customColumns.ts`); extend `evaluateCustomColumn` to support a new
expression prefix.

### Changing the App Version
1. Edit `version` in `package.json`; the bottom-right `#app-version` label
   picks it up automatically at startup.

### Adding a Highlight Color or Emoji
- Color: add the name to `NAMED_COLORS` and a
  `#requests-table tbody tr.hl-<name>` rule in `main.css`, placed before the
  `:hover` rule.
- Emoji: add `name: '<emoji>'` to `HIGHLIGHT_EMOJIS` in `highlightRules.ts`
  (the hint text is generated from it).

### Adding a Filterable Field
1. Add the field to `FIELD_ALIASES` in `filterParser.ts` (and to
   `NUMERIC_FIELDS`/the `FieldName` union type if it's a number)
2. Add a case for it in `getFieldValue` in the same file
3. Update the hint text in `index.html`'s `#filter-hint`

### Adding a Header/Cookie-Style Filter Prefix
1. Add the prefix to `HEADER_COOKIE_ALIASES` in `filterParser.ts`, mapping
   it to a `side` key
2. Add a case for that `side` in `getHeaderCookieList` in the same file
3. Update the hint text in `index.html`'s `#filter-hint`

### Adding a Sub-Tab to the Detail Panel
1. Add the tab to `SUB_TABS` in `DetailPanel.ts` (and to the `SubTabKey` type)
2. Add a `case` for it in `DetailPanel.renderSidePanel`
3. Implement a `renderXxx(...)` method following the existing
   `renderHeaders` / `renderRaw` / `renderCookies` / `renderSyntax` pattern

### Extending HAR Parsing
1. Add new fields/methods to `HarParser.ts`, updating the raw/parsed
   interfaces in `src/types/har.ts` to match
2. If the data is used by the filter engine, also wire it into
   `filterParser.ts`'s `getFieldValue`/`FIELD_ALIASES`

### Adding/Changing a Timeline Phase
1. Update `TIMELINE_PHASES` in `DetailPanel.ts` (key into `ParsedEntry.timings`,
   label, CSS class) and add the matching `.phase-xxx` color in `main.css`
2. If it's a new raw HAR timing field, add it to `HarTimingsRaw`/
   `ParsedTimings` in `src/types/har.ts` and to `HarParser.parseTimings`

## TypeScript

The project is written in strict-mode TypeScript (`tsconfig.json`: `strict`
and `noUncheckedIndexedAccess`). A few things to keep in mind:
- Vite serves/transpiles `.ts` files natively (no type-checking at dev-server
  time); run `npm run typecheck` (or `npm run build`, which runs it first)
  to actually type-check.
- Jest runs tests through Babel (`@babel/preset-typescript`), which strips
  types without checking them - `npm run typecheck` is the source of truth
  for type errors, `npm test` only proves the code runs correctly.
- Source imports keep an explicit `.js` extension (e.g.
  `import { HarParser } from '../utils/harParser.js'`) even though the
  files are `.ts` - this is required for native ESM resolution in the
  browser/Vite. `jest.config.js` maps those back to the `.ts` source via
  `moduleNameMapper`.
- Shared data shapes live in `src/types/har.ts`; prefer extending those
  interfaces over inlining object types or using `any`.

## Testing

Unit tests live in `tests/`, run with `npm test` (Jest + jsdom):
- `tests/harParser.test.ts` - parsing, formatting, derived fields, timing normalization
- `tests/filterParser.test.ts` - filter query parsing and matching
- `tests/aggregateStats.test.ts` - multi-select aggregate stats computation
- `tests/highlightRules.test.ts` - highlight rule parsing and CSS color coverage
- `tests/virtualWindow.test.ts` - windowed-rendering range computation
- `tests/fileLoaderStream.test.ts` - streaming JSON parse (plain/gzip), equivalence with `JSON.parse`, progress (Node env)
- `tests/jsonArraySplitter.test.ts` - per-item array splitting across chunk sizes, escapes, batching, invalid-item placeholders, error cases (Node env)
- `tests/fileLoader.test.ts` - FileReader text reading and progress (jsdom)
- `tests/fileLoaderGzip.test.ts` - gzip decompression and progress (Node env, since jsdom lacks `DecompressionStream`)
- `tests/dbOrder.test.ts` - DB order persistence, `applyDbOrder`, `moveName`
- `tests/harStore.test.ts` - IndexedDB store: naming, create/finish/inspect/reopen, list/comment, filtering by range and header/cookie sub-attributes, highlighting of DB-read rows, streamed upload in batches (invalid placeholders, HAR comment), export incl. comment (Node env with `fake-indexeddb`)

Jest needs `jest-environment-jsdom`, `@babel/preset-env` and
`@babel/preset-typescript` (see `babel.config.cjs`) to transform TS/ES
modules for the test run; the app itself ships as native ES modules/TS via
Vite, untouched by Babel. Run `npm run typecheck` separately (or via
`npm run build`) for actual type-checking - see [TypeScript](#typescript).

Future enhancements could include:
1. Component/integration tests for `RequestTable` and `DetailPanel`
2. End-to-end tests with Playwright or Cypress covering drag-and-drop

## Deployment

Static deployment only — no server-side requirements, and the app never
makes network requests with user data. Can be deployed to any static
hosting service (GitHub Pages, Netlify, Vercel, etc.). The production build
uses `base: '/har-viewer/'` (see `vite.config.mjs`) because GitHub Pages
serves the project at that sub-path; the dev server uses `/`. Static assets such
as `public/favicon.svg` are copied to the dist root by Vite.

GitHub Pages is wired up in `.github/workflows/ci-cd.yml`: the `deploy` job
(main branch only, `contents: write`) publishes `dist/` to the `gh-pages`
branch with `peaceiris/actions-gh-pages`. Pages must be set to serve from
the `gh-pages` branch, and the app lives at
https://christianschmidt4.github.io/har-viewer/.

## Browser Compatibility

Targets modern browsers that support:
- ES6 modules
- `FileReader` / drag-and-drop file APIs
- Modern CSS features (custom properties, flexbox)

IE11 support would require significant polyfilling and is not a goal.
