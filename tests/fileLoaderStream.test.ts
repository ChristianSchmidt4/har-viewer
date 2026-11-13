/**
 * @jest-environment node
 */
// Runs in the Node environment: jsdom lacks DecompressionStream/TextDecoderStream.
import { gzipSync } from 'zlib';
import { parseJsonFileStreaming } from '../src/utils/fileLoader.js';

const sample = {
  log: {
    version: '1.2',
    entries: [
      { request: { method: 'GET', url: 'https://ex.com/é?q=ü' }, n: -1.5e3, ok: true, nothing: null, empty: {}, list: [] },
      { request: { method: 'POST', url: 'https://ex.com/' }, n: 0, text: 'line\n"quoted"' },
    ],
  },
};

describe('parseJsonFileStreaming', () => {
  it('parses a plain JSON file like JSON.parse', async () => {
    const json = JSON.stringify(sample);
    const file = new File([json], 'a.har');
    const result = await parseJsonFileStreaming(file, false, () => {});
    expect(result.value).toEqual(JSON.parse(json));
    expect(result.uncompressedSize).toBeNull();
  });

  it('parses a gzipped file and reports the uncompressed size', async () => {
    const json = JSON.stringify(sample);
    const file = new File([gzipSync(json)], 'a.har.gz');
    const result = await parseJsonFileStreaming(file, true, () => {});
    expect(result.value).toEqual(JSON.parse(json));
    expect(result.uncompressedSize).toBe(Buffer.byteLength(json));
  });

  it('reports progress on compressed bytes, ending at 1', async () => {
    const json = JSON.stringify({ log: { entries: Array(2000).fill({ x: 'y' }) } });
    const file = new File([gzipSync(json)], 'a.har.gz');
    const fractions: number[] = [];
    await parseJsonFileStreaming(file, true, (f) => fractions.push(f));
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions[fractions.length - 1]).toBeCloseTo(1);
  });

  it('rejects invalid JSON', async () => {
    const file = new File(['{"log": [1, 2'], 'bad.har');
    await expect(parseJsonFileStreaming(file, false, () => {})).rejects.toBeDefined();
  });
});
