import {HarParser} from './utils/harParser.js';
import {FileDropZone} from './components/FileDropZone.js';
import {RequestTable} from './components/RequestTable.js';
import {HighlightBar} from './components/HighlightBar.js';
import {DetailPanel} from './components/DetailPanel.js';
import {askChoice, askText} from './components/ChoiceDialog.js';
import {makeResizer} from './utils/resizer.js';
import {addCustomColumn, loadCustomColumns, removeCustomColumn, saveCustomColumns} from './utils/customColumns.js';
import {nextPaint, parseJsonFileStreaming} from './utils/fileLoader.js';
import {HarStore, dbNameFor} from './utils/harStore.js';
import type {StoredRow} from './utils/harStore.js';
import {applyDbOrder, loadDbOrder, saveDbOrder} from './utils/dbOrder.js';
import {DatabaseList} from './components/DatabaseList.js';
import type {DatabaseListItem} from './components/DatabaseList.js';
import type {HarData} from './types/har.js';
import pkg from '../package.json';

// Number of log entries written to the store and rendered per progressive batch.
const BATCH_SIZE = 1000;

// An import running in the background. Its store is readable while it runs.
interface ImportJob {
  name: string;
  fileName: string;
  fileSize: number;
  store: HarStore;
  // Share of the compressed file read so far (0..1).
  fraction: number;
}

// Main application class - orchestrates loading a HAR file locally and
// wiring the drop zone, request table and detail panel together.
class HarViewerApp {
  private harParser: HarParser;
  // The IndexedDB-backed copy of the currently shown file.
  private store: HarStore | null;
  private dropZone: FileDropZone;
  private requestTable: RequestTable;
  private detailPanel: DetailPanel;
  private errorTimeout: ReturnType<typeof setTimeout> | undefined;
  // Background imports, keyed by database name.
  private readonly jobs = new Map<string, ImportJob>();
  // Database names whose import is being started (guards against races).
  private readonly busy = new Set<string>();
  private databaseList: DatabaseList;
  private listRenderQueued = false;

