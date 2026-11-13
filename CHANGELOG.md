# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Stored databases show when they were last used (set on import and every time they are opened)
- Import asks for the database name and a comment in one dialog once the file is read; the comment is pre-filled with the HAR's `log.comment`
- Request-table filter, custom columns and highlight rules are saved in each database and restored when it is opened
- Imported HAR files are stored in IndexedDB, one database per file, with a start-page database manager (status, file time, comment, delete, drag-to-reorder) (`9297b9a`)
- Filter results are cached in the database and reused when it is reopened with the same query (`b25ff5e`)

### Changed
- Custom columns are no longer stored in localStorage; columns saved before must be added again once
- The request-table filter is applied on Enter or when the input loses focus, with a loading indicator while filtering (`88c73bf`)
- HAR entries are parsed and imported in batches of 1000; items that fail to parse appear as flagged rows (`45658d5`)
- The "Invalid JSON format" message includes the parse error details (`86a5124`, `be8e370`)
- Licensed under a custom non-commercial license instead of MIT (`5fc258b`)
- Vite config uses `import.meta.dirname` instead of `__dirname` (`86c1070`)

## [1.9.0] - 2026-11-12

### Added
- Shared post-edit hook (`.github/hooks/minor-version-docs.mjs`) for Copilot CLI and Claude Code that prompts updates to CHANGELOG.md, README.md and CLAUDE.md when the minor version is bumped

## [1.8.0] - 2026-11-12

### Added
- Progress bar while loading large HAR files (`5601691`)

## [1.7.0] - 2026-11-12

### Changed
- Documented GitHub Pages deployment in README and CLAUDE.md (`c7408b2`)

## [1.6.0] - 2026-11-12

### Changed
- Production build is served under the `/har-viewer/` base path (`95d8956`)

## [1.5.0] - 2026-11-12

### Fixed
- Granted `contents: write` permission to the deploy job (`2cf3e09`)

## [1.4.0] - 2026-11-12

### Changed
- CI configuration updated to support Node.js 22.x (`21173f1`)

## [1.3.0] - 2026-11-12

### Changed
- Upgraded upload/download artifact actions to v4 (`a39422a`)

## [1.2.0] - 2026-11-12

### Changed
- Favicon redesigned with rounded corners, repositioned elements and a text label (`a0f9932`)
- Imports switched to absolute paths and variables made `readonly` where applicable (`e43bc78`)
- Documented the version label, column resizing, windowed rendering and other missing details (`b4eb79d`)

## [1.1.0] - 2026-11-12

### Added
- Fiddler-style filterable request table with a split request/response detail view (`00230ba`)
- Header and cookie filters (`reqheader:`, `resheader:`, `reqcookie:`, `rescookie:`), `and`/`or`/`not` grouping, and filter debounce (`1437fa1`)
- Multi-select timeline and stats aggregate view in the detail panel (`0900c46`)
- Custom request-table columns with a remove button (`3979a2a`)
- Image sub-tab for image responses with a hover frame effect (`bfc36de`, `f486459`)
- Gzip support for `.har.gz` / `.gz` files (`c4da6dc`), with the uncompressed size shown in the header (`8c63ae1`)
- Archive start time and total duration in the header (`76169cb`)
- Highlight rules for request table rows, with colors, emojis and text styles (`68d3add`)
- Favicon support (`113cfba`)
- Lazy row rendering via windowing for large archives (`441333a`)
- Resizable request-table columns with fixed widths (`8b4d8a8`)
- Resizable splitters between panes (`b586b32`)
- Application version shown in the bottom-right corner (`69684bd`)
- Selecting a timeline row also selects the matching request row (`ab50443`)
- Exports now include only the requests that pass the current filter, with a tooltip describing the output (`51369e4`)
- Syntax tab hidden when a request or response has no body (`6458d6b`)
- Agent guidance (`CLAUDE.md`) to keep documentation in sync with code changes (`d760acc`)

### Changed
- Source converted to strict-mode TypeScript (`a7a6ab3`)
- Project moved to Vite (`8efdc9e`); `vite.config.js` renamed to `vite.config.mjs` with dependency updates (`1721ff5`)
- Request-table documentation updated and body size calculation corrected (`f2f33c9`)

### Fixed
- Vite serving: `index.html` moved to the project root to match `/src` references (`0c1c4ca`)
- Empty MIME types and missing response bodies handled in content-type detection (`fbbb1de`)

## [1.0.0] - 2026-11-11

### Added
- Initial project structure (`75ff2f5`)
