import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repository = 'Mostok/mooteam-mcp';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releasePlan(pkg, lock, registry, sha) {
  if (pkg.name !== 'mooteam-mcp' || !stableVersion.test(pkg.version)) throw new Error('Expected mooteam-mcp with a stable semantic version.');
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('Lockfile version does not match package.json.');
  const existing = registry.versions?.[pkg.version];
  if (existing) return { version: pkg.version, publish: false, release: Boolean(sha && existing.gitHead === sha) };
  const latest = registry['dist-tags']?.latest;
  if (latest && stableVersion.test(latest)) {
    const a = pkg.version.split('.').map(Number), b = latest.split('.').map(Number);
    const difference = a.map((n, i) => n - b[i]).find(n => n !== 0) ?? 0;
    if (difference <= 0) throw new Error('New version must be greater than npm latest.');
  }
  return { version: pkg.version, publish: true, release: true };
}

export function inspectPackage(pack, version) {
  if (pack.length !== 1 || pack[0].name !== 'mooteam-mcp' || pack[0].version !== version) throw new Error('Unexpected package identity.');
  const paths = pack[0].files.map(file => file.path);
  if (!paths.includes('dist/cli.js') || !paths.includes('dist/server.js')) throw new Error('Missing runtime entry points.');
  for (const path of paths) {
    if (!/^(?:dist\/[a-z-]+\.js|docs\/[a-z-]+\.md|README\.md|LICENSE|package\.json)$/.test(path)) throw new Error(`Unexpected package file: ${path}`);
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Remote request failed: HTTP ${response.status}`);
  return response.json();
}

async function main(mode) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const registryUrl = 'https://registry.npmjs.org/mooteam-mcp';
  if (mode === 'inspect') {
    inspectPackage(JSON.parse(readFileSync('pack.json', 'utf8')), pkg.version);
    console.log('Package contains only approved runtime and documentation files.');
    return;
  }
  if (mode === 'plan') {
    const registry = await request(registryUrl);
    if (!registry) throw new Error('Existing npm package was not found.');
    const result = releasePlan(pkg, lock, registry, process.env.GITHUB_SHA);
    if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(result)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(JSON.stringify(result));
    return;
  }
  if (!stableVersion.test(pkg.version)) throw new Error('Invalid release version.');
  if (mode === 'verify') {
    for (let attempt = 0; attempt < 6; attempt++) {
      const published = await request(`${registryUrl}/${pkg.version}`);
      if (published?.version === pkg.version) {
        if (!process.env.GITHUB_SHA || published.gitHead !== process.env.GITHUB_SHA) throw new Error('Published version belongs to a different commit.');
        console.log(`Verified mooteam-mcp@${pkg.version} from ${published.gitHead}.`);
        return;
      }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('Published version is not visible in npm. Re-run the workflow to retry verification.');
  }
  if (mode === 'github') {
    if (process.env.GITHUB_REPOSITORY !== repository || !process.env.GH_TOKEN || !process.env.GITHUB_SHA) throw new Error('Expected authenticated GitHub release job.');
    const base = `https://api.github.com/repos/${repository}`;
    const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const tag = `v${pkg.version}`;
    const ref = await request(`${base}/git/ref/tags/${tag}`, { headers });
    if (ref && (ref.object.type !== 'commit' || ref.object.sha !== process.env.GITHUB_SHA)) throw new Error('Existing tag does not point directly to this release commit.');
    const existing = await request(`${base}/releases/tags/${tag}`, { headers });
    if (existing) { console.log(`Release already exists: ${existing.html_url}`); return; }
    const created = await request(`${base}/releases`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: tag, target_commitish: process.env.GITHUB_SHA, name: tag, generate_release_notes: true, make_latest: 'legacy' }) });
    if (!created) throw new Error('GitHub release creation failed.');
    console.log(`Created ${created.html_url}`);
    return;
  }
  throw new Error('Usage: node scripts/release.mjs plan|inspect|verify|github');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
