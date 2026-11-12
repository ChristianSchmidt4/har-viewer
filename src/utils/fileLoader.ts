// Local file reading helpers with progress reporting. Files are read in the
// browser only - nothing is ever uploaded.

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
    reader.onload = (event) => resolve(event.target!.result as string);
    reader.onerror = () => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
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
