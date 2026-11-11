// Builds raw HTTP-wire-format text and lightweight syntax highlighting for
// request/response bodies, used by the detail panes' "Raw" and "Syntax" tabs.
import { escapeHtml } from './domUtils.js';

function headerLines(headers) {
  return (headers || []).map(h => `${h.name}: ${h.value}`).join('\r\n');
}

function requestLine(request) {
  let target = request.url || '/';
  try {
    const urlObj = new URL(request.url);
    target = urlObj.pathname + urlObj.search;
  } catch (e) {
    // keep full url as target if it isn't absolute
  }
  return `${request.method} ${target} ${request.httpVersion || 'HTTP/1.1'}`;
}

function requestBodyText(request) {
  if (!request.postData) return '';
  if (request.postData.text) return request.postData.text;
  if (request.postData.params && request.postData.params.length) {
    return request.postData.params
      .map(p => `${p.name}=${p.value ?? ''}`)
      .join('&');
  }
  return '';
}

// Builds the raw request exactly as it would appear on the wire.
export function buildRawRequest(entry) {
  const { request } = entry;
  const lines = [requestLine(request)];
  const headers = headerLines(request.headers);
  if (headers) lines.push(headers);
  lines.push('');
  const body = requestBodyText(request);
  if (body) lines.push(body);
  return lines.join('\r\n');
}

// Builds the raw response exactly as it would appear on the wire.
export function buildRawResponse(entry) {
  const { response } = entry;
  const statusLine = `${response.httpVersion || 'HTTP/1.1'} ${response.status} ${response.statusText || ''}`.trim();
  const lines = [statusLine];
  const headers = headerLines(response.headers);
  if (headers) lines.push(headers);
  lines.push('');
  if (response.content && response.content.text) {
    lines.push(response.content.text);
  }
  return lines.join('\r\n');
}

// Very small, dependency-free syntax highlighter good enough for JSON/XML/
// HTML/plain bodies. Returns safe HTML (input is escaped first).
export function highlightSyntax(text, mimeType) {
  if (!text) return '<span class="syntax-empty">No body</span>';

  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('json')) return highlightJson(text);
  if (mime.includes('html') || mime.includes('xml')) return highlightMarkup(text);
  return `<span class="syntax-plain">${escapeHtml(text)}</span>`;
}

function highlightJson(text) {
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    // Not valid JSON (or already pretty) - fall back to raw text.
  }

  const escaped = escapeHtml(pretty);
  // Tokenize strings/keys, numbers, booleans/null.
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'syntax-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'syntax-key' : 'syntax-string';
      } else if (/true|false/.test(match)) {
        cls = 'syntax-boolean';
      } else if (/null/.test(match)) {
        cls = 'syntax-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function highlightMarkup(text) {
  const escaped = escapeHtml(text);
  // Highlight tags (&lt;/?tag ... &gt;) and attribute names.
  return escaped.replace(
    /(&lt;\/?[a-zA-Z][\w:-]*)|((?:\s)[\w-]+)(=)|(&gt;)/g,
    (match, tagStart, attrName, equals, tagEnd) => {
      if (tagStart) return `<span class="syntax-tag">${tagStart}</span>`;
      if (attrName && equals) return `<span class="syntax-attr">${attrName}</span>=`;
      if (tagEnd) return `<span class="syntax-tag">${tagEnd}</span>`;
      return match;
    }
  );
}
