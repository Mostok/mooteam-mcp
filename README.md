# Moo.team MCP

Read Moo.team task context from your AI assistant through the HTTPS API.
No browser automation, open tabs or background browser session is required.

**Русский:** передайте ассистенту ссылку или ID задачи. Сервер получает описание,
комментарии с авторами и вложения напрямую по API. Он ничего не записывает в Moo.team.

This is an independent community integration, not an official Moo.team product.

## What it does

- Reads task description, participants, workflow status, parent reference and checklist.
- Preserves comment authors, timestamps, chronology and reply relationships.
- Separates human discussion from optional activity history.
- Associates files with their task description or specific comment.
- Returns supported images as MCP image content, PDF embedded text and UTF-8 text.
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
| `get_task_context` | Task details, attributed comments, file manifest and optional history |
| `read_attachment` | Read a file belonging to that task or its visible comments |

## Boundaries

The server exposes only reads. It cannot post comments, change tasks, track time
or upload files. Access is limited by the configured Moo.team account's permissions.
It uses observed application API endpoints, which may change without notice.

Images have a 5 MiB output limit. PDF extraction reads embedded text, with no OCR
or interpretation of diagrams. Word, Excel, archives, audio and video are listed
but not extracted in this release. External links are retained without fetching them.

## Documentation

| Page | Contents |
|---|---|
| [Configuration](docs/configuration.md) | Credentials, clients, limits and troubleshooting |
| [Tools and API](docs/api.md) | Inputs, output semantics, pagination and endpoint mapping |
| [Development](docs/development.md) | Architecture, tests and release procedure |

## License

MIT — see [LICENSE](LICENSE).
