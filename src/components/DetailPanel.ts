// Right-hand panel: shows either a single selected entry split into Request
// / Response sides, or - when multiple rows are multi-selected in the
// request table - an aggregate view with Timeline (waterfall) and Stats
// tabs, mirroring Fiddler's single-inspector and "Statistics" views.
import { HarParser } from '../utils/harParser.js';
import { escapeHtml } from '../utils/domUtils.js';
import { buildRawRequest, buildRawResponse, highlightSyntax } from '../utils/httpFormatter.js';
import { makeResizer } from '../utils/resizer.js';
import { computeAggregateStats } from '../utils/aggregateStats.js';
import type { HarHeader, HarCookie, ParsedEntry } from '../types/har.js';

type Side = 'request' | 'response';
type SubTabKey = 'headers' | 'raw' | 'cookies' | 'syntax';
type AggregateTabKey = 'timeline' | 'stats';

interface SubTab {
  key: SubTabKey;
  label: string;
}

const SUB_TABS: SubTab[] = [
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'Raw' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'syntax', label: 'Syntax' }
];

// One segment of the waterfall bar per Fiddler's Timeline documentation
// (https://www.telerik.com/fiddler/fiddler-classic/documentation/knowledge-base/timeline).
const TIMELINE_PHASES: { key: keyof ParsedEntry['timings']; label: string; className: string }[] = [
  { key: 'blocked', label: 'Blocked', className: 'phase-blocked' },
  { key: 'dns', label: 'DNS Lookup', className: 'phase-dns' },
  { key: 'connect', label: 'Connect', className: 'phase-connect' },
  { key: 'ssl', label: 'SSL/TLS', className: 'phase-ssl' },
  { key: 'send', label: 'Send', className: 'phase-send' },
  { key: 'wait', label: 'Wait (TTFB)', className: 'phase-wait' },
  { key: 'receive', label: 'Receive', className: 'phase-receive' }
];

// Pixels per tick step when the fixed time scale is enabled, i.e. every
// "nice" tick interval is always this many pixels wide regardless of how
// long the overall selection spans - longer selections simply get wider
// (horizontally scrollable) timelines instead of being squeezed to fit.
const FIXED_SCALE_PX_PER_TICK = 120;

export class DetailPanel {
  private harParser: HarParser;
  private containerEl: HTMLElement;
  private emptyStateEl: HTMLElement;
  private contentEl: HTMLElement;
  private activeSubTab: Record<Side, SubTabKey>;
  private activeAggregateTab: AggregateTabKey;
  private fixedTimelineScale: boolean;

  constructor() {
    this.harParser = new HarParser();
    this.containerEl = document.getElementById('detail-panel')!;
    this.emptyStateEl = document.getElementById('detail-empty-state')!;
    this.contentEl = document.getElementById('detail-content')!;

    // Remembers the active sub-tab per side so re-selecting a request keeps
    // the user's place (e.g. stay on "Raw" while clicking through rows).
    this.activeSubTab = { request: 'headers', response: 'headers' };
    this.activeAggregateTab = 'timeline';
    this.fixedTimelineScale = false;
  }

  showEmptyState(): void {
    this.emptyStateEl.classList.remove('hidden');
    this.contentEl.classList.add('hidden');
  }

  render(entry: ParsedEntry): void {
    this.emptyStateEl.classList.add('hidden');
    this.contentEl.classList.remove('hidden');

    // The Syntax tab only makes sense when there's a body to highlight;
    // fall back to Headers if the previously active tab no longer applies.
    (['request', 'response'] as const).forEach(side => {
      if (this.activeSubTab[side] === 'syntax' && !this.hasBody(side, entry)) {
        this.activeSubTab[side] = 'headers';
      }
    });

    this.contentEl.innerHTML = `
      <div class="detail-summary">
        <span class="summary-method">${escapeHtml(entry.request.method)}</span>
        <span class="summary-url" title="${escapeHtml(entry.request.url)}">${escapeHtml(entry.request.url)}</span>
        <span class="summary-status">${entry.response.status} ${escapeHtml(entry.response.statusText)}</span>
      </div>
      <div class="detail-columns" id="detail-columns">
        <section class="detail-side" data-side="request">
          <h3>Request</h3>
          ${this.renderSubTabs('request', entry)}
          <div class="sub-tab-panels" data-side-panels="request"></div>
        </section>
        <div id="detail-splitter" class="splitter splitter-horizontal"></div>
        <section class="detail-side" data-side="response">
          <h3>Response</h3>
          ${this.renderSubTabs('response', entry)}
          <div class="sub-tab-panels" data-side-panels="response"></div>
        </section>
      </div>
    `;

    this.bindSubTabs(entry);
    this.renderSidePanel('request', entry);
    this.renderSidePanel('response', entry);
    this.bindDetailSplitter();
  }

