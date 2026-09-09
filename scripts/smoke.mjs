import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const task = process.env.MOOTEAM_SMOKE_TASK;
const fileId = process.env.MOOTEAM_SMOKE_FILE;
if (!task) throw new Error('Set MOOTEAM_SMOKE_TASK to a task ID or URL. This script prints counts only.');
const client = new Client({ name: 'mooteam-smoke', version: '1.0.0' });
try {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [process.env.MOOTEAM_SMOKE_ENTRY || 'dist/cli.js'], env, stderr: 'pipe', maxBufferSize: 20 * 1024 * 1024 }));
  const { tools } = await client.listTools();
  const result = await client.callTool({ name: 'get_task_context', arguments: { task } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  const context = result.structuredContent;
  console.log(JSON.stringify({ tools: tools.map(t => t.name), taskId: context.task.taskId, comments: context.comments.loaded, complete: context.comments.sourceComplete, authors: new Set(context.comments.items.map(c => c.author.userId)).size, attachments: context.attachments.length, warnings: context.warnings.length }));
  if (fileId) {
    const attachment = await client.callTool({ name: 'read_attachment', arguments: { task, fileId: Number(fileId) } });
    if (attachment.isError) throw new Error(JSON.stringify(attachment.content));
    console.log(JSON.stringify({ attachmentKind: attachment.structuredContent.kind, downloadedBytes: attachment.structuredContent.downloadedBytes, contentTypes: attachment.content.map(c => c.type) }));
  }
} finally { await client.close(); }
