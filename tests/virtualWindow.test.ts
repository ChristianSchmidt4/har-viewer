import { computeWindowRange } from '../src/utils/virtualWindow.js';

describe('computeWindowRange', () => {
  it('returns an empty range for an empty list or unknown row height', () => {
    expect(computeWindowRange(0, 500, 28, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(computeWindowRange(0, 500, 0, 100, 10)).toEqual({ start: 0, end: 0 });
  });

  it('renders the viewport plus overscan at the top of the list', () => {
    // 500px / 28px = 18 visible rows (ceil), +5 overscan below.
    expect(computeWindowRange(0, 500, 28, 10000, 5)).toEqual({ start: 0, end: 23 });
  });

  it('shifts the window with the scroll position', () => {
    // scrollTop 2800px = row 100; start = 100 - 5, end = 100 + 18 + 5.
    expect(computeWindowRange(2800, 500, 28, 10000, 5)).toEqual({ start: 95, end: 123 });
  });

  it('never exceeds the total number of rows', () => {
    // scrollTop 28000px = row 1000 (past the end); window clamps to [995, 1000).
    expect(computeWindowRange(28000, 500, 28, 1000, 5)).toEqual({ start: 995, end: 1000 });
    expect(computeWindowRange(0, 5000, 28, 20, 5)).toEqual({ start: 0, end: 20 });
  });

  it('handles scroll positions beyond the list end', () => {
    const range = computeWindowRange(1_000_000, 500, 28, 50, 5);
    expect(range.start).toBeLessThanOrEqual(50);
    expect(range.end).toBe(50);
  });
});