  // Renders the aggregate (Timeline/Stats) view for 2+ selected entries.
  renderMultiSelect(entries: ParsedEntry[]): void {
    this.emptyStateEl.classList.add('hidden');
    this.contentEl.classList.remove('hidden');

    this.contentEl.innerHTML = `
      <div class="detail-summary">
        <span class="summary-method">${entries.length} requests selected</span>
      </div>
      <div class="sub-tabs aggregate-tabs-row" data-aggregate-tabs>
        ${(['timeline', 'stats'] as AggregateTabKey[]).map(key => `
          <div class="sub-tab ${key === this.activeAggregateTab ? 'active' : ''}" data-aggregate-tab="${key}">
            ${key === 'timeline' ? 'Timeline' : 'Stats'}
          </div>
        `).join('')}
        <label class="timeline-scale-toggle ${this.activeAggregateTab === 'timeline' ? '' : 'hidden'}" data-timeline-scale-toggle>
          <input type="checkbox" id="timeline-fixed-scale" ${this.fixedTimelineScale ? 'checked' : ''} />
          Fixed time scale
        </label>
      </div>
      <div class="aggregate-panel" data-aggregate-panel></div>
    `;

    this.bindAggregateTabs(entries);
    this.renderAggregatePanel(entries);
  }

  private bindAggregateTabs(entries: ParsedEntry[]): void {
    const tabsEl = this.contentEl.querySelector<HTMLElement>('[data-aggregate-tabs]')!;
    const scaleToggleEl = this.contentEl.querySelector<HTMLElement>('[data-timeline-scale-toggle]')!;
    tabsEl.querySelectorAll<HTMLElement>('.sub-tab').forEach(tabEl => {
      tabEl.addEventListener('click', () => {
        this.activeAggregateTab = tabEl.dataset.aggregateTab as AggregateTabKey;
        tabsEl.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
        scaleToggleEl.classList.toggle('hidden', this.activeAggregateTab !== 'timeline');
        this.renderAggregatePanel(entries);
      });
    });

    const scaleCheckboxEl = scaleToggleEl.querySelector<HTMLInputElement>('#timeline-fixed-scale')!;
    scaleCheckboxEl.addEventListener('change', () => {
      this.fixedTimelineScale = scaleCheckboxEl.checked;
      this.renderAggregatePanel(entries);
    });
  }

  private renderAggregatePanel(entries: ParsedEntry[]): void {
    const panelEl = this.contentEl.querySelector<HTMLElement>('[data-aggregate-panel]')!;
    panelEl.innerHTML = this.activeAggregateTab === 'timeline'
      ? this.renderTimeline(entries)
      : this.renderStats(entries);
  }

