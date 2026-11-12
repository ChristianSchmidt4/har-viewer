import {HarParser} from './utils/harParser.js';
import {FileDropZone} from './components/FileDropZone.js';
import {RequestTable} from './components/RequestTable.js';
import {HighlightBar} from './components/HighlightBar.js';
import {DetailPanel} from './components/DetailPanel.js';
import {makeResizer} from './utils/resizer.js';
import {addCustomColumn, loadCustomColumns, removeCustomColumn, saveCustomColumns} from './utils/customColumns.js';
import type {HarData, ParsedEntry} from './types/har.js';
import pkg from '../package.json';

// Main application class - orchestrates loading a HAR file locally and
// wiring the drop zone, request table and detail panel together.
class HarViewerApp {
  private harParser: HarParser;
  private currentHarData: HarData | null;
  private currentFileName: string | null;
  private dropZone: FileDropZone;
  private requestTable: RequestTable;
  private detailPanel: DetailPanel;
  private errorTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.harParser = new HarParser();
    this.currentHarData = null;
    this.currentFileName = null;

    this.dropZone = new FileDropZone({
      onFileSelected: (file) => this.handleFile(file),
      onError: (message) => this.showErrorMessage(message)
    });

    this.requestTable = new RequestTable({
      onSelect: (entry) => this.detailPanel.render(entry),
      onMultiSelect: (entries) => {
        if (entries.length === 0) {
          this.detailPanel.showEmptyState();
        } else {
          this.detailPanel.renderMultiSelect(entries);
        }
      },
      onCustomColumnRemove: (columnId) => {
        const columns = this.requestTable.getCustomColumns();
        const updated = removeCustomColumn(columns, columnId);
        columns.length = 0;
        columns.push(...updated);
        saveCustomColumns(columns);
        this.requestTable.setCustomColumns(columns);
      }
    });

    this.detailPanel = new DetailPanel({
      onTimelineRowClick: (entry) => this.requestTable.selectSingleEntry(entry.id)
    });

    new HighlightBar({
      onChange: (rules) => this.requestTable.setHighlightRules(rules)
    });

