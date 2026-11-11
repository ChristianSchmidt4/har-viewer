// Left-hand panel: a filterable table of HTTP requests.
// Columns: index, response code, http protocol, host, path, body size,
// content-type, overall request duration, start time relative to the first
// request in the archive.
//
// Custom columns can be added via setCustomColumns() — they render as
// additional <th>/<td> pairs after the built-in columns.
import { HarParser } from '../utils/harParser.js';
import { filterEntries } from '../utils/filterParser.js';
import { escapeHtml, truncateText } from '../utils/domUtils.js';
import { evaluateCustomColumn } from '../utils/customColumns.js';
import type { ParsedEntry } from '../types/har.js';
import type { CustomColumn } from '../utils/customColumns.js';

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
  onMultiSelect: (entries: ParsedEntry[]) => void;
  onCustomColumnRemove?: (columnId: string) => void;
}

export class RequestTable {
  private onSelect: (entry: ParsedEntry) => void;
  private onMultiSelect: (entries: ParsedEntry[]) => void;
  private harParser: HarParser;

  private allEntries: ParsedEntry[];
  private visibleEntries: ParsedEntry[];
  private selectedEntryIds: Set<number>;
  private lastSelectedEntryId: number | null;
  private filterDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  private filterInputEl: HTMLInputElement;
  private filterHintEl: HTMLElement;
  private tableBodyEl: HTMLElement;
  private resultCountEl: HTMLElement;
  private theadEl: HTMLElement;

  private customColumns: CustomColumn[];

  private onCustomColumnRemove?: (columnId: string) => void;

  constructor({ onSelect, onMultiSelect, onCustomColumnRemove }: RequestTableOptions) {
    this.onSelect = onSelect;
    this.onMultiSelect = onMultiSelect;
    this.onCustomColumnRemove = onCustomColumnRemove;
    this.harParser = new HarParser();

    this.allEntries = [];
    this.visibleEntries = [];
    this.selectedEntryIds = new Set();
    this.lastSelectedEntryId = null;
    this.customColumns = [];

    this.filterInputEl = document.getElementById('request-filter') as HTMLInputElement;
    this.filterHintEl = document.getElementById('filter-hint')!;
    this.tableBodyEl = document.getElementById('requests-table-body')!;
    this.resultCountEl = document.getElementById('result-count')!;
    this.theadEl = document.getElementById('requests-table-thead')!;

    this.renderHeader();
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
      const mouseEvent = event as MouseEvent;
      const entryId = parseInt(row.dataset.entryId!, 10);
      if (mouseEvent.shiftKey) {
        this.selectRange(entryId);
      } else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
        this.toggleEntry(entryId);
      } else {
        this.selectEntry(entryId);
      }
    });

    // Close button on custom column headers.
    this.theadEl.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>('.col-custom-remove');
      if (!btn) return;
      event.stopPropagation();
      const columnId = btn.dataset.columnId;
      if (columnId && this.onCustomColumnRemove) {
        this.onCustomColumnRemove(columnId);
      }
    });
  }

  setEntries(entries: ParsedEntry[]): void {
    this.allEntries = entries;
    this.selectedEntryIds.clear();
    this.lastSelectedEntryId = null;
    this.filterInputEl.value = '';
    this.applyFilter();
  }

  setCustomColumns(columns: CustomColumn[]): void {
    this.customColumns = columns;
    this.renderHeader();
    this.render();
  }

  getCustomColumns(): CustomColumn[] {
    return this.customColumns;
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

  private renderHeader(): void {
    const customThs = this.customColumns.map(col =>
      `<th class="col-custom">${escapeHtml(col.label)}<button class="col-custom-remove" data-column-id="${escapeHtml(col.id)}" title="Remove column">&times;</button></th>`
    ).join('');
    this.theadEl.innerHTML = `
      <tr>
        ${COLUMNS.map(c => `<th>${c.label}</th>`).join('')}
        ${customThs}
      </tr>
    `;
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
    if (this.selectedEntryIds.has(entry.id)) {
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

    const customCells = this.customColumns.map(col => {
      const value = evaluateCustomColumn(col, entry);
      return `<td class="col-custom" title="${escapeHtml(value)}">${escapeHtml(value || '—')}</td>`;
    }).join('');

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
      ${customCells}
    `;
    return row;
  }

  private selectEntry(entryId: number): void {
    this.selectedEntryIds = new Set([entryId]);
    this.lastSelectedEntryId = entryId;
    this.syncRowSelectionClasses();
    this.notifySelection();
  }

  private toggleEntry(entryId: number): void {
    if (this.selectedEntryIds.has(entryId)) {
      this.selectedEntryIds.delete(entryId);
    } else {
      this.selectedEntryIds.add(entryId);
    }
    this.lastSelectedEntryId = entryId;
    this.syncRowSelectionClasses();
    this.notifySelection();
  }

  private selectRange(entryId: number): void {
    const anchorId = this.lastSelectedEntryId ?? entryId;
    const anchorIndex = this.visibleEntries.findIndex(e => e.id === anchorId);
    const targetIndex = this.visibleEntries.findIndex(e => e.id === entryId);
    if (anchorIndex === -1 || targetIndex === -1) {
      this.selectEntry(entryId);
      return;
    }

    const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    this.selectedEntryIds = new Set(this.visibleEntries.slice(start, end + 1).map(e => e.id));
    this.syncRowSelectionClasses();
    this.notifySelection();
  }

  private syncRowSelectionClasses(): void {
    this.tableBodyEl.querySelectorAll<HTMLElement>('tr[data-entry-id]').forEach(row => {
      row.classList.toggle('selected', this.selectedEntryIds.has(parseInt(row.dataset.entryId!, 10)));
    });
  }

  private notifySelection(): void {
    const selected = this.allEntries.filter(e => this.selectedEntryIds.has(e.id));
    if (selected.length === 0) {
      this.onMultiSelect([]);
    } else if (selected.length === 1) {
      this.onSelect(selected[0]!);
    } else {
      this.onMultiSelect(selected);
    }
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
