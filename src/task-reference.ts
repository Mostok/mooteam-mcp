import { MooTeamError } from './errors.js';

export interface TaskReference { taskId: number; workspace?: string; projectId?: number; commentId?: number }

export function parseTaskReference(value: string | number): TaskReference {
  const input = String(value).trim();
  if (/^\d+$/.test(input)) return { taskId: positiveId(input) };
  let url: URL;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || !['app.moo.team', 'new-app.moo.team'].includes(url.hostname) || url.port || url.username || url.password) throw invalid();
  const workspace = /^\/(WS[A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1];
  const old = /\/projects\/(\d+)\/tasks\/(\d+)\/?$/.exec(url.pathname);
  const direct = /\/tasks\/(\d+)\/?$/.exec(url.pathname);
  const candidate = old?.[2] || direct?.[1] || url.searchParams.get('taskId');
  if (!candidate || !workspace) throw invalid();
  const reference: TaskReference = { taskId: positiveId(candidate), workspace };
  if (old?.[1]) reference.projectId = positiveId(old[1]);
  const comment = /^#comment-(\d+)$/.exec(url.hash)?.[1] || url.searchParams.get('commentId');
  if (comment) reference.commentId = positiveId(comment);
  return reference;
}

function positiveId(value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n <= 0) throw invalid();
  return n;
}

function invalid() { return new MooTeamError('INVALID_TASK_REFERENCE', 'Use a positive task ID or an HTTPS task link from app.moo.team or new-app.moo.team.'); }
