// Local file reading helpers with progress reporting. Files are read in the
// browser only - nothing is ever uploaded.

import { parseJsonWithArray, type ArraySplitOptions } from './jsonArraySplitter.js';

export type ProgressCallback = (fraction: number) => void;

// Resolves after the browser has painted the current frame, so progress UI
// updates become visible before a long synchronous step starts.
export const nextPaint = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

// Reads a file as text via FileReader, reporting progress in [0, 1].
export function readFileAsText(file: Blob, onProgress: ProgressCallback): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    reader.onload = (event) => {
      resolve(event.target!.result as string);
    };
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
}

const countBytes = (onChunk: (byteLength: number) => void) =>
  new TransformStream<BufferSource, BufferSource>({
    transform(chunk, controller) {
      onChunk(chunk.byteLength);
      controller.enqueue(chunk);
    }
  });

// Reads a (optionally gzipped) JSON file in chunks and parses it without ever
// joining the whole text: the HAR log.entries items are parsed one by one
// (see jsonArraySplitter.ts). Progress is measured on the compressed bytes read.
export async function parseJsonFileStreaming(
  file: Blob,
  isGzipped: boolean,
  onProgress: ProgressCallback,
  options: ArraySplitOptions = {}
): Promise<{ value: unknown; uncompressedSize: number | null }> {
  let compressedRead = 0;
  let uncompressedSize = 0;

  let source: ReadableStream<BufferSource> = file.stream().pipeThrough(
    countBytes((n) => {
      compressedRead += n;
      if (file.size > 0) onProgress(compressedRead / file.size);
    })
  );
  if (isGzipped) {
    source = source
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(countBytes((n) => { uncompressedSize += n; }));
  }

  const reader = source.pipeThrough(new TextDecoderStream()).getReader();
  const value = await parseJsonWithArray(reader, ['log', 'entries'], options);

  return {
    value,
    uncompressedSize: isGzipped ? uncompressedSize : null
  };
}

// Gunzips a file and returns its text. Progress is measured on the
// compressed bytes read from the file.
export async function readGzipFileAsText(file: Blob, onProgress: ProgressCallback): Promise<string> {
  let bytesRead = 0;
  const counter = new TransformStream<BufferSource, BufferSource>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      if (file.size > 0) onProgress(bytesRead / file.size);
      controller.enqueue(chunk);
    }
  });
  const decompressedStream = file.stream()
    .pipeThrough(counter)
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(decompressedStream).text();
}
