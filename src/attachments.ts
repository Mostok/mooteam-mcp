import { Worker } from 'node:worker_threads';
import { MooTeamError } from './errors.js';
import { TaskContextService } from './task-context.js';

export interface PdfResult { pages: { page: number; text: string }[]; totalPages: number; pagesRead: number; truncated: boolean; textFound: boolean }

export class AttachmentService {
  constructor(readonly context: TaskContextService) {}

  async read(task: string | number, fileId: number, maxCharacters = 50000, maxPages = 30) {
    const context = await this.context.getContext(task, { commentsLimit: 1 });
    const attachment = context.attachments.find(f => f.fileId === fileId);
    if (!attachment) throw new MooTeamError('ATTACHMENT_NOT_IN_TASK', context.comments.sourceComplete ? 'This file is not an attachment of the requested task or its visible comments.' : 'This file could not be verified because the task comments are incomplete.');
    if (attachment.sizeBytes !== null && attachment.sizeBytes > this.context.api.config.maxAttachmentBytes) throw new MooTeamError('SIZE_LIMIT', 'This attachment exceeds the configured byte limit.');
    const { bytes, mimeType } = await this.context.api.file(fileId);
    this.context.api.log('debug', 'attachment.loaded', { fileId, bytes: bytes.length, mimeType });
    const base = { attachment, downloadedBytes: bytes.length, mimeType };
    const imageMime = imageType(bytes);
    if (imageMime) {
      if (bytes.length > 5 * 1024 * 1024) throw new MooTeamError('IMAGE_OUTPUT_LIMIT', 'This image exceeds the 5 MiB image output limit. Its contents have not been returned.');
      return { ...base, kind: 'image' as const, imageMime, data: Buffer.from(bytes).toString('base64'), complete: true };
    }
    if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-') {
      const pdf = await extractPdf(bytes, maxPages, maxCharacters, this.context.api.config.timeoutMs);
      return { ...base, kind: 'pdf' as const, ...pdf, complete: !pdf.truncated, warnings: pdf.textFound ? ['PDF text extraction does not include diagrams, image content or OCR.'] : ['No embedded text found. This PDF may require OCR or visual inspection.'] };
    }
    if (mimeType.startsWith('text/') || /(?:json|xml|yaml|javascript)/.test(mimeType) || /\.(txt|md|csv|tsv|json|xml|yaml|yml|log|js|ts|css|html|sql|py|php)$/i.test(attachment.name)) {
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new MooTeamError('UNSUPPORTED_ENCODING', 'This file is not valid UTF-8 text. Its contents were not decoded.'); }
      if (text.includes('\0')) throw new MooTeamError('UNSUPPORTED_FORMAT', 'The file contains binary data and cannot be treated as text.');
      return { ...base, kind: 'text' as const, text: text.slice(0, maxCharacters), totalCharacters: text.length, complete: text.length <= maxCharacters };
    }
    return { ...base, kind: 'unsupported' as const, complete: false, message: 'This version reads PNG/JPEG/WebP/GIF images, PDF embedded text and UTF-8 text files. Other files are identified but their contents are not extracted.' };
  }
}

function imageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function extractPdf(bytes: Uint8Array, maxPages: number, maxCharacters: number, timeoutMs: number): Promise<PdfResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: { bytes, maxPages, maxCharacters }, resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true });
    // Parser output is isolated from MCP stdout and may contain document data, so do not forward it.
    worker.stdout.resume(); worker.stderr.resume();
    const timeout = setTimeout(() => { void worker.terminate(); reject(new MooTeamError('PDF_TIMEOUT', 'PDF extraction exceeded the configured timeout.')); }, timeoutMs);
    worker.once('message', (result: PdfResult & { error?: string }) => {
      clearTimeout(timeout);
      void worker.terminate();
      if (result.error) reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'Could not extract text from this PDF; it may be encrypted or unsupported.'));
      else resolve(result);
    });
    worker.once('error', () => { clearTimeout(timeout); reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'The PDF parser failed.')); });
    worker.once('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'The PDF parser exited before completing.')); });
  });
}
