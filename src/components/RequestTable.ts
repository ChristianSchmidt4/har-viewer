// Left-hand panel: a filterable table of HTTP requests.
// Columns: index, response code, http protocol, host, path, body size,
// content-type, overall request duration, start time relative to the first
// request in the archive.
import { HarParser } from '../utils/harParser.js';
import { filterEntries } from '../utils/filterParser.js';
import { escapeHtml, truncateText } from '../utils/domUtils.js';
import type { ParsedEntry } from '../types/har.js';

interface Column {
  key: string;
  label: string;
}

const COLUMNS: Column[] = [
  { key: 'index', label: '#' },
  { key: 'status', label: 'Code' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'host', label: 'Host' },
  { key: 'path', label: 'Path' },
  { key: 'size', label: 'Body Size' },
  { key: 'contentType', label: 'Content-Type' },
  { key: 'duration', label: 'Duration' },
  { key: 'startOffset', label: 'Start' }
];

export interface RequestTableOptions {
  onSelect: (entry: ParsedEntry) => void;
}

export class RequestTable {
  private onSelect: (entry: ParsedEntry) => void;
  private harParser: HarParser;

  private allEntries: ParsedEntry[];
  private visibleEntries: ParsedEntry[];
  private selectedEntryId: number | null;
  private filterDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  private filterInputEl: HTMLInputElement;
  private filterHintEl: HTMLElement;
  private tableBodyEl: HTMLElement;
  private resultCountEl: HTMLElement;

  constructor({ onSelect }: RequestTableOptions) {
    this.onSelect = onSelect;
    this.harParser = new HarParser();

    this.allEntries = [];
    this.visibleEntries = [];
    this.selectedEntryId = null;

    this.filterInputEl = document.getElementById('request-filter') as HTMLInputElement;
    this.filterHintEl = document.getElementById('filter-hint')!;
    this.tableBodyEl = document.getElementById('requests-table-body')!;
    this.resultCountEl = document.getElementById('result-count')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.filterInputEl.addEventListener('input', () => {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = setTimeout(() => this.applyFilter(), 250);
    });

    // Toggle the filter syntax hint on focus for discoverability.
    this.filterInputEl.addEventListener('focus', () => {
      this.filterHintEl.classList.add('visible');
    });
    this.filterInputEl.addEventListener('blur', () => {
      this.filterHintEl.classList.remove('visible');
    });

    this.tableBodyEl.addEventListener('click', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-entry-id]');
      if (!row) return;
      this.selectEntry(parseInt(row.dataset.entryId!, 10));
    });
  }

  setEntries(entries: ParsedEntry[]): void {
    this.allEntries = entries;
    this.selectedEntryId = null;
    this.filterInputEl.value = '';
    this.applyFilter();
  }

  // Returns the entries currently passing the filter (same objects as
  // allEntries, so entry.id maps back to the original HAR entry index).
  getVisibleEntries(): ParsedEntry[] {
    return this.visibleEntries;
  }

  applyFilter(): void {
    const query = this.filterInputEl.value;
    this.visibleEntries = filterEntries(this.allEntries, query);
    this.render();
  }

  private render(): void {
    this.tableBodyEl.innerHTML = '';
    const fragment = document.createDocumentFragment();

    this.visibleEntries.forEach(entry => {
      fragment.appendChild(this.buildRow(entry));
    });

    this.tableBodyEl.appendChild(fragment);
    this.updateResultCount();
  }

  private buildRow(entry: ParsedEntry): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.dataset.entryId = String(entry.id);
    if (entry.id === this.selectedEntryId) {
      row.classList.add('selected');
    }

    const status = entry.response.status;
    const statusClass = status >= 200 && status < 300 ? 'status-success'
      : status >= 400 ? 'status-error'
      : status >= 300 && status < 400 ? 'status-redirect'
      : '';

    const bodySize = entry.response.bodySize >= 0
      ? this.harParser.formatBytes(entry.response.bodySize)
      : 'N/A';

    row.innerHTML = `
      <td class="col-index">${entry.id + 1}</td>
      <td class="col-status ${statusClass}">${status || '—'}</td>
      <td class="col-protocol">${escapeHtml(entry.protocol)}</td>
      <td class="col-host" title="${escapeHtml(entry.host)}">${escapeHtml(entry.host)}</td>
      <td class="col-path" title="${escapeHtml(entry.path)}">${escapeHtml(truncateText(entry.path, 60))}</td>
      <td class="col-size">${bodySize}</td>
      <td class="col-type">${escapeHtml(entry.contentType)}</td>
      <td class="col-duration">${this.harParser.formatTime(entry.time)}</td>
      <td class="col-start">${this.harParser.formatRelativeTime(entry.relativeStartMs)}</td>
    `;
    return row;
  }

  private selectEntry(entryId: number): void {
    this.selectedEntryId = entryId;
    this.tableBodyEl.querySelectorAll<HTMLElement>('tr[data-entry-id]').forEach(row => {
      row.classList.toggle('selected', parseInt(row.dataset.entryId!, 10) === entryId);
    });

    const entry = this.allEntries.find(e => e.id === entryId);
    if (entry) this.onSelect(entry);
  }

  private updateResultCount(): void {
    const total = this.allEntries.length;
    const visible = this.visibleEntries.length;
    this.resultCountEl.textContent = visible === total
      ? `${total} requests`
      : `${visible} / ${total} requests`;
  }
}

export { COLUMNS };
