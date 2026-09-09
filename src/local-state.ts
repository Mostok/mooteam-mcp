import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MooTeamError } from './errors.js';

export async function readLocalFile(path: string, maxBytes: number): Promise<Buffer | null> {
  let file;
  try { file = await open(path, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new MooTeamError('LOCAL_STATE_LIMIT', 'Local state exceeds its configured size limit.');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

export async function withLocalLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let lock;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { lock = await open(path + '.lock', 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!lock) throw new MooTeamError('LOCAL_STATE_BUSY', 'Local state is locked by another process. Retry; if a process crashed, remove its .lock file after stopping all MCP processes.');
  try { return await action(); }
  finally { await lock.close(); await unlink(path + '.lock'); }
}

/** Caller holds the lock. At most one bounded temporary copy exists. */
export async function writeLocalFile(path: string, bytes: Uint8Array) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
