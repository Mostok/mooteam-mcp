import { TaskContextService } from './task-context.js';
import { observations } from './history.js';
import { parseTaskReference } from './task-reference.js';
import { id } from './types.js';
import { publicError } from './errors.js';

export class RelatedService {
  constructor(readonly context: TaskContextService) {}

  async read(task: string | number, maxTasks = 10, depth = 1) {
    const root = await this.context.getContext(task, { commentsLimit: 1 });
    const seen = new Set([root.task.taskId]);
    const queue: { taskId: number; depth: number }[] = [];
    const edges: { from: number; to: number; kind: string; commentId?: number }[] = [];
    const tasks: { task: typeof root.task; comments: unknown; attachments: typeof root.attachments }[] = [];
    const warnings: string[] = [];
    let complete = true;
    const add = (from: number, to: number, kind: string, level: number, commentId?: number) => {
      if (!edges.some(e => e.from === from && e.to === to && e.kind === kind && e.commentId === commentId)) edges.push({ from, to, kind, ...(commentId ? { commentId } : {}) });
      if (!seen.has(to) && level <= depth) { seen.add(to); queue.push({ taskId: to, depth: level }); }
    };
    const discover = async (c: typeof root, level: number) => {
      if (!c.comments.sourceComplete) { complete = false; warnings.push(`Comments incomplete for task ${c.task.taskId}; some links may be missing.`); }
      if (c.task.parentTaskId) add(c.task.taskId, c.task.parentTaskId, 'parent', level);
      if (c.task.hasSubTasks) {
        try {
          const children = await this.context.api.collection('/tasks', { 'filters[parentId]': c.task.taskId, fields: 'taskId,parentId', 'per-page': 100 }, 5);
          for (const child of children.items) {
            if (id(child.parentId) === c.task.taskId && id(child.taskId)) add(c.task.taskId, id(child.taskId)!, 'subtask', level);
            else { complete = false; warnings.push('API returned a child outside the requested parent.'); }
          }
          if (!children.complete) { complete = false; warnings.push(...children.warnings); }
        } catch { complete = false; warnings.push(`Could not list children of task ${c.task.taskId}.`); }
      }
      const comments = observations.get(c)?.comments ?? [];
      for (const body of [{ rich: c.task.description, commentId: undefined }, ...comments.map(x => ({ rich: x.body, commentId: x.commentId }))]) {
        const urls = new Set<string>([...body.rich.links.map((l: any) => l.url), ...(body.rich.markdown.match(/https:\/\/(?:new-app|app)\.moo\.team\/[^\s<>"\]]+/g) ?? [])]);
        for (const url of urls) {
          try { const ref = parseTaskReference(url.replace(/[),.;]+$/, '')); add(c.task.taskId, ref.taskId, 'mentioned', level, body.commentId); }
          catch { /* Unrelated links are references, never fetched. */ }
        }
      }
      for (const cmt of comments) if (cmt.relatedTaskId) add(c.task.taskId, cmt.relatedTaskId, 'comment-related', level, cmt.commentId);
    };
    await discover(root, 1);
    let attempted = 0;
    while (queue.length && attempted < maxTasks) {
      const next = queue.shift()!;
      attempted++;
      try {
        const c = await this.context.getContext(next.taskId, { commentsLimit: 20 });
        tasks.push({ task: c.task, comments: c.comments, attachments: c.attachments });
        if (next.depth < depth) await discover(c, next.depth + 1);
      } catch (error) { complete = false; warnings.push(`Task ${next.taskId}: ${publicError(error).code}.`); }
    }
    if (queue.length) { complete = false; warnings.push(`Stopped at maxTasks=${maxTasks}; ${queue.length} discovered tasks were not read.`); }
    return { rootTaskId: root.task.taskId, depth, attempted, tasks, edges, complete, warnings: [...new Set(warnings)], notes: ['Mentioned links are references, not necessarily blocking dependencies.', 'Traversal stops at the requested depth; maxTasks counts attempted related reads, including inaccessible tasks, excluding the root.', 'Attachment contents and external URLs were not fetched. Related reads do not advance history baselines.'] };
  }
}
