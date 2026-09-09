import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from '../dist/api-client.js';
import { TaskContextService } from '../dist/task-context.js';
import { loadConfig } from '../dist/config.js';
import { config, fixtureFetch } from './fixtures.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mooteam-roles-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rolesFile = join(dir, 'roles.json');
  const mention = { blocks: [{ text: '@Sam', entityRanges: [{ offset: 0, length: 4, key: 0 }] }], entityMap: [{ type: 'MENTION', data: { userId: 20 } }] };
  const service = new TaskContextService(new ApiClient({ ...config, rolesFile }, () => {}, fixtureFetch({ taskOverrides: { description: mention } })));
  const save = users => writeFile(rolesFile, JSON.stringify({ company: config.company, users }));
  return { rolesFile, service, save };
}

test('local roles enrich authors and mentions, honor project overrides and reload edits', async t => {
  const { service, save } = await setup(t);
  await save({ 10: { role: 'QA' }, 20: { role: 'Developer', projects: { 45: 'Mobile developer', 99: 'Reviewer' } } });
  const r = await service.getContext(123);
  assert.equal(r.task.creator.role, 'QA');
  assert.equal(r.task.creator.roleScope, 'company');
  assert.equal(r.task.assignee.role, 'Mobile developer');
  assert.equal(r.task.assignee.roleScope, 'project');
  assert.equal(r.comments.items[1].author.roleSource, 'local');
  assert.equal(r.comments.items[1].updatedBy.role, 'Mobile developer');
  assert.equal(r.task.description.mentions[0].role, 'Mobile developer');
  assert.equal(r.task.coPerformer.role, null);
  await save({ 20: { role: 'Backend developer' } });
  const updated = await service.getContext(123);
  assert.equal(updated.task.assignee.role, 'Backend developer');
  assert.equal(updated.task.creator.role, null);
  assert.equal(updated.task.creator.roleSource, null);
});

test('missing, malformed, oversized and foreign workspace directories never assign guessed roles', async t => {
  const { service, rolesFile } = await setup(t);
  const missing = await service.getContext(123);
  assert.equal(missing.task.creator.role, null);
  assert.deepEqual(missing.warnings, []);
  for (const content of [
    '{broken',
    JSON.stringify({ company: 'another-workspace', users: { 10: { role: 'QA' } } }),
    JSON.stringify({ company: config.company, users: { 10: { role: 123 } } }),
    JSON.stringify({ company: config.company, users: { 10: { role: 'x'.repeat(257) } } }),
    ' '.repeat(1024 * 1024 + 1),
  ]) {
    await writeFile(rolesFile, content);
    const r = await service.getContext(123);
    assert.equal(r.task.creator.role, null);
    assert.ok(r.warnings.some(w => /roles/i.test(w)));
    assert.equal(r.comments.sourceComplete, true);
  }
});

test('role file defaults beside selected credential file and accepts an environment override', async t => {
  const { rolesFile } = await setup(t);
  const configFile = join(rolesFile, '..', 'credentials.json');
  await writeFile(configFile, JSON.stringify({ token: config.token, company: config.company }));
  assert.equal(loadConfig({ MOOTEAM_CONFIG_FILE: configFile }).rolesFile, rolesFile);
  assert.equal(loadConfig({ MOOTEAM_CONFIG_FILE: configFile, MOOTEAM_ROLES_FILE: 'custom.json' }).rolesFile, 'custom.json');
});
