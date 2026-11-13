import { applyDbOrder, DB_ORDER_KEY, loadDbOrder, moveName, saveDbOrder } from '../src/utils/dbOrder.js';

describe('dbOrder persistence', () => {
  beforeEach(() => localStorage.clear());

  test('loads an empty order when nothing is stored', () => {
    expect(loadDbOrder()).toEqual([]);
  });

  test('round-trips the saved order through localStorage', () => {
    saveDbOrder(['b', 'a']);
    expect(localStorage.getItem(DB_ORDER_KEY)).toBe('["b","a"]');
    expect(loadDbOrder()).toEqual(['b', 'a']);
  });

  test('ignores corrupt or non-array stored values', () => {
    localStorage.setItem(DB_ORDER_KEY, '{not json');
    expect(loadDbOrder()).toEqual([]);
    localStorage.setItem(DB_ORDER_KEY, '{"a":1}');
    expect(loadDbOrder()).toEqual([]);
    localStorage.setItem(DB_ORDER_KEY, '["a",3,null,"b"]');
    expect(loadDbOrder()).toEqual(['a', 'b']);
  });
});

describe('applyDbOrder', () => {
  const item = (name: string) => ({ name });

  test('sorts by the saved order', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(applyDbOrder(items, ['c', 'a', 'b']).map(i => i.name)).toEqual(['c', 'a', 'b']);
  });

  test('puts unknown names last, keeping their relative order', () => {
    const items = [item('new1'), item('a'), item('new2'), item('b')];
    expect(applyDbOrder(items, ['b', 'a']).map(i => i.name)).toEqual(['b', 'a', 'new1', 'new2']);
  });

  test('does not mutate the input array', () => {
    const items = [item('a'), item('b')];
    applyDbOrder(items, ['b', 'a']);
    expect(items.map(i => i.name)).toEqual(['a', 'b']);
  });
});

describe('moveName', () => {
  test('moves a name before the target', () => {
    expect(moveName(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
  });

  test('moves a name after the target', () => {
    expect(moveName(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c']);
  });

  test('moving onto the same position keeps the order', () => {
    expect(moveName(['a', 'b', 'c'], 'b', 'b', false)).toEqual(['a', 'b', 'c']);
    expect(moveName(['a', 'b', 'c'], 'b', 'a', true)).toEqual(['a', 'b', 'c']);
  });

  test('returns the original order when the target is unknown', () => {
    expect(moveName(['a', 'b'], 'a', 'zzz', false)).toEqual(['a', 'b']);
  });
});
