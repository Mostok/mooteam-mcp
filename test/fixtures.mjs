export const config = { token: 'synthetic-test-token', company: 'WSfixture', timeoutMs: 1000, maxPages: 10, maxAttachmentBytes: 1024 * 1024, logLevel: 'silent' };
export const draft = (text) => ({ blocks: [{ text, type: 'unstyled', entityRanges: [] }], entityMap: [] });
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
export const file = (fileId, entity, entityId) => ({ fileId, entity, entityId, name: 'screenshot', extension: 'png', type: 'image/png', rawSize: png.length, uploadedBy: 10 });
export function comment(n) { return { commentId: n, entity: 'task', entityId: 123, createdBy: n % 2 ? 10 : 20, updatedBy: n % 2 ? 10 : 20, authorName: n % 2 ? 'Alex Example' : 'Sam Example', timeCreated: `2026-01-01 12:00:${String(n).padStart(2, '0')}`, parentId: n === 2 ? 1 : null, replyId: n === 2 ? 1 : null, newContent: draft(`Comment ${n}`), content: { children: [{ text: '' }] }, files: n === 2 ? [file(901, 'comment', 2)] : [] }; }
export function fixtureFetch({ comments = Array.from({ length: 21 }, (_, i) => comment(21 - i)), taskOverrides = {}, onRequest = () => {}, fileBytes = png, fileMime = 'image/png' } = {}) {
  return async (input, init) => {
    const url = new URL(input); onRequest(url, init);
    if (init.method !== 'GET') throw new Error('Writes are forbidden');
    if (url.origin !== 'https://api.moo.team') throw new Error('Unexpected host');
    let body;
    if (url.pathname === '/api/tasks/123') body = { taskId: 123, projectId: 45, companyId: 1, header: 'Synthetic task', userId: 20, creatorId: 10, statusId: 3, description: draft('Task description'), files: [file(900, 'task', 123)], ...taskOverrides };
    else if (url.pathname === '/api/comments') { const page = Number(url.searchParams.get('page')); body = { items: comments.slice((page - 1) * 20, page * 20), _meta: { totalCount: comments.length, pageCount: Math.ceil(comments.length / 20), currentPage: page, perPage: 20 } }; }
    else if (url.pathname === '/api/user-profiles') body = { items: [{ userId: 10, firstname: 'Alex', lastname: 'Example' }, { userId: 20, firstname: 'Sam', lastname: 'Example' }] };
    else if (url.pathname === '/api/task-statuses') body = { items: [{ statusId: 3, name: 'In progress' }] };
    else if (url.pathname === '/api/activity-logs/task/123') body = { items: [], _meta: { totalCount: 0, pageCount: 0, currentPage: 1 } };
    else if (/^\/api\/files\/90[01]$/.test(url.pathname)) return new Response(fileBytes, { headers: { 'content-type': fileMime } });
    else return new Response('not found', { status: 404 });
    return Response.json(body);
  };
}
