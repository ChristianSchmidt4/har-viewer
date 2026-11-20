import './pivot.css';
import { escapeHtml } from '@/common/domUtils';
import type { CustomColumn } from '@/table/customColumns';
import { HarStore, ROOT_FILTER_ID } from '@/har/harStore';
import { HarParser } from '@/har/harParser';
import {
  AGGREGATIONS,
  BUILTIN_FIELDS,
  NUMERIC_SOURCES,
  PIVOT_SIDES,
  buildPivot,
  cellExclusion,
  cellFilterQuery,
  cellTerms,
  isExclusionFilter,
  recordPassesFilters,
  isRowExpanded,
  isRowVisible,
  rowToggleKey,
  cellKey,
  defaultPivotConfig,
  fieldKey,
  heatmapColor,
  heatmapPosition,
  moveItem,
  pivotLimitMessage,
  transferItem,
  splitEntry,
  type Aggregation,
  type BaseSet,
  type ConversionRule,
  type CellStatistics,
  type FieldFilter,
  type HeatmapConfig,
  type PivotConfig,
  type PivotFilter,
  type PivotFieldId,
  type PivotRecord,
  type PivotResult,
  type PivotState,
  type ValueSource,
  type ValueField
} from '@/pivot/pivotModel';

export interface PivotOverlayOptions {
  getStore: () => HarStore | null;
  getCustomColumns: () => CustomColumn[];
  showMessage: (message: string, variant?: 'error' | 'info') => void;
  // Called with the current base set and layout after each change, for persistence.
  onStateChange: (state: PivotState) => void;
}


// Zones a chip can be dragged from or dropped on; `available` is the attribute pool.
type DragZone = 'rows' | 'columns' | 'values' | 'available';

// Attributes come from the pool or move between Rows and Columns; values only reorder.
function canDrop(from: DragZone, to: DragZone): boolean {
  if (to === 'values') return from === 'values';
  if (to === 'available') return from !== 'available';
  return from !== 'values';
}

const DEFAULT_HEATMAP: HeatmapConfig = { low: '#63be7b', mid: '#ffeb84', high: '#f8696b' };

const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: 'Count',
  distinct: 'Distinct count',
  percentOfTotal: '% of total',
  sum: 'Sum',
  min: 'Min',
  max: 'Max',
  avg: 'Average',
  median: '50th percentile (median)',
  p75: '75th percentile',
  p90: '90th percentile',
  p95: '95th percentile',
  p99: '99th percentile',
  stddev: 'Std. deviation'
};

const SOURCE_LABELS: Record<string, string> = {
  time: 'Duration',
  contentLength: 'Content-Length',
  headerSize: 'Header size',
  cookieSize: 'Cookie size',
  status: 'Status code'
};

const formatter = new HarParser();

// Unit of an aggregated value, so sizes and durations get human-readable output.
// Count-like aggregations are plain numbers whatever the source.
function valueUnit(field: ValueField): 'duration' | 'bytes' | null {
  if (field.aggregation === 'count' || field.aggregation === 'distinct' || field.aggregation === 'percentOfTotal') return null;
  if (field.source === 'time') return 'duration';
  if (field.source === 'contentLength' || field.source === 'headerSize' || field.source === 'cookieSize') return 'bytes';
  return null;
}

const FIELD_LABELS: Record<string, string> = {
  statusRange: 'Status range',
  status: 'Status',
  method: 'Method',
  host: 'Host',
  path: 'Path',
  basePath: 'Base path',
  basePathStart: 'Base path start',
  basePathSegment2: 'Base path 2nd segment',
  basePathSegment3: 'Base path 3rd segment',
  basePathSegment4: 'Base path 4th segment',
  basePathLast: 'Base path last segment',
  protocol: 'Protocol',
  contentType: 'Content type',
  side: 'Side'
};

// Output of the most recent run, kept for cell clicks.
interface Computed {
  result: PivotResult;
}

// Fullscreen pivot view over a complete database. The base set must be chosen
// before anything is computed; the view recomputes on every change.
export class PivotOverlay {
  private readonly root: HTMLElement;
  private readonly options: PivotOverlayOptions;
  private base: BaseSet | null = null;
  private config: PivotConfig = defaultPivotConfig();

  private computed: Computed | null = null;
  private selectedCell: { row: number; col: number } | null = null;
  // User toggles of row groups, keyed by `rowToggleKey`; absent means the default.
  private rowToggles = new Map<string, boolean>();
  private runId = 0;
  private message = '';
  private open_ = false;

