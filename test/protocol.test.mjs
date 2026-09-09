import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('standalone stdio process exposes GET-only remote tools and returns text and image content', async () => {
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['test/server-fixture.mjs'], stderr: 'pipe' }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['get_related_tasks', 'get_task_changes', 'get_task_context', 'list_participants', 'list_projects', 'read_attachment', 'search_tasks', 'set_participant_role']);
    assert.ok(tools.every(t => !t.annotations.destructiveHint));
    assert.equal(tools.find(t => t.name === 'set_participant_role').annotations.readOnlyHint, false);
    assert.equal(tools.find(t => t.name === 'search_tasks').annotations.readOnlyHint, true);
    const context = await client.callTool({ name: 'get_task_context', arguments: { task: '123' } });
    assert.notEqual(context.isError, true);
    assert.equal(context.structuredContent.comments.loaded, 21);
    const file = await client.callTool({ name: 'read_attachment', arguments: { task: '123', fileId: 900 } });
    assert.notEqual(file.isError, true);
    assert.equal(file.content[1].type, 'image');
    const rejected = await client.callTool({ name: 'get_task_context', arguments: { task: 'https://evil.test/123' } });
    assert.equal(rejected.isError, true);
  } finally { await client.close(); }
});

test('stdio tools integrate compact history, local roles, search and in-memory PDF rendering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mooteam-protocol-'));
  const client = new Client({ name: 'synthetic-expanded-test', version: '1.0.0' });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result;
  };
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['test/server-fixture.mjs'], stderr: 'pipe', env: { ...process.env, SYNTHETIC_STATE_DIR: dir } }));
    const first = (await call('get_task_context', { task: 123, commentsLimit: 1 })).structuredContent;
    assert.equal(first.changesSincePreviousRead.baselineCreated, true);
    const again = (await call('get_task_changes', { task: 123 })).structuredContent;
    assert.equal(again.changed, false);
    assert.equal((await call('list_projects')).structuredContent.items[0].projectId, 45);
    assert.equal((await call('search_tasks', { query: 'synthetic', projectId: 45 })).structuredContent.items[0].taskId, 123);
    assert.equal((await call('list_participants', { query: 'Alex' })).structuredContent.items[0].userId, 10);
    await call('set_participant_role', { userId: 10, expectedName: 'Alex Example', role: 'QA', userConfirmed: true });
    const roleRead = (await call('get_task_context', { task: 123, trackChanges: false })).structuredContent;
    assert.equal(roleRead.task.creator.role, 'QA');
    assert.equal(roleRead.changesSincePreviousRead.baselineUpdated, false);
    assert.equal((await call('get_related_tasks', { task: 123 })).structuredContent.tasks.length, 0);
    const pages = await call('read_attachment', { task: 123, fileId: 900, pdfPages: [1] });
    assert.equal(pages.content[1].type, 'image');
    assert.deepEqual(pages.structuredContent.renderedPageNumbers, [1]);
    assert.equal(pages.structuredContent.images, undefined);
    assert.deepEqual((await readdir(dir)).sort(), ['history.json.gz', 'roles.json']);
  } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
});
