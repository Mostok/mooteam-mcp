import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from '../dist/server.js';
import { config, fixtureFetch } from './fixtures.mjs';
serveStdio(() => createServer(config, fixtureFetch()));
