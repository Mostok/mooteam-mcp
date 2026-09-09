import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod/v4';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { readLocalFile, withLocalLock, writeLocalFile } from './local-state.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v) ?? 'null').digest('base64url').slice(0, 22);
const canonicalText = (v: any) => ({ markdown: v.markdown, links: v.links, files: v.inlineFileIds, mentions: v.mentions.map((m: any) => m.userId) });
const pairs = z.record(z.string(), z.string().length(22));
const snapshotSchema = z.object({ at: z.string().datetime(), fields: pairs, comments: pairs, files: pairs, status: z.object({ status: z.string(), statusId: z.number().nullable() }) });
const changesSchema = z.object({ at: z.string().datetime(), fields: z.array(z.string()), comments: z.object({ added: z.array(z.string()), edited: z.array(z.string()), noLongerVisible: z.array(z.string()) }), files: z.object({ added: z.array(z.string()), edited: z.array(z.string()), noLongerVisible: z.array(z.string()) }) });
const stateSchema = z.object({ version: z.literal(1), company: z.string(), tasks: z.record(z.string(), z.object({ snapshot: snapshotSchema, events: z.array(changesSchema).max(20) })) });
type Snapshot = z.infer<typeof snapshotSchema>;
type State = z.infer<typeof stateSchema>;

// Retain full current comments in RAM only, so returned windows do not affect comparisons.
export const observations = new WeakMap<object, { at: string; comments: any[] }>();

function snapshot(context: any): Snapshot {
  const observation = observations.get(context);
  if (!observation) throw new Error('Missing observation');
  const t = context.task;
  const fields: Record<string, unknown> = { title: t.title, description: canonicalText(t.description), status: t.status, workflowStatus: t.workflowStatus.statusId, assignee: t.assignee.userId, creator: t.creator.userId, coPerformer: t.coPerformer.userId, priority: t.priority, project: t.projectId, parent: t.parentTaskId, checklist: t.checklist, labels: t.labels.map((l: any) => l.labelId), startDate: t.startDate, endDate: t.endDate };
  return { at: observation.at, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, hash(v)])), comments: Object.fromEntries(observation.comments.map(c => [String(c.commentId), hash([c.author.userId, c.parentId, c.replyToCommentId, canonicalText(c.body)])])), files: Object.fromEntries(context.attachments.map((f: any) => [`${f.source.kind}:${f.source.id}:${f.fileId}`, hash([f.name, f.sizeBytes, f.mimeType, f.createdAt, f.uploadedBy])])), status: { status: t.status, statusId: t.workflowStatus.statusId } };
}

function compare(a: Record<string, string>, b: Record<string, string>) {
  return { added: Object.keys(b).filter(k => !(k in a)), edited: Object.keys(b).filter(k => k in a && a[k] !== b[k]), noLongerVisible: Object.keys(a).filter(k => !(k in b)) };
}

function compactChange(change: z.infer<typeof changesSchema>) {
  const compact = (values: ReturnType<typeof compare>) => ({ added: values.added.slice(0, 100), edited: values.edited.slice(0, 100), noLongerVisible: values.noLongerVisible.slice(0, 100), counts: { added: values.added.length, edited: values.edited.length, noLongerVisible: values.noLongerVisible.length }, idsTruncated: Object.values(values).some(v => v.length > 100) });
  return { ...change, comments: compact(change.comments), files: compact(change.files) };
}

export class HistoryService {
  constructor(readonly config: Config, readonly log: Logger) {}

  async observe(context: any) {
    const base = { baselineUpdated: false, baselineCreated: false, warnings: [] as string[] };
    if (!this.config.historyFile) return { ...base, enabled: false };
    if (!context.comments.sourceComplete) return { ...base, enabled: true, warnings: ['Incomplete source: previous complete history baseline preserved.'] };
    try {
      return await withLocalLock(this.config.historyFile, async () => {
        const maxBytes = this.config.historyMaxBytes ?? 1048576;
        const bytes = await readLocalFile(this.config.historyFile!, maxBytes);
        const state: State = bytes ? stateSchema.parse(JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'))) : { version: 1, company: this.config.company, tasks: {} };
        if (state.company !== this.config.company) throw new Error('Workspace mismatch');
        const current = snapshot(context), key = String(context.task.taskId);
        const cutoff = Date.now() - (this.config.historyRetentionDays ?? 90) * 86400000;
        for (const [k, entry] of Object.entries(state.tasks)) if (Date.parse(entry.snapshot.at) < cutoff) delete state.tasks[k];
        const previous = state.tasks[key];
        if (previous && previous.snapshot.at > current.at) return { ...base, enabled: true, warnings: ['A newer observation is already stored; this late read did not replace it.'] };
        const changes = { at: current.at, fields: previous ? Object.keys(current.fields).filter(k => previous.snapshot.fields[k] !== current.fields[k]) : [], comments: compare(previous?.snapshot.comments ?? current.comments, current.comments), files: compare(previous?.snapshot.files ?? current.files, current.files) };
        const changed = changes.fields.length || Object.values(changes.comments).some(v => v.length) || Object.values(changes.files).some(v => v.length);
        const events = [...(previous?.events ?? []), ...(changed ? [changes] : [])].slice(-20);
        state.tasks[key] = { snapshot: current, events };
        const oldest = Object.keys(state.tasks).filter(k => k !== key).sort((a, b) => state.tasks[a]!.snapshot.at.localeCompare(state.tasks[b]!.snapshot.at));
        let packed: Buffer;
        while (true) {
          const text = JSON.stringify(state);
          packed = gzipSync(text, { level: 9 });
          if (packed.length <= maxBytes && Buffer.byteLength(text) <= 16 * 1024 * 1024 && Object.keys(state.tasks).length <= (this.config.historyMaxTasks ?? 200)) break;
          const evict = oldest.shift();
          if (evict) delete state.tasks[evict];
          else if (state.tasks[key]!.events.length) state.tasks[key]!.events.shift();
          else return { ...base, enabled: true, warnings: ['Task fingerprint exceeds the history storage budget; previous baseline preserved.'] };
        }
        await writeLocalFile(this.config.historyFile!, packed);
        this.log('debug', 'history.saved', { taskId: context.task.taskId, bytes: packed.length, tasks: Object.keys(state.tasks).length });
        return { ...base, enabled: true, baselineUpdated: true, baselineCreated: !previous, previousReadAt: previous?.snapshot.at ?? null, currentReadAt: current.at, changed: Boolean(changed), changes: compactChange(changes), statusBefore: previous?.snapshot.status ?? null, statusNow: current.status, recentEvents: events.slice(-5).map(compactChange), storedBytes: packed.length };
      });
    } catch {
      this.log('warn', 'history.unavailable');
      return { ...base, enabled: true, warnings: ['Local history could not be read or updated (busy, corrupt, or inaccessible). Task content is still available; history was preserved.'] };
    }
  }
}
