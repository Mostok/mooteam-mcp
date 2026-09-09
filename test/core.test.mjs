import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, readLimited } from '../dist/api-client.js';
import { TaskContextService } from '../dist/task-context.js';
import { AttachmentService, extractPdf } from '../dist/attachments.js';
import { parseTaskReference } from '../dist/task-reference.js';
import { renderRichText, preferredRichText } from '../dist/rich-text.js';
import { redact } from '../dist/server.js';
import { config, fixtureFetch, draft, comment, png } from './fixtures.mjs';

const service = (options, settings = config) => new TaskContextService(new ApiClient(settings, () => {}, fixtureFetch(options)));

test('accepts task IDs and both UI URL forms while rejecting foreign and invalid URLs', () => {
  assert.equal(parseTaskReference('123').taskId, 123);
  assert.deepEqual(parseTaskReference('https://app.moo.team/WSfixture/projects/45/tasks/123#comment-2'), { taskId: 123, projectId: 45, workspace: 'WSfixture', commentId: 2 });
  assert.equal(parseTaskReference('https://new-app.moo.team/WSfixture/home?modal=task-view&taskId=123').taskId, 123);
  for (const value of ['0', '-1', '9007199254740993', 'https://evil.test/WSfixture/tasks/123', 'http://app.moo.team/WSfixture/tasks/123', 'https://user:pass@app.moo.team/WSfixture/tasks/123']) assert.throws(() => parseTaskReference(value));
});

test('assembles every comment page, attributes authors, replies and file ownership', async () => {
  const calls = [];
  const result = await service({ onRequest: (url, init) => calls.push({ url, init }) }).getContext(123);
  assert.equal(result.comments.loaded, 21);
  assert.equal(result.comments.sourceComplete, true);
  assert.equal(result.comments.items[0].author.name, 'Alex Example');
  assert.equal(result.comments.items[1].author.name, 'Sam Example');
  assert.equal(result.comments.items[1].replyToCommentId, 1);
  assert.equal(result.comments.items[1].body.markdown, 'Comment 2');
  assert.equal(result.task.workflowStatus.name, 'In progress');
  assert.deepEqual(result.attachments.map(f => f.source), [{ kind: 'task', id: 123 }, { kind: 'comment', id: 2 }]);
  assert.equal(calls.filter(c => c.url.pathname === '/api/comments').length, 2);
  assert.ok(calls.every(c => c.init.method === 'GET' && c.init.redirect === 'manual'));
});

test('returned comment windows expose continuation independently of source completeness', async () => {
  const s = service();
  const first = await s.getContext(123, { commentsLimit: 2 });
  assert.equal(first.comments.nextOffset, 2);
  assert.equal(first.comments.allIncluded, false);
  const next = await s.getContext(123, { commentsOffset: 2, commentsLimit: 2 });
  assert.equal(next.comments.items[0].commentId, 3);
  assert.equal(next.attachments.length, 2);
});

test('page limit, repeated pages and failed subsequent pages cannot report complete', async () => {
  const capped = await service(undefined, { ...config, maxPages: 1 }).getContext(123);
  assert.equal(capped.comments.sourceComplete, false);
  assert.match(capped.warnings.join(' '), /limit/);
  const repeated = new ApiClient(config, () => {}, async () => Response.json({ items: [{ commentId: 1 }], _meta: { totalCount: 2, pageCount: 2 } }));
  assert.equal((await repeated.collection('/comments')).complete, false);
  let count = 0;
  const failing = new ApiClient(config, () => {}, async () => ++count === 1 ? Response.json({ items: [{ commentId: 1 }], _meta: { totalCount: 2, pageCount: 2, currentPage: 1 } }) : new Response('', { status: 500 }));
  assert.equal((await failing.collection('/comments')).complete, false);
});

test('rejects mismatched task project and excludes unexpected comment/file owners', async () => {
  await assert.rejects(service().getContext('https://app.moo.team/WSfixture/projects/999/tasks/123'), { code: 'TASK_SCOPE_MISMATCH' });
  const c = comment(1); c.entityId = 999;
  const result = await service({ comments: [c] }).getContext(123);
  assert.equal(result.comments.loaded, 0);
  assert.equal(result.comments.sourceComplete, false);
  const bad = await service({ taskOverrides: { files: [{ fileId: 900, entity: 'task', entityId: 999 }] } }).getContext(123);
  assert.ok(!bad.attachments.some(f => f.fileId === 900));
});

test('rich text preserves image positions, links and mentions from entity ranges', () => {
  const body = renderRichText({ blocks: [{ text: 'X link @Sam', entityRanges: [{ offset: 0, length: 1, key: 0 }, { offset: 2, length: 4, key: 1 }, { offset: 7, length: 4, key: 2 }] }], entityMap: [{ type: 'IMAGE', data: { fileId: 900, name: 'shot.png' } }, { type: 'hyperlink', data: { url: 'https://example.com/?token=secret&x=1' } }, { type: 'MENTION', data: { userId: 20 } }] });
  assert.ok(body.markdown.startsWith('[shot.png](mooteam://files/900)'));
  assert.equal(body.links[0].url, 'https://example.com/?x=1');
  assert.deepEqual(body.inlineFileIds, [900]);
  assert.equal(body.mentions[0].userId, 20);
});