  private renderTimeline(entries: ParsedEntry[]): string {
    if (!entries.length) return '<p class="empty-note">No requests selected</p>';

    const starts = entries.map(e => e.startedTimeMs).filter(Number.isFinite);
    const ends = entries.map(e => e.startedTimeMs + Math.max(e.time, 0)).filter(Number.isFinite);
    const rangeStart = starts.length ? Math.min(...starts) : 0;
    const rangeEnd = ends.length ? Math.max(...ends) : rangeStart + 1;
    const rangeMs = Math.max(rangeEnd - rangeStart, 1);
    const step = this.pickNiceTickStep(rangeMs);

    // Auto mode fits the whole range into 100% width (percentage-based
    // positioning); fixed mode gives every tick a constant pixel width, so
    // longer selections produce a wider (horizontally scrollable) track.
    const tickCount = Math.ceil(rangeMs / step);
    const trackWidthPx = this.fixedTimelineScale ? tickCount * FIXED_SCALE_PX_PER_TICK : null;
    const unit = (ms: number): string => trackWidthPx != null
      ? `${(ms / rangeMs) * trackWidthPx}px`
      : `${(ms / rangeMs) * 100}%`;

    const rows = entries.map(entry => {
      const offsetMs = Number.isFinite(entry.startedTimeMs) ? entry.startedTimeMs - rangeStart : 0;
      const totalPhaseMs = TIMELINE_PHASES.reduce((sum, phase) => sum + entry.timings[phase.key], 0);
      // Requests without detailed phase timings (e.g. synthetic/sample data)
      // still get a single bar sized to the overall request time.
      const effectivePhases = totalPhaseMs > 0
        ? TIMELINE_PHASES.map(phase => ({ ...phase, ms: entry.timings[phase.key] }))
        : [{ key: 'wait' as const, label: 'Duration', className: 'phase-wait', ms: entry.time }];
      const barWidthMs = Math.max(entry.time, totalPhaseMs, 0.001);
      const rowTooltip = this.buildTimelineRowTooltip(entry);

      const segments = effectivePhases
        .filter(phase => phase.ms > 0)
        .map(phase => `<span class="timeline-segment ${phase.className}" style="width:${unit(phase.ms)}" title="${rowTooltip}"></span>`)
        .join('');

      return `
        <div class="timeline-row">
          <div class="timeline-label" title="${rowTooltip}">
            <span class="timeline-method">${escapeHtml(entry.request.method)}</span>
            ${escapeHtml(entry.path || entry.request.url)}
          </div>
          <div class="timeline-track" style="${trackWidthPx != null ? `width:${trackWidthPx}px; flex: none;` : ''}" title="${rowTooltip}">
            ${this.renderTimelineGridLines(rangeMs, step, unit)}
            <div class="timeline-bar" style="left:${unit(offsetMs)}; width:${unit(barWidthMs)}">${segments}</div>
          </div>
          <div class="timeline-duration">${this.harParser.formatTime(entry.time)}</div>
        </div>
      `;
    }).join('');

    const legend = TIMELINE_PHASES.map(phase =>
      `<span class="timeline-legend-item"><span class="timeline-swatch ${phase.className}"></span>${phase.label}</span>`
    ).join('');

    const axisAndRows = `
      ${this.renderTimelineAxis(rangeStart, rangeEnd, rangeMs, step, unit, trackWidthPx)}
      <div class="timeline-rows">${rows}</div>
    `;

    return `
      <div class="timeline-legend">${legend}</div>
      ${trackWidthPx != null ? `<div class="timeline-scroll">${axisAndRows}</div>` : axisAndRows}
    `;
  }

  // Renders the x-axis: absolute clock time at the start/end, and evenly
  // spaced relative offset ticks (e.g. "+100ms") in between, using a
  // "nice" step (1/2/5 x a power of ten) so tick labels don't overlap.
  private renderTimelineAxis(
    rangeStart: number,
    rangeEnd: number,
    rangeMs: number,
    step: number,
    unit: (ms: number) => string,
    trackWidthPx: number | null
  ): string {
    const ticks: string[] = [];
    // Skip ticks too close to either edge so they don't collide with the
    // absolute start/end labels.
    const edgeMarginMs = rangeMs * 0.22;
    for (let offset = step; offset < rangeMs; offset += step) {
      if (offset < edgeMarginMs || rangeMs - offset < edgeMarginMs) continue;
      ticks.push(`<span class="timeline-tick" style="left:${unit(offset)}" data-value="${offset}">${this.harParser.formatTime(offset)}</span>`);
    }

    return `
      <div class="timeline-axis-row">
        <div class="timeline-axis-spacer"></div>
        <div class="timeline-axis" style="${trackWidthPx != null ? `width:${trackWidthPx}px; flex: none;` : ''}">
          <span class="timeline-axis-endpoint timeline-axis-start">${this.harParser.formatClockTime(rangeStart)}</span>
          ${ticks.join('')}
          <span class="timeline-axis-endpoint timeline-axis-end">${this.harParser.formatClockTime(rangeEnd)}</span>
        </div>
        <div class="timeline-axis-spacer timeline-axis-spacer-end"></div>
      </div>
    `;
  }

  // Builds a multi-line plain-text tooltip (native title attribute) for a
  // timeline row: URL, status, per-phase timings and request/response sizes.
  private buildTimelineRowTooltip(entry: ParsedEntry): string {
    const lines = [
      `${entry.request.method} ${entry.request.url}`,
      `Status: ${entry.response.status || 'N/A'} ${entry.response.statusText}`.trim(),
      `Started: ${this.harParser.formatClockTime(entry.startedTimeMs)}`,
      `Total time: ${this.harParser.formatTime(entry.time)}`,
      ''
    ];

    const timingLines = TIMELINE_PHASES
      .filter(phase => entry.timings[phase.key] > 0)
      .map(phase => `  ${phase.label}: ${this.harParser.formatTime(entry.timings[phase.key])}`);
    if (timingLines.length) {
      lines.push('Timings:', ...timingLines, '');
    }

    lines.push(
      'Sizes:',
      `  Request headers: ${this.harParser.formatBytes(entry.request.headersSize)}`,
      `  Request body: ${this.harParser.formatBytes(entry.request.bodySize)}`,
      `  Response headers: ${this.harParser.formatBytes(entry.response.headersSize)}`,
      `  Response body: ${this.harParser.formatBytes(entry.response.bodySize)}`
    );

    return escapeHtml(lines.join('\n'));
  }

