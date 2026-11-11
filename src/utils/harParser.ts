// Utility class for parsing HAR files
import type {
  HarData,
  HarEntryRaw,
  HarRequestRaw,
  HarResponseRaw,
  HarContentRaw,
  HarTimingsRaw,
  ParsedEntry,
  ParsedRequest,
  ParsedResponse,
  ParsedContent,
  ParsedTimings,
  ParsedHar
} from '../types/har.js';

export class HarParser {
  parse(harData: HarData): ParsedHar {
    if (!harData || !harData.log) {
      throw new Error('Invalid HAR format: Missing log object');
    }

    const log = harData.log;
    const entries = this.parseEntries(log.entries || []);
    this.applyRelativeTimings(entries);

    return {
      version: log.version || '1.2',
      creator: log.creator || {},
      browser: log.browser || {},
      pages: log.pages || [],
      entries,
      comment: log.comment || ''
    };
  }

  parseEntries(entries: HarEntryRaw[]): ParsedEntry[] {
    return entries.map((entry, index) => {
      const request = this.parseRequest(entry.request || {});
      const response = this.parseResponse(entry.response || {});
      const urlParts = this.parseUrl(request.url);

      return {
        id: index,
        startedDateTime: entry.startedDateTime || '',
        startedTimeMs: this.toTimestamp(entry.startedDateTime),
        relativeStartMs: 0, // filled in by applyRelativeTimings
        time: entry.time || 0,
        request,
        response,
        cache: entry.cache || {},
        timings: this.parseTimings(entry.timings || {}),
        serverIPAddress: entry.serverIPAddress || '',
        connection: entry.connection || '',
        comment: entry.comment || '',
        // Flattened fields used by the request table / filter engine.
        protocol: response.httpVersion || request.httpVersion || '',
        host: urlParts.host,
        path: urlParts.path,
        contentType: this.getContentType(response.content.mimeType, this.hasResponseBody(response))
      };
    });
  }

  // Computes relativeStartMs on every entry relative to the earliest entry
  // in the archive (i.e. "time since the first request started").
  applyRelativeTimings(entries: ParsedEntry[]): void {
    if (!entries.length) return;
    const validTimes = entries
      .map(e => e.startedTimeMs)
      .filter(t => Number.isFinite(t));
    if (!validTimes.length) return;

    const firstStart = Math.min(...validTimes);
    entries.forEach(entry => {
      entry.relativeStartMs = Number.isFinite(entry.startedTimeMs)
        ? entry.startedTimeMs - firstStart
        : 0;
    });
  }

  toTimestamp(dateString: string | undefined): number {
    if (!dateString) return NaN;
    const parsed = Date.parse(dateString);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  parseUrl(url: string): { host: string; path: string } {
    try {
      const urlObj = new URL(url);
      return {
        host: urlObj.host,
        path: urlObj.pathname + urlObj.search
      };
    } catch (e) {
      return { host: '', path: url || '' };
    }
  }

  parseRequest(request: HarRequestRaw): ParsedRequest {
    return {
      method: request.method || '',
      url: request.url || '',
      httpVersion: request.httpVersion || '',
      cookies: request.cookies || [],
      headers: request.headers || [],
      queryString: request.queryString || [],
      postData: request.postData || null,
      headersSize: request.headersSize ?? -1,
      bodySize: request.bodySize ?? -1,
      comment: request.comment || ''
    };
  }

  parseResponse(response: HarResponseRaw): ParsedResponse {
    return {
      status: response.status || 0,
      statusText: response.statusText || '',
      httpVersion: response.httpVersion || '',
      cookies: response.cookies || [],
      headers: response.headers || [],
      content: this.parseContent(response.content || {}),
      redirectURL: response.redirectURL || '',
      headersSize: response.headersSize ?? -1,
      bodySize: response.bodySize ?? -1,
      comment: response.comment || ''
    };
  }

  parseContent(content: HarContentRaw): ParsedContent {
    return {
      size: content.size || 0,
      compression: content.compression || 0,
      mimeType: content.mimeType || '',
      text: content.text || '',
      encoding: content.encoding || '',
      comment: content.comment || ''
    };
  }

  // HAR timings use -1 (or an absent field) to mean "not applicable for
  // this request" - normalized to 0 so callers can sum/render them directly.
  parseTimings(timings: HarTimingsRaw): ParsedTimings {
    const normalize = (value: number | undefined): number => (value && value > 0 ? value : 0);
    return {
      blocked: normalize(timings.blocked),
      dns: normalize(timings.dns),
      connect: normalize(timings.connect),
      send: normalize(timings.send),
      wait: normalize(timings.wait),
      receive: normalize(timings.receive),
      ssl: normalize(timings.ssl)
    };
  }

  // Format time in milliseconds to a human-readable format
  formatTime(timeMs: number): string {
    if (!Number.isFinite(timeMs)) return 'N/A';
    if (timeMs < 1) return `${Math.round(timeMs * 1000)}μs`;
    if (timeMs < 1000) return `${Math.round(timeMs)}ms`;
    return `${(timeMs / 1000).toFixed(2)}s`;
  }

  // Format a relative start offset (always non-negative, prefixed with "+")
  formatRelativeTime(timeMs: number): string {
    if (!Number.isFinite(timeMs) || timeMs <= 0) return '+0ms';
    return `+${this.formatTime(timeMs)}`;
  }

  // Format an absolute timestamp (ms since epoch) to a human-readable
  // local date/time string.
  formatDateTime(timeMs: number): string {
    if (!Number.isFinite(timeMs)) return 'N/A';
    return new Date(timeMs).toLocaleString();
  }

  // Format an absolute timestamp as a local wall-clock time with
  // milliseconds (HH:MM:SS.mmm), as used in the aggregate stats panel.
  formatClockTime(timeMs: number): string {
    if (!Number.isFinite(timeMs)) return 'N/A';
    const date = new Date(timeMs);
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  }

  // Format a duration in milliseconds as HH:MM:SS.mmm, as used in the
  // aggregate stats panel.
  formatDurationClock(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs < 0) return 'N/A';
    const totalMs = Math.round(durationMs);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
  }

  // Format bytes to a human-readable format
  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  hasResponseBody(response: ParsedResponse): boolean {
    return response.content.size > 0 || response.bodySize > 0;
  }

  // Get a short content-type label from a MIME type. Empty when there is
  // neither a MIME type nor a body; 'other' for a body of unknown type.
  getContentType(mimeType: string, hasBody = true): string {
    if (!mimeType && !hasBody) return '';
    if (!mimeType) return 'other';
    const mime = mimeType.toLowerCase();
    if (mime.includes('text/html')) return 'html';
    if (mime.includes('text/css')) return 'css';
    if (mime.includes('javascript')) return 'js';
    if (mime.includes('image')) return 'image';
    if (mime.includes('font')) return 'font';
    if (mime.includes('json')) return 'json';
    if (mime.includes('xml')) return 'xml';
    if (mime.includes('text/plain')) return 'text';
    return 'other';
  }
}
