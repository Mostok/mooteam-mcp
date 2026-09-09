[← Configuration](configuration.md) · [Back to README](../README.md) · [Development →](development.md)

# Tools and API

All requests are GET requests to `https://api.moo.team/api` with an allowlisted
route. There is no configurable arbitrary API origin, browser integration or write tool.

## get_task_context

```json
{
  "task": "12345",
  "commentsOffset": 0,
  "commentsLimit": 100,
  "includeHistory": false
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
| `text` | UTF-8 text, total character count and completeness |
| `unsupported` | Metadata and explicit statement that content was not extracted |

`maxCharacters` is 100–200000, `maxPages` is 1–100. PDF diagrams and scanned text
are not interpreted. Archive contents, Word/Excel, audio and video are not extracted.
Scripts and HTML are returned as text where supported and are never executed.

## Observed endpoints

| Endpoint | Usage |
|---|---|
| `/tasks/{id}` | Task, description, files and selected expansions |
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
