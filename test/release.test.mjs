import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { releasePlan, inspectPackage } from '../scripts/release.mjs';
import { version } from '../dist/version.js';

const pkg = { name: 'mooteam-mcp', version: '1.2.3' };
const lock = { version: pkg.version, packages: { '': { version: pkg.version } } };

test('release planning publishes new versions and resumes only the same published commit', () => {
  assert.deepEqual(releasePlan(pkg, lock, { versions: {}, 'dist-tags': { latest: '1.2.2' } }, 'abc'), { version: '1.2.3', publish: true, release: true });
  const published = { versions: { '1.2.3': { gitHead: 'abc' } } };
  assert.deepEqual(releasePlan(pkg, lock, published, 'abc'), { version: '1.2.3', publish: false, release: true });
  assert.deepEqual(releasePlan(pkg, lock, published, 'def'), { version: '1.2.3', publish: false, release: false });
  assert.equal(releasePlan(pkg, lock, published, undefined).release, false);
});

test('release planning rejects inconsistent, prerelease and backwards versions', () => {
  assert.throws(() => releasePlan(pkg, { ...lock, version: '1.2.2' }, {}, 'abc'));
  assert.throws(() => releasePlan({ ...pkg, version: '1.2.3-beta.1' }, lock, {}, 'abc'));
  assert.throws(() => releasePlan(pkg, lock, { 'dist-tags': { latest: '2.0.0' } }, 'abc'));
});

test('package inspection rejects local settings and unexpected nested files', () => {
  const pack = paths => [{ name: pkg.name, version: pkg.version, files: paths.map(path => ({ path })) }];
  const files = ['dist/cli.js', 'dist/server.js', 'dist/roles.js', 'README.md', 'docs/configuration.md', 'package.json', 'LICENSE'];
  assert.doesNotThrow(() => inspectPackage(pack(files), pkg.version));
  for (const extra of ['roles.json', 'config.json', '.env', 'dist/roles.json', 'docs/private/config.json', 'test/fixtures.mjs']) {
    assert.throws(() => inspectPackage(pack([...files, extra]), pkg.version));
  }
  assert.throws(() => inspectPackage(pack(['README.md']), pkg.version));
});

test('runtime version follows the package version', () => {
  assert.equal(version, JSON.parse(readFileSync('package.json', 'utf8')).version);
});
