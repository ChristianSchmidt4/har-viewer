import { filterEntries } from '../src/utils/filterParser.js';
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
    headersSize: -1,
    bodySize: -1,
    comment: '',
    ...overrides.request
  };
  const response: ParsedResponse = {
    status: 200,
    statusText: '',
    httpVersion: '',
    cookies: [],
    headers: [],
    content: { size: 0, compression: 0, mimeType: '', text: '', encoding: '', comment: '' },
    redirectURL: '',
    headersSize: -1,
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
    timings: {},
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

describe('filterEntries', () => {
  const entries = [
    makeEntry({ id: 0, host: 'example.com', path: '/', contentType: 'html', time: 100,
      request: { method: 'GET', url: 'https://example.com/' }, response: { status: 200, bodySize: 500 } }),
    makeEntry({ id: 1, host: 'api.example.com', path: '/users', contentType: 'json', time: 250,
      request: { method: 'POST', url: 'https://api.example.com/users' }, response: { status: 404, bodySize: 50 } }),
    makeEntry({ id: 2, host: 'cdn.example.com', path: '/logo.png', contentType: 'image', time: 30,
      request: { method: 'GET', url: 'https://cdn.example.com/logo.png' }, response: { status: 200, bodySize: 20480 } })
  ];

  it('returns all entries for an empty query', () => {
    expect(filterEntries(entries, '')).toHaveLength(3);
  });

  it('filters by exact status', () => {
    const result = filterEntries(entries, 'status:200');
    expect(result.map(e => e.id)).toEqual([0, 2]);
  });

  it('filters by method', () => {
    const result = filterEntries(entries, 'method:POST');
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it('filters by host substring', () => {
    const result = filterEntries(entries, 'host:api');
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it('negates a field match', () => {
    const result = filterEntries(entries, '-type:image');
    expect(result.map(e => e.id)).toEqual([0, 1]);
  });

  it('supports numeric comparisons on duration', () => {
    const result = filterEntries(entries, 'duration:>100');
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it('supports numeric comparisons on size with units', () => {
    const result = filterEntries(entries, 'size:>1kb');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('combines multiple clauses with AND', () => {
    const result = filterEntries(entries, 'status:200 type:image');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('falls back to a plain-text URL match', () => {
    const result = filterEntries(entries, 'logo');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('supports or and grouping', () => {
    const result = filterEntries(entries, '(status:404 or type:image)');
    expect(result.map(e => e.id)).toEqual([1, 2]);
  });

  it('supports not keyword', () => {
    const result = filterEntries(entries, 'not type:image');
    expect(result.map(e => e.id)).toEqual([0, 1]);
  });

  it('matches a request header value', () => {
    const withHeaders = entries.map(e => ({
      ...e,
      request: { ...e.request, headers: e.id === 1 ? [{ name: 'user-agent', value: 'Chromium/1.0' }] : [] }
    }));
    const result = filterEntries(withHeaders, 'reqheader:user-agent=chromium');
    expect(result.map(e => e.id)).toEqual([1]);
  });

  it('checks for response header presence without a value', () => {
    const withHeaders = entries.map(e => ({
      ...e,
      response: { ...e.response, headers: e.id === 2 ? [{ name: 'x-execution-id', value: 'ADFEEx01' }] : [] }
    }));
    const result = filterEntries(withHeaders, 'resheader:x-execution-id');
    expect(result.map(e => e.id)).toEqual([2]);
  });

  it('matches cookies and combines with and/or', () => {
    const withCookies = entries.map(e => ({
      ...e,
      request: { ...e.request, cookies: e.id === 0 ? [{ name: 'sid', value: 'abc' }] : [] }
    }));
    const result = filterEntries(withCookies, 'reqcookie:sid=abc or status:404');
    expect(result.map(e => e.id)).toEqual([0, 1]);
  });
});
