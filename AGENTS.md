# Project guidance

Read README.md and docs/development.md for setup and architecture.

## Structure

- `src/`: TypeScript runtime; `cli.ts` is the executable, `server.ts` registers tools.
- `test/`: synthetic unit and stdio integration tests; no production credentials/data.
- `scripts/smoke.mjs`: opt-in direct API smoke test; prints counts only.
- `docs/`: configuration, API contract and development guidance.

## Boundaries

All Moo.team network operations are GET-only, on the fixed allowlisted API origin.
Preserve comment authors/replies, file ownership and explicit completeness indicators.
Never log or publish credentials, real task fixtures, full network captures or local config.
MCP stdout must contain protocol messages only. Logs use configurable stderr logging.
Use npm test and npm run check before release; inspect npm pack contents.

## Maintaining local participant roles

When the user supplies a person's role, resolve their stable userId from task
context and update the local roles.json described in docs/configuration.md.
Only persist user-confirmed roles; clarify ambiguous names. Preserve unrelated
entries and company scope. Never commit the real directory or infer job titles
from discussion. The server reloads roles on every task context request.
