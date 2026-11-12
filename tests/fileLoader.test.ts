import { readFileAsText } from '../src/utils/fileLoader.js';

describe('readFileAsText', () => {
  it('returns the file contents', async () => {
    const file = new File(['{"log":{}}'], 'a.har', { type: 'application/json' });
    await expect(readFileAsText(file, () => {})).resolves.toBe('{"log":{}}');
  });

  it('reports progress ending at 1 for a non-empty file', async () => {
    const file = new File(['x'.repeat(4096)], 'big.har');
    const fractions: number[] = [];
    await readFileAsText(file, (f) => fractions.push(f));
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions[fractions.length - 1]).toBe(1);
    fractions.forEach((f) => {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    });
  });

  it('resolves an empty file to an empty string', async () => {
    const file = new File([], 'empty.har');
    await expect(readFileAsText(file, () => {})).resolves.toBe('');
  });
});
