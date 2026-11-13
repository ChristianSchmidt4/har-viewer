/**
 * @jest-environment node
 */
// Runs in the Node environment: jsdom lacks ReadableStream.
import { parseJsonWithArray } from '../src/utils/jsonArraySplitter.js';

const readerFor = (text: string, chunkSize: number) => {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return new ReadableStream<string>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(c));
      controller.close();
    },
  }).getReader();
};

const doc = {
  log: {
    version: '1.2',
    creator: { name: 'tool [x]', nested: { deep: [1, { a: 'b' }] } },
    entries: [
      { request: { url: 'https://ex.com/a}b]c', headers: [] }, text: 'quote " and \\ backslash', n: -1.5e3 },
      { request: { url: 'https://ex.com/é?q=ü' }, arr: [[], {}, null, true] },
      {},
    ],
    pages: [],
  },
};

describe('parseJsonWithArray', () => {
  const text = JSON.stringify(doc, null, 2);

  it.each([1, 3, 7, 64 * 1024])('matches JSON.parse with chunk size %i', async (chunkSize) => {
    const result = await parseJsonWithArray(readerFor(text, chunkSize), ['log', 'entries']);
    expect(result).toEqual(doc);
  });

  it('handles escaped keys', async () => {
    const json = '{"lo\\u0067":{"entries":[{"a":"x"}]}}';
    const result = await parseJsonWithArray(readerFor(json, 2), ['log', 'entries']);
    expect(result).toEqual(JSON.parse(json));
  });

  it('returns the document unchanged when the path is missing', async () => {
    const json = '{"other":[1,2]}';
    const result = await parseJsonWithArray(readerFor(json, 4), ['log', 'entries']);
    expect(result).toEqual({ other: [1, 2] });
  });

  it('marks items that are not objects as invalid placeholders', async () => {
    const json = '{"log":{"entries":[1,2]}}';
    const result = (await parseJsonWithArray(readerFor(json, 5), ['log', 'entries'])) as any;
    expect(result.log.entries).toHaveLength(2);
    expect(result.log.entries[0]).toMatchObject({ invalid: true, raw: '1' });
  });

  it('emits batches of batchSize items and a final partial batch', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ i }));
    const json = JSON.stringify({ log: { entries } });
    const batches: unknown[][] = [];
    await parseJsonWithArray(readerFor(json, 7), ['log', 'entries'], {
      batchSize: 10,
      onBatch: (items) => { batches.push(items); },
    });
    expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(entries);
  });

  it('does not retain items when onBatch is given', async () => {
    const json = JSON.stringify({ log: { entries: [{ i: 1 }, { i: 2 }, { i: 3 }] } });
    const result = await parseJsonWithArray(readerFor(json, 5), ['log', 'entries'], {
      batchSize: 2,
      onBatch: () => undefined,
    }) as { log: { entries?: unknown[] } };
    expect(result.log.entries).toEqual([]);
  });

  it('turns an item with malformed JSON into an invalid placeholder and keeps going', async () => {
    const json = '{"log":{"entries":[{"a":1},{"b":oops},{"c":3}]}}';
    const result = (await parseJsonWithArray(readerFor(json, 4), ['log', 'entries'])) as any;
    expect(result.log.entries).toHaveLength(3);
    expect(result.log.entries[0]).toEqual({ a: 1 });
    expect(result.log.entries[1].invalid).toBe(true);
    expect(result.log.entries[2]).toEqual({ c: 3 });
  });

  it('rejects truncated input', async () => {
    const json = '{"log":{"entries":[{"a":1}';
    await expect(parseJsonWithArray(readerFor(json, 5), ['log', 'entries'])).rejects.toThrow();
  });
});
