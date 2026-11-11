# Claude Code Project Guide

This document provides specific guidance for using Claude Code with this HAR Viewer project.

## Project Overview

This is a client-side HTTP Archive (HAR) viewer inspired by Fiddler. It parses HAR files in the browser and displays detailed information about HTTP requests and responses.

## Key Components

1. **HarParser** (`src/utils/harParser.js`) - Parses HAR JSON format and extracts structured data
2. **UIManager** (`src/components/UIManager.js`) - Handles all UI interactions and rendering
3. **Main Application** (`src/index.js`) - Orchestrates the application flow

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
3. **Styles**: Add to `src/styles/main.css` or create new CSS files as needed
4. **Tests**: Place in `tests/` directory mirroring the src structure

## Architecture Notes

### Data Flow
1. User uploads HAR file
2. File is parsed by HarParser
3. UIManager renders data to tables and detail views
4. User interactions update the detail views

### State Management
All state is kept in-memory in the browser. No external state management libraries are used.

### Styling Approach
Uses CSS custom properties for consistent theming and responsive design principles.

## Common Tasks

### Adding New Columns to Request Table
1. Modify `renderRequestList` in UIManager.js
2. Update the row HTML template
3. Ensure data is available in the entry object

### Adding New Detail Tabs
1. Update `displayRequestDetails` in UIManager.js
2. Add new tab header in the tabs section
3. Add new tab content section
4. Update `setupTabSwitching` if needed

### Extending HAR Parsing
1. Add new methods to HarParser.js
2. Update the parsing methods to extract additional data
3. Update data structures as needed

## Testing

Currently uses manual testing through the browser interface. Future enhancements could include:

1. Unit tests for HarParser
2. Integration tests for UIManager
3. End-to-end tests with Playwright or Cypress

## Deployment

Static deployment only - no server-side requirements. Can be deployed to any static hosting service (GitHub Pages, Netlify, Vercel, etc.).

## Browser Compatibility

Targets modern browsers that support:
- ES6 modules
- Fetch API
- Modern CSS features

IE11 support would require significant polyfilling.