import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ApiClient } from '../dist/api-client.js';
import { TaskContextService } from '../dist/task-context.js';
import { AttachmentService } from '../dist/attachments.js';
import { HistoryService, observations } from '../dist/history.js';
import { setParticipantRole } from '../dist/roles.js';
import { config, fixtureFetch, comment, draft } from './fixtures.mjs';

async function setup(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mooteam-state-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = { ...config, historyFile: join(dir, 'history.json.gz'), rolesFile: join(dir, 'roles.json'), ...extra };
  const api = options => new ApiClient(settings, () => {}, fixtureFetch(options));
  const context = options => new TaskContextService(api(options));
  return { dir, settings, api, context, history: new HistoryService(settings, () => {}) };
}

test('history stores fingerprints, detects semantic edits and preserves full pagination baselines', async t => {
  const { settings, context, history } = await setup(t);
  const first = await context().getContext(123, { commentsLimit: 1 });
  assert.equal((await history.observe(first)).baselineCreated, true);
  assert.equal((await history.observe(await context().getContext(123, { commentsOffset: 15, commentsLimit: 2 }))).changed, false);
  const edited = comment(1); edited.newContent = draft('Private changed body');
  const next = await context({ comments: [edited, comment(22)], taskOverrides: { status: 'finished', header: 'Private changed title' } }).getContext(123);
  const result = await history.observe(next);
  assert.ok(result.changes.fields.includes('status'));
  assert.deepEqual(result.changes.comments.added, ['22']);
  assert.deepEqual(result.changes.comments.edited, ['1']);
  assert.ok(result.changes.comments.noLongerVisible.includes('2'));
  assert.ok(result.changes.files.noLongerVisible.includes('comment:2:901'));
  const stored = gunzipSync(await readFile(settings.historyFile)).toString();
  for (const text of ['Private changed body', 'Private changed title', 'Task description', 'Alex Example', config.token]) assert.ok(!stored.includes(text));
});

test('incomplete, internal attachment and late reads cannot consume a complete history baseline', async t => {
  const { settings, context, history } = await setup(t);
  const first = await context().getContext(123); await history.observe(first);
  const before = await readFile(settings.historyFile);
  await new AttachmentService(context()).read(123, 900);
  assert.deepEqual(await readFile(settings.historyFile), before);
  const partial = await new TaskContextService(new ApiClient({ ...settings, maxPages: 1 }, () => {}, fixtureFetch())).getContext(123);
  assert.equal((await history.observe(partial)).baselineUpdated, false);
  const late = await context().getContext(123); observations.get(late).at = '2000-01-01T00:00:00.000Z';
  assert.equal((await history.observe(late)).baselineUpdated, false);
  assert.deepEqual(await readFile(settings.historyFile), before);
});

test('history bounds task count and preserves corrupt existing state', async t => {
  const { settings, context, history, dir } = await setup(t, { historyMaxTasks: 1, historyMaxBytes: 16384 });
  await history.observe(await context().getContext(123));
  const second = await context().getContext(123); second.task.taskId = 124;
  await history.observe(second);
  const state = JSON.parse(gunzipSync(await readFile(settings.historyFile)).toString());
  assert.deepEqual(Object.keys(state.tasks), ['124']);
  assert.ok((await readFile(settings.historyFile)).length <= 16384);
  await writeFile(settings.historyFile, 'corrupt');
  assert.equal((await history.observe(await context().getContext(123))).baselineUpdated, false);
  assert.equal((await readFile(settings.historyFile)).toString(), 'corrupt');
  assert.ok(!(await readdir(dir)).some(p => p.endsWith('.tmp') || p.endsWith('.lock')));
});

test('history expires stale baselines, caps changed IDs and preserves state on oversized fingerprints', async t => {
  const { settings, context, history } = await setup(t, { historyMaxBytes: 16384, historyRetentionDays: 1 });
  await history.observe(await context().getContext(123));
  const state = JSON.parse(gunzipSync(await readFile(settings.historyFile)).toString());
  state.tasks['123'].snapshot.at = '2000-01-01T00:00:00.000Z';
  await writeFile(settings.historyFile, gzipSync(JSON.stringify(state)));
  assert.equal((await history.observe(await context().getContext(123))).baselineCreated, true);
  const many = await context({ comments: Array.from({ length: 150 }, (_, i) => comment(i + 100)) }).getContext(123);
  const result = await history.observe(many);
  assert.equal(result.changes.comments.added.length, 100);
  assert.equal(result.changes.comments.counts.added, 150);
  assert.equal(result.changes.comments.idsTruncated, true);
  const before = await readFile(settings.historyFile);
  const huge = await context().getContext(123);
  const template = observations.get(huge).comments[0];
  observations.get(huge).comments = Array.from({ length: 2000 }, (_, i) => ({ ...template, commentId: i + 1000, body: { ...template.body, markdown: `Unique content ${i}` } }));
  assert.equal((await history.observe(huge)).baselineUpdated, false);
  assert.deepEqual(await readFile(settings.historyFile), before);
  await writeFile(settings.historyFile, Buffer.alloc(16385));
  assert.equal((await history.observe(await context().getContext(123))).baselineUpdated, false);
  assert.equal((await readFile(settings.historyFile)).length, 16385);
});

test('local role tool validates identity, preserves concurrent updates and does not alter source hashes', async t => {
  const { settings, api, context, history } = await setup(t);
  await history.observe(await context().getContext(123));
  await Promise.all([
    setParticipantRole(api(), { userId: 10, expectedName: 'Alex Example', role: 'QA', userConfirmed: true }),
    setParticipantRole(api(), { userId: 20, expectedName: 'Sam Example', role: 'Developer', projectId: 45, userConfirmed: true }),
  ]);
  const saved = JSON.parse(await readFile(settings.rolesFile, 'utf8'));
  assert.equal(saved.users['10'].role, 'QA'); assert.equal(saved.users['20'].projects['45'], 'Developer');
  assert.equal((await history.observe(await context().getContext(123))).changed, false);
  await assert.rejects(setParticipantRole(api(), { userId: 10, expectedName: 'Wrong Person', role: 'QA', userConfirmed: true }), { code: 'PARTICIPANT_MISMATCH' });
  await setParticipantRole(api(), { userId: 20, expectedName: 'Sam Example', role: null, projectId: 45, userConfirmed: true });
  assert.equal(JSON.parse(await readFile(settings.rolesFile, 'utf8')).users['20'], undefined);
  await writeFile(settings.rolesFile, '{bad');
  await assert.rejects(setParticipantRole(api(), { userId: 10, expectedName: 'Alex Example', role: 'QA', userConfirmed: true }), { code: 'ROLES_INVALID' });
  assert.equal(await readFile(settings.rolesFile, 'utf8'), '{bad');
});

test('concurrent task observations preserve both baselines', async t => {
  const { settings, context, history } = await setup(t);
  const a = await context().getContext(123), b = await context().getContext(123);
  b.task.taskId = 124;
  const results = await Promise.all([history.observe(a), history.observe(b)]);
  assert.ok(results.every(r => r.baselineUpdated));
  const saved = JSON.parse(gunzipSync(await readFile(settings.historyFile)).toString());
  assert.deepEqual(Object.keys(saved.tasks).sort(), ['123', '124']);
});
