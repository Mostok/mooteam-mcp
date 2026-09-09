import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { bytes, maxPages, maxCharacters } = workerData as { bytes: Uint8Array; maxPages: number; maxCharacters: number };
const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0, stopAtErrors: true });
try {
  const pdf = await loading.promise;
  const pages: { page: number; text: string }[] = [];
  let remaining = maxCharacters;
  let truncated = false;
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, maxPages) && remaining > 0; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    try {
      const { items } = await page.getTextContent();
      const text = items.filter(item => 'str' in item).map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      if (text.length > remaining) truncated = true;
      const bounded = text.slice(0, remaining);
      remaining -= bounded.length;
      pages.push({ page: pageNumber, text: bounded });
    } finally { page.cleanup(); }
  }
  parentPort?.postMessage({ pages, totalPages: pdf.numPages, pagesRead: pages.length, truncated: truncated || pages.length < pdf.numPages, textFound: pages.some(p => p.text.trim().length > 0) });
} catch {
  parentPort?.postMessage({ error: 'PDF_EXTRACTION_FAILED' });
} finally { await loading.destroy(); }
