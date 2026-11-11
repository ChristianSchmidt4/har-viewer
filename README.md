# HAR Viewer - Fiddler Style

A client-side HTTP Archive (HAR) viewer inspired by Fiddler, built with modern web technologies.

## Features

- Client-side HAR file parsing — **nothing is ever uploaded to a server**
- Drag-and-drop landing screen, with a "Select File…" button as an
  alternative to dropping a file
- Filterable request table (Fiddler-style) with a simple query syntax
  (`status:200 method:GET host:example.com -type:image duration:>100`)
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
- Resizable panes (drag the splitters)
- Responsive design (panels stack on narrow screens)

## Project Structure

```
har_viewer/
├── src/
│   ├── components/
│   │   ├── FileDropZone.js   # Drag & drop / file-picker landing screen
│   │   ├── RequestTable.js   # Filterable request list (left pane)
│   │   └── DetailPanel.js    # Request/Response detail view (right pane)
│   ├── utils/
│   │   ├── harParser.js      # HAR JSON -> structured entries
│   │   ├── filterParser.js   # Request-table filter query engine
│   │   ├── httpFormatter.js  # Raw HTTP text + syntax highlighting
│   │   └── domUtils.js       # Shared DOM/string helpers
│   ├── styles/
│   │   └── main.css          # All styling (drop screen + viewer)
│   └── index.js              # Main entry point / app orchestration
├── index.html           # App shell (loads /src/index.js as a module)
├── docs/               # Documentation (incl. HAR format reference, sample.har)
├── tests/              # Test files (mirrors src/ structure)
├── .claude/            # Claude Code configuration
├── .github/workflows/  # GitHub Actions
└── dist/               # Build output (generated)
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