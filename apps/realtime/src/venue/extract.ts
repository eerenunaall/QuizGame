import { Worker } from 'node:worker_threads';

/**
 * Reading an uploaded PDF/DOCX/TXT/MD for the Soru Stüdyosu (ADR-0028 §6). The parsing itself lives in
 * `extract/core.mjs` and runs in a worker thread with a heap cap and a wall-clock budget, so a hostile
 * file can neither block the event loop nor take the process down with it.
 */
export const EXTRACT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 50,
  maxChars: 200_000,
  /** Less than this is not a document we can make questions from. */
  minChars: 200,
  /** Inflated size of word/document.xml and the declared total of a docx. */
  maxInflate: 20 * 1024 * 1024,
  maxZipEntries: 1000,
  /** Size of the "bölüm" sections of documents without pages. */
  sectionChars: 3000,
} as const;

export type ExtractErrorCode =
  | 'too_big'
  | 'too_long'
  | 'unsupported'
  | 'pdf_encrypted'
  | 'corrupt'
  | 'no_text'
  | 'binary'
  | 'timeout'
  | 'busy';

export interface DocumentSection {
  /** "s. 3" for a PDF page, "bölüm 2" for running text. */
  label: string;
  text: string;
}
export type ExtractResult =
  | { ok: true; kind: 'pdf' | 'docx' | 'text'; sections: DocumentSection[]; chars: number }
  | { ok: false; code: ExtractErrorCode };

export interface ExtractOptions {
  timeoutMs?: number;
  heapMb?: number;
}

/** At most this many documents are read at the same moment (each may use the heap cap below). */
const MAX_CONCURRENT = 2;
let running = 0;

export function extractDocument(
  bytes: Uint8Array,
  fileName: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (bytes.length > EXTRACT_LIMITS.maxBytes)
    return Promise.resolve({ ok: false, code: 'too_big' });
  if (running >= MAX_CONCURRENT) return Promise.resolve({ ok: false, code: 'busy' });
  running++;
  return new Promise<ExtractResult>((resolve) => {
    let settled = false;
    const done = (result: ExtractResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running--;
      void worker.terminate();
      resolve(result);
    };
    // The bytes are copied into the worker: the caller's buffer stays usable (for hashing).
    const worker = new Worker(new URL('./extract/worker.mjs', import.meta.url), {
      workerData: { bytes: Uint8Array.from(bytes).buffer, fileName, limits: EXTRACT_LIMITS },
      resourceLimits: {
        maxOldGenerationSizeMb: options.heapMb ?? 192,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
      },
      // No environment: the worker must not be able to read keys even if a parser bug ran code.
      env: {},
    });
    const timer = setTimeout(
      () => done({ ok: false, code: 'timeout' }),
      options.timeoutMs ?? 15_000,
    );
    worker.once('message', (message: ExtractResult) => done(message));
    // Out of memory and uncaught errors end here: the file is the problem, not the server.
    worker.once('error', () => done({ ok: false, code: 'corrupt' }));
    worker.once('exit', () => done({ ok: false, code: 'corrupt' }));
  });
}
