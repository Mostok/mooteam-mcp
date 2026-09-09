# Moo.team MCP

Read Moo.team task context from your AI assistant through the HTTPS API.
No browser automation, open tabs or background browser session is required.

**Русский:** передайте ассистенту ссылку или ID задачи. Сервер получает описание,
комментарии с авторами и вложения напрямую по API. Он ничего не записывает в Moo.team.

This is an independent community integration, not an official Moo.team product.

## What it does

- Reads task description, participants, workflow status, parent reference and checklist.
- Preserves comment authors, timestamps, chronology and reply relationships.
- Adds user-confirmed participant roles from an optional local directory.
- Separates human discussion from optional activity history.
- Associates files with their task description or specific comment.
- Searches task titles/descriptions by project, assignee and lifecycle status.
- Reads parents, subtasks and task links with their discussion source.
- Compares reads using a bounded gzip history of fingerprints, without storing task bodies.
- Updates user-confirmed roles through MCP in a local directory.
- Reads images, PDF text/page images, DOCX/XLSX/PPTX text, ZIP listings and text members.
- Reports incomplete pagination, unsupported formats and truncated extraction.
- Accepts old `app.moo.team` links, new `new-app.moo.team` task links and numeric IDs.

## Install

Requires **Node.js 22.17 or newer**.

```sh
npm install -g mooteam-mcp
```

Create a local configuration file outside your repositories:

- Windows: `%USERPROFILE%\.config\mooteam-mcp\config.json`
- macOS/Linux: `~/.config/mooteam-mcp/config.json`

```json
{
  "token": "YOUR_MOOTEAM_BEARER_TOKEN",
  "company": "YOUR_X_MT_COMPANY_VALUE"
}
```

Use your existing Moo.team API token and the `X-MT-Company` value for your workspace.
The company value is the API header value; do not assume it equals a workspace URL ID.
Environment variables can be used instead; see [configuration](docs/configuration.md).

```sh
mooteam-mcp --check
```

## Connect to Codex

```sh
codex mcp add mooteam -- mooteam-mcp
```

Open a new assistant session after changing the MCP configuration.
On Windows, if the host cannot resolve the npm command shim, use the absolute
`node.exe` path and the installed package's `dist/cli.js`; see [configuration](docs/configuration.md).

Other stdio MCP clients can launch `mooteam-mcp` with no arguments.

## Example

Ask your assistant:

> Read task 12345, distinguish each person's comments, and inspect the attached screenshots.

The assistant calls `get_task_context` and then `read_attachment` for relevant files.
Listing an attachment does not mean its contents have been read.

| Tool | Purpose |
|---|---|
| `get_task_context` | Task details, attributed comments, file manifest and changes since last read |
| `read_attachment` | Read a file belonging to that task or its visible comments |
| `get_task_changes` | Compare current data with the last local baseline |
| `get_related_tasks` | Read parents, subtasks and tasks linked in discussion |
| `search_tasks` | Search titles/descriptions with bounded collection scanning |
| `list_projects` | Discover accessible project names and IDs |
| `list_participants` | Resolve people and their local roles |
| `set_participant_role` | Save an explicitly supplied role locally |

## Boundaries

All Moo.team requests are GET-only. The server cannot post comments, change tasks,
track time or upload files. It can update local history and participant roles.
Access is limited by the configured Moo.team account's permissions.
It uses observed application API endpoints, which may change without notice.

Attachment bytes and rendered pages stay in memory; there is no attachment cache
or document temporary directory. Images have a 5 MiB output limit. Selected PDF
pages can be returned as images for the assistant to inspect scans and diagrams;
there is no automatic OCR transcript. Office extraction reads text and reports
visual/layout limitations. Legacy DOC/XLS/PPT, audio, video and non-ZIP archives
are unsupported. External links are retained without fetching them.

History defaults to at most **1 MiB compressed per workspace**, 200 tasks and
90 days since last observation, with at most 20 change events per task. It stores
hashes, IDs, statuses and timestamps, never task/comment bodies or file contents.
Expiry and eviction run on the next tracked read. See [configuration](docs/configuration.md)
for storage details, disabling history and limits.

## Documentation

| Page | Contents |
|---|---|
| [Configuration](docs/configuration.md) | Credentials, clients, limits and troubleshooting |
| [Tools and API](docs/api.md) | Inputs, output semantics, pagination and endpoint mapping |
| [Development](docs/development.md) | Architecture, tests and release procedure |

## License

MIT — see [LICENSE](LICENSE).
