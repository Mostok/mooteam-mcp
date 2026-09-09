import { parentPort, workerData } from 'node:worker_threads';
import { posix } from 'node:path';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { SaxesParser } from 'saxes';

interface Node { name: string; attrs: Record<string, string>; children: (Node | string)[] }
const children = (node: Node) => node.children.filter((n): n is Node => typeof n !== 'string');
const all = (node: Node, name: string): Node[] => [...(node.name === name ? [node] : []), ...children(node).flatMap(n => all(n, name))];
const text = (node?: Node): string => node?.children.map(n => typeof n === 'string' ? n : text(n)).join('') ?? '';
function xml(bytes: Buffer): Node {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('DTD unsupported');
  const root: Node = { name: '#document', attrs: {}, children: [] }, stack = [root];
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', tag => {
    if (++nodes > 100000 || stack.length > 128) throw new Error('XML limit');
    const node: Node = { name: tag.local, attrs: {}, children: [] };
    for (const attr of Object.values(tag.attributes)) if (typeof attr !== 'string') node.attrs[attr.uri.endsWith('/relationships') ? `r:${attr.local}` : attr.local] = attr.value;
    stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on('text', value => stack.at(-1)!.children.push(value));
  parser.on('cdata', value => stack.at(-1)!.children.push(value));
  parser.on('closetag', () => { stack.pop(); });
  parser.write(source).close();
  return root;
}

