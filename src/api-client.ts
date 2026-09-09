import type { Config } from './config.js';
import { MooTeamError } from './errors.js';
import type { Logger } from './logger.js';
import { array, record, type PageResult, type RecordData } from './types.js';

const API_BASE = 'https://api.moo.team/api';
const READ_ROUTES = /^\/(?:tasks(?:\/\d+)?|comments|user-profiles|task-statuses|projects(?:\/\d+)?|activity-logs\/task\/\d+|files\/\d+)$/;

export class ApiClient {
  constructor(readonly config: Config, readonly log: Logger, private readonly fetcher: typeof fetch = fetch) {}

  async json(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const response = await this.get(path, params);
    const bytes = await readLimited(response, 8 * 1024 * 1024);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new MooTeamError('INVALID_RESPONSE', 'Moo.team returned an invalid JSON response.'); }
  }

  async collection(path: string, params: Record<string, string | number> = {}, maxPages = this.config.maxPages): Promise<PageResult> {
    const result: PageResult = { items: [], complete: false, total: null, pagesRead: 0, warnings: [] };
    const seen = new Set<string>();
    for (let page = 1; page <= Math.min(maxPages, this.config.maxPages); page++) {
      let raw: unknown;
      try { raw = await this.json(path, { ...params, page }); }
      catch (error) {
        if (page === 1 || (error instanceof MooTeamError && error.code === 'AUTH_EXPIRED')) throw error;
        result.warnings.push(`Could not load page ${page}.`);
        return result;
      }
      const body = record(raw);
      const items = Array.isArray(raw) ? raw : body.items;
      if (!Array.isArray(items)) throw new MooTeamError('INVALID_RESPONSE', 'Expected a paginated list from Moo.team.');
      result.pagesRead++;
      const fingerprint = JSON.stringify(items);
      if (items.length && seen.has(fingerprint)) { result.warnings.push('API repeated a page; collection is incomplete.'); return result; }
      seen.add(fingerprint);
      result.items.push(...items.map(record));
      const meta = record(body._meta);
      const total = Number(meta.totalCount);
      if (Number.isSafeInteger(total) && total >= 0) {
        if (result.total !== null && result.total !== total) result.warnings.push('Collection changed while reading pages; fetch again for a consistent snapshot.');
        result.total = total;
      }
      const pageCount = Number(meta.pageCount);
      const currentPage = Number(meta.currentPage);
      if (meta.currentPage !== undefined && currentPage !== page) { result.warnings.push('API returned an unexpected page number.'); return result; }
      if (Number.isSafeInteger(pageCount) && pageCount >= 0) {
        if (page >= pageCount) {
          result.complete = (result.total === null || result.items.length === result.total) && result.warnings.length === 0;
          if (!result.complete && !result.warnings.length) result.warnings.push('Loaded count differs from API total.');
          return result;
        }
        if (items.length === 0) { result.warnings.push('Empty page before the last page.'); return result; }
        continue;
      }
      // An unpaginated array is complete; a wrapped response without pagination metadata is not provably complete.
      result.complete = Array.isArray(raw);
      if (!result.complete) result.warnings.push('Missing pagination metadata; completeness cannot be established.');
      return result;
    }
    result.warnings.push(`Stopped at the configured limit of ${Math.min(maxPages, this.config.maxPages)} pages.`);
    return result;
  }

  async file(fileId: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
    let response: Response;
    try { response = await this.get(`/files/${fileId}`, { download: 1 }); }
    catch (error) {
      if (!(error instanceof MooTeamError) || ![401, 403].includes(error.status || 0) || !this.config.fileToken) throw error;
      response = await this.get(`/files/${fileId}`, { download: 1, token: this.config.fileToken });
    }
    const mimeType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    return { bytes: await readLimited(response, this.config.maxAttachmentBytes), mimeType };
  }

  private async get(path: string, params: Record<string, string | number>): Promise<Response> {
    if (!READ_ROUTES.test(path)) throw new MooTeamError('ROUTE_NOT_ALLOWED', 'This API route is not in the read-only allowlist.');
    const url = new URL(API_BASE + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      this.log('debug', 'api.request', { path, attempt });
      let response: Response;
      try {
        response = await this.fetcher(url, { method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${this.config.token}`, 'X-MT-Company': this.config.company, Accept: 'application/json, */*' }, signal: AbortSignal.timeout(this.config.timeoutMs) });
      } catch {
        this.log('error', 'api.connection_failed', { path });
        throw new MooTeamError('CONNECTION_FAILED', 'Could not reach Moo.team within the configured timeout.');
      }
      this.log('debug', 'api.response', { path, status: response.status, durationMs: Date.now() - started });
      if (response.ok) return response;
      await response.body?.cancel();
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Math.min(2000, Math.max(200, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * (attempt + 1)));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw httpError(response.status);
    }
    throw new MooTeamError('API_UNAVAILABLE', 'Moo.team is temporarily unavailable.');
  }
}

function httpError(status: number): MooTeamError {
  if (status === 401) return new MooTeamError('AUTH_EXPIRED', 'Moo.team rejected the token. Replace it in your local configuration.', status);
  if (status === 403) return new MooTeamError('ACCESS_DENIED', 'The configured Moo.team account cannot access this resource.', status);
  if (status === 404) return new MooTeamError('NOT_FOUND', 'The requested Moo.team resource was not found or is not visible to this account.', status);
  if (status >= 300 && status < 400) return new MooTeamError('REDIRECT_BLOCKED', 'Moo.team redirected the request. Redirects are not followed with credentials.', status);
  return new MooTeamError('API_ERROR', `Moo.team returned HTTP ${status}.`, status);
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new MooTeamError('SIZE_LIMIT', 'The response exceeds the configured byte limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new MooTeamError('SIZE_LIMIT', 'The response exceeds the configured byte limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
