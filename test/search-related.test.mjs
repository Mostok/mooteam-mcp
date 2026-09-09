import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../dist/api-client.js';
import { SearchService } from '../dist/search.js';
import { RelatedService } from '../dist/related.js';
import { TaskContextService } from '../dist/task-context.js';
import { config, fixtureFetch, draft } from './fixtures.mjs';

test('search locally verifies filters and reports incomplete scan versus returned pagination', async () => {
  const api = new ApiClient(config, () => {}, async () => Response.json({ items: [
    { taskId: 1, projectId: 45, userId: 20, status: 'active', header: 'Gift task' },
    { taskId: 2, projectId: 99, userId: 20, status: 'active', header: 'Gift task' },
    { taskId: 3, projectId: 45, userId: 10, status: 'active', header: 'Gift task' },
  ], _meta: { totalCount: 6, pageCount: 2, currentPage: 1 } }));
  const result = await new SearchService(api).tasks({ query: 'gift', projectId: 45, assigneeId: 20, status: 'active', maxPages: 1 });
  assert.deepEqual(result.items.map(t => t.taskId), [1]);
  assert.equal(result.sourceComplete, false);
  assert.ok(result.warnings.length);
});

test('inaccessible related tasks consume the traversal attempt budget', async () => {
  let attempts = 0;
  const fallback = fixtureFetch({ taskOverrides: { hasSubTasks: true }, comments: [] });
  const api = new ApiClient(config, () => {}, async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/api/tasks') return Response.json({ items: [124, 125, 126].map(taskId => ({ taskId, parentId: 123 })), _meta: { totalCount: 3, pageCount: 1, currentPage: 1 } });
    if (/\/tasks\/(124|125|126)$/.test(url.pathname)) { attempts++; return new Response('', { status: 404 }); }
    return fallback(input, init);
  });
  const result = await new RelatedService(new TaskContextService(api)).read(123, 1, 1);
  assert.equal(attempts, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some(w => w.includes('maxTasks=1')));
});

test('related tasks retain link provenance, follow parents/children, and avoid cycles and external URLs', async () => {
  const requests = [];
  const fallback = fixtureFetch();
  const api = new ApiClient(config, () => {}, async (input, init) => {
    const url = new URL(input); requests.push(url.pathname);
    if (url.pathname === '/api/tasks/123') return Response.json({ taskId: 123, projectId: 45, parentId: 124, hasSubTasks: true, description: draft('https://app.moo.team/WSfixture/tasks/125 and https://evil.test/tasks/900') });
    if (url.pathname === '/api/tasks') return Response.json({ items: [{ taskId: 125, parentId: 123 }], _meta: { totalCount: 1, pageCount: 1, currentPage: 1 } });
    if (/\/tasks\/(124|125)$/.test(url.pathname)) return Response.json({ taskId: Number(url.pathname.split('/').at(-1)), projectId: 45, parentId: 123, description: draft('Child') });
    if (url.pathname === '/api/comments') return Response.json({ items: [], _meta: { totalCount: 0, pageCount: 0, currentPage: 1 } });
    return fallback(input, init);
  });
  const result = await new RelatedService(new TaskContextService(api)).read(123, 10, 2);
  assert.deepEqual(result.tasks.map(c => c.task.taskId), [124, 125]);
  assert.ok(result.edges.some(e => e.kind === 'mentioned' && e.to === 125));
  assert.ok(result.edges.some(e => e.kind === 'subtask' && e.to === 125));
  assert.equal(requests.filter(p => p === '/api/tasks/123').length, 1);
  assert.ok(!requests.some(p => p.includes('900')));
  assert.equal(result.complete, true);
});
