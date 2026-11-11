// Shared types describing the HAR 1.2 JSON format (subset used by this
// app) and the structured entries HarParser derives from it.

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface HarQueryParam {
  name: string;
  value: string;
}

export interface HarPostDataParam {
  name: string;
  value?: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarPostDataParam[];
}

export interface HarRequestRaw {
  method?: string;
  url?: string;
  httpVersion?: string;
  cookies?: HarCookie[];
  headers?: HarHeader[];
  queryString?: HarQueryParam[];
  postData?: HarPostData | null;
  headersSize?: number;
  bodySize?: number;
  comment?: string;
}

export interface HarContentRaw {
  size?: number;
  compression?: number;
  mimeType?: string;
  text?: string;
  encoding?: string;
  comment?: string;
}

export interface HarResponseRaw {
  status?: number;
  statusText?: string;
  httpVersion?: string;
  cookies?: HarCookie[];
  headers?: HarHeader[];
  content?: HarContentRaw;
  redirectURL?: string;
  headersSize?: number;
  bodySize?: number;
  comment?: string;
}

export interface HarEntryRaw {
  startedDateTime?: string;
  time?: number;
  request?: HarRequestRaw;
  response?: HarResponseRaw;
  cache?: Record<string, unknown>;
  timings?: Record<string, unknown>;
  serverIPAddress?: string;
  connection?: string;
  comment?: string;
}

export interface HarLogRaw {
  version?: string;
  creator?: Record<string, unknown>;
  browser?: Record<string, unknown>;
  pages?: unknown[];
  entries?: HarEntryRaw[];
  comment?: string;
}

export interface HarData {
  log: HarLogRaw;
}

// --- Structured (parsed) shapes produced by HarParser ---

export interface ParsedRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  queryString: HarQueryParam[];
  postData: HarPostData | null;
  headersSize: number;
  bodySize: number;
  comment: string;
}

export interface ParsedContent {
  size: number;
  compression: number;
  mimeType: string;
  text: string;
  encoding: string;
  comment: string;
}

export interface ParsedResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  content: ParsedContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  comment: string;
}

export interface ParsedEntry {
  id: number;
  startedDateTime: string;
  startedTimeMs: number;
  relativeStartMs: number;
  time: number;
  request: ParsedRequest;
  response: ParsedResponse;
  cache: Record<string, unknown>;
  timings: Record<string, unknown>;
  serverIPAddress: string;
  connection: string;
  comment: string;
  protocol: string;
  host: string;
  path: string;
  contentType: string;
}

export interface ParsedHar {
  version: string;
  creator: Record<string, unknown>;
  browser: Record<string, unknown>;
  pages: unknown[];
  entries: ParsedEntry[];
  comment: string;
}
