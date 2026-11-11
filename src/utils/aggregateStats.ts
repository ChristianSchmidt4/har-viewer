// Computes Fiddler-style aggregate statistics across a set of selected HAR
// entries, for the detail panel's multi-select "Stats" tab.
import type { ParsedEntry } from '../types/har.js';

export interface AggregateStats {
  requestCount: number;
  bytesSent: { total: number; headers: number; body: number };
  bytesReceived: { total: number; headers: number; body: number };
  startedAt: number;
  completedAt: number;
  sequenceDurationMs: number;
  aggregateSessionDurationMs: number;
  responseCodes: Record<number, number>;
  responseBytesByType: Record<string, number>;
}

function nonNegative(value: number): number {
  return value > 0 ? value : 0;
}

export function computeAggregateStats(entries: ParsedEntry[]): AggregateStats {
  let sentHeaders = 0;
  let sentBody = 0;
  let receivedHeaders = 0;
  let receivedBody = 0;
  const responseCodes: Record<number, number> = {};
  const responseBytesByType: Record<string, number> = {};

  let startedAt = Infinity;
  let completedAt = -Infinity;
  let aggregateSessionDurationMs = 0;

  entries.forEach(entry => {
    sentHeaders += nonNegative(entry.request.headersSize);
    sentBody += nonNegative(entry.request.bodySize);
    receivedHeaders += nonNegative(entry.response.headersSize);
    receivedBody += nonNegative(entry.response.bodySize);

    responseCodes[entry.response.status] = (responseCodes[entry.response.status] || 0) + 1;

    const mimeType = (entry.response.content.mimeType || '').split(';')[0]?.trim() || 'unknown';
    responseBytesByType[mimeType] = (responseBytesByType[mimeType] || 0) + nonNegative(entry.response.bodySize);
    responseBytesByType['~headers~'] = (responseBytesByType['~headers~'] || 0) + nonNegative(entry.response.headersSize);

    if (Number.isFinite(entry.startedTimeMs)) {
      startedAt = Math.min(startedAt, entry.startedTimeMs);
      completedAt = Math.max(completedAt, entry.startedTimeMs + Math.max(entry.time, 0));
    }

    aggregateSessionDurationMs += Math.max(entry.time, 0);
  });

  return {
    requestCount: entries.length,
    bytesSent: { total: sentHeaders + sentBody, headers: sentHeaders, body: sentBody },
    bytesReceived: { total: receivedHeaders + receivedBody, headers: receivedHeaders, body: receivedBody },
    startedAt: Number.isFinite(startedAt) ? startedAt : NaN,
    completedAt: Number.isFinite(completedAt) ? completedAt : NaN,
    sequenceDurationMs: Number.isFinite(startedAt) && Number.isFinite(completedAt) ? completedAt - startedAt : NaN,
    aggregateSessionDurationMs,
    responseCodes,
    responseBytesByType
  };
}