  constructor(options: PivotOverlayOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.id = 'pivot-overlay';
    this.root.className = 'pivot-overlay';
    this.root.hidden = true;
    document.body.appendChild(this.root);
    this.root.addEventListener('click', event => this.onClick(event));
    this.root.addEventListener('change', event => this.onChange(event));
    this.root.addEventListener('keydown', event => this.onKeyDown(event));
    this.root.addEventListener('dragstart', event => this.onDragStart(event));
    this.root.addEventListener('dragover', event => this.onDragOver(event));
    this.root.addEventListener('drop', event => this.onDrop(event));
    this.root.addEventListener('dragend', () => this.clearDragState());
  }

  // Chip being dragged: its zone, index and, for the attribute pool, its field.
  private dragSource: { zone: DragZone; index: number; field?: PivotFieldId } | null = null;

  private dropZoneFrom(event: Event): HTMLElement | null {
    return (event.target as HTMLElement).closest<HTMLElement>('[data-drop-zone]');
  }

  private chipFrom(event: Event): HTMLElement | null {
    return (event.target as HTMLElement).closest<HTMLElement>('[data-drag-zone]');
  }

  private onDragStart(event: DragEvent): void {
    const chip = this.chipFrom(event);
    if (!chip) return;
    this.dragSource = {
      zone: chip.dataset.dragZone as DragZone,
      index: Number(chip.dataset.index),
      field: chip.dataset.field as PivotFieldId | undefined
    };
    event.dataTransfer?.setData('text/plain', '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  }

  private onDragOver(event: DragEvent): void {
    const zone = this.dropZoneFrom(event);
    if (!zone || !this.dragSource || !canDrop(this.dragSource.zone, zone.dataset.dropZone as DragZone)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  private onDrop(event: DragEvent): void {
    const zone = this.dropZoneFrom(event);
    const source = this.dragSource;
    this.clearDragState();
    if (!zone || !source) return;
    const target = zone.dataset.dropZone as DragZone;
    if (!canDrop(source.zone, target)) return;
    event.preventDefault();
    const chip = this.chipFrom(event);
    // Dropping on the empty area of a zone appends the chip.
    const index = chip ? Number(chip.dataset.index) : Number.MAX_SAFE_INTEGER;
    if (target === 'values') {
      this.config.values = moveItem(this.config.values, source.index, Math.min(index, this.config.values.length - 1));
      this.selectedCell = null;
      this.render();
      void this.recompute();
      return;
    }
    if (source.zone === 'values') return;
    const lists = { rows: this.config.rows, columns: this.config.columns };
    if (target === 'available') {
      // The pool is derived from Rows and Columns, so returning a chip just removes it there.
      if (source.zone !== 'available') {
        lists[source.zone] = lists[source.zone].filter((_, i) => i !== source.index);
      }
    } else if (source.zone === 'available') {
      const list = lists[target];
      const at = Math.min(index, list.length);
      if (source.field) lists[target] = [...list.slice(0, at), source.field, ...list.slice(at)];
    } else if (source.zone === target) {
      const list = lists[target];
      lists[target] = moveItem(list, source.index, Math.min(index, list.length - 1));
    } else {
      const moved = transferItem(lists[source.zone], source.index, lists[target], index);
      lists[source.zone] = moved.source;
      lists[target] = moved.target;
    }
    this.config.rows = lists.rows;
    this.config.columns = lists.columns;
    this.selectedCell = null;
    this.render();
    void this.recompute();
  }

  private clearDragState(): void {
    this.dragSource = null;
    this.root.querySelectorAll('.pivot-chip.dragging').forEach(el => el.classList.remove('dragging'));
  }

  get isOpen(): boolean {
    return this.open_;
  }

  // Replaces the base set and layout with the ones stored for the database
  // (or the defaults when none are stored). Used when a database is opened.
  setState(state: PivotState | null): void {
    this.base = state?.base ?? null;
    this.config = state?.config ?? defaultPivotConfig();
    this.computed = null;
    this.selectedCell = null;
    this.message = '';
    if (this.open_) {
      this.render();
      void this.recompute();
    }
  }

  private state(): PivotState {
    return { base: this.base, config: this.config };
  }

  open(): void {
    this.open_ = true;
    this.root.hidden = false;
    this.render();
    void this.recompute();
  }

  close(): void {
    this.open_ = false;
    this.root.hidden = true;
  }

  // Called when the filter tree or custom columns change while the view is open.
  refresh(): void {
    if (!this.open_) return;
    const store = this.options.getStore();
    const base = this.base;
    if (base?.kind === 'filter' && store && !store.allFilters().some(node => node.id === base.id)) {
      this.base = null;
      this.computed = null;
      this.message = 'The base filter was deleted. Choose another base set.';
    }
    this.render();
    void this.recompute();
  }

  private render(): void {
    const store = this.options.getStore();
    const columns = this.options.getCustomColumns();
    // Re-rendering rebuilds the add forms; keep the chosen dropdown values.
    const kept = new Map<string, string>();
    this.root.querySelectorAll<HTMLSelectElement>('select[data-add]').forEach(el => kept.set(el.dataset.add!, el.value));
    // The table is rebuilt below; keep its scroll position.
    const oldWrap = this.root.querySelector<HTMLElement>('.pivot-table-wrap');
    const scroll = oldWrap ? { top: oldWrap.scrollTop, left: oldWrap.scrollLeft } : null;
    this.root.innerHTML = `
      <div class="pivot-panel" role="dialog" aria-label="Pivot">
        <div class="pivot-header">
          <div class="pivot-title">Pivot</div>
          <div class="pivot-base">${this.renderBaseSelect(store)}</div>
          <div class="pivot-header-actions">
            <button type="button" data-action="copy-json" ${this.base ? '' : 'disabled'}>Copy JSON</button>
            <button type="button" class="pivot-close" data-action="close" aria-label="Close pivot">×</button>
          </div>
        </div>
        ${this.message ? `<div class="pivot-message">${escapeHtml(this.message)}</div>` : ''}
        ${store ? this.renderConfig(columns) : '<div class="pivot-empty">Open a database to build a pivot.</div>'}
        <div class="pivot-body">${this.renderBody(columns)}</div>
        <div class="pivot-footer">${this.renderCellInfo(columns)}</div>
      </div>`;
    kept.forEach((value, name) => {
      const el = this.root.querySelector<HTMLSelectElement>(`select[data-add="${name}"]`);
      if (el && [...el.options].some(option => option.value === value)) el.value = value;
    });
    const newWrap = this.root.querySelector<HTMLElement>('.pivot-table-wrap');
    if (scroll && newWrap) {
      newWrap.scrollTop = scroll.top;
      newWrap.scrollLeft = scroll.left;
    }
    this.syncFilterInputs();
  }

  // Shows or hides the rendered rows and updates their toggles in place, so
  // collapsing or expanding a group does not rebuild the table.
  private applyRowVisibility(): void {
    if (!this.computed) return;
    const { rows } = this.computed.result;
    const isExpanded = (path: string[]) => isRowExpanded(path, this.rowToggles, this.config.rows);
    this.root.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row]').forEach(tr => {
      const row = rows[Number(tr.dataset.row)];
      if (!row) return;
      tr.hidden = !isRowVisible(row.path, isExpanded);
      const toggle = tr.querySelector<HTMLButtonElement>('.pivot-toggle');
      if (!toggle) return;
      const expanded = isExpanded(row.path);
      toggle.textContent = expanded ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
    });
  }

  // The filter's value input is replaced by the side select for the `side` field.
  private syncFilterInputs(): void {
    const isSide = this.root.querySelector<HTMLSelectElement>('[data-change="filter-field"]')?.value === 'side';
    const text = this.root.querySelector<HTMLInputElement>('[data-add="filter-values"]');
    const side = this.root.querySelector<HTMLSelectElement>('[data-add="filter-side"]');
    if (text) text.hidden = isSide;
    if (side) side.hidden = !isSide;
  }

  // Attributes not used in Rows or Columns, in their default order.
  private availableFields(columns: CustomColumn[]): PivotFieldId[] {
    const used = new Set<PivotFieldId>([...this.config.rows, ...this.config.columns]);
    const all: PivotFieldId[] = [
      ...BUILTIN_FIELDS,
      ...columns.map(column => `custom:${column.id}` as PivotFieldId)
    ];
    return all.filter(field => !used.has(field));
  }

  // Filter tree as an indented select. The custom query is a separate choice.
  private renderBaseSelect(store: HarStore | null): string {
    if (!store) return '';
    const options = store.allFilters().map(node => {
      const indent = '\u00a0\u00a0'.repeat(node.depth);
      const label = node.id === ROOT_FILTER_ID ? 'All requests' : node.query;
      const selected = this.base?.kind === 'filter' && this.base.id === node.id ? 'selected' : '';
      return `<option value="f:${node.id}" ${selected}>${indent}${escapeHtml(label)} (${node.count})</option>`;
    });
    const customSelected = this.base?.kind === 'custom' ? 'selected' : '';
    const none = this.base ? '' : 'selected';
    return `
      <label>Base set
        <select data-change="base">
          <option value="" ${none} disabled>Choose a base filter…</option>
          ${options.join('')}
          <option value="custom" ${customSelected}>Custom filter…</option>
        </select>
      </label>
      ${this.base?.kind === 'custom' || !this.base ? `
        <input type="text" data-custom-query placeholder="e.g. status:>=400 method:post" value="${escapeHtml(this.base?.kind === 'custom' ? this.base.query : '')}" />
        <button type="button" data-action="apply-custom">Apply</button>` : ''}`;
  }

  private renderConfig(columns: CustomColumn[]): string {
    const fieldOptions = (selectedDefault: string = '') => [
      ...BUILTIN_FIELDS.map(id => `<option value="${id}" ${id === selectedDefault ? 'selected' : ''}>${FIELD_LABELS[id]}</option>`),
      ...columns.map(column => `<option value="custom:${escapeHtml(column.id)}">${escapeHtml(column.label)}</option>`)
    ].join('');
    const chips = (items: string[], action: string, zone?: DragZone) =>
      items.map((item, i) => {
        const drag = zone ? ` draggable="true" data-drag-zone="${zone}" data-index="${i}"` : '';
        return `<span class="pivot-chip"${drag}>${escapeHtml(item)}<button type="button" data-action="${action}" data-index="${i}" aria-label="Remove">×</button></span>`;
      }).join('');
    const valueSourceOptions = [
      ...NUMERIC_SOURCES.map(source => `<option value="${source}">${SOURCE_LABELS[source]}</option>`),
      ...columns.map(column => `<option value="custom:${escapeHtml(column.id)}">${escapeHtml(column.label)}</option>`)
    ].join('');
    const aggregationOptions = AGGREGATIONS.map(a => `<option value="${a}">${AGGREGATION_LABELS[a]}</option>`).join('');
    const rowChips = chips(this.config.rows.map(field => this.fieldLabel(field, columns)), 'remove-row', 'rows');
    const colChips = chips(this.config.columns.map(field => this.fieldLabel(field, columns)), 'remove-col', 'columns');
    const poolChips = this.availableFields(columns)
      .map(field => `<span class="pivot-chip" draggable="true" data-drag-zone="available" data-field="${escapeHtml(field)}">${escapeHtml(this.fieldLabel(field, columns))}</span>`)
      .join('');
    const valueChips = chips(this.config.values.map(value => this.valueLabel(value, columns)), 'remove-value', 'values');
    const filterChips = chips(this.config.filters.map(f => this.filterLabel(f, columns)), 'remove-filter');

    return `
      <div class="pivot-zones">
        <div class="pivot-zone">
          <div class="pivot-zone-title">Filter</div>
          <div class="pivot-zone-add">
            <select data-add="filter-field" data-change="filter-field">${fieldOptions()}</select>
            <input type="text" data-add="filter-values" placeholder="values, comma separated" />
            <select data-add="filter-side" hidden>
              ${PIVOT_SIDES.map(side => `<option value="${side}">${side}</option>`).join('')}
            </select>
            <button type="button" data-action="add-filter">Add</button>
          </div>
          <div class="pivot-chips">${filterChips}</div>
        </div>
        <div class="pivot-rc">
          <div class="pivot-available" data-drop-zone="available">
            <div class="pivot-zone-title">Attributes</div>
            <div class="pivot-chips">${poolChips || '<span class="pivot-hint">All attributes are in use.</span>'}</div>
          </div>
          <div class="pivot-rc-zones">
            <div class="pivot-zone" data-drop-zone="rows">
              <div class="pivot-zone-title">Rows</div>
              <div class="pivot-chips">${rowChips}</div>
            </div>
            <div class="pivot-zone" data-drop-zone="columns">
              <div class="pivot-zone-title">Columns</div>
              <div class="pivot-chips">${colChips}</div>
            </div>
          </div>
        </div>
        <div class="pivot-zone" data-drop-zone="values">
          <div class="pivot-zone-title">Values</div>
          <div class="pivot-zone-add">
            <select data-add="value-source">${valueSourceOptions}</select>
            <select data-add="value-agg">${aggregationOptions}</select>
            <input type="text" data-add="value-rules" placeholder="conversions, e.g. -1 => empty" />
            <button type="button" data-action="add-value">Add</button>
          </div>
          <div class="pivot-chips">${valueChips}</div>
          <label class="pivot-heatmap"><input type="checkbox" data-change="heatmap" ${this.config.heatmap ? 'checked' : ''}/> Heatmap</label>
        </div>
      </div>`;
  }

  private renderBody(columns: CustomColumn[]): string {
    if (!this.base) return '<div class="pivot-empty">Choose a base set to build the pivot.</div>';
    if (!this.computed) return '<div class="pivot-empty">Computing…</div>';
    const { result } = this.computed;
    if (result.values.length === 0) return '<div class="pivot-empty">Add at least one value field.</div>';
    const limit = pivotLimitMessage(result);
    if (limit) return `<div class="pivot-empty">${escapeHtml(limit)}</div>`;
    const colSpan = result.values.length;
    const rowFieldLabel = this.config.rows.map(field => this.fieldLabel(field, columns)).join(' › ') || 'Rows';
    const colFieldLabel = this.config.columns.map(field => this.fieldLabel(field, columns)).join(' › ') || 'Columns';

    const headerTop = `<tr><th rowspan="2" class="pivot-corner">${escapeHtml(rowFieldLabel)} ↓ / ${escapeHtml(colFieldLabel)} →</th>${result.columns
      .map((col, c) => `<th colspan="${colSpan}" class="${col.depth === 0 ? 'pivot-total' : ''}" data-col="${c}">${escapeHtml(this.pathLabel(col.path, col.depth))}</th>`)
      .join('')}</tr>`;
    const headerValues = `<tr>${result.columns
      .map(() => result.values.map(value => `<th class="pivot-value-head">${escapeHtml(this.valueLabel(value, columns))}</th>`).join(''))
      .join('')}</tr>`;

    const isExpanded = (path: string[]) => isRowExpanded(path, this.rowToggles, this.config.rows);
    const bodyRows = result.rows.map((row, r) => {
      const cells = result.columns.flatMap((col, c) =>
        result.values.map((value, v) => {
          const aggregated = result.cells.get(cellKey(row.path, col.path, v)) ?? null;
          const range = result.ranges[v]!;
          const color = this.config.heatmap ? heatmapColor(aggregated, range, this.config.heatmap) : undefined;
          const selected = this.selectedCell?.row === r && this.selectedCell?.col === c ? ' pivot-selected' : '';
          const style = color ? ` style="background:${color}"` : '';
          const isTotal = row.depth === 0 || col.depth === 0 ? ' pivot-total' : '';
          const formatted = this.formatValue(aggregated, value);
          const excludeButton = `<button type="button" class="pivot-exclude" data-action="exclude-cell" data-row="${r}" data-col="${c}" title="Exclude these requests" aria-label="Exclude these requests"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4.5 6.5h4" stroke="currentColor" stroke-width="1.4"/></svg></button>`;
          const includeButton = `<button type="button" class="pivot-include" data-action="include-cell" data-row="${r}" data-col="${c}" title="Show only these requests" aria-label="Show only these requests"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" stroke-width="1.4"/></svg></button>`;
          const heatmapInfo = this.config.heatmap ? this.heatmapTooltip(aggregated, range, value) : undefined;
          const stats = result.stats.get(cellKey(row.path, col.path, v));
          const statsInfo = stats ? this.statsTooltip(stats, value, result.baseCount) : undefined;
          const title = [formatted.title, heatmapInfo, statsInfo].filter(Boolean).join('\n');
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
          return `<td class="pivot-cell${isTotal}${selected}" data-cell-row="${r}" data-cell-col="${c}" data-value="${v}"${style}${titleAttr}>${escapeHtml(formatted.text)}${excludeButton}${includeButton}</td>`;
        })
      );
      const hasChildren = row.depth > 0 && row.depth < this.config.rows.length;
      const expanded = isExpanded(row.path);
      const toggle = hasChildren
        ? `<button type="button" class="pivot-toggle" data-action="toggle-row" data-row="${r}" aria-expanded="${expanded}" aria-label="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>`
        : row.depth === 0
          ? `<button type="button" class="pivot-collapse-all" data-action="collapse-all" title="Collapse all row groups" aria-label="Collapse all row groups"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 6.5L8 2l4.5 4.5M3.5 13L8 8.5 12.5 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="pivot-collapse-all" data-action="expand-all" title="Expand all row groups" aria-label="Expand all row groups"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.5 3.5L8 8l4.5-4.5M3.5 10L8 14.5 12.5 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
          : '<span class="pivot-toggle-spacer"></span>';
      const hidden = isRowVisible(row.path, isExpanded) ? '' : ' hidden';
      return `<tr data-row="${r}"${hidden}><th class="pivot-row-head${row.depth === 0 ? ' pivot-total' : ''}" style="padding-left:${8 + row.depth * 14}px">${toggle}<span class="pivot-row-label" title="${escapeHtml(this.pathLabel(row.path, row.depth))}">${escapeHtml(this.pathLabel(row.path, row.depth))}</span></th>${cells.join('')}</tr>`;
    });

    return `<div class="pivot-table-wrap">
      <div class="pivot-meta">Base set: ${result.baseCount} request/response rows after the filter zone</div>
      <table class="pivot-table"><thead>${headerTop}${headerValues}</thead><tbody>${bodyRows.join('')}</tbody></table>
    </div>`;
  }

  private renderCellInfo(columns: CustomColumn[]): string {
    if (!this.computed || !this.selectedCell) return 'Click a cell to see the filter that selects its requests.';
    const { result } = this.computed;
    const row = result.rows[this.selectedCell.row];
    const col = result.columns[this.selectedCell.col];
    if (!row || !col) return '';
    const query = cellFilterQuery(this.config.rows, row.path, this.config.columns, col.path);
    if (query === null) return 'This cell cannot be turned into a filter (custom columns and empty values are not supported).';
    return `Filter: <code>${escapeHtml(query || '(all requests)')}</code> <button type="button" data-action="copy-filter">Copy filter</button>`;
  }

  private pathLabel(path: string[], depth: number): string {
    if (depth === 0) return 'Total';
    return path[path.length - 1] ?? '';
  }

  private fieldLabel(field: PivotFieldId, columns: CustomColumn[]): string {
    if (field.startsWith('custom:')) {
      const column = columns.find(c => c.id === field.slice('custom:'.length));
      return column ? column.label : field;
    }
    return FIELD_LABELS[field] ?? field;
  }

  private valueLabel(value: ValueField, columns: CustomColumn[]): string {
    const source = value.source.startsWith('custom:')
      ? columns.find(c => c.id === value.source.slice('custom:'.length))?.label ?? value.source
      : SOURCE_LABELS[value.source] ?? value.source;
    return `${AGGREGATION_LABELS[value.aggregation]} of ${source}`;
  }

  // Heatmap detail for the cell tooltip: where the value sits between the
  // scale's min and max, with those bounds for reference.
  // Full-precision statistics of a cell, for the title tooltip.
  private statsTooltip(stats: CellStatistics, field: ValueField, baseCount: number): string {
    const unit = valueUnit(field);
    const suffix = unit === 'duration' ? ' ms' : unit === 'bytes' ? ' B' : '';
    const num = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}${suffix}`);
    const share = stats.baseShare === null ? '—' : `${stats.baseShare.toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
    return [
      'Statistics:',
      `  Rows: ${stats.entries} (${share} of ${baseCount} split rows)`,
      `  Numeric values: ${stats.numeric} of ${stats.entries}`,
      `  Distinct: ${stats.distinct}`,
      `  Sum: ${num(stats.sum)}`,
      `  Min: ${num(stats.min)}`,
      `  Max: ${num(stats.max)}`,
      `  Average: ${num(stats.avg)}`,
      `  50th percentile (median): ${num(stats.median)}`,
      `  75th percentile: ${num(stats.p75)}`,
      `  90th percentile: ${num(stats.p90)}`,
      `  95th percentile: ${num(stats.p95)}`,
      `  99th percentile: ${num(stats.p99)}`,
      `  Std dev: ${num(stats.stddev)}`
    ].join('\n');
  }

  private heatmapTooltip(value: number | null, range: { min: number; max: number }, field: ValueField): string | undefined {
    const position = heatmapPosition(value, range);
    if (position === null) return undefined;
    if (range.max <= range.min) {
      return `Heatmap: all values equal (min and max ${this.formatValue(range.min, field).text})`;
    }
    const pct = (position * 100).toFixed(1);
    const min = this.formatValue(range.min, field).text;
    const max = this.formatValue(range.max, field).text;
    return `Heatmap: ${pct}% of scale (min ${min}, max ${max})`;
  }

  private formatValue(value: number | null, field: ValueField): { text: string; title?: string } {
    if (value === null) return { text: '—' };
    if (field.aggregation === 'percentOfTotal') return { text: `${value.toFixed(1)}%` };
    const unit = valueUnit(field);
    if (unit === 'duration') {
      return { text: formatter.formatDuration(value), title: `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ms` };
    }
    if (unit === 'bytes') {
      return { text: formatter.formatBytes(value), title: formatter.formatBytesExact(value) };
    }
    if (Number.isInteger(value)) return { text: String(value) };
    return { text: value.toFixed(2) };
  }

  private async recompute(): Promise<void> {
    const runId = ++this.runId;
    const store = this.options.getStore();
    if (store) this.options.onStateChange(this.state());
    if (!store || !this.base) {
      this.computed = null;
      return;
    }
    if (this.config.values.length === 0) {
      this.computed = null;
      this.render();
      return;
    }
    try {
      const ids = this.base.kind === 'filter'
        ? await store.idsInScope(this.base.id, '')
        : await store.idsInScope(ROOT_FILTER_ID, this.base.query);
      const baseEntries = await store.getEntries(ids);
      const columns = this.options.getCustomColumns();
      const records = this.applyFilterZone(baseEntries.flatMap(splitEntry), columns);
      if (runId !== this.runId) return;
      const result = buildPivot(records, this.config, columns);
      this.computed = { result };
    } catch (error) {
      if (runId !== this.runId) return;
      this.computed = null;
      this.options.showMessage(error instanceof Error ? error.message : 'Could not build the pivot.');
    }
    if (runId === this.runId) this.render();
  }

  // Records that pass every Filter zone entry (see recordPassesFilters).
  private applyFilterZone(records: PivotRecord[], columns: CustomColumn[]): PivotRecord[] {
    if (this.config.filters.length === 0) return records;
    return records.filter(record => recordPassesFilters(record, this.config.filters, columns));
  }

  private filterLabel(filter: PivotFilter, columns: CustomColumn[]): string {
    const term = (f: FieldFilter) => `${this.fieldLabel(f.field, columns)} = ${f.values.join(', ')}`;
    return isExclusionFilter(filter) ? `NOT ${filter.exclude.map(term).join(' and ')}` : term(filter);
  }

  // Terms of one cell's row and column values, or null when no cell matches.
  private cellTermsAt(rowIndex: number, colIndex: number): FieldFilter[] | null {
    if (!this.computed) return null;
    const { result } = this.computed;
    const row = result.rows[rowIndex];
    const col = result.columns[colIndex];
    if (!row || !col) return null;
    return cellTerms(this.config.rows, row.path, this.config.columns, col.path);
  }

  private excludeCell(rowIndex: number, colIndex: number): void {
    const terms = this.cellTermsAt(rowIndex, colIndex);
    if (!terms) return;
    if (terms.length === 0) {
      this.options.showMessage('The grand total cannot be excluded.');
      return;
    }
    this.config.filters = [...this.config.filters, { exclude: terms }];
    this.selectedCell = null;
    this.render();
    void this.recompute();
  }

  // Each term is its own include filter, so the terms combine with AND.
  private includeCell(rowIndex: number, colIndex: number): void {
    const terms = this.cellTermsAt(rowIndex, colIndex);
    if (!terms) return;
    if (terms.length === 0) {
      this.options.showMessage('The grand total cannot be filtered to one cell.');
      return;
    }
    this.config.filters = [...this.config.filters, ...terms];
    this.selectedCell = null;
    this.render();
    void this.recompute();
  }

  private onClick(event: Event): void {
    const target = event.target as HTMLElement;
    const exclude = target.closest<HTMLElement>('[data-action="exclude-cell"]');
    if (exclude) {
      this.excludeCell(Number(exclude.dataset.row), Number(exclude.dataset.col));
      return;
    }
    const include = target.closest<HTMLElement>('[data-action="include-cell"]');
    if (include) {
      this.includeCell(Number(include.dataset.row), Number(include.dataset.col));
      return;
    }
    const cell = target.closest<HTMLElement>('[data-cell-row]');
    if (cell) {
      this.selectedCell = { row: Number(cell.dataset.cellRow), col: Number(cell.dataset.cellCol) };
      this.render();
      return;
    }
    const button = target.closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action!;
    const index = Number(button.dataset.index);
    const select = (name: string) => this.root.querySelector<HTMLSelectElement>(`[data-add="${name}"]`)?.value ?? '';
    const input = (name: string) => this.root.querySelector<HTMLInputElement>(`[data-add="${name}"]`)?.value ?? '';

    switch (action) {
      case 'close':
        this.close();
        return;
      case 'apply-custom':
        this.applyCustomQuery();
        return;
      case 'remove-row':
        this.config.rows = this.config.rows.filter((_, i) => i !== index);
        break;
      case 'remove-col':
        this.config.columns = this.config.columns.filter((_, i) => i !== index);
        break;
      case 'add-filter': {
        const field = select('filter-field') as PivotFieldId;
        const values = field === 'side'
          ? [select('filter-side')]
          : input('filter-values').split(',').map(v => v.trim()).filter(Boolean);
        if (values.length === 0) return;
        this.config.filters = [...this.config.filters, { field, values }];
        break;
      }
      case 'remove-filter':
        this.config.filters = this.config.filters.filter((_, i) => i !== index);
        break;
      case 'add-value': {
        const value: ValueField = {
          source: select('value-source') as ValueSource,
          aggregation: select('value-agg') as Aggregation,
          conversions: parseConversions(input('value-rules'))
        };
        this.config.values = [...this.config.values, value];
        break;
      }
      case 'remove-value':
        this.config.values = this.config.values.filter((_, i) => i !== index);
        break;
      case 'toggle-row': {
        const row = this.computed?.result.rows[Number(button.dataset.row)];
        if (!row) return;
        const key = rowToggleKey(row.path, this.config.rows);
        this.rowToggles.set(key, !isRowExpanded(row.path, this.rowToggles, this.config.rows));
        this.applyRowVisibility();
        return;
      }
      case 'collapse-all':
      case 'expand-all': {
        if (!this.computed) return;
        const expanded = action === 'expand-all';
        for (const row of this.computed.result.rows) {
          if (row.depth > 0 && row.depth < this.config.rows.length) this.rowToggles.set(rowToggleKey(row.path, this.config.rows), expanded);
        }
        this.applyRowVisibility();
        return;
      }
      case 'copy-json':
        void this.copyJson();
        return;
      case 'copy-filter':
        void this.copyFilter();
        return;
      default:
        return;
    }
    this.selectedCell = null;
    this.render();
    void this.recompute();
  }

  private onChange(event: Event): void {
    const target = event.target as HTMLElement;
    const kind = target.dataset.change;
    if (kind === 'base') {
      const value = (target as HTMLSelectElement).value;
      if (value === 'custom') {
        this.base = { kind: 'custom', query: '' };
        this.computed = null;
        this.render();
        this.root.querySelector<HTMLInputElement>('[data-custom-query]')?.focus();
        return;
      }
      if (!value.startsWith('f:')) return;
      this.base = { kind: 'filter', id: Number(value.slice(2)) };
      this.message = '';
      this.selectedCell = null;
      this.render();
      void this.recompute();
      return;
    }
    if (kind === 'filter-field') {
      this.syncFilterInputs();
      return;
    }
    if (kind === 'heatmap') {
      this.config.heatmap = (target as HTMLInputElement).checked ? { ...DEFAULT_HEATMAP } : null;
      this.render();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-custom-query]')) {
      this.applyCustomQuery();
    }
  }

  private applyCustomQuery(): void {
    const query = this.root.querySelector<HTMLInputElement>('[data-custom-query]')?.value.trim() ?? '';
    if (!query) {
      this.options.showMessage('Enter a filter expression first.', 'info');
      return;
    }
    this.base = { kind: 'custom', query };
    this.selectedCell = null;
    this.render();
    void this.recompute();
  }

  private async copyJson(): Promise<void> {
    const payload = { version: 1, base: this.base, config: this.config };
    await this.copyText(JSON.stringify(payload, null, 2), 'Pivot definition copied as JSON.');
  }

  private async copyFilter(): Promise<void> {
    if (!this.computed || !this.selectedCell) return;
    const row = this.computed.result.rows[this.selectedCell.row];
    const col = this.computed.result.columns[this.selectedCell.col];
    if (!row || !col) return;
    const query = cellFilterQuery(this.config.rows, row.path, this.config.columns, col.path);
    if (query === null) return;
    await this.copyText(query, 'Filter copied to the clipboard.');
  }

  private async copyText(text: string, success: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.options.showMessage(success, 'info');
    } catch {
      this.options.showMessage('Could not write to the clipboard.');
    }
  }
}

// Parses "from => to, from => to" conversion rules; "empty" means ignored.
export function parseConversions(text: string): ConversionRule[] {
  return text
    .split(',')
    .map(part => part.split('=>'))
    .filter(parts => parts.length === 2 && parts[0]!.trim() !== '')
    .flatMap(([from, to]): ConversionRule[] => {
      const target = to!.trim();
      if (target === 'empty' || target === '') return [{ from: from!.trim(), to: null }];
      const numeric = Number(target);
      return Number.isFinite(numeric) ? [{ from: from!.trim(), to: numeric }] : [];
    });
}
