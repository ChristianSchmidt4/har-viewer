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

type WidthUnit = "px" | "em" | "rem" | "ch"
interface Column {
  key: string;
  label: string;
  // Width in ch; the header cell owns it (table-layout: fixed), so body
  // content never changes column widths.
  // if given, then the column is resizable manually
  width?: number;
}

const COLUMNS: Column[] = [
  {key: 'index', label: '   #'},
  {key: 'status', label: 'Code'},
  {key: 'protocol', label: 'Protocol'},
  {key: 'host', label: 'Host', width: 10},
  {key: 'path', label: 'Path', width: 20},
  {key: 'size', label: 'Body Size'},
  {key: 'contentType', label: 'Type'},
  {key: 'duration', label: 'Duration'},
  {key: 'startOffset', label: 'Start    '}
];


const MIN_COLUMN_WIDTH_PX = 48;

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
  // Widths (px) of resizable columns, keyed by column key or `custom:<id>`.
  private columnWidths: Map<string, number>;

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
    this.columnWidths = new Map();
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

    // Drag the right edge of a resizable header cell to change its width.
    this.theadEl.addEventListener('mousedown', (event) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>('.col-resizer');
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      const key = handle.dataset.columnKey!;
      const th = handle.closest('th')!;
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;

      const onMove = (moveEvent: MouseEvent) => {
        const width = Math.max(MIN_COLUMN_WIDTH_PX, Math.round(startWidth + moveEvent.clientX - startX));
        this.columnWidths.set(key, width);
        th.style.width = `${width}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('resizing-horizontal');
      };
      document.body.classList.add('resizing-horizontal');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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

  // Selects only the given entry (as a click would), scrolling it into view
  // when it is part of the currently filtered list.
  selectSingleEntry(entryId: number): void {
    const index = this.visibleEntries.findIndex(e => e.id === entryId);
    if (index !== -1) {
      const rowTop = index * this.rowHeight;
      const viewBottom = this.scrollEl.scrollTop + this.scrollEl.clientHeight;
      if (rowTop < this.scrollEl.scrollTop || rowTop + this.rowHeight > viewBottom) {
        this.scrollEl.scrollTop = Math.max(0, rowTop - this.scrollEl.clientHeight / 2);
      }
    }
    this.selectEntry(entryId);
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
    const widthStyle = (key: string, defaultWidth: number, unit: WidthUnit): string =>
      `style="box-sizing: content-box; width:${this.columnWidths.get(key) ?? defaultWidth}${unit}"`;
    const builtInThs = COLUMNS.map(c => {
      const resizer = c.width
        ? `<span class="col-resizer" data-column-key="${c.key}"></span>`
        : '';
      return `<th ${widthStyle(c.key, c.width || c.label.length, 'ch')}>${c.label}${resizer}</th>`;
    }).join('');
    const customThs = this.customColumns.map(col => {
      const key = `custom:${col.id}`;
      return `<th class="col-custom" ${widthStyle(key, col.label.length + 3, "ch")}><span class="col-label">${escapeHtml(col.label)}</span><button class="col-custom-remove" data-column-id="${escapeHtml(col.id)}" title="Remove column">&times;</button><span class="col-resizer" data-column-key="${escapeHtml(key)}"></span></th>`;
    }).join('');
    // Filler absorbs spare width so the fixed-width columns keep their size.
    this.theadEl.innerHTML = `
      <tr>
        ${builtInThs}
        ${customThs}
        <th class="col-fill" aria-hidden="true"></th>
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

    const colSpan = COLUMNS.length + this.customColumns.length + 1;
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
      <td class="col-fill" aria-hidden="true"></td>
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