    this.init();
  }

  private init(): void {
    document.getElementById('load-new-btn')!.addEventListener('click', () => this.resetToDropScreen());
    document.getElementById('export-btn')!.addEventListener('click', () => this.exportData());

    // Custom column control: add a column when Enter is pressed.
    this.initCustomColControl();

    makeResizer({
      splitterEl: document.getElementById('main-splitter')!,
      targetEl: document.getElementById('request-list-container')!,
      containerEl: document.querySelector('.main-layout')!,
      direction: 'horizontal',
      min: 280
    });

    console.log('HAR Viewer App initialized');
  }

  // Reads the File object locally via FileReader - the file is never sent
  // to any server, only parsed in-memory in the browser. Transparently
  // gunzips .har.gz / .gz files via the native DecompressionStream before
  // parsing the JSON.
  private async handleFile(file: File): Promise<void> {
    try {
      const { harData, uncompressedSize } = await this.readFileAsJson(file);
      this.currentHarData = harData;
      this.currentFileName = file.name;

      const parsedData = this.harParser.parse(harData);

      this.dropZone.hide();
      document.getElementById('har-content')!.classList.remove('hidden');
      this.displayFileInfo(file.name, file.size, uncompressedSize);

      this.requestTable.setEntries(parsedData.entries);
      this.detailPanel.showEmptyState();
      this.displayTimeRange(parsedData.entries);
    } catch (error) {
      console.error('Error processing HAR file:', error);
      const message = error instanceof Error ? error.message : '';
      this.showErrorMessage(
        message.includes('Invalid HAR')
          ? message
          : 'Failed to process HAR file. Please ensure it is a valid HAR (JSON) file.'
      );
    }
  }

  private async readFileAsJson(file: File): Promise<{ harData: HarData; uncompressedSize: number | null }> {
    const isGzipped = /\.gz$/i.test(file.name);
    const text = isGzipped
      ? await this.readGzipFileAsText(file)
      : await this.readFileAsText(file);

    try {
      return {
        harData: JSON.parse(text),
        uncompressedSize: isGzipped ? new Blob([text]).size : null
      };
    } catch (error) {
      throw new Error('Invalid JSON format');
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target!.result as string);
      reader.onerror = () => reject(new Error('Error reading file'));
      reader.readAsText(file);
    });
  }

  private async readGzipFileAsText(file: File): Promise<string> {
    const decompressedStream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(decompressedStream).text();
  }

  private displayFileInfo(fileName: string, fileSize: number, uncompressedSize: number | null): void {
    const fileInfoDiv = document.getElementById('file-info')!;
    const sizeText = uncompressedSize != null
      ? `${this.harParser.formatBytes(fileSize)} compressed, ${this.harParser.formatBytes(uncompressedSize)} uncompressed`
      : this.harParser.formatBytes(fileSize);
    fileInfoDiv.textContent = `${fileName} (${sizeText})`;
  }

  private resetToDropScreen(): void {
    this.currentHarData = null;
    this.currentFileName = null;
    document.getElementById('har-content')!.classList.add('hidden');
    document.getElementById('file-info')!.textContent = '';
    document.getElementById('time-range')!.textContent = '';
    this.dropZone.show();
  }

  // Shows the first request's start time and the total duration of the
  // archive (from the first request's start to the last request's end).
  private displayTimeRange(entries: ParsedEntry[]): void {
    const timeRangeDiv = document.getElementById('time-range')!;
    if (!entries.length) {
      timeRangeDiv.textContent = '';
      return;
    }

    const first = entries[0]!;
    const last = entries[entries.length - 1]!;
    const totalDurationMs = Number.isFinite(first.startedTimeMs) && Number.isFinite(last.startedTimeMs)
      ? (last.startedTimeMs + last.time) - first.startedTimeMs
      : NaN;

    timeRangeDiv.textContent =
      `Start: ${this.harParser.formatDateTime(first.startedTimeMs)} · `
      + `Duration: ${this.harParser.formatTime(totalDurationMs)}`;
  }

  // Exports only the entries currently passing the request table's filter,
  // as a standalone .har (JSON) file - the full HAR structure is kept, but
  // log.entries is reduced to the filtered subset.
  private exportData(): void {
    if (!this.currentHarData) {
      this.showErrorMessage('No data to export');
      return;
    }

    const visibleIds = new Set(this.requestTable.getVisibleEntries().map(entry => entry.id));
    const filteredHarData: HarData = {
      ...this.currentHarData,
      log: {
        ...this.currentHarData.log,
        entries: (this.currentHarData.log.entries || []).filter((_, index) => visibleIds.has(index))
      }
    };

    const dataStr = JSON.stringify(filteredHarData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const baseName = (this.currentFileName || 'har-export').replace(/\.gz$/i, '').replace(/\.har$/i, '');
    const exportFileName = `${baseName}.filtered.har`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileName);
    linkElement.click();
  }

  private showErrorMessage(message: string): void {
    let errorDiv = document.getElementById('error-message');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'error-message';
      document.getElementById('app')!.prepend(errorDiv);
    }
    errorDiv.textContent = message;
    errorDiv.classList.add('visible');

    clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => {
      errorDiv!.classList.remove('visible');
    }, 5000);
  }

  private initCustomColControl(): void {
    const inputEl = document.getElementById('custom-col-input') as HTMLInputElement;
    if (!inputEl) return;

    const columns = loadCustomColumns();
    this.requestTable.setCustomColumns(columns);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const expr = inputEl.value.trim().toLowerCase();
      if (!expr) return;

      // Validate that it's a known custom-column expression.
      const validPrefixes = ['reqheader', 'resheader', 'reqcookie', 'rescookie'];
      const parts = expr.split(':');
      if (parts.length < 2 || !validPrefixes.includes(parts[0]!)) {
        inputEl.value = '';
        return;
      }

      // Use the part before = as the label; fall back to the full expression.
      const namePart = parts[1]!.split('=')[0] || parts[1];
      const label = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1) + '/' + namePart;
      const updated = addCustomColumn(columns, label, expr);
      columns.length = 0;
      columns.push(...updated);
      saveCustomColumns(columns);
      this.requestTable.setCustomColumns(columns);
      inputEl.value = '';
    });
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = `v${pkg.version}`;
  new HarViewerApp();
});

export { HarViewerApp };
