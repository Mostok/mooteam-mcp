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

1. Run tests and type checking.
2. Run `npm pack --dry-run` and inspect the package allowlist.
3. Check staged source contains no tokens, private task data or local configuration.
4. Commit and push reviewed source.
5. Publish with `npm publish --access public` using your own npm account.
6. Verify the published version and install it in a clean directory.

Only `dist`, `docs`, README, package metadata and LICENSE ship in the npm package.
Internal plans, editor settings, tests, local credentials and development helpers
are excluded. The CI workflow runs tests and checks on Linux and Windows.

## See also

- [Configuration](configuration.md)
- [Tools and API](api.md)
