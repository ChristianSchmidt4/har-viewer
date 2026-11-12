// Small, dependency-free DOM/string helpers shared across components.

export function escapeHtml(text: unknown): string {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function truncateUrl(url: string, maxLength: number): string {
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

export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '\n\n... (truncated)';
}