  private renderTimelineGridLines(rangeMs: number, step: number, unit: (ms: number) => string): string {
    const lines: string[] = [];
    for (let offset = step; offset < rangeMs; offset += step) {
      lines.push(`<span class="timeline-gridline" style="left:${unit(offset)}"></span>`);
    }
    return lines.join('');
  }

  // Picks a "nice" tick step (1/2/5 * 10^n) targeting ~5-8 ticks across the
  // given range, the standard approach used by chart axis libraries.
  private pickNiceTickStep(rangeMs: number, targetTicks = 6): number {
    if (!Number.isFinite(rangeMs) || rangeMs <= 0) return 1;
    const roughStep = rangeMs / targetTicks;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;

    let niceNormalized: number;
    if (normalized <= 1) niceNormalized = 1;
    else if (normalized <= 2) niceNormalized = 2;
    else if (normalized <= 5) niceNormalized = 5;
    else niceNormalized = 10;

    return niceNormalized * magnitude;
  }

  private renderStats(entries: ParsedEntry[]): string {
    if (!entries.length) return '<p class="empty-note">No requests selected</p>';

    const stats = computeAggregateStats(entries);
    const responseCodeRows = Object.entries(stats.responseCodes)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([code, count]) => `<tr><td>HTTP/${escapeHtml(code)}</td><td>${count}</td></tr>`)
      .join('');
    const responseTypeRows = Object.entries(stats.responseBytesByType)
      .sort(([, a], [, b]) => b - a)
      .map(([type, bytes]) => `<tr><td>${escapeHtml(type)}</td><td>${this.harParser.formatBytes(bytes)}</td></tr>`)
      .join('');

    return `
      <div class="stats-view">
        <table class="stats-table">
          <tbody>
            <tr><td>Request Count:</td><td>${stats.requestCount}</td></tr>
            <tr><td>Bytes Sent:</td><td>${this.harParser.formatBytes(stats.bytesSent.total)}
              <span class="stats-breakdown">(headers: ${this.harParser.formatBytes(stats.bytesSent.headers)}; body: ${this.harParser.formatBytes(stats.bytesSent.body)})</span></td></tr>
            <tr><td>Bytes Received:</td><td>${this.harParser.formatBytes(stats.bytesReceived.total)}
              <span class="stats-breakdown">(headers: ${this.harParser.formatBytes(stats.bytesReceived.headers)}; body: ${this.harParser.formatBytes(stats.bytesReceived.body)})</span></td></tr>
          </tbody>
        </table>

        <h4 class="stats-section-title">Actual Performance</h4>
        <table class="stats-table">
          <tbody>
            <tr><td>Requests started at:</td><td>${this.harParser.formatClockTime(stats.startedAt)}</td></tr>
            <tr><td>Responses completed at:</td><td>${this.harParser.formatClockTime(stats.completedAt)}</td></tr>
            <tr><td>Sequence (clock) duration:</td><td>${this.harParser.formatDurationClock(stats.sequenceDurationMs)}</td></tr>
            <tr><td>Aggregate Session duration:</td><td>${this.harParser.formatDurationClock(stats.aggregateSessionDurationMs)}</td></tr>
          </tbody>
        </table>

        <h4 class="stats-section-title">Response Codes</h4>
        <table class="stats-table">
          <tbody>${responseCodeRows}</tbody>
        </table>

        <h4 class="stats-section-title">Response Bytes (by Content-Type)</h4>
        <table class="stats-table">
          <tbody>${responseTypeRows}</tbody>
        </table>
      </div>
    `;
  }

  private hasBody(side: Side, entry: ParsedEntry): boolean {
    if (side === 'request') {
      return Boolean(entry.request.postData && entry.request.postData.text);
    }
    return Boolean(entry.response.content && entry.response.content.text);
  }

  private bindDetailSplitter(): void {
    const columnsEl = this.contentEl.querySelector<HTMLElement>('#detail-columns');
    const splitterEl = this.contentEl.querySelector<HTMLElement>('#detail-splitter');
    const requestSideEl = this.contentEl.querySelector<HTMLElement>('[data-side="request"]');
    if (!columnsEl || !splitterEl || !requestSideEl) return;

    makeResizer({
      splitterEl,
      targetEl: requestSideEl,
      containerEl: columnsEl,
      direction: 'vertical',
      min: 80
    });
  }

  private renderSubTabs(side: Side, entry: ParsedEntry): string {
    const tabs = SUB_TABS.filter(tab => tab.key !== 'syntax' || this.hasBody(side, entry));
    return `
      <div class="sub-tabs" data-side-tabs="${side}">
        ${tabs.map(tab => `
          <div class="sub-tab ${tab.key === this.activeSubTab[side] ? 'active' : ''}" data-sub-tab="${tab.key}">
            ${tab.label}
          </div>
        `).join('')}
      </div>
    `;
  }

  private bindSubTabs(entry: ParsedEntry): void {
    (['request', 'response'] as const).forEach(side => {
      const tabsEl = this.contentEl.querySelector<HTMLElement>(`[data-side-tabs="${side}"]`)!;
      tabsEl.querySelectorAll<HTMLElement>('.sub-tab').forEach(tabEl => {
        tabEl.addEventListener('click', () => {
          this.activeSubTab[side] = tabEl.dataset.subTab as SubTabKey;
          tabsEl.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
          tabEl.classList.add('active');
          this.renderSidePanel(side, entry);
        });
      });
    });
  }

  private renderSidePanel(side: Side, entry: ParsedEntry): void {
    const panelEl = this.contentEl.querySelector<HTMLElement>(`[data-side-panels="${side}"]`)!;
    const activeTab = this.activeSubTab[side];
    const data = side === 'request' ? entry.request : entry.response;

    switch (activeTab) {
      case 'headers':
        panelEl.innerHTML = this.renderHeaders(data.headers);
        break;
      case 'raw':
        panelEl.innerHTML = this.renderRaw(side, entry);
        break;
      case 'cookies':
        panelEl.innerHTML = this.renderCookies(data.cookies);
        break;
      case 'syntax':
        panelEl.innerHTML = this.renderSyntax(side, entry);
        break;
      default:
        panelEl.innerHTML = '';
    }
  }

  private renderHeaders(headers: HarHeader[] | undefined): string {
    if (!headers || !headers.length) {
      return '<p class="empty-note">No headers</p>';
    }
    const rows = headers.map(h => `
      <tr>
        <td class="header-name">${escapeHtml(h.name)}</td>
        <td class="header-value">${escapeHtml(h.value)}</td>
      </tr>
    `).join('');
    return `
      <table class="headers-table">
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private renderCookies(cookies: HarCookie[] | undefined): string {
    if (!cookies || !cookies.length) {
      return '<p class="empty-note">No cookies</p>';
    }
    const rows = cookies.map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.value)}</td>
        <td>${escapeHtml(c.domain || '')}</td>
        <td>${escapeHtml(c.path || '')}</td>
        <td>${escapeHtml(c.expires || '')}</td>
        <td>${c.httpOnly ? 'Yes' : 'No'}</td>
        <td>${c.secure ? 'Yes' : 'No'}</td>
      </tr>
    `).join('');
    return `
      <table class="headers-table cookies-table">
        <thead>
          <tr>
            <th>Name</th><th>Value</th><th>Domain</th><th>Path</th>
            <th>Expires</th><th>HttpOnly</th><th>Secure</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private renderRaw(side: Side, entry: ParsedEntry): string {
    const raw = side === 'request' ? buildRawRequest(entry) : buildRawResponse(entry);
    return `<pre class="raw-view">${escapeHtml(raw)}</pre>`;
  }

  private renderSyntax(side: Side, entry: ParsedEntry): string {
    if (side === 'request') {
      const postData = entry.request.postData;
      const text = postData ? (postData.text || '') : '';
      const mimeType = postData ? postData.mimeType : '';
      if (!text) return '<p class="empty-note">No request body</p>';
      return `<pre class="syntax-view">${highlightSyntax(text, mimeType)}</pre>`;
    }

    const content = entry.response.content;
    if (!content || !content.text) return '<p class="empty-note">No response body</p>';
    return `<pre class="syntax-view">${highlightSyntax(content.text, content.mimeType)}</pre>`;
  }
}