async function main() {
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(Buffer.from(workerData.bytes), { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, z) => error ? reject(error) : resolve(z!)));
  try {
    const entries = new Map<string, Entry>();
    let inventoryComplete = true;
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject); zip.once('end', resolve);
      zip.on('entry', entry => {
        if (entries.size >= 1000) { inventoryComplete = false; resolve(); return; }
        if (entries.has(entry.fileName)) { reject(new Error('Duplicate ZIP path')); return; }
        entries.set(entry.fileName, entry); zip.readEntry();
      });
      zip.readEntry();
    });
    let inflated = 0;
    const read = async (name: string): Promise<Buffer> => {
      const entry = entries.get(name);
      if (!entry || entry.isEncrypted() || entry.uncompressedSize > 8 * 1024 * 1024) throw new Error('Invalid ZIP member');
      return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error); return; }
        const chunks: Buffer[] = []; let size = 0;
        stream.on('data', chunk => {
          size += chunk.length; inflated += chunk.length;
          if (size > 8 * 1024 * 1024 || inflated > 24 * 1024 * 1024) { stream.destroy(new Error('Inflation limit')); return; }
          chunks.push(chunk);
        });
        stream.once('error', reject); stream.once('end', () => resolve(Buffer.concat(chunks)));
      }));
    };
    const warnings: string[] = [];
    let output = '', truncated = false;
    const emit = (value: string) => {
      const room = workerData.maxCharacters - output.length;
      output += value.slice(0, Math.max(0, room));
      if (value.length > room) truncated = true;
    };
    const relationships = async (part: string) => {
      const path = posix.join(posix.dirname(part), '_rels', posix.basename(part) + '.rels');
      const map = new Map<string, string>();
      if (!entries.has(path)) return map;
      for (const r of all(xml(await read(path)), 'Relationship')) {
        if (r.attrs.TargetMode === 'External') continue;
        const target = r.attrs.Target ?? '';
        if (!target || target.includes('\\') || /^[a-z]+:/i.test(target)) throw new Error('Invalid relationship');
        const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(part), target));
        if (resolved.startsWith('../')) throw new Error('Relationship escapes archive');
        map.set(r.attrs.Id!, resolved);
      }
      return map;
    };
    if (workerData.archiveMember) {
      const name = String(workerData.archiveMember);
      if (!/\.(txt|md|csv|tsv|json|xml|yaml|yml|log|js|ts|css|html|sql|py|php)$/i.test(name)) throw new Error('Only text archive members can be read');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await read(name));
      if (source.includes('\0')) throw new Error('Binary archive member');
      emit(source);
      return { kind: 'zip', text: output, complete: !truncated, warnings: ['Only the selected UTF-8 text member was read. Nested archives and external links were not opened.'] };
    }
    const kind = entries.has('word/document.xml') ? 'docx' : entries.has('xl/workbook.xml') ? 'xlsx' : entries.has('ppt/presentation.xml') ? 'pptx' : 'zip';
    if (kind === 'zip') return { kind, entries: [...entries.values()].map(e => ({ name: e.fileName, sizeBytes: e.uncompressedSize, compressedBytes: e.compressedSize, encrypted: e.isEncrypted() })), complete: inventoryComplete, warnings: [inventoryComplete ? 'Archive inventory only; member contents were not read.' : 'Archive inventory stopped after 1000 entries.'] };
    if (!inventoryComplete) throw new Error('Office archive entry limit');
    if (kind === 'docx') {
      const render = (n: Node): string => {
        if (n.name === 'del') return '~~' + children(n).map(render).join('') + '~~';
        if (n.name === 't' || n.name === 'delText') return text(n);
        if (n.name === 'tab') return '\t';
        if (n.name === 'br' || n.name === 'cr') return '\n';
        const inner = children(n).map(render).join('');
        return inner + (['p', 'tr'].includes(n.name) ? '\n' : n.name === 'tc' ? '\t' : '');
      };
      emit(render(xml(await read('word/document.xml'))));
      for (const name of [...entries.keys()].filter(n => /^word\/(header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(n))) {
        if (truncated) break;
        emit(`\n[${name}]\n` + render(xml(await read(name))));
      }
      warnings.push('Extracted document text, tables and notes; layout, drawings and embedded images were not interpreted. Deleted tracked text is struck through.');
    } else if (kind === 'xlsx') {
      const workbook = xml(await read('xl/workbook.xml')), rels = await relationships('xl/workbook.xml');
      const shared = entries.has('xl/sharedStrings.xml') ? all(xml(await read('xl/sharedStrings.xml')), 'si').map(si => all(si, 't').map(text).join('')) : [];
      const sheets = all(workbook, 'sheet'); let cells = 0;
      for (const sheet of sheets.slice(0, workerData.maxPages)) {
        if (truncated) break;
        const path = rels.get(sheet.attrs['r:id']!); if (!path) throw new Error('Missing sheet relation');
        emit(`\n[Sheet: ${sheet.attrs.name ?? ''}]\n`);
        for (const cell of all(xml(await read(path)), 'c')) {
          if (++cells > 10000) { truncated = true; break; }
          const raw = text(all(cell, 'v')[0]);
          let value = cell.attrs.t === 's' ? shared[Number(raw)] : cell.attrs.t === 'inlineStr' ? all(cell, 't').map(text).join('') : cell.attrs.t === 'b' ? (raw === '1' ? 'true' : 'false') : raw;
          if (value === undefined) throw new Error('Invalid shared string index');
          const formula = all(cell, 'f')[0];
          if (formula) value = `=${text(formula)} [cached: ${value}]`;
          emit(`${cell.attrs.r ?? '?'}\t${value}\n`); if (truncated) break;
        }
      }
      if (sheets.length > workerData.maxPages) truncated = true;
      warnings.push('Formulas are never evaluated; cached values may be stale. Numbers/dates are raw stored values. Charts, formatting and images were not interpreted.');
    } else {
      const presentation = xml(await read('ppt/presentation.xml')), rels = await relationships('ppt/presentation.xml');
      const slides = all(presentation, 'sldId');
      for (const [index, slide] of slides.slice(0, workerData.maxPages).entries()) {
        if (truncated) break;
        const path = rels.get(slide.attrs['r:id']!); if (!path) throw new Error('Missing slide relation');
        const content = xml(await read(path));
        emit(`\n[Slide ${index + 1}]\n` + all(content, 'p').map(p => all(p, 't').map(text).join('')).join('\n'));
        for (const target of (await relationships(path)).values()) if (/\/notesSlides\/notesSlide\d+\.xml$/.test(target)) emit('\n[Speaker notes]\n' + all(xml(await read(target)), 'p').map(p => all(p, 't').map(text).join('')).join('\n'));
      }
      if (slides.length > workerData.maxPages) truncated = true;
      warnings.push('Slide text and speaker notes only; images, diagrams, animations and layout were not interpreted.');
    }
    if (truncated) warnings.push('Output stopped at the requested character/page or cell limit.');
    return { kind, text: output, complete: !truncated, warnings };
  } finally { zip.close(); }
}

main().then(result => parentPort!.postMessage(result), () => parentPort!.postMessage({ error: true }));
