// Pure math for windowed (virtualized) list rendering: given the scroll
// position and viewport of a fixed-row-height list, returns the [start, end)
// slice of row indices that should be in the DOM, padded by `overscan` rows
// on each side so fast scrolling does not show blank space.
export interface WindowRange {
  start: number;
  end: number;
}

export function computeWindowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number
): WindowRange {
  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visibleCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const start = Math.min(total, Math.max(0, firstVisible - overscan));
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  return { start, end: Math.max(start, end) };
}
