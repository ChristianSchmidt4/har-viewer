# Claude Code Project Guide

This document provides specific guidance for using Claude Code with this HAR Viewer project.

## Project Overview

This is a client-side HTTP Archive (HAR) viewer inspired by Fiddler. A user
drags a `.har` file onto the landing screen (or picks one via a file
dialog); the file is read and parsed entirely in the browser with
`FileReader`/`JSON.parse` — **it is never uploaded to a server**. The dev
server and production build only ever serve static files.

## Key Components

### Utilities (`src/utils/`)
1. **HarParser** (`harParser.js`) - Parses HAR JSON into structured entries;
   also derives `host`, `path`, `protocol`, `contentType` and
   `relativeStartMs` (time since the first request in the archive) per
   entry, and provides `formatBytes` / `formatTime` / `formatRelativeTime`.
2. **filterParser** (`filterParser.js`) - Parses and applies the request
   table's filter query syntax (`parseFilterQuery`, `filterEntries`).
3. **httpFormatter** (`httpFormatter.js`) - Builds raw wire-format HTTP text
   (`buildRawRequest`, `buildRawResponse`) and lightweight JSON/HTML syntax
   highlighting (`highlightSyntax`) for the detail panel's Raw/Syntax tabs.
4. **domUtils** (`domUtils.js`) - Shared `escapeHtml`, `truncateUrl`,
   `truncateText` helpers.

### Components (`src/components/`)
1. **FileDropZone** (`FileDropZone.js`) - The landing screen: drag-and-drop
   target plus a "Select File…" button (native file picker). Validates the
   file looks like a `.har`/JSON file, then hands the raw `File` object back
   via `onFileSelected`.
2. **RequestTable** (`RequestTable.js`) - Left-pane filterable table. Owns
   the filter input, re-filters on every keystroke via `filterParser`, and
   renders rows with columns: index, response code, protocol, host, path,
   body size, content-type, duration, and relative start time. Emits
   `onSelect(entry)` when a row is clicked.
3. **DetailPanel** (`DetailPanel.js`) - Right-pane detail view. Splits into
   a Request side and a Response side, each with independent Headers / Raw
   / Cookies / Syntax sub-tabs (state remembered per side across selections).

### Orchestration
- **Main Application** (`src/index.js`) - Reads the file locally, calls
  `HarParser.parse`, and wires `FileDropZone` → `RequestTable` → `DetailPanel`.

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
3. **Styles**: Add to `src/styles/main.css` (all styling, including the
   drop screen, lives in this one file; split it out only if it grows
   unwieldy)
4. **Tests**: Place in `tests/` directory mirroring the `src/` structure

## Architecture Notes

### Data Flow
1. User drags a file onto `FileDropZone` or picks one via "Select File…"
2. `index.js` reads the file locally with `FileReader` and parses the JSON
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

### Filter Query Syntax (`filterParser.js`)
Space-separated clauses, ANDed together:
- `field:value` — known fields: `method`, `status`/`code`, `host`/`domain`,
  `path`, `protocol`/`proto`, `type`/`mime`, `duration`/`time`, `size`
- `-field:value` — negates the clause
- Numeric fields (`status`, `duration`, `size`) support `>`, `<`, `>=`, `<=`
  (e.g. `duration:>100`, `size:<10kb`)
- Plain text with no `field:` prefix matches against the request method + URL
- Unknown field prefixes degrade gracefully to a plain-text match (the
  filter never throws on bad input)

### Styling Approach
Uses CSS custom properties (`:root` in `main.css`) for consistent theming.
Layout is a full-height flex column (header, filter bar, two-pane body);
panes stack vertically under 900px width.

## Common Tasks

### Adding a Column to the Request Table
1. Add a `<th>` in `index.html`'s `#requests-table thead`
2. Update `RequestTable.buildRow` in `RequestTable.js` to add the matching `<td>`
3. Ensure the value is available on the parsed entry (extend `HarParser` if not)

### Adding a Filterable Field
1. Add the field to `FIELD_ALIASES` in `filterParser.js` (and to
   `NUMERIC_FIELDS` if it's a number)
2. Add a case for it in `getFieldValue` in the same file
3. Update the hint text in `index.html`'s `#filter-hint`

### Adding a Sub-Tab to the Detail Panel
1. Add the tab to `SUB_TABS` in `DetailPanel.js`
2. Add a `case` for it in `DetailPanel.renderSidePanel`
3. Implement a `renderXxx(...)` method following the existing
   `renderHeaders` / `renderRaw` / `renderCookies` / `renderSyntax` pattern

### Extending HAR Parsing
1. Add new fields/methods to `HarParser.js`
2. If the data is used by the filter engine, also wire it into
   `filterParser.js`'s `getFieldValue`/`FIELD_ALIASES`

## Testing

Unit tests live in `tests/`, run with `npm test` (Jest + jsdom):
- `tests/harParser.test.js` - parsing, formatting, derived fields
- `tests/filterParser.test.js` - filter query parsing and matching

Jest needs `jest-environment-jsdom` and `@babel/preset-env` (see
`babel.config.cjs`) to transform ES modules for the test run; the app
itself ships as native ES modules via Vite, untouched by Babel.

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
