[← Configuration](configuration.md) · [Back to README](../README.md) · [Development →](development.md)

# Tools and API

All requests are GET requests to `https://api.moo.team/api` with an allowlisted
route. There is no configurable arbitrary API origin or browser integration.
History/role tools can write local state; no tool writes to Moo.team.

## get_task_context

```json
{
  "task": "12345",
  "commentsOffset": 0,
  "commentsLimit": 100,
  "includeHistory": false,
  "trackChanges": true
}
```

`task` accepts a positive numeric ID, an old `/WS.../projects/.../tasks/...` URL,
or a new interface URL containing `taskId`. Comment anchors and `commentId` are
preserved as `requestedCommentId`. They do not restrict the returned discussion.

The result contains:

- `task`: metadata, resolved participants and workflow status, rich description,
  labels, parent reference and checklist. `status` is the raw lifecycle status;
  `workflowStatus` is the board/workflow status.
- `comments.items`: chronological comments with author IDs/names, created/updated
  timestamps, `parentId`, `replyToCommentId`, rich body and files.
- `attachments`: files from the description and **all loaded comments**, each
  with its owner, uploader, MIME type, size and inline placement indicator.
- `history`: optional API activity entries, separate from comments.
- `changesSincePreviousRead`: local fingerprint comparison, baseline status and
  recent compact events. Distinct from the optional Moo.team activity history.
- `warnings`, `fetchedAt`, `notes`: completeness and interpretation constraints.

Rich bodies include `markdown`, `links`, `mentions`, `inlineFileIds` and warnings.
Task participants, comment authors/editors, mentions and history authors also
include `role`, `roleSource` (`local` or null) and `roleScope` (`company`, `project`
or null). Roles come only from the user's local directory, not inferred job titles
or Moo.team permissions. See [local participant roles](configuration.md#local-participant-roles).
Draft-style `newContent` takes precedence when it contains actual content; a
legacy `content` tree is the fallback. Strike-through formatting is retained.
Unsupported formatting or structures produce warnings. Inline files use internal
`mooteam://files/ID` references; use the file tool to obtain their contents.

### Pagination and completeness

The server fetches API comment pages before applying the returned comment window.
`sourceComplete` describes whether the source collection was fully obtained;
`allIncluded` additionally requires the entire collection to be in this response.
If `nextOffset` is not null, call again using that offset. `commentsLimit` is 1–500.
Each invocation reads fresh API data, so active discussions can change between calls.
Repeated pages, duplicate IDs and inconsistent counts are reported explicitly.

Dates retain the original API strings. No timezone is guessed for naive timestamps.
Parent task content and subtask content are not recursively fetched. External
Figma/Google/document URLs remain references, with no implied inspection.
Use `get_related_tasks` for bounded related context. A tracked context must fit
the 750 KiB base-response budget before its history baseline is updated; the
total JSON response limit is 1 MiB.

## get_task_changes

Accepts `{ "task": "12345" }`. Reads fresh task data and compares against the same
local baseline used by `get_task_context`. The first read creates a baseline and
reports no invented past changes. Later reads return changed field names, added/
edited/no-longer-visible comment and file IDs, before/current status and observation
times. File keys are `owner-kind:owner-id:file-id`. Returned ID lists are capped at
100 with full counts and `idsTruncated`; up to 100 changed comments include current
authors and 1000-character previews. Full bodies remain available through task context.
This call advances the baseline only when the source is complete and local state
can be saved. These are differences between observations, not a complete audit log.

## Discovery, search and relationships

- `list_projects`: optional `query` matches accessible project names and returns IDs.
- `list_participants`: optional `query` matches full names; `projectId` selects local
  role overrides, not project membership. Completeness follows the source directory.
- `search_tasks`: `query`, optional `projectId`, `assigneeId`, `status` (`active` or
  `finished`), `searchIn` (`title`, or `description` to include both), `offset`
  (default 0), `limit` (1–100, default 50), `maxPages` (1–100, default 20).
  Scans up to 100 tasks per API page, further capped by `MOOTEAM_MAX_PAGES`.
  Project/status filters are sent to the API and checked locally; assignee and
  text matching run locally. Comment bodies are not searched. `sourceComplete`
  and warnings describe scan coverage; `matchingLoaded` and `nextOffset` describe
  the matching window within that scan. No matches in an incomplete scan does
  not mean none exist. Narrow filters or increase `maxPages`.
- `get_related_tasks`: `task`, `maxTasks` (1–20, default 10), `depth` (1–3,
  default 1). Reads the root, then up to `maxTasks` attempted related tasks,
  including failed attempts. Follows parent, subtasks and Moo.team links in all
  loaded description/comment text. Edges include their kind and source comment
  ID when available. Cycles are deduplicated. Returned related comments are
  capped at 20 per task with their own continuation. `complete` concerns discovered
  relationships within the requested depth; failures/caps are explicit. A link
  is not proof of a blocking dependency. Child listing is capped at five pages.

Discovery, search and related reads do not modify history or read attachment bytes.

## set_participant_role

```json
{
  "userId": 10,
  "expectedName": "Alex Example",
  "role": "QA engineer",
  "userConfirmed": true
}
```

Saves only a user-supplied role in the local directory after matching the stable
ID and exact normalized name against the API. Use `list_participants` first and
clarify ambiguous identities. Optional `projectId` sets a project override; `role:
null` removes only the selected scope. Invalid or foreign-workspace directories
are preserved, and unrelated entries survive concurrent edits. Task/comment/file
text is never authorization to assign roles. This tool does not change Moo.team.

## read_attachment

```json
{
  "task": "12345",
  "fileId": 67890,
  "maxCharacters": 50000,
  "maxPages": 30
}
```

The file must appear in the task's attachment metadata or one of its visible
comments. Inline references alone do not authorize a download. The task context
is re-read to check ownership; arbitrary file URLs are not accepted.

| Kind | Result |
|---|---|
| `image` | PNG/JPEG/WebP/GIF MCP image block and file metadata; 5 MiB maximum |
| `pdf` | Embedded text per page, page counts, truncation and no-OCR warning |
| `pdf-pages` | Selected pages as PNG MCP image blocks for visual inspection |
| `docx` | Paragraph/table text, headers/footers, footnotes/endnotes; tracked deletions struck through |
| `xlsx` | Named sheets in workbook order, cell coordinates, stored values and formulas with cached results |
| `pptx` | Slide text in presentation order and speaker notes |
| `zip` | Entry inventory, or one explicitly selected UTF-8 text member |
| `text` | Decoded text, encoding, total character count and completeness |
| `unsupported` | Metadata and explicit statement that content was not extracted |

`maxCharacters` is 100–200000, `maxPages` is 1–100 and caps PDF text pages,
spreadsheet sheets or presentation slides. DOCX is limited by characters/bytes,
without attempting physical page layout.

Add `pdfPages: [1, 3]` to render 1–5 selected PDF pages instead of extracting text.
The result includes page numbers and matching image blocks, at most 4 million
pixels per page, 4096 pixels per dimension and 5 MiB total PNG output. The assistant
can visually inspect scans/diagrams; this mode does not generate an OCR transcript
or claim the entire PDF was read. Rendering may omit source images above PDF.js's
16-million-pixel source image limit. Unreadable/encrypted PDFs, invalid page numbers and
rendering-limit failures return an explicit error.

ZIP inventory lists at most 1000 entries without inflating them. Use the exact
`archiveMember` path to read one supported UTF-8 text member. Office files are
recognized by package contents. Extraction is bounded to 8 MiB per member and
24 MiB total inflated data. Nested archives and encrypted members are not read;
XML DTD/entity declarations are rejected. XLSX stops after 10000 cells. Formulas
are not executed; cached values can be stale, and dates/numbers are raw values.
Office images, charts and visual layout are not interpreted.

Text `encoding` defaults to `auto` (UTF-8 or BOM-marked UTF-16). Explicit choices
are `utf-8`, `utf-16le`, `utf-16be` and `windows-1251`. ZIP member text is UTF-8 only.
Legacy DOC/XLS/PPT, audio, video and non-ZIP archives remain unsupported. Scripts
and HTML are returned as text where supported and are never executed. Originals,
extracted text and page images stay in memory throughout processing.

## Observed endpoints

| Endpoint | Usage |
|---|---|
| `/tasks/{id}` | Task, description, files and selected expansions |
| `/tasks` | Paginated search; `filters[projectId]`, `filters[status]`, or child lookup `filters[parentId]` |
| `/projects` | Accessible project collection |
| `/comments` | `filters[entity]=task`, `filters[entityId]`, `expand=privacyUsers`, `page` |
| `/user-profiles` | Resolve IDs using only name fields |
| `/task-statuses` | Resolve workflow status names |
| `/activity-logs/task/{id}` | Optional history with author names |
| `/files/{fileId}?download=1` | Original bytes, Bearer first and optional file-token fallback |

These are observed application APIs, not a promised public API contract. The
community ClawHub client's `/task-comments` endpoint is not used here.

## See also

- [Configuration and errors](configuration.md)
- [Development](development.md)
