import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('standalone stdio process exposes read-only tools and returns text and image content', async () => {
  const client = new Client({ name: 'synthetic-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['test/server-fixture.mjs'], stderr: 'pipe' }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['get_task_context', 'read_attachment']);
    assert.ok(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
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
