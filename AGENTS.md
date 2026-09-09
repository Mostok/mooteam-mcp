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