  constructor() {
    this.harParser = new HarParser();
    this.store = null;

    this.databaseList = new DatabaseList(document.getElementById('db-list')!, {
      onOpen: (name) => void this.showDatabase(name),
      onDelete: (name) => void this.deleteDatabase(name),
      onEditComment: (name, comment) => void this.editComment(name, comment),
      onReorder: (names) => this.reorderDatabases(names),
      formatBytes: (bytes) => this.harParser.formatBytes(bytes),
      formatDateTime: (timeMs) => this.harParser.formatDateTime(timeMs)
    });

    this.dropZone = new FileDropZone({
      onFileSelected: (file) => void this.importFile(file),
      onError: (message) => this.showMessage(message)
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
    void this.renderDatabaseList();

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

  // Imports a dropped/selected HAR file as a new database. The import runs in
  // the background: the database is shown straight away and fills up as
  // batches are written. The file itself is never sent to a server.
  // If a complete database for the same name + modification time exists,
  // the user chooses to reuse it or override it.
  private async importFile(file: File): Promise<void> {
    const name = dbNameFor(file.name, file.lastModified);
    if (this.jobs.has(name) || this.busy.has(name)) {
      this.showMessage(`"${file.name}" is already being imported`, 'info');
      return;
    }
    this.busy.add(name);
    try {
      const existing = await HarStore.inspect(name);
      if (existing) {
        const choice = await askChoice(
          `"${file.name}" was loaded before and a complete database exists. Reuse it or override it?`,
          [
            {value: 'reuse', label: 'Reuse stored database (Recommended)'},
            {value: 'override', label: 'Override'}
          ]
        );
        if (choice === null) return;
        if (choice === 'reuse') {
          await this.showDatabase(name);
          return;
        }
      }

      // The name shown for the database can be overridden; the identity used
      // for duplicate detection stays the original file name + modification time.
      const entered = await askText('Name for this database:', file.name);
      if (entered === null) return;
      const displayName = entered || file.name;

      const store = await HarStore.create(name, displayName, file.size, file.lastModified);
      const job: ImportJob = {name, fileName: displayName, fileSize: file.size, store, fraction: 0};
      this.jobs.set(name, job);
      void this.renderDatabaseList();
      void this.runImport(job, file);
    } catch (error) {
      console.error('Error starting HAR import:', error);
      this.showMessage('Failed to start the import of this file.');
    } finally {
      this.busy.delete(name);
    }
  }

  // Reads the file in batches into the job's store, then marks it complete.
  private async runImport(job: ImportJob, file: File): Promise<void> {
    const store = job.store;
    try {
      const onProgress = (fraction: number) => {
        job.fraction = fraction;
        this.onJobChanged(job);
      };
      const onBatch = async (items: unknown[]): Promise<void> => {
        await store.writeBatch(items as StoredRow[]);
        this.onJobChanged(job);
        // Let the browser paint the new rows before the next chunk is parsed.
        await nextPaint();
      };

      const {value, uncompressedSize} = await parseJsonFileStreaming(
        file,
        /\.gz$/i.test(file.name),
        onProgress,
        {batchSize: BATCH_SIZE, onBatch}
      );
      const harData = value as HarData;
      if (!harData || !harData.log) {
        throw new Error('Invalid HAR format: Missing log object');
      }
      await store.finish(harData as unknown as Record<string, unknown>, uncompressedSize);
      this.endJob(job);

      const sizes = uncompressedSize != null
        ? `${this.harParser.formatBytes(file.size)} compressed, ${this.harParser.formatBytes(uncompressedSize)} uncompressed`
        : this.harParser.formatBytes(file.size);
      this.showMessage(`Import of "${job.fileName}" finished: ${sizes}, ${store.count} requests.`, 'info', 8000);
    } catch (error) {
      console.error('Error processing HAR file:', error);
      this.endJob(job);
      const message = error instanceof Error ? error.message : '';
      const reason = message.includes('Invalid HAR')
        ? message
        : 'Please ensure it is a valid HAR (JSON) file.';
      this.showMessage(
        `Import of "${job.fileName}" failed after ${store.count} requests: ${reason} The partial database was kept as incomplete.`,
        'error',
        8000
      );
    }
  }

  // Removes a finished or failed job and closes its store.
  private endJob(job: ImportJob): void {
    this.jobs.delete(job.name);
    job.store.close();
    void this.renderDatabaseList();
  }

  // Called on every batch and progress step of a running import.
  private onJobChanged(job: ImportJob): void {
    this.scheduleListRender();
  }

  // Opens a complete stored database for viewing. Databases still being
  // imported or incomplete cannot be opened.
  private async showDatabase(name: string): Promise<void> {
    if (this.jobs.has(name)) {
      this.showMessage('This database is still importing. Wait for the import to finish.', 'info');
      return;
    }
    try {
      const store = await HarStore.open(name);
      if (!store.complete) {
        store.close();
        this.showMessage('This database is incomplete and cannot be opened. Delete it and import the file again.');
        void this.renderDatabaseList();
        return;
      }
      this.closeStore();
      this.store = store;
      this.showStore(store);
      this.updateFileInfo();
      void this.displayTimeRange(store);
    } catch (error) {
      console.error('Error opening database:', error);
      this.showMessage('Could not open this database.');
    }
  }

  // Deletes a stored database after confirmation. Databases still being
  // imported cannot be deleted.
  private async deleteDatabase(name: string): Promise<void> {
    if (this.jobs.has(name)) return;
    const summaries = await HarStore.list();
    const summary = summaries.find(s => s.name === name);
    const choice = await askChoice(
      `Delete the database for "${summary?.fileName ?? name}"? This cannot be undone.`,
      [{value: 'delete', label: 'Delete'}]
    );
    if (choice !== 'delete') return;

    if (this.store?.name === name) this.closeStore();
    try {
      await HarStore.deleteDatabase(name);
    } catch (error) {
      console.error('Error deleting database:', error);
      this.showMessage('Could not delete this database.');
    }
    void this.renderDatabaseList();
  }

  // Edits the comment of a stored database. A database still being imported
  // is updated through its open store so the import does not overwrite it.
  private async editComment(name: string, currentComment: string): Promise<void> {
    const comment = await askText('Comment for this database (what is inside):', currentComment);
    if (comment === null || comment === currentComment) return;
    try {
      const job = this.jobs.get(name);
      if (job) {
        await job.store.setComment(comment);
      } else {
        await HarStore.updateComment(name, comment);
      }
    } catch (error) {
      console.error('Error saving comment:', error);
      this.showMessage('Could not save the comment.');
    }
    void this.renderDatabaseList();
  }

  // Stores the start-page order chosen by drag-and-drop and redraws the list.
  private reorderDatabases(names: string[]): void {
    saveDbOrder(names);
    void this.renderDatabaseList();
  }

  // Rebuilds the stored-database list on the landing screen.
  private async renderDatabaseList(): Promise<void> {
    const summaries = applyDbOrder(await HarStore.list(), loadDbOrder());
    const items: DatabaseListItem[] = summaries.map(summary => {
      const job = this.jobs.get(summary.name);
      if (!job) return {...summary, importing: false, fraction: 0};
      return {...summary, comment: job.store.comment, count: job.store.count, complete: false, importing: true, fraction: job.fraction};
    });
    this.databaseList.render(items);
  }

  // Coalesces frequent progress updates into one list re-render.
  private scheduleListRender(): void {
    if (this.listRenderQueued) return;
    this.listRenderQueued = true;
    setTimeout(() => {
      this.listRenderQueued = false;
      void this.renderDatabaseList();
    }, 250);
  }

  // Shows the table for a store, replacing the drop screen.
  private showStore(store: HarStore): void {
    this.dropZone.hide();
    document.getElementById('har-content')!.classList.remove('hidden');
    this.detailPanel.showEmptyState();
    this.requestTable.setStore(store);
  }

  // Detaches the table from the displayed store. The database itself is kept
  // (and keeps importing if a job is running on it).
  private closeStore(): void {
    const store = this.store;
    this.requestTable.setStore(null);
    this.store = null;
    if (store && ![...this.jobs.values()].some(job => job.store === store)) {
      store.close();
    }
  }

  // Header text for the displayed (complete) database.
  private updateFileInfo(): void {
    const store = this.store;
    const fileInfoDiv = document.getElementById('file-info')!;
    if (!store) {
      fileInfoDiv.textContent = '';
      return;
    }
    const sizeText = store.uncompressedSize != null
      ? `${this.harParser.formatBytes(store.fileSize)} compressed, ${this.harParser.formatBytes(store.uncompressedSize)} uncompressed`
      : this.harParser.formatBytes(store.fileSize);
    fileInfoDiv.textContent = `${store.fileName} (${sizeText}) – ${store.count} requests`;
  }

  private resetToDropScreen(): void {
    this.closeStore();
    document.getElementById('har-content')!.classList.add('hidden');
    document.getElementById('file-info')!.textContent = '';
    document.getElementById('time-range')!.textContent = '';
    this.dropZone.show();
    void this.renderDatabaseList();
  }

  // Shows the first request's start time and the total duration of the
  // archive (from the first request's start to the last request's end).
  private async displayTimeRange(store: HarStore): Promise<void> {
    const timeRangeDiv = document.getElementById('time-range')!;
    if (store.count === 0) {
      timeRangeDiv.textContent = '';
      return;
    }

    const [first] = await store.getEntries([0]);
    const [last] = await store.getEntries([store.count - 1]);
    if (!first || !last || store !== this.store) return;
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
  private async exportData(): Promise<void> {
    const store = this.store;
    if (!store || !store.complete) {
      this.showMessage('No data to export');
      return;
    }

    const blob = await store.exportBlob(this.requestTable.getVisibleIds());
    const url = URL.createObjectURL(blob);
    const baseName = store.fileName.replace(/\.gz$/i, '').replace(/\.har$/i, '');

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', url);
    linkElement.setAttribute('download', `${baseName}.filtered.har`);
    linkElement.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private showMessage(message: string, variant: 'error' | 'info' = 'error', durationMs = 5000): void {
    let errorDiv = document.getElementById('error-message');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'error-message';
      document.getElementById('app')!.prepend(errorDiv);
    }
    errorDiv.textContent = message;
    errorDiv.classList.toggle('info', variant === 'info');
    errorDiv.classList.add('visible');

    clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => {
      errorDiv!.classList.remove('visible');
    }, durationMs);
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