test('uses newContent when legacy content is empty, and reads tree-form editor content', () => {
  assert.equal(preferredRichText(draft('Actual text'), { children: [{ text: '' }] }).markdown, 'Actual text');
  const body = renderRichText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Specification', marks: [{ type: 'link', attrs: { href: 'https://example.com/spec' } }] }] }] });
  assert.equal(body.links[0].url, 'https://example.com/spec');
  assert.match(renderRichText({ unexpected: 'data' }).warnings.join(' '), /Unsupported/);
});

test('auth failures, redirects and arbitrary API routes are explicitly rejected', async () => {
  for (const [status, code] of [[401, 'AUTH_EXPIRED'], [403, 'ACCESS_DENIED'], [302, 'REDIRECT_BLOCKED']]) {
    const client = new ApiClient(config, () => {}, async () => new Response('secret backend data', { status, headers: { location: 'https://evil.test' } }));
    await assert.rejects(client.json('/tasks/123'), { code });
  }
  const client = new ApiClient(config, () => {}, fixtureFetch());
  await assert.rejects(client.json('/credentials'), { code: 'ROUTE_NOT_ALLOWED' });
});

test('streaming response limit applies even without content-length', async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); controller.close(); } });
  await assert.rejects(readLimited(new Response(body), 10), { code: 'SIZE_LIMIT' });
});

test('only a verified task attachment can be read and binary image content is preserved', async () => {
  const calls = [];
  const s = new AttachmentService(service({ onRequest: url => calls.push(url.pathname) }));
  await assert.rejects(s.read(123, 999), { code: 'ATTACHMENT_NOT_IN_TASK' });
  assert.ok(!calls.some(p => p.startsWith('/api/files/')));
  const result = await s.read(123, 901);
  assert.equal(result.kind, 'image');
  assert.deepEqual(Buffer.from(result.data, 'base64'), png);
});

test('UTF-8 extraction reports truncation and unsupported binary stays unread', async () => {
  const text = await new AttachmentService(service({ fileBytes: Buffer.from('hello world'), fileMime: 'text/plain' })).read(123, 900, 5);
  assert.equal(text.kind, 'text'); assert.equal(text.text, 'hello'); assert.equal(text.complete, false);
  const binary = await new AttachmentService(service({ fileBytes: new Uint8Array([0, 1, 2]), fileMime: 'application/zip' })).read(123, 900);
  assert.equal(binary.kind, 'unsupported'); assert.equal(binary.complete, false);
});

test('configured tokens and signed URLs never appear in serialized results', () => {
  const result = redact({ text: config.token, link: 'https://api.moo.team/api/files/1?token=other-secret&download=1' }, config);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(config.token)); assert.ok(!text.includes('other-secret'));
});

test('signed query policy covers cloud signatures and encoded keys in plain text and entities', () => {
  const source = 'https://storage.example/file?X-Amz-Signature=cloud-secret&%74oken=encoded-secret&sig=short-secret&part=1';
  const result = redact({ markdown: `[file](${source})` }, config);
  for (const secret of ['cloud-secret', 'encoded-secret', 'short-secret']) assert.ok(!result.markdown.includes(secret));
  const body = renderRichText({ type: 'link', url: source, children: [{ text: 'file' }] });
  assert.equal(body.links[0].url, 'https://storage.example/file?part=1');
});

test('preserves struck-through requirements and separates table cells', () => {
  const struck = renderRichText({ blocks: [{ text: 'Old requirement', inlineStyleRanges: [{ offset: 0, length: 15, style: 'STRIKETHROUGH' }] }] });
  assert.equal(struck.markdown, '~~Old requirement~~');
  const table = renderRichText({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'text', text: 'A' }] }, { type: 'tableCell', content: [{ type: 'text', text: 'B' }] }] }] });
  assert.match(table.markdown, /A\tB/);
  const treeStrike = renderRichText({ type: 'text', text: 'Old', marks: [{ type: 'strike' }] });
  assert.equal(treeStrike.markdown, '~~Old~~');
});

test('oversized image returns a readable error before exceeding the protocol frame limit', async () => {
  const big = Buffer.alloc(6 * 1024 * 1024); png.copy(big);
  const s = service({ fileBytes: big }, { ...config, maxAttachmentBytes: 10 * 1024 * 1024 });
  await assert.rejects(new AttachmentService(s).read(123, 900), { code: 'IMAGE_OUTPUT_LIMIT' });
});

function tinyPdf() {
  const stream = 'BT /F1 12 Tf 10 100 Td (Synthetic PDF text) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('PDF extraction runs in an isolated worker and reports character truncation', async () => {
  const full = await extractPdf(tinyPdf(), 1, 1000, 10000);
  assert.match(full.pages[0].text, /Synthetic PDF text/);
  assert.equal(full.totalPages, 1); assert.equal(full.truncated, false);
  const limited = await extractPdf(tinyPdf(), 1, 5, 10000);
  assert.equal(limited.pages[0].text.length, 5); assert.equal(limited.truncated, true);
});
