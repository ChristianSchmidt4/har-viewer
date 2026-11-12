# HAR Viewer - Fiddler Style

A client-side HTTP Archive (HAR) viewer inspired by Fiddler, built with modern web technologies.

## Features

- Client-side HAR file parsing — **nothing is ever uploaded to a server**
- Drag-and-drop landing screen, with a "Select File…" button as an
  alternative to dropping a file
- Filterable request table (Fiddler-style) with a simple query syntax
  (`status:200 method:GET host:example.com -type:image duration:>100`)
- Highlight rules below the table: `<filter> => [toggle|add|remove] <class>...`
  (e.g. `status:>=400 => red fire`; the action defaults to `add`) color, tag or
  restyle matching rows with any CSS named color (`red`, `lightblue`, ...),
  a symbol emoji (`fire`, `warning`, `lock`, ...) or text style (`bold`,
  `italic`, `underline`, `strikethrough`); rules are applied in order and are not persisted
- Split Request / Response detail view, each with **Headers**, **Raw**,
  **Cookies** and **Syntax** (highlighted body) tabs; image responses get an
  **Image** preview tab and font responses a **Font** tab (renders the
  pangram, the Latin alphabet, several sizes and text styles with the file's own font)
- Custom request-table columns: type e.g. `reqheader:X-Trace`,
  `resheader:Content-Encoding`, `reqcookie:sessionid` or `rescookie:track`
  into the column input to show that value per request; columns persist in
  localStorage and are removed with the `×` on their header
- Multi-select (Ctrl/Cmd- or Shift-click) shows an aggregate view with a
  **Timeline** waterfall and a **Stats** summary
- Header shows the archive's start time and total duration
- Opens plain `.har` and gzip-compressed `.har.gz` files
- Export of the currently filtered requests as a `.har` file
- Resizable panes (drag the splitters) and resizable request-table columns
  (drag the `Path` or custom column header edge)
- Large archives stay fast: only the visible rows of the request table are rendered
- Clicking a row in the multi-select Timeline selects that request and shows its details
- App version shown in the bottom-right corner
- Responsive design (panels stack on narrow screens)
- Written in strict-mode TypeScript and built with Vite

## Project Structure

```
har_viewer/
├── src/
│   ├── components/
│   │   ├── FileDropZone.ts   # Drag & drop / file-picker landing screen
│   │   ├── RequestTable.ts   # Filterable, windowed request list (left pane)
│   │   ├── HighlightBar.ts   # Highlight rule input + custom columns below the list
│   │   └── DetailPanel.ts    # Request/Response detail view and multi-select aggregate view (right pane)
│   ├── types/
│   │   └── har.ts            # Shared HAR raw/parsed type definitions
│   ├── utils/
│   │   ├── harParser.ts      # HAR JSON -> structured entries
│   │   ├── filterParser.ts   # Request-table filter query engine
│   │   ├── highlightRules.ts # Highlight rule parsing, color/emoji classes
│   │   ├── httpFormatter.ts  # Raw HTTP text + syntax highlighting
│   │   ├── aggregateStats.ts # Multi-select statistics
│   │   ├── customColumns.ts  # Custom column persistence and evaluation
│   │   ├── resizer.ts        # Drag-to-resize splitters
│   │   ├── virtualWindow.ts  # Windowed (virtualized) row range math
│   │   └── domUtils.ts       # Shared DOM/string helpers
│   ├── styles/
│   │   └── main.css          # All styling (drop screen + viewer)
│   └── index.ts              # Main entry point / app orchestration
├── index.html                # App shell (loads /src/index.ts as a module)
├── docs/                     # Documentation (incl. HAR format reference, sample.har)
├── tests/                    # Jest tests (mirrors src/ structure)
├── .claude/                  # Claude Code configuration
├── .github/workflows/        # GitHub Actions
└── dist/                     # Build output (generated)
```

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm start
```

This will start the development server at http://localhost:3000

### Building for Production

```bash
npm run build
```

The build output will be in the `dist/` directory.

### Deployment (GitHub Pages)

The CI/CD workflow (`.github/workflows/ci-cd.yml`) runs tests and a build on every push and pull request to `main`. On pushes to `main`, the `deploy` job publishes `dist/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`.

The app is served at **https://christianschmidt4.github.io/har-viewer/**. The production build uses `base: '/har-viewer/'` in `vite.config.mjs`, so asset paths match that sub-path.

One-time setup: in the repository's **Settings → Pages**, set **Source** to "Deploy from a branch", branch `gh-pages`, folder `/ (root)`. Also ensure **Settings → Actions → General → Workflow permissions** allows read and write for `GITHUB_TOKEN` (the deploy job also requests `contents: write`).

### Type Checking and Tests

```bash
npm run typecheck   # strict TypeScript check
npm test            # Jest unit tests
```

## Using with Claude Code

This project is designed to work seamlessly with Claude Code:

1. Open the project in your preferred IDE
2. Use Claude Code commands to assist with development
3. Leverage AI-powered code suggestions and explanations

## Using with GitHub Copilot

GitHub Copilot works well with this project structure:

1. Open the project in VS Code with GitHub Copilot installed
2. Start coding - Copilot will provide intelligent suggestions
3. Use Copilot Chat for architecture discussions and code explanations

## HAR Format Support

This viewer supports the HAR 1.2 specification:

- Log metadata (creator, browser, pages)
- Entry details (request, response, timings)
- Content inspection
- Performance metrics

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details.