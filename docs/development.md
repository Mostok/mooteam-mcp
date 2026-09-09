[← Tools and API](api.md) · [Back to README](../README.md)

# Development

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Tests use synthetic data and an injected fetch implementation. No credentials or
network access are needed for the test suite. The protocol test starts a separate
stdio server and verifies tool discovery, task reads and image blocks.

For a live read-only check, configure local credentials and run `mooteam-mcp --check`.
Set `MOOTEAM_SMOKE_TASK` and optionally `MOOTEAM_SMOKE_FILE`, then run `npm run smoke`.
The smoke script prints IDs/counts and result kinds, not task bodies or credentials.

## Architecture

```text
MCP stdio → tool handlers → task context / attachment services → GET-only API client
                              ↓                  ↓
                         rich-text renderer    PDF worker
```

| Module | Responsibility |
|---|---|
| `src/cli.ts` | CLI entry, config loading, stdio lifecycle |
| `src/server.ts` | MCP schemas, tool results, error and redaction boundary |
| `src/api-client.ts` | Fixed API origin, auth, bounded GETs and pagination |
| `src/task-context.ts` | Task/comment assembly, authors and file ownership |
| `src/roles.ts` | Bounded local role directory, workspace scope and project overrides |
| `src/rich-text.ts` | Rich-text conversion with explicit limitations |
| `src/attachments.ts` | File validation, format dispatch and output bounds |
| `src/pdf-worker.ts` | Isolated PDF text extraction |

Runtime dependencies are the official MCP server SDK v2, Zod and PDF.js.
MCP SDK's stdio compatibility support handles older protocol clients.
There is no LLM API dependency and no hosted proxy.

## Release

Releases run automatically from `.github/workflows/release.yml` after a push to
`main`. Pull requests and other branches only run checks. To prepare a release:

```sh
npm run release:version -- patch
```

Use `minor` or `major` when appropriate. This updates package.json and the lockfile;
the CLI and MCP protocol read that same version. Commit the reviewed changes and
push to main. Never include local credentials, participant directories or real
task fixtures in the commit.

The workflow runs the Windows/Linux and Node 22/24 checks first. If the version is
newer than npm's latest release, it builds, checks the package file allowlist,
publishes to npm, verifies the registry commit, then creates a `vVERSION` tag and
GitHub Release with generated notes. Unchanged published versions are skipped.
Only stable versions are supported by this workflow.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
with OIDC: package `mooteam-mcp`, repository `Mostok/mooteam-mcp`, workflow filename
`release.yml`, and direct `npm publish` permission. No npm token or Moo.team
credentials are stored in Actions. Only the publish job can request an OIDC token;
only the GitHub Release job can write repository metadata.

If a run fails, use **Re-run failed jobs** on that run. A version already published
from the same commit is not republished; verification and GitHub Release creation
can resume. Do not move an existing release tag. A new commit without a new version
does not repair an older release; retry the original run instead. `workflow_dispatch`
is available on main and runs the same checks and release guards.

Only `dist`, `docs`, README, package metadata and LICENSE ship in the npm package.
Internal plans, editor settings, tests, local credentials and development helpers
are excluded. The CI workflow runs tests and checks on Linux and Windows.

## See also

- [Configuration](configuration.md)
- [Tools and API](api.md)
