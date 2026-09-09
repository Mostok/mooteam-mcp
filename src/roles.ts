import { open } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

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
