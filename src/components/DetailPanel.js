// Right-hand panel: shows the selected entry split into a Request side and
// a Response side. Each side has its own Headers / Raw / Cookies / Syntax
// tabs, mirroring Fiddler's Inspectors layout.
import { HarParser } from '../utils/harParser.js';
import { escapeHtml } from '../utils/domUtils.js';
import { buildRawRequest, buildRawResponse, highlightSyntax } from '../utils/httpFormatter.js';
import { makeResizer } from '../utils/resizer.js';

const SUB_TABS = [
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'Raw' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'syntax', label: 'Syntax' }
];

export class DetailPanel {
  constructor() {
    this.harParser = new HarParser();
    this.containerEl = document.getElementById('detail-panel');
    this.emptyStateEl = document.getElementById('detail-empty-state');
    this.contentEl = document.getElementById('detail-content');

    // Remembers the active sub-tab per side so re-selecting a request keeps
    // the user's place (e.g. stay on "Raw" while clicking through rows).
    this.activeSubTab = { request: 'headers', response: 'headers' };
  }

  showEmptyState() {
    this.emptyStateEl.classList.remove('hidden');
    this.contentEl.classList.add('hidden');
  }

  render(entry) {
    this.emptyStateEl.classList.add('hidden');
    this.contentEl.classList.remove('hidden');

    // The Syntax tab only makes sense when there's a body to highlight;
    // fall back to Headers if the previously active tab no longer applies.
    ['request', 'response'].forEach(side => {
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

  hasBody(side, entry) {
    if (side === 'request') {
      return Boolean(entry.request.postData && entry.request.postData.text);
    }
    return Boolean(entry.response.content && entry.response.content.text);
  }

  bindDetailSplitter() {
    const columnsEl = this.contentEl.querySelector('#detail-columns');
    const splitterEl = this.contentEl.querySelector('#detail-splitter');
    const requestSideEl = this.contentEl.querySelector('[data-side="request"]');
    if (!columnsEl || !splitterEl || !requestSideEl) return;

    makeResizer({
      splitterEl,
      targetEl: requestSideEl,
      containerEl: columnsEl,
      direction: 'vertical',
      min: 80
    });
  }

  renderSubTabs(side, entry) {
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

  bindSubTabs(entry) {
    ['request', 'response'].forEach(side => {
      const tabsEl = this.contentEl.querySelector(`[data-side-tabs="${side}"]`);
      tabsEl.querySelectorAll('.sub-tab').forEach(tabEl => {
        tabEl.addEventListener('click', () => {
          this.activeSubTab[side] = tabEl.dataset.subTab;
          tabsEl.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
          tabEl.classList.add('active');
          this.renderSidePanel(side, entry);
        });
      });
    });
  }

  renderSidePanel(side, entry) {
    const panelEl = this.contentEl.querySelector(`[data-side-panels="${side}"]`);
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

  renderHeaders(headers) {
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

  renderCookies(cookies) {
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

  renderRaw(side, entry) {
    const raw = side === 'request' ? buildRawRequest(entry) : buildRawResponse(entry);
    return `<pre class="raw-view">${escapeHtml(raw)}</pre>`;
  }

  renderSyntax(side, entry) {
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
