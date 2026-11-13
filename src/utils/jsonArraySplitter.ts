// Parses a JSON document read as text chunks while parsing the items of one
// array separately with JSON.parse. Each item is kept only as its own short
// string, and the rest of the document is parsed as a small skeleton, so the
// whole file is never joined into one string (V8 caps string length, which a
// multi-GB HAR exceeds). Items that fail to parse or are not objects become
// InvalidItem placeholders instead of failing the whole load. Items are also
// handed out in batches via onBatch while the file is still being read.

import type { InvalidItem } from '../types/har.js';

export interface ArraySplitOptions {
  // Number of items per onBatch call (default 1000).
  batchSize?: number;
  // Awaited before reading continues, so callers can render or yield.
  onBatch?: (items: unknown[]) => void | Promise<void>;
}

const RAW_EXCERPT_LENGTH = 300;

export const isInvalidItem = (value: unknown): value is InvalidItem =>
  typeof value === 'object' && value !== null && (value as InvalidItem).invalid === true;

const invalidItem = (reason: string, text: string): InvalidItem => ({
  invalid: true,
  reason,
  raw: text.length > RAW_EXCERPT_LENGTH ? text.slice(0, RAW_EXCERPT_LENGTH) + '…' : text,
});

const parseItem = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' ? value : invalidItem('Not a JSON object', text.trim());
  } catch (error) {
    return invalidItem(error instanceof Error ? error.message : 'Invalid JSON', text.trim());
  }
};

const QUOTE = 34;
const BACKSLASH = 92;
const COMMA = 44;
const LBRACKET = 91;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;

// Where the current run of characters is written.
const SKELETON = 0;
const ITEM = 1;
const SKIP = 2;

interface Frame {
  isArray: boolean;
  // True when this container sits at arrayPath under the root object.
  onPath: boolean;
  pendingKey: string | null;
  expectKey: boolean;
}

const isWhitespace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

export async function parseJsonWithArray(
  reader: ReadableStreamDefaultReader<string>,
  arrayPath: string[],
  options: ArraySplitOptions = {}
): Promise<unknown> {
  // Stack index of the split array; the root object is at index 0.
  const arrayDepth = arrayPath.length;
  const batchSize = options.batchSize ?? 1000;
  const stack: Frame[] = [];
  const skeleton: string[] = [];
  const items: unknown[] = [];
  let emitted = 0;
  let itemParts: string[] = [];
  let itemDepth = 0;
  let itemIsPrimitive = false;
  let inItem = false;
  let dest = SKELETON;
  let chunk = '';
  let segStart = 0;
  let inString = false;
  let escaped = false;
  let keyMode = false;
  let keyRaw = '';

  const topFrame = (): Frame | undefined => stack[stack.length - 1];
  const isTargetTop = (): boolean => {
    const top = topFrame();
    return stack.length - 1 === arrayDepth && top !== undefined && top.onPath && top.isArray;
  };

  // Writes chunk[segStart, end) to the current destination.
  const flush = (end: number): void => {
    if (end > segStart) {
      const piece = chunk.slice(segStart, end);
      if (dest === SKELETON) skeleton.push(piece);
      else if (dest === ITEM) itemParts.push(piece);
    }
    segStart = end;
  };
  const setDest = (next: number, i: number): void => {
    flush(i);
    dest = next;
  };
  const finishItem = (): void => {
    items.push(parseItem(itemParts.join('')));
    itemParts = [];
    inItem = false;
  };
  const emitBatches = async (final: boolean): Promise<void> => {
    if (!options.onBatch) return;
    while (items.length - emitted >= batchSize) {
      await options.onBatch(items.slice(emitted, emitted + batchSize));
      emitted += batchSize;
    }
    if (final && items.length > emitted) {
      await options.onBatch(items.slice(emitted));
      emitted = items.length;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunk = value;
    segStart = 0;

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);

      // A primitive item (number, string, literal) ends at the next top-level comma or ']'.
      if (inItem && itemIsPrimitive && !inString && (c === COMMA || (c === RBRACKET && stack.length - 1 === arrayDepth))) {
        flush(i);
        finishItem();
        dest = SKIP;
      }

      const inTarget = !inItem && isTargetTop();
      if (inTarget && !(c === LBRACE || c === LBRACKET || c === RBRACKET || c === COMMA || isWhitespace(c))) {
        inItem = true;
        itemIsPrimitive = true;
        itemParts = [];
      }

      let next: number;
      if (inItem) next = ITEM;
      else if (inTarget) next = c === RBRACKET ? SKELETON : c === COMMA || isWhitespace(c) ? SKIP : ITEM;
      else next = SKELETON;
      if (next !== dest) setDest(next, i);

      if (inString) {
        if (escaped) {
          escaped = false;
          if (keyMode) keyRaw += chunk[i];
        } else if (c === BACKSLASH) {
          escaped = true;
          if (keyMode) keyRaw += '\\';
        } else if (c === QUOTE) {
          inString = false;
          if (keyMode) {
            const top = topFrame()!;
            top.pendingKey = JSON.parse('"' + keyRaw + '"') as string;
            top.expectKey = false;
          }
        } else if (keyMode) {
          keyRaw += chunk[i];
        }
        continue;
      }

      if (c === QUOTE) {
        inString = true;
        const top = topFrame();
        keyMode = top !== undefined && !top.isArray && top.expectKey;
        keyRaw = '';
      } else if (c === LBRACE || c === LBRACKET) {
        const k = stack.length;
        const parent = topFrame();
        const onPath =
          k === 0 ||
          (parent !== undefined && parent.onPath && !parent.isArray && k - 1 < arrayDepth && parent.pendingKey === arrayPath[k - 1]);
        stack.push({ isArray: c === LBRACKET, onPath, pendingKey: null, expectKey: c === LBRACE });
        if (inTarget) {
          inItem = true;
          itemIsPrimitive = false;
          itemDepth = stack.length;
          itemParts = [];
        }
      } else if (c === RBRACE || c === RBRACKET) {
        if (stack.length === 0) throw new Error('Unexpected closing bracket in JSON');
        if (inItem && stack.length === itemDepth) {
          flush(i + 1);
          finishItem();
          dest = SKIP;
        }
        stack.pop();
      } else if (c === COMMA) {
        const top = topFrame();
        if (top !== undefined && !top.isArray) top.expectKey = true;
      }
    }
    flush(chunk.length);
    segStart = 0;
    await emitBatches(false);
  }

  if (stack.length !== 0 || inString) throw new Error('Unexpected end of JSON input');
  await emitBatches(true);

  const root = JSON.parse(skeleton.join('')) as Record<string, unknown>;
  let container: unknown = root;
  for (const key of arrayPath.slice(0, -1)) {
    container = container && typeof container === 'object' ? (container as Record<string, unknown>)[key] : undefined;
  }
  const lastKey = arrayPath[arrayPath.length - 1]!;
  if (container && typeof container === 'object' && lastKey in container) {
    (container as Record<string, unknown>)[lastKey] = items;
  }
  return root;
}
