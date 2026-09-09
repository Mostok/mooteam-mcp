import { ApiClient } from './api-client.js';
import { id, string } from './types.js';
import { loadRoles } from './roles.js';
import { preferredRichText } from './rich-text.js';

export class SearchService {
  constructor(readonly api: ApiClient) {}

  async participants(query = '', projectId?: number) {
    const [profiles, roles] = await Promise.all([
      this.api.collection('/user-profiles', { fields: 'userId,firstname,lastname', 'per-page': 0 }),
      loadRoles(this.api.config, this.api.log),
    ]);
    const q = query.trim().toLocaleLowerCase();
    return { items: profiles.items.map(p => ({ userId: id(p.userId), name: `${string(p.firstname)} ${string(p.lastname)}`.trim(), ...roles.resolve(id(p.userId), projectId ?? null) })).filter(p => p.userId && (!q || p.name.toLocaleLowerCase().includes(q))), complete: profiles.complete, warnings: [...profiles.warnings, ...roles.warnings], note: 'Workspace directory, not a project membership list. projectId selects local role overrides only.' };
  }

  async projects(query = '') {
    const result = await this.api.collection('/projects', { fields: 'projectId,name,status', 'per-page': 100 });
    const q = query.trim().toLocaleLowerCase();
    return { items: result.items.map(p => ({ projectId: id(p.projectId), name: string(p.name), status: string(p.status) })).filter(p => !q || p.name.toLocaleLowerCase().includes(q)), complete: result.complete, warnings: result.warnings };
  }

  async tasks(options: { query?: string; projectId?: number; assigneeId?: number; status?: 'active' | 'finished'; searchIn?: 'title' | 'description'; offset?: number; limit?: number; maxPages?: number } = {}) {
    const params: Record<string, string | number> = { fields: 'taskId,projectId,header,userId,parentId,status,statusId,timeUpdated' + (options.searchIn === 'description' ? ',description,newDescription' : ''), 'per-page': 100 };
    if (options.projectId) params['filters[projectId]'] = options.projectId;
    if (options.status) params['filters[status]'] = options.status;
    const result = await this.api.collection('/tasks', params, options.maxPages ?? 20);
    const query = options.query?.trim().toLocaleLowerCase() ?? '';
    const matches = result.items.filter(t => (!options.projectId || id(t.projectId) === options.projectId) && (!options.assigneeId || id(t.userId) === options.assigneeId) && (!options.status || t.status === options.status) && (!query || (string(t.header) + (options.searchIn === 'description' ? '\n' + preferredRichText(t.newDescription ?? t.description, undefined).markdown : '')).toLocaleLowerCase().includes(query)));
    const offset = options.offset ?? 0, limit = options.limit ?? 50;
    const items = matches.slice(offset, offset + limit).map(t => ({ taskId: id(t.taskId), title: string(t.header), projectId: id(t.projectId), assigneeId: id(t.userId), status: string(t.status), statusId: id(t.statusId), parentTaskId: id(t.parentId), updatedAt: string(t.timeUpdated), sourceUrl: `mooteam://tasks/${id(t.taskId)}` }));
    return { items, matchingLoaded: matches.length, scanned: result.items.length, sourceTotal: result.total, sourceComplete: result.complete, pagesRead: result.pagesRead, nextOffset: offset + items.length < matches.length ? offset + items.length : null, warnings: result.warnings, searchIn: options.searchIn ?? 'title', note: 'Search covers loaded task titles (and descriptions when requested), not comment bodies. Narrow project/status or raise maxPages if sourceComplete is false.' };
  }
}
