#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, defaultConfigPath } from './config.js';
import { ApiClient } from './api-client.js';
import { publicError } from './errors.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`mooteam-mcp 0.2.0 — read-only Moo.team API server\n\nUsage: mooteam-mcp [--check | --version | --help]\n\nWithout arguments, starts the MCP server over stdio. No browser required.\n\nConfiguration: MOOTEAM_API_TOKEN and MOOTEAM_COMPANY_ALIAS environment variables,\nor JSON file at ${defaultConfigPath()}\nwith { "token": "...", "company": "..." }.\nMOOTEAM_CONFIG_FILE overrides this path. Environment credentials override the file.\nMOOTEAM_FILE_TOKEN is optional, used only if Bearer-authenticated file access fails.\n\n--check validates credentials with a read-only API request.\nLOG_LEVEL=debug|info|warn|error|silent controls stderr logging.\n`);
} else if (args.includes('--version')) {
  process.stdout.write('0.2.0\n');
} else {
  try {
    if (args.some(a => a !== '--check')) throw new Error('Unknown argument');
    const config = loadConfig();
    const log = createLogger(config.logLevel);
    if (args.includes('--check')) {
      await new ApiClient(config, log).json('/task-statuses', { fields: 'statusId', 'per-page': 0 });
      process.stdout.write('Moo.team API authentication OK (read-only).\n');
    } else {
      log('info', 'server.start', { version: '0.2.0', transport: 'stdio' });
      const handle = serveStdio(() => createServer(config));
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void handle.close().then(() => process.exit(0)); });
    }
  } catch (error) {
    process.stderr.write(JSON.stringify(publicError(error)) + '\n');
    process.exitCode = 1;
  }
}
