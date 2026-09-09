import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../dist/server.js';
import { config, fixtureFetch } from './fixtures.mjs';
import { visualPdf } from './binary-fixtures.mjs';
const expanded = Boolean(process.env.SYNTHETIC_STATE_DIR);
const settings = expanded ? { ...config, timeoutMs: process.env.CI ? 60000 : 10000, historyFile: `${process.env.SYNTHETIC_STATE_DIR}/history.json.gz`, rolesFile: `${process.env.SYNTHETIC_STATE_DIR}/roles.json` } : config;
const fallback = fixtureFetch(expanded ? { fileBytes: visualPdf(), fileMime: 'application/pdf' } : {});
const fetcher = async (input, init) => {
  const url = new URL(input);
  if (init.method !== 'GET' || url.origin !== 'https://api.moo.team') throw new Error('Unexpected request');
  const items = url.pathname === '/api/tasks' ? [{ taskId: 123, header: 'Synthetic task', projectId: 45, userId: 20 }] : url.pathname === '/api/projects' ? [{ projectId: 45, name: 'Synthetic project' }] : null;
  if (items) return Response.json({ items, _meta: { totalCount: items.length, pageCount: 1, currentPage: 1 } });
  return fallback(input, init);
};
serveStdio(() => createServer(settings, fetcher));
