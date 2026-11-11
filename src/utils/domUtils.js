// Small, dependency-free DOM/string helpers shared across components.

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function truncateUrl(url, maxLength) {
  if (!url) return '';
  if (url.length <= maxLength) return url;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;
    const search = urlObj.search;

    if (domain.length + path.length <= maxLength - 10) {
      return `${urlObj.protocol}//${domain}${path}${search}`.substring(0, maxLength) + '...';
    } else if (domain.length <= maxLength - 10) {
      return `${urlObj.protocol}//${domain}/...`.substring(0, maxLength) + '...';
    }
    return url.substring(0, maxLength) + '...';
  } catch (e) {
    return url.substring(0, maxLength) + '...';
  }
}

export function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '\n\n... (truncated)';
}

// Creates an element from an HTML string (first element child only).
export function createElementFromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
