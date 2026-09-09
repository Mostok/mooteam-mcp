import { Worker } from 'node:worker_threads';
import { MooTeamError } from './errors.js';
import { TaskContextService } from './task-context.js';
import { extractDocument } from './documents.js';

export interface PdfResult { pages: { page: number; text: string }[]; images?: { page: number; data: string; mimeType: string }[]; totalPages: number; pagesRead: number; truncated: boolean; textFound: boolean }
export interface ReadOptions { pdfPages?: number[]; archiveMember?: string; encoding?: 'auto' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251' }

export class AttachmentService {
  constructor(readonly context: TaskContextService) {}

  async read(task: string | number, fileId: number, maxCharacters = 50000, maxPages = 30, options: ReadOptions = {}) {
    const context = await this.context.getContext(task, { commentsLimit: 1 });
    const attachment = context.attachments.find(f => f.fileId === fileId);
    if (!attachment) throw new MooTeamError('ATTACHMENT_NOT_IN_TASK', context.comments.sourceComplete ? 'This file is not an attachment of the requested task or its visible comments.' : 'This file could not be verified because the task comments are incomplete.');
    if (attachment.sizeBytes !== null && attachment.sizeBytes > this.context.api.config.maxAttachmentBytes) throw new MooTeamError('SIZE_LIMIT', 'This attachment exceeds the configured byte limit.');
    const { bytes, mimeType } = await this.context.api.file(fileId);
    this.context.api.log('debug', 'attachment.loaded', { fileId, bytes: bytes.length, mimeType });
    const base = { attachment, downloadedBytes: bytes.length, mimeType };
    const isPdf = Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && [[3, 4], [5, 6], [7, 8]].some(([a, b]) => bytes[2] === a && bytes[3] === b);
    if (options.pdfPages && !isPdf) throw new MooTeamError('UNSUPPORTED_FORMAT', 'Page rendering is supported only for PDF attachments.');
    if (options.archiveMember && !isZip) throw new MooTeamError('UNSUPPORTED_FORMAT', 'Member selection requires a ZIP attachment.');
    const imageMime = imageType(bytes);
    if (imageMime) {
      if (bytes.length > 5 * 1024 * 1024) throw new MooTeamError('IMAGE_OUTPUT_LIMIT', 'This image exceeds the 5 MiB image output limit. Its contents have not been returned.');
      return { ...base, kind: 'image' as const, imageMime, data: Buffer.from(bytes).toString('base64'), complete: true };
    }
    if (isPdf) {
      const pdf = await extractPdf(bytes, maxPages, maxCharacters, this.context.api.config.timeoutMs, options.pdfPages);
      if (options.pdfPages) return { ...base, kind: 'pdf-pages' as const, ...pdf, complete: !pdf.truncated, warnings: ['Selected PDF pages rendered in memory for visual inspection; this is not an OCR transcript or the whole document.', 'PDF.js may omit unsupported features or source images above 16 million pixels.'] };
      return { ...base, kind: 'pdf' as const, ...pdf, complete: !pdf.truncated, warnings: pdf.textFound ? ['PDF text extraction does not include diagrams, image content or OCR.'] : ['No embedded text found. This PDF may require OCR or visual inspection.'] };
    }
    if (isZip) return { ...base, ...await extractDocument(bytes, { maxCharacters, maxPages, archiveMember: options.archiveMember }, this.context.api.config.timeoutMs) };
    if (mimeType.startsWith('text/') || /(?:json|xml|yaml|javascript)/.test(mimeType) || /\.(txt|md|csv|tsv|json|xml|yaml|yml|log|js|ts|css|html|sql|py|php)$/i.test(attachment.name)) {
      let text: string;
      const encoding = options.encoding && options.encoding !== 'auto' ? options.encoding : bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { throw new MooTeamError('UNSUPPORTED_ENCODING', 'Text decoding failed. Use an explicit supported encoding if this is not UTF-8 or BOM-marked UTF-16.'); }
      if (text.includes('\0')) throw new MooTeamError('UNSUPPORTED_FORMAT', 'The file contains binary data and cannot be treated as text.');
      return { ...base, kind: 'text' as const, text: text.slice(0, maxCharacters), encoding, totalCharacters: text.length, complete: text.length <= maxCharacters };
    }
    return { ...base, kind: 'unsupported' as const, complete: false, message: 'Supported: images, PDF text/page images, DOCX/XLSX/PPTX text, ZIP inventory/member text and supported text encodings. Legacy DOC/XLS/PPT, other archives, audio and video are not extracted.' };
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

export function extractPdf(bytes: Uint8Array, maxPages: number, maxCharacters: number, timeoutMs: number, pdfPages?: number[]): Promise<PdfResult> {
  if (pdfPages && (pdfPages.length < 1 || pdfPages.length > 5 || pdfPages.some(p => !Number.isSafeInteger(p) || p < 1))) return Promise.reject(new MooTeamError('INVALID_PDF_PAGES', 'Select 1 to 5 positive PDF page numbers.'));
  return new Promise((resolve, reject) => {
    let finished = false;
    const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: { bytes, maxPages, maxCharacters, pdfPages }, resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true });
    // Parser output is isolated from MCP stdout and may contain document data, so do not forward it.
    worker.stdout.resume(); worker.stderr.resume();
    const timeout = setTimeout(() => { finished = true; void worker.terminate(); reject(new MooTeamError('PDF_TIMEOUT', 'PDF extraction exceeded the configured timeout.')); }, timeoutMs);
    worker.once('message', (result: PdfResult & { error?: string }) => {
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (result.error) reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'Could not read this PDF or selected pages; check page numbers, encryption and rendering limits.'));
      else resolve(result);
    });
    worker.once('error', () => { finished = true; clearTimeout(timeout); reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'The PDF parser failed.')); });
    worker.once('exit', () => { clearTimeout(timeout); if (!finished) reject(new MooTeamError('PDF_EXTRACTION_FAILED', 'The PDF parser exited before completing.')); });
  });
}
