import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MooTeamError } from './errors.js';
import type { LogLevel } from './logger.js';

export interface Config {
  token: string;
  company: string;
  fileToken?: string;
  timeoutMs: number;
  maxPages: number;
  maxAttachmentBytes: number;
  logLevel: LogLevel;
}

export const defaultConfigPath = () => join(homedir(), '.config', 'mooteam-mcp', 'config.json');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const path = env.MOOTEAM_CONFIG_FILE || defaultConfigPath();
  let local: Record<string, unknown> = {};
  if (existsSync(path)) {
    try { local = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new MooTeamError('CONFIG_INVALID', 'The local Moo.team config file is not valid JSON.'); }
    if (!local || typeof local !== 'object' || Array.isArray(local)) throw new MooTeamError('CONFIG_INVALID', 'The config must be a JSON object.');
  } else if (env.MOOTEAM_CONFIG_FILE) {
    throw new MooTeamError('CONFIG_MISSING', 'MOOTEAM_CONFIG_FILE does not exist.');
  }
  const token = String(env.MOOTEAM_API_TOKEN ?? local.token ?? '').replace(/^Bearer\s+/i, '').trim();
  const company = String(env.MOOTEAM_COMPANY_ALIAS ?? local.company ?? '').trim();
  const fileToken = String(env.MOOTEAM_FILE_TOKEN ?? local.fileToken ?? '').trim() || undefined;
  if (!token || !company) throw new MooTeamError('CONFIG_MISSING', 'Set MOOTEAM_API_TOKEN and MOOTEAM_COMPANY_ALIAS, or create the local config file (see --help).');
  if (/[\r\n]/.test(token + company + (fileToken || ''))) throw new MooTeamError('CONFIG_INVALID', 'Credentials must be single-line values.');
  if (!/^[A-Za-z0-9_-]+$/.test(company)) throw new MooTeamError('CONFIG_INVALID', 'Invalid company alias.');
  const logLevel = env.LOG_LEVEL || 'info';
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) throw new MooTeamError('CONFIG_INVALID', 'LOG_LEVEL must be debug, info, warn, error or silent.');
  return { token, company, fileToken, timeoutMs: integer(env.MOOTEAM_TIMEOUT_MS, 30000, 1000, 120000), maxPages: integer(env.MOOTEAM_MAX_PAGES, 100, 1, 1000), maxAttachmentBytes: integer(env.MOOTEAM_MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024, 1024, 50 * 1024 * 1024), logLevel: logLevel as LogLevel };
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new MooTeamError('CONFIG_INVALID', `Numeric setting must be an integer between ${min} and ${max}.`);
  return n;
}
