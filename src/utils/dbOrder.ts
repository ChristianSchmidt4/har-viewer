// User-chosen order of the stored databases on the start page. The order is a
// list of database names kept in localStorage; names not in the list (e.g.
// newly imported databases) sort after the ordered ones, keeping their order.

export const DB_ORDER_KEY = 'har-viewer-db-order';

export function loadDbOrder(): string[] {
  try {
    const raw = localStorage.getItem(DB_ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDbOrder(names: string[]): void {
  localStorage.setItem(DB_ORDER_KEY, JSON.stringify(names));
}

export function applyDbOrder<T extends { name: string }>(items: T[], order: string[]): T[] {
  const position = new Map(order.map((name, index) => [name, index]));
  const rank = (item: T) => position.get(item.name) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => rank(a) - rank(b));
}

// Returns the names with `dragged` removed and re-inserted before or after `target`.
export function moveName(names: string[], dragged: string, target: string, after: boolean): string[] {
  if (dragged === target) return [...names];
  const rest = names.filter(name => name !== dragged);
  const targetIndex = rest.indexOf(target);
  if (targetIndex === -1) return [...names];
  rest.splice(targetIndex + (after ? 1 : 0), 0, dragged);
  return rest;
}
