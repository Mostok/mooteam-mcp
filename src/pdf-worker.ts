import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const { bytes, maxPages, maxCharacters, pdfPages } = workerData as { bytes: Uint8Array; maxPages: number; maxCharacters: number; pdfPages?: number[] };
const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0, stopAtErrors: true, maxImageSize: 16000000, canvasMaxAreaInBytes: 16000000 });
try {
  const pdf = await loading.promise;
  const pages: { page: number; text: string }[] = [];
  if (pdfPages) {
    const factory = pdf.canvasFactory as { create(width: number, height: number): { canvas: any; context: any }; destroy(target: unknown): void };
    const images: { page: number; data: string; mimeType: string }[] = [];
    let totalBytes = 0;
    for (const number of [...new Set(pdfPages)]) {
      if (number > pdf.numPages) throw new Error('Page outside document');
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1.5, Math.sqrt(4000000 / (natural.width * natural.height)), 4096 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const target = factory.create(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      try {
        await page.render({ canvasContext: target.context, viewport, canvas: target.canvas }).promise;
        const data: Buffer = target.canvas.toBuffer('image/png');
        totalBytes += data.length;
        if (totalBytes > 5 * 1024 * 1024) throw new Error('Rendered image size limit');
        images.push({ page: number, data: data.toString('base64'), mimeType: 'image/png' });
      } finally { factory.destroy(target); page.cleanup(); }
    }
    parentPort?.postMessage({ pages: [], images, totalPages: pdf.numPages, pagesRead: images.length, truncated: false, textFound: false });
  } else {
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
  }
} catch {
  parentPort?.postMessage({ error: 'PDF_EXTRACTION_FAILED' });
} finally { await loading.destroy(); }
