import { HarParser } from '../utils/harParser.js';

export class UIManager {
  constructor() {
    this.harParser = new HarParser();
  }

  displayFileInfo(fileName, fileSize) {
    const fileInfoDiv = document.getElementById('file-info');
    const formattedSize = this.harParser.formatBytes(fileSize);
    fileInfoDiv.textContent = `Loaded: ${fileName} (${formattedSize})`;
  }

  showHarContent() {
    document.querySelector('.upload-section').style.display = 'none';
    document.getElementById('har-content').classList.remove('hidden');
  }

  showErrorMessage(message) {
    // Create or update error message element
    let errorDiv = document.getElementById('error-message');
    if (!errorDiv) {
      errorDiv = document.createElement('div');
      errorDiv.id = 'error-message';
      errorDiv.style.cssText = `
        color: #e74c3c;
        background-color: #fdeded;
        border: 1px solid #e74c3c;
        border-radius: 4px;
        padding: 1rem;
        margin: 1rem 0;
      `;
      document.querySelector('main').prepend(errorDiv);
    }
    errorDiv.textContent = message;

    // Hide after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 5000);
  }

  renderRequestList(entries) {
    const tableBody = document.getElementById('requests-table-body');
    tableBody.innerHTML = '';

    entries.forEach(entry => {
      const row = document.createElement('tr');
      row.dataset.entryId = entry.id;

      // Format data for display
      const statusCode = entry.response.status;
      const statusClass = statusCode >= 200 && statusCode < 300 ? 'status-success' :
                         statusCode >= 400 ? 'status-error' : '';

      const mimeType = entry.response.content.mimeType || '';
      const contentType = this.harParser.getContentType(mimeType);

      const.contentSize = entry.response.bodySize >= 0 ?
                         this.harParser.formatBytes(entry.response.bodySize) : 'N/A';

      const totalTime = this.harParser.formatTime(entry.time);

      row.innerHTML = `
        <td>${entry.id + 1}</td>
        <td>${entry.request.method}</td>
        <td class="url-cell">${this.truncateUrl(entry.request.url, 50)}</td>
        <td class="${statusClass}">${statusCode}</td>
        <td>${contentType}</td>
        <td>${contentSize}</td>
        <td>${totalTime}</td>
      `;

      tableBody.appendChild(row);
    });
  }

  setupRequestDetailsHandler(entries) {
    const tableRows = document.querySelectorAll('#requests-table-body tr');

    tableRows.forEach(row => {
      row.addEventListener('click', () => {
        // Highlight selected row
        tableRows.forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');

        // Get entry ID and find corresponding entry
        const entryId = parseInt(row.dataset.entryId);
        const entry = entries.find(e => e.id === entryId);

        if (entry) {
          this.displayRequestDetails(entry);
        }
      });
    });
  }

  displayRequestDetails(entry) {
    const detailsContainer = document.getElementById('request-details');

    // Format request headers
    const requestHeaders = entry.request.headers.map(header =>
      `<div><strong>${header.name}:</strong> ${header.value}</div>`
    ).join('');

    // Format response headers
    const responseHeaders = entry.response.headers.map(header =>
      `<div><strong>${header.name}:</strong> ${header.value}</div>`
    ).join('');

    // Format response content (truncate if too long)
    let responseContent = entry.response.content.text || '';
    if (responseContent.length > 10000) {
      responseContent = responseContent.substring(0, 10000) + '\n\n... (content truncated)';
    }

    detailsContainer.innerHTML = `
      <div class="tabs">
        <div class="tab active" data-tab="headers">Headers</div>
        <div class="tab" data-tab="response">Response</div>
        <div class="tab" data-tab="timings">Timings</div>
      </div>

      <div class="tab-content active" id="headers-content">
        <h3>Request Headers</h3>
        <div class="headers-list">${requestHeaders || '<p>No request headers</p>'}</div>

        <h3>Response Headers</h3>
        <div class="headers-list">${responseHeaders || '<p>No response headers</p>'}</div>
      </div>

      <div class="tab-content" id="response-content">
        <h3>Response Body</h3>
        <pre>${this.escapeHtml(responseContent || 'No response body')}</pre>
      </div>

      <div class="tab-content" id="timings-content">
        <h3>Request Timings</h3>
        <div class="timings-list">
          <div><strong>Started:</strong> ${entry.startedDateTime}</div>
          <div><strong>Total Time:</strong> ${this.harParser.formatTime(entry.time)}</div>
          ${entry.timings ? `
            <div><strong>Blocked:</strong> ${entry.timings.blocked ? this.harParser.formatTime(entry.timings.blocked) : 'N/A'}</div>
            <div><strong>DNS:</strong> ${entry.timings.dns ? this.harParser.formatTime(entry.timings.dns) : 'N/A'}</div>
            <div><strong>Connect:</strong> ${entry.timings.connect ? this.harParser.formatTime(entry.timings.connect) : 'N/A'}</div>
            <div><strong>Send:</strong> ${entry.timings.send ? this.harParser.formatTime(entry.timings.send) : 'N/A'}</div>
            <div><strong>Wait:</strong> ${entry.timings.wait ? this.harParser.formatTime(entry.timings.wait) : 'N/A'}</div>
            <div><strong>Receive:</strong> ${entry.timings.receive ? this.harParser.formatTime(entry.timings.receive) : 'N/A'}</div>
            <div><strong>SSL:</strong> ${entry.timings.ssl ? this.harParser.formatTime(entry.timings.ssl) : 'N/A'}</div>
          ` : '<p>No timing information available</p>'}
        </div>
      </div>
    `;

    // Add tab switching functionality
    this.setupTabSwitching();
  }

  setupTabSwitching() {
    const tabs = document.querySelectorAll('.tab');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs and content
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Add active class to clicked tab
        tab.classList.add('active');

        // Show corresponding content
        const tabName = tab.dataset.tab;
        const contentElement = document.getElementById(`${tabName}-content`);
        if (contentElement) {
          contentElement.classList.add('active');
        }
      });
    });
  }

  truncateUrl(url, maxLength) {
    if (url.length <= maxLength) return url;

    // Try to keep the domain and path
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname;
      const search = urlObj.search;

      if (domain.length + path.length <= maxLength - 10) {
        return `${urlObj.protocol}//${domain}${path}${search}`.substring(0, maxLength) + '...';
      } else if (domain.length <= maxLength - 10) {
        return `${urlObj.protocol}//${domain}/...`.substring(0, maxLength) + '...';
      } else {
        return url.substring(0, maxLength) + '...';
      }
    } catch (e) {
      // If URL parsing fails, just truncate
      return url.substring(0, maxLength) + '...';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}