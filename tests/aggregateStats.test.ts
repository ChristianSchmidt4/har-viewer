import { computeAggregateStats } from '../src/utils/aggregateStats.js';
import type { ParsedEntry, ParsedRequest, ParsedResponse } from '../src/types/har.js';

function makeEntry(overrides: Partial<Omit<ParsedEntry, 'request' | 'response'>> & {
  request?: Partial<ParsedRequest>;
  response?: Partial<ParsedResponse>;
} = {}): ParsedEntry {
  const request: ParsedRequest = {
    method: 'GET',
    url: 'https://example.com/',
    httpVersion: '',
    cookies: [],
    headers: [],
    queryString: [],
    postData: null,
    headersSize: 100,
    bodySize: 0,
    comment: '',
    ...overrides.request
  };
  const response: ParsedResponse = {
    status: 200,
    statusText: '',
    httpVersion: '',
    cookies: [],
    headers: [],
    content: { size: 0, compression: 0, mimeType: 'text/html', text: '', encoding: '', comment: '' },
    redirectURL: '',
    headersSize: 200,
    bodySize: 500,
    comment: '',
    ...overrides.response
  };

  return {
    id: 0,
    startedDateTime: '',
    startedTimeMs: 0,
    relativeStartMs: 0,
    time: 100,
    cache: {},
    timings: { blocked: 0, dns: 0, connect: 0, send: 0, wait: 0, receive: 0, ssl: 0 },
    serverIPAddress: '',
    connection: '',
    comment: '',
    host: 'example.com',
    path: '/',
    protocol: 'HTTP/1.1',
    contentType: 'html',
    ...overrides,
    request,
    response
  };
}

describe('computeAggregateStats', () => {
  it('sums bytes sent/received and counts requests', () => {
    const entries = [
      makeEntry({ id: 0, request: { headersSize: 100, bodySize: 50 }, response: { headersSize: 200, bodySize: 500 } }),
      makeEntry({ id: 1, request: { headersSize: 80, bodySize: 0 }, response: { headersSize: 150, bodySize: 300 } })
    ];

    const stats = computeAggregateStats(entries);

    expect(stats.requestCount).toBe(2);
    expect(stats.bytesSent).toEqual({ total: 230, headers: 180, body: 50 });
    expect(stats.bytesReceived).toEqual({ total: 1150, headers: 350, body: 800 });
  });

  it('treats -1 (not applicable) sizes as zero', () => {
    const entries = [makeEntry({ request: { headersSize: -1, bodySize: -1 }, response: { headersSize: -1, bodySize: -1 } })];
    const stats = computeAggregateStats(entries);
    expect(stats.bytesSent).toEqual({ total: 0, headers: 0, body: 0 });
    expect(stats.bytesReceived).toEqual({ total: 0, headers: 0, body: 0 });
  });

  it('tallies response codes', () => {
    const entries = [
      makeEntry({ response: { status: 200 } }),
      makeEntry({ response: { status: 200 } }),
      makeEntry({ response: { status: 404 } })
    ];
    expect(computeAggregateStats(entries).responseCodes).toEqual({ 200: 2, 404: 1 });
  });

  it('aggregates response bytes by content-type, tracking header bytes separately', () => {
    const entries = [
      makeEntry({ response: { content: { size: 0, compression: 0, mimeType: 'text/html; charset=UTF-8', text: '', encoding: '', comment: '' }, bodySize: 8456, headersSize: 1000 } }),
      makeEntry({ response: { content: { size: 0, compression: 0, mimeType: 'text/html', text: '', encoding: '', comment: '' }, bodySize: 0, headersSize: 1633 } })
    ];

    const stats = computeAggregateStats(entries);
    expect(stats.responseBytesByType['text/html']).toBe(8456);
    expect(stats.responseBytesByType['~headers~']).toBe(2633);
  });

  it('computes sequence duration from first start to last end', () => {
    const entries = [
      makeEntry({ startedTimeMs: 1000, time: 100 }),
      makeEntry({ startedTimeMs: 2000, time: 316 })
    ];
    const stats = computeAggregateStats(entries);
    expect(stats.startedAt).toBe(1000);
    expect(stats.completedAt).toBe(2316);
    expect(stats.sequenceDurationMs).toBe(1316);
  });

  it('sums individual request durations for aggregate session duration', () => {
    const entries = [makeEntry({ time: 20 }), makeEntry({ time: 17 })];
    expect(computeAggregateStats(entries).aggregateSessionDurationMs).toBe(37);
  });

  it('returns NaN timing fields for an empty selection', () => {
    const stats = computeAggregateStats([]);
    expect(stats.requestCount).toBe(0);
    expect(Number.isNaN(stats.startedAt)).toBe(true);
    expect(Number.isNaN(stats.completedAt)).toBe(true);
    expect(Number.isNaN(stats.sequenceDurationMs)).toBe(true);
  });
});
