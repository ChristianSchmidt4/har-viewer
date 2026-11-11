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

## Project Overview

This is a client-side HTTP Archive (HAR) viewer inspired by Fiddler. A user
drags a `.har` file onto the landing screen (or picks one via a file
dialog); the file is read and parsed entirely in the browser with
`FileReader`/`JSON.parse` — **it is never uploaded to a server**. The dev
server and production build only ever serve static files.

The app is written in **TypeScript** (strict mode) and served as native ES
modules by Vite, which transpiles `.ts` on the fly — no separate build step
is needed for development. See [TypeScript](#typescript) below.

## Key Components

### Utilities (`src/utils/`)
1. **HarParser** (`harParser.ts`) - Parses HAR JSON into structured entries;
   also derives `host`, `path`, `protocol`, `contentType` and
   `relativeStartMs` (time since the first request in the archive) per
   entry, and provides `formatBytes` / `formatTime` / `formatRelativeTime` /
   `formatDateTime`.
2. **filterParser** (`filterParser.ts`) - Parses and applies the request
   table's filter query syntax (`parseFilterQuery`, `filterEntries`).
3. **httpFormatter** (`httpFormatter.ts`) - Builds raw wire-format HTTP text
   (`buildRawRequest`, `buildRawResponse`) and lightweight JSON/HTML syntax
   highlighting (`highlightSyntax`) for the detail panel's Raw/Syntax tabs.
4. **domUtils** (`domUtils.ts`) - Shared `escapeHtml`, `truncateUrl`,
   `truncateText` helpers.

### Types (`src/types/`)
- **har.ts** - Shared TypeScript interfaces for the raw HAR 1.2 JSON shape
  (`HarData`, `HarEntryRaw`, `HarRequestRaw`, `HarResponseRaw`, ...) and the
  structured shape `HarParser` produces (`ParsedHar`, `ParsedEntry`,
  `ParsedRequest`, `ParsedResponse`, ...). Import `ParsedEntry` whenever you
  need the type of an entry flowing through the table/filter/detail panel.

### Components (`src/components/`)
1. **FileDropZone** (`FileDropZone.ts`) - The landing screen: drag-and-drop
   target plus a "Select File…" button (native file picker). Validates the
   file looks like a `.har`/JSON file, then hands the raw `File` object back
   via `onFileSelected`.
2. **RequestTable** (`RequestTable.ts`) - Left-pane filterable table. Owns
   the filter input, debounces keystrokes 250ms before re-filtering via
   `filterParser`, and renders rows with columns: index, response code,
   protocol, host, path, body size, content-type, duration, and relative
   start time. Emits `onSelect(entry)` when a row is clicked. Exposes
   `getVisibleEntries()` so other components (e.g. the Export button in
   `index.ts`) can get the currently filtered-in entries.
3. **DetailPanel** (`DetailPanel.ts`) - Right-pane detail view. Splits into
   a Request side and a Response side, each with independent Headers / Raw
   / Cookies / Syntax sub-tabs (state remembered per side across selections).

### Orchestration
- **Main Application** (`src/index.ts`) - Reads the file locally, calls
  `HarParser.parse`, and wires `FileDropZone` → `RequestTable` → `DetailPanel`.
  Also implements the header's **Export** button (`exportData`), which
  downloads the entries currently passing the request table's filter (via
  `RequestTable.getVisibleEntries`) as a standalone `.har` (JSON) file,
  named `<original-name>.filtered.har`. The button's `title` tooltip states
  what/format is exported; keep it in sync if the export format or scope
  changes. After a file loads, `displayTimeRange` fills `#time-range`
  (next to `#file-info`, before the header buttons) with the first
  request's start time and the archive's total duration (first request's
  start to last request's end), via `HarParser.formatDateTime`/`formatTime`.

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
1. User drags a file onto `FileDropZone` or picks one via "Select File…"
2. `index.ts` reads the file locally with `FileReader` and parses the JSON
3. `HarParser.parse` turns the raw HAR JSON into structured entries
4. `RequestTable.setEntries` renders the filterable list; `DetailPanel`
   starts in its empty state
5. Selecting a row calls `DetailPanel.render(entry)`, which renders both
   sides' active sub-tab (Headers/Raw/Cookies/Syntax)

### State Management
All state is kept in-memory in the browser. No external state management
libraries are used, and no network requests are made — the project is a
pure static site (`npm run build` → static `dist/`, servable by any static
file server).

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

### Styling Approach
Uses CSS custom properties (`:root` in `main.css`) for consistent theming.
Layout is a full-height flex column (header, filter bar, two-pane body);
panes stack vertically under 900px width.

## Common Tasks

### Adding a Column to the Request Table
1. Add a `<th>` in `index.html`'s `#requests-table thead`
2. Update `RequestTable.buildRow` in `RequestTable.ts` to add the matching `<td>`
3. Ensure the value is available on the parsed entry (extend `HarParser`
   and the `ParsedEntry` interface in `src/types/har.ts` if not)

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
- `tests/harParser.test.ts` - parsing, formatting, derived fields
- `tests/filterParser.test.ts` - filter query parsing and matching

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
hosting service (GitHub Pages, Netlify, Vercel, etc.).

## Browser Compatibility

Targets modern browsers that support:
- ES6 modules
- `FileReader` / drag-and-drop file APIs
- Modern CSS features (custom properties, flexbox)

IE11 support would require significant polyfilling and is not a goal.
