import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument } from '../dist/documents.js';
import { extractPdf, AttachmentService } from '../dist/attachments.js';
import { TaskContextService } from '../dist/task-context.js';
import { ApiClient } from '../dist/api-client.js';
import { config, fixtureFetch } from './fixtures.mjs';
import { zip, visualPdf } from './binary-fixtures.mjs';

const extract = (files, options = {}) => extractDocument(zip(files), { maxCharacters: 50000, maxPages: 30, ...options }, process.env.CI ? 60000 : 10000);
const rels = relationships => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;

test('DOCX preserves paragraphs, table cells and deleted revisions without writing attachments', async () => {
  const result = await extract({ 'word/document.xml': '<d:document xmlns:d="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><d:body><d:p><d:r><d:t>Hello</d:t></d:r><d:del><d:r><d:delText>old</d:delText></d:r></d:del></d:p><d:tbl><d:tr><d:tc><d:p><d:r><d:t>A</d:t></d:r></d:p></d:tc><d:tc><d:p><d:r><d:t>B</d:t></d:r></d:p></d:tc></d:tr></d:tbl></d:body></d:document>' });
  assert.equal(result.kind, 'docx'); assert.match(result.text, /Hello~~old~~\n/); assert.match(result.text, /A\n\tB/); assert.equal(result.complete, true);
});

test('XLSX follows workbook order and keeps shared strings, sparse addresses and cached formulas', async () => {
  const result = await extract({
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Second first" r:id="r2"/><sheet name="First second" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': rels('<Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/>'),
    'xl/sharedStrings.xml': '<sst><si><t>Shared value</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="Z9"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c></row></sheetData></worksheet>',
  });
  assert.equal(result.kind, 'xlsx'); assert.ok(result.text.indexOf('Second first') < result.text.indexOf('First second')); assert.match(result.text, /A1\tShared value/); assert.match(result.text, /C1\tInline/); assert.match(result.text, /Z9\t=1\+2 \[cached: 3\]/);
});

test('PPTX follows presentation relationships and extracts speaker notes', async () => {
  const result = await extract({
    'ppt/presentation.xml': '<presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sldIdLst><sldId r:id="r2"/><sldId r:id="r1"/></sldIdLst></presentation>',
    'ppt/_rels/presentation.xml.rels': rels('<Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/>'),
    'ppt/slides/slide1.xml': '<sld><p><t>Later</t></p></sld>',
    'ppt/slides/slide2.xml': '<sld><p><t>Earlier</t></p></sld>',
    'ppt/slides/_rels/slide2.xml.rels': rels('<Relationship Id="n" Target="../notesSlides/notesSlide1.xml"/>'),
    'ppt/notesSlides/notesSlide1.xml': '<notes><p><t>Private speaker note</t></p></notes>',
  });
  assert.equal(result.kind, 'pptx'); assert.ok(result.text.indexOf('Earlier') < result.text.indexOf('Later')); assert.match(result.text, /Speaker notes.*\nPrivate speaker note/);
});

test('ZIP returns inventory or one text member, reports truncation and rejects oversized/XML entity content', async () => {
  const inventory = await extract({ 'readme.txt': 'Hello archive', 'nested.zip': 'not opened' });
  assert.equal(inventory.kind, 'zip'); assert.equal(inventory.text, undefined); assert.equal(inventory.entries.length, 2);
  const member = await extract({ 'readme.txt': 'Hello archive' }, { archiveMember: 'readme.txt', maxCharacters: 5 });
  assert.equal(member.text, 'Hello'); assert.equal(member.complete, false);
  await assert.rejects(extract({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///secret">]><x>&leak;</x>' }), { code: 'DOCUMENT_EXTRACTION_FAILED' });
  await assert.rejects(extract({ 'word/document.xml': 'x'.repeat(8 * 1024 * 1024 + 1) }), { code: 'DOCUMENT_EXTRACTION_FAILED' });
  await assert.rejects(extract({ 'nested.zip': 'contents' }, { archiveMember: 'nested.zip' }), { code: 'DOCUMENT_EXTRACTION_FAILED' });
});

test('PDF without text renders a bounded image in memory and rejects invalid pages', async () => {
  const timeout = process.env.CI ? 60000 : 10000;
  const empty = await extractPdf(visualPdf(), 1, 1000, timeout);
  assert.equal(empty.textFound, false);
  const visual = await extractPdf(visualPdf(), 1, 1000, timeout, [1]);
  assert.equal(visual.images.length, 1); assert.equal(visual.images[0].mimeType, 'image/png');
  assert.equal(Buffer.from(visual.images[0].data, 'base64').subarray(1, 4).toString(), 'PNG');
  await assert.rejects(extractPdf(visualPdf(), 1, 1000, timeout, [2]));
  await assert.rejects(extractPdf(visualPdf(), 1, 1000, timeout, [1, 2, 3, 4, 5, 6]), { code: 'INVALID_PDF_PAGES' });
});

test('text attachment BOM detection supports UTF-16 while explicit encoding is preserved', async () => {
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from('Hello unicode', 'utf16le')]);
  const service = new AttachmentService(new TaskContextService(new ApiClient(config, () => {}, fixtureFetch({ fileBytes: bytes, fileMime: 'text/plain' }))));
  const r = await service.read(123, 900);
  assert.equal(r.text, 'Hello unicode'); assert.equal(r.encoding, 'utf-16le');
});
