import { Worker } from 'node:worker_threads';
import { MooTeamError } from './errors.js';

export interface DocumentResult {
  kind: 'docx' | 'xlsx' | 'pptx' | 'zip';
  text?: string;
  entries?: { name: string; sizeBytes: number; compressedBytes: number; encrypted: boolean }[];
  complete: boolean;
  warnings: string[];
}

export function extractDocument(bytes: Uint8Array, options: { maxCharacters: number; maxPages: number; archiveMember?: string }, timeoutMs: number): Promise<DocumentResult> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const worker = new Worker(new URL('./document-worker.js', import.meta.url), { workerData: { bytes, ...options }, resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true });
    worker.stdout.resume(); worker.stderr.resume();
    const done = (error?: MooTeamError, result?: DocumentResult) => {
      if (finished) return;
      finished = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => done(new MooTeamError('DOCUMENT_TIMEOUT', 'Document extraction exceeded the configured timeout.')), timeoutMs);
    worker.once('message', result => result.error ? done(new MooTeamError('DOCUMENT_EXTRACTION_FAILED', 'Document is corrupt, encrypted, unsupported, or exceeds parser limits.')) : done(undefined, result));
    worker.once('error', () => done(new MooTeamError('DOCUMENT_EXTRACTION_FAILED', 'Document parser failed.')));
    worker.once('exit', () => { if (!finished) done(new MooTeamError('DOCUMENT_EXTRACTION_FAILED', 'Document parser exited before completing.')); });
  });
}
