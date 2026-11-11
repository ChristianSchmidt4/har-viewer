// Utility class for parsing HAR files
export class HarParser {
  parse(harData) {
    if (!harData || !harData.log) {
      throw new Error('Invalid HAR format: Missing log object');
    }

    const log = harData.log;

    return {
      version: log.version || '1.2',
      creator: log.creator || {},
      browser: log.browser || {},
      pages: log.pages || [],
      entries: this.parseEntries(log.entries || []),
      comment: log.comment || ''
    };
  }

  parseEntries(entries) {
    return entries.map((entry, index) => {
      return {
        id: index,
        startedDateTime: entry.startedDateTime || '',
        time: entry.time || 0,
        request: this.parseRequest(entry.request || {}),
        response: this.parseResponse(entry.response || {}),
        cache: entry.cache || {},
        timings: entry.timings || {},
        serverIPAddress: entry.serverIPAddress || '',
        connection: entry.connection || '',
        comment: entry.comment || ''
      };
    });
  }

  parseRequest(request) {
    return {
      method: request.method || '',
      url: request.url || '',
      httpVersion: request.httpVersion || '',
      cookies: request.cookies || [],
      headers: request.headers || [],
      queryString: request.queryString || [],
      postData: request.postData || {},
      headersSize: request.headersSize || -1,
      bodySize: request.bodySize || -1,
      comment: request.comment || ''
    };
  }

  parseResponse(response) {
    return {
      status: response.status || 0,
      statusText: response.statusText || '',
      httpVersion: response.httpVersion || '',
      cookies: response.cookies || [],
      headers: response.headers || [],
      content: this.parseContent(response.content || {}),
      redirectURL: response.redirectURL || '',
      headersSize: response.headersSize || -1,
      bodySize: response.bodySize || -1,
      comment: response.comment || ''
    };
  }

  parseContent(content) {
    return {
      size: content.size || 0,
      compression: content.compression || 0,
      mimeType: content.mimeType || '',
      text: content.text || '',
      encoding: content.encoding || '',
      comment: content.comment || ''
    };
  }

  // Format time in milliseconds to a human-readable format
  formatTime(timeMs) {
    if (timeMs < 1) return `${Math.round(timeMs * 1000)}μs`;
    if (timeMs < 1000) return `${Math.round(timeMs)}ms`;
    return `${(timeMs / 1000).toFixed(2)}s`;
  }

  // Format bytes to a human-readable format
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Get content type from MIME type
  getContentType(mimeType) {
    if (!mimeType) return 'other';
    if (mimeType.includes('text/html')) return 'html';
    if (mimeType.includes('text/css')) return 'css';
    if (mimeType.includes('javascript')) return 'js';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('json')) return 'json';
    if (mimeType.includes('xml')) return 'xml';
    return 'other';
  }
}