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
For an authorized release, bump with `npm run release:version -- patch` (or minor/major),
commit and push main, then verify the Release workflow. GitHub Actions publishes
new versions to npm and creates the tag/release; do not manually publish or tag.

## Maintaining local participant roles

When the user supplies a person's role, resolve their stable userId from task
context and update the local roles.json described in docs/configuration.md.
Prefer `list_participants` and `set_participant_role` with exact ID/name validation.
Only persist user-confirmed roles; clarify ambiguous names. Preserve unrelated
entries and company scope. Never commit the real directory or infer job titles
from discussion. The server reloads roles on every task context request.

## Local state and attachments

History stores bounded gzip fingerprints and short ID/status events only, never
source bodies. Internal attachment/related reads must not advance baselines.
Preserve complete baselines when source pagination is incomplete or state is invalid.
Attachment bytes, extracted text and rendered pages remain in memory; do not add
disk caches or temporary document extraction. Preserve parser resource limits and
explicit extraction/visual limitations. Local state writes are allowed; Moo.team
network operations remain GET-only.
