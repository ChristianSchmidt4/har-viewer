/**
 * @jest-environment node
 */
// Runs in the Node environment: jsdom lacks DecompressionStream/Response.
import { gzipSync } from 'zlib';
import { readGzipFileAsText } from '../src/utils/fileLoader.js';

describe('readGzipFileAsText', () => {
  it('decompresses a gzipped file', async () => {
    const json = JSON.stringify({ log: { entries: [] } });
    const gz = new File([gzipSync(json)], 'a.har.gz');
    await expect(readGzipFileAsText(gz, () => {})).resolves.toBe(json);
  });

  it('reports progress on compressed bytes, ending at 1', async () => {
    const json = JSON.stringify({ log: { entries: Array(500).fill({ x: 'y' }) } });
    const gz = new File([gzipSync(json)], 'a.har.gz');
    const fractions: number[] = [];
    await readGzipFileAsText(gz, (f) => fractions.push(f));
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
  });

  it('rejects invalid gzip data', async () => {
    const bad = new File(['not gzip'], 'bad.har.gz');
    await expect(readGzipFileAsText(bad, () => {})).rejects.toBeDefined();
  });
});
