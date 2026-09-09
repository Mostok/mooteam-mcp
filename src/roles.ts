import { open } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { readLocalFile, withLocalLock, writeLocalFile } from './local-state.js';
import { ApiClient } from './api-client.js';
import { MooTeamError } from './errors.js';

const numericId = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)));
const role = z.string().trim().min(1).max(256);
const schema = z.object({
  company: z.string().min(1),
  users: z.record(numericId, z.object({
    role: role.optional(),
    projects: z.record(numericId, role).optional(),
  }).strict()),
}).strict();
type Directory = z.infer<typeof schema>;

export async function setParticipantRole(api: ApiClient, input: { userId: number; expectedName: string; role: string | null; projectId?: number; userConfirmed: true }) {
  if (input.userConfirmed !== true) throw new MooTeamError('ROLE_CONFIRMATION_REQUIRED', 'Only save roles explicitly supplied by the user.');
  const path = api.config.rolesFile;
  if (!path) throw new MooTeamError('CONFIG_MISSING', 'A local role directory path is required.');
  const profiles = await api.collection('/user-profiles', { fields: 'userId,firstname,lastname', 'per-page': 0 });
  const person = profiles.items.find(p => Number(p.userId) === input.userId);
  const name = person ? `${person.firstname ?? ''} ${person.lastname ?? ''}`.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.toLocaleLowerCase() !== input.expectedName.trim().replace(/\s+/g, ' ').toLocaleLowerCase()) throw new MooTeamError('PARTICIPANT_MISMATCH', 'Resolve the exact user ID and display name with list_participants before saving a role.');
  return withLocalLock(path, async () => {
    const bytes = await readLocalFile(path, 1048576);
    let directory: Directory;
    try { directory = bytes ? schema.parse(JSON.parse(bytes.toString('utf8'))) : { company: api.config.company, users: {} }; }
    catch { throw new MooTeamError('ROLES_INVALID', 'Existing local role directory is invalid and was not changed.'); }
    if (directory.company !== api.config.company) throw new MooTeamError('ROLE_SCOPE_MISMATCH', 'Local role directory belongs to another workspace.');
    const key = String(input.userId), entry = directory.users[key] ?? {};
    if (input.projectId) {
      entry.projects ??= {};
      if (input.role === null) delete entry.projects[String(input.projectId)];
      else entry.projects[String(input.projectId)] = role.parse(input.role);
      if (!Object.keys(entry.projects).length) delete entry.projects;
    } else if (input.role === null) delete entry.role;
    else entry.role = role.parse(input.role);
    if (entry.role || entry.projects) directory.users[key] = entry;
    else delete directory.users[key];
    const output = Buffer.from(JSON.stringify(directory, null, 2) + '\n');
    if (output.length > 1048576) throw new MooTeamError('LOCAL_STATE_LIMIT', 'Role directory exceeds 1 MiB.');
    await writeLocalFile(path, output);
    api.log('info', 'roles.updated', { userId: input.userId, projectId: input.projectId });
    return { userId: input.userId, name, role: input.role?.trim() ?? null, projectId: input.projectId ?? null, saved: true, storage: 'local', note: 'Moo.team was not modified. Project overrides take precedence over general roles.' };
  });
}

/** Reload per context request so user-confirmed edits apply to running servers. */
export async function loadRoles(config: Config, log: Logger) {
  let directory: Directory | undefined;
  const warnings: string[] = [];
  log('debug', 'roles.load.start');
  if (config.rolesFile) {
    try {
      const file = await open(config.rolesFile, 'r');
      let text: string;
      try {
        const maxBytes = 1024 * 1024;
        const buffer = Buffer.alloc(maxBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > maxBytes) throw new Error('size');
        text = buffer.subarray(0, length).toString('utf8');
      } finally { await file.close(); }
      const parsed = schema.parse(JSON.parse(text));
      if (parsed.company !== config.company) {
        warnings.push('Local roles company does not match the configured workspace; roles ignored.');
      } else { directory = parsed; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        warnings.push('Local roles file is unreadable or invalid; roles ignored. Check roles.json configuration.');
      }
    }
  }
  if (warnings.length) log('warn', 'roles.load.failed', { warnings: warnings.length });
  log('debug', 'roles.load.complete', { users: Object.keys(directory?.users ?? {}).length });
  return {
    warnings,
    resolve(userId: number | null, projectId: number | null) {
      const entry = userId ? directory?.users[String(userId)] : undefined;
      const projectRole = projectId ? entry?.projects?.[String(projectId)] : undefined;
      const value = projectRole ?? entry?.role ?? null;
      return { role: value, roleSource: value ? 'local' as const : null, roleScope: value ? (projectRole ? 'project' as const : 'company' as const) : null };
    },
  };
}
