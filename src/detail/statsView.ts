// Fiddler-style "Statistics" markup for a set of HAR entries. Shared by the
// detail panel's multi-select Stats tab and the pivot's cell stats layer.
import './detail.css';
import { HarParser } from '@/har/harParser';
import { escapeHtml } from '@/common/domUtils';
import { computeAggregateStats } from '@/detail/aggregateStats';
import type { ParsedEntry } from '@/common/types/har';

export function renderStatsView(entries: ParsedEntry[], parser: HarParser): string {
  const byteValue = (bytes: number) => `<span title="${parser.formatBytesExact(bytes)}">${parser.formatBytes(bytes)}</span>`;
  const stats = computeAggregateStats(entries);
  const responseCodeRows = Object.entries(stats.responseCodes)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([code, count]) => `<tr><td>HTTP/${escapeHtml(code)}</td><td>${count}</td></tr>`)
    .join('');
  const responseTypeRows = Object.entries(stats.responseBytesByType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, bytes]) => `<tr><td>${escapeHtml(type)}</td><td>${byteValue(bytes)}</td></tr>`)
    .join('');

  return `
    <div class="stats-view">
      <table class="stats-table">
        <tbody>
          <tr><td>Request Count:</td><td>${stats.requestCount}</td></tr>
          <tr><td>Bytes Sent:</td><td>${byteValue(stats.bytesSent.total)}
            <span class="stats-breakdown">(headers: ${byteValue(stats.bytesSent.headers)}; body: ${byteValue(stats.bytesSent.body)})</span></td></tr>
          <tr><td>Bytes Received:</td><td>${byteValue(stats.bytesReceived.total)}
            <span class="stats-breakdown">(headers: ${byteValue(stats.bytesReceived.headers)}; body: ${byteValue(stats.bytesReceived.body)})</span></td></tr>
        </tbody>
      </table>

      <h4 class="stats-section-title">Actual Performance</h4>
      <table class="stats-table">
        <tbody>
          <tr><td>Requests started at:</td><td>${parser.formatClockTime(stats.startedAt)}</td></tr>
          <tr><td>Responses completed at:</td><td>${parser.formatClockTime(stats.completedAt)}</td></tr>
          <tr><td>Sequence (clock) duration:</td><td>${parser.formatDuration(stats.sequenceDurationMs)}</td></tr>
          <tr><td>Aggregate Session duration:</td><td>${parser.formatDuration(stats.aggregateSessionDurationMs)}</td></tr>
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
