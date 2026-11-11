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
import { computeHighlightClasses, highlightClassName, HIGHLIGHT_EMOJIS } from '../utils/highlightRules.js';
import { computeWindowRange } from '../utils/virtualWindow.js';
import type { WindowRange } from '../utils/virtualWindow.js';
import type { ParsedEntry } from '../types/har.js';
import type { CustomColumn } from '../utils/customColumns.js';
import type { HighlightRule } from '../utils/highlightRules.js';

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

// Only rows inside the viewport (plus this many rows above/below) are in the
// DOM; the rest is represented by spacer rows so scrolling stays accurate.
const OVERSCAN_ROWS = 15;
const DEFAULT_ROW_HEIGHT_PX = 28;

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
  private scrollEl: HTMLElement;
  private tableBodyEl: HTMLElement;
  private resultCountEl: HTMLElement;
  private theadEl: HTMLElement;

  private customColumns: CustomColumn[];
  private highlightRules: HighlightRule[];

  private rowHeight: number;
  private renderedRange: WindowRange | null;

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
    this.highlightRules = [];
    this.rowHeight = DEFAULT_ROW_HEIGHT_PX;
    this.renderedRange = null;

    this.filterInputEl = document.getElementById('request-filter') as HTMLInputElement;
    this.filterHintEl = document.getElementById('filter-hint')!;
    this.tableBodyEl = document.getElementById('requests-table-body')!;
    this.resultCountEl = document.getElementById('result-count')!;
    this.theadEl = document.getElementById('requests-table-thead')!;
    this.scrollEl = this.tableBodyEl.closest<HTMLElement>('.request-table-scroll')!;

    this.renderHeader();
    this.bindEvents();
  }

  private bindEvents(): void {
    this.scrollEl.addEventListener('scroll', () => this.renderWindow());
    // A resized pane changes how many rows fit in the viewport.
    new ResizeObserver(() => this.renderWindow()).observe(this.scrollEl);

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
    this.scrollEl.scrollTop = 0;
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

  // Replaces the highlight rules and re-renders so row classes are updated.
  setHighlightRules(rules: HighlightRule[]): void {
    this.highlightRules = rules;
    this.render();
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
    // Content changed, so the rendered slice must be rebuilt even if the
    // visible index range is unchanged.
    this.renderedRange = null;
    this.renderWindow();
  }

  // Renders only the rows in the viewport (plus overscan), padded above and
  // below with spacer rows that keep the scrollbar at the full list height.
  private renderWindow(): void {
    const total = this.visibleEntries.length;
    const range = computeWindowRange(
      this.scrollEl.scrollTop,
      this.scrollEl.clientHeight,
      this.rowHeight,
      total,
      OVERSCAN_ROWS
    );
    this.updateResultCount();

    if (this.renderedRange && this.renderedRange.start === range.start && this.renderedRange.end === range.end) {
      return;
    }
    this.renderedRange = range;

    const colSpan = COLUMNS.length + this.customColumns.length;
    const nodes: HTMLElement[] = [];
    if (range.start > 0) {
      nodes.push(this.buildSpacer(range.start * this.rowHeight, colSpan));
    }
    for (let i = range.start; i < range.end; i++) {
      nodes.push(this.buildRow(this.visibleEntries[i]!));
    }
    const bottomRows = total - range.end;
    if (bottomRows > 0) {
      nodes.push(this.buildSpacer(bottomRows * this.rowHeight, colSpan));
    }
    this.tableBodyEl.replaceChildren(...nodes);

    // Row height depends on content (e.g. emoji highlights); re-measure from
    // the real DOM and re-render once if the estimate was off.
    const firstRow = this.tableBodyEl.querySelector<HTMLElement>('tr[data-entry-id]');
    if (firstRow) {
      const measured = firstRow.getBoundingClientRect().height;
      if (measured > 0 && Math.abs(measured - this.rowHeight) > 0.5) {
        this.rowHeight = measured;
        this.renderedRange = null;
        this.renderWindow();
      }
    }
  }

  private buildSpacer(heightPx: number, colSpan: number): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.className = 'spacer';
    row.setAttribute('aria-hidden', 'true');
    const cell = document.createElement('td');
    cell.colSpan = colSpan;
    cell.style.height = `${heightPx}px`;
    row.appendChild(cell);
    return row;
  }


  private buildRow(entry: ParsedEntry): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.dataset.entryId = String(entry.id);
    if (this.selectedEntryIds.has(entry.id)) {
      row.classList.add('selected');
    }

    const highlightClasses = computeHighlightClasses(this.highlightRules, entry);
    highlightClasses.forEach(cls => row.classList.add(highlightClassName(cls)));
    const emojis = highlightClasses.flatMap(cls => {
      const emoji = HIGHLIGHT_EMOJIS[cls];
      return emoji ? [emoji] : [];
    });
    const emojiPrefix = emojis.length ? `<span class="hl-emoji">${emojis.join('')}</span>` : '';

    const status = entry.response.status;
    const statusClass = status >= 200 && status < 300 ? 'status-success'
      : status >= 400 ? 'status-error'
      : status >= 300 && status < 400 ? 'status-redirect'
      : '';

    const requestBodySize = Math.max(entry.request.bodySize, 0);
    const responseBodySize = Math.max(entry.response.bodySize, 0);
    const bodySize = entry.request.bodySize >= 0 || entry.response.bodySize >= 0
      ? this.harParser.formatBytes(requestBodySize + responseBodySize)
      : 'N/A';

    const customCells = this.customColumns.map(col => {
      const value = evaluateCustomColumn(col, entry);
      return `<td class="col-custom" title="${escapeHtml(value)}">${escapeHtml(value || '—')}</td>`;
    }).join('');

    row.innerHTML = `
      <td class="col-index">${emojiPrefix}${entry.id + 1}</td>
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
