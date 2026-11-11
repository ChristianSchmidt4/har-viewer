# HAR Viewer - Fiddler Style

A client-side HTTP Archive (HAR) viewer inspired by Fiddler, built with modern web technologies.

## Features

- Client-side HAR file parsing (no server required)
- Request/response inspection similar to Fiddler
- Timing analysis and performance metrics
- Export functionality
- Responsive design

## Project Structure

```
har_viewer/
├── src/
│   ├── components/     # UI components
│   ├── utils/          # Utility functions
│   ├── styles/         # CSS stylesheets
│   └── index.js        # Main entry point
├── public/             # Static assets and HTML
├── docs/               # Documentation
├── tests/              # Test files
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