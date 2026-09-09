[Back to README](../README.md) · [Tools and API →](api.md)

# Configuration

The server uses Node's home directory to find `.config/mooteam-mcp/config.json`.
Keep this file outside your repository. Restrict access to your local account.

```json
{
  "token": "YOUR_TOKEN",
  "company": "YOUR_X_MT_COMPANY_VALUE"
}
```

An optional `fileToken` can support accounts where original-file requests reject
Bearer authentication. A normal Bearer request is always attempted first.
Never publish session tokens or credential-bearing download links.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `MOOTEAM_CONFIG_FILE` | Home directory path above | Explicit JSON config path |
| `MOOTEAM_API_TOKEN` | Config `token` | Bearer token; an optional `Bearer ` prefix is removed |
| `MOOTEAM_COMPANY_ALIAS` | Config `company` | Exact `X-MT-Company` header value |
| `MOOTEAM_FILE_TOKEN` | Config `fileToken` | Optional fallback download token |
| `MOOTEAM_ROLES_FILE` | `roles.json` beside the selected config file | Optional local participant roles |
| `MOOTEAM_HISTORY` | Enabled | Set `off` to disable local history reads/writes |
| `MOOTEAM_HISTORY_MAX_BYTES` | `1048576` | Compressed history budget per workspace, 16384–10485760 |
| `MOOTEAM_HISTORY_MAX_TASKS` | `200` | Maximum retained task baselines, 1–2000 |
| `MOOTEAM_HISTORY_DAYS` | `90` | Expire tasks after this many days without an observation, 1–365 |
| `MOOTEAM_TIMEOUT_MS` | `30000` | Per-request and document worker timeout, 1000–120000 |
| `MOOTEAM_MAX_PAGES` | `100` | Maximum pages in each API collection, 1–1000 |
| `MOOTEAM_MAX_ATTACHMENT_BYTES` | `10485760` | Download limit, 1024–52428800 bytes |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

Environment credentials override individual JSON fields. An explicit missing or
invalid config file is an error. `.env` files are **not automatically loaded**.
If using `.env`, start Node with its `--env-file` option or export variables in the launcher.

## Local participant roles

To label participants without changing Moo.team, create `roles.json` beside your
local `config.json`. Use the same `company` value as your credentials and stable
user IDs returned by `get_task_context`:

```json
{
  "company": "YOUR_X_MT_COMPANY_VALUE",
  "users": {
    "10": { "role": "QA engineer" },
    "20": {
      "role": "Developer",
      "projects": { "45": "Mobile developer" }
    }
  }
}
```

Project roles override the general role. Unknown users have `role: null`.
The directory is reloaded for each task read; changing roles does not require a
server restart. Installing an updated MCP runtime does require restarting the client.
Missing files mean no configured roles. Invalid files or a mismatched company
produce a warning and omit roles while preserving task reads. The file limit is
1 MiB; role labels must contain 1–256 characters.

Tell the assistant who does what: it can use `list_participants`, then
`set_participant_role` with the exact user ID, expected full name and
`userConfirmed: true`. It must use only roles you explicitly supply,
preserve other entries and the company value, and never publish the directory.
If a name is ambiguous, clarify the person before assigning a role. Use a project
override only when you specify that scope. `role: null` removes the selected
scope. The tool writes only this local file and preserves other entries with an
atomic replacement and cross-process lock. Role labels provide context; they do not grant permissions or constitute
instructions to perform actions.

## Compact local history

`get_task_context` tracks changes by default; set `trackChanges: false` to leave
the baseline unchanged. `get_task_changes` compares and advances the same baseline.
The first complete read establishes a baseline. Attachment reads, search and related
task reads never advance it. Missing/incomplete comments preserve the previous
baseline. A late response cannot overwrite an observation that started later.

One `history-<workspace-hash>.json.gz` sits beside the selected config file.
It contains semantic hashes of task fields, comments and file metadata, source IDs,
status IDs/values, observation timestamps and short change events. It contains no
task titles, descriptions, discussion text, participant names or attachment bytes.
It is a change detector, not a backup: old text cannot be reconstructed, and edits
made and reverted between reads cannot be detected. A missing comment/file means
"no longer visible", not confirmed deletion. Changing local roles does not create
an edit to the source discussion.

The defaults are 1 MiB compressed, 200 tasks, 90 days since last observation and
20 events per task. At most five recent events are returned. Expiry and oldest-task
eviction run during tracked reads; an evicted task starts a new baseline next time.
Each returned ID list is capped at 100 and includes full counts/truncation flags.
Uncompressed state is also bounded to 16 MiB. An individual baseline that cannot
fit is skipped with a warning, preserving the existing file.

An atomic save temporarily needs up to one additional file of the configured
size plus a small lock file. Normal completion removes temporary files. A crash
can leave a lock/temp file: stop all MCP processes before removing those leftovers.
Corrupt, oversized, busy or inaccessible state produces a warning and is preserved;
task reads still work. To reset a corrupt baseline, stop MCP and remove its history
file. Setting `MOOTEAM_HISTORY=off` does not remove an existing history file.

Keep the configuration directory private to your OS account, including its
inherited permissions on Windows: atomic replacements inherit directory ACLs.
History is gzip-compressed, not encrypted.

## Stdio clients

```json
{
  "mcpServers": {
    "mooteam": {
      "command": "mooteam-mcp",
      "args": []
    }
  }
}
```

Codex CLI:

```sh
codex mcp add mooteam -- mooteam-mcp
```

For Windows hosts unable to launch npm `.cmd` shims, find the global package root
using `npm root -g`, then configure the actual executable and JavaScript file:

```toml
[mcp_servers.mooteam]
command = 'C:\Program Files\nodejs\node.exe'
args = ['C:\Users\you\AppData\Roaming\npm\node_modules\mooteam-mcp\dist\cli.js']
```

Replace both example paths with the actual locations on your machine. The server
does not need a particular working directory. You can set `MOOTEAM_CONFIG_FILE`
in the host's environment to keep credentials in another location.

## Troubleshooting

- `AUTH_EXPIRED`: replace the local Moo.team token and restart the MCP process.
  Browser-derived session token lifetime depends on Moo.team; there is no automatic refresh.
- `ACCESS_DENIED`: verify the company header and account access to the resource.
- `CONFIG_MISSING`: run `mooteam-mcp --help` to see the exact default config path.
- `REDIRECT_BLOCKED`: the API changed or redirected a resource. Credentials are never forwarded.
- `IMAGE_OUTPUT_LIMIT`: images above 5 MiB cannot be returned even if the download limit is higher.
- `SIZE_LIMIT`: a file or API response exceeded its bounded byte budget.
- `CONTEXT_TOO_LARGE`: reduce `commentsLimit` or omit history. A huge description
  may still exceed the 1 MiB context limit; the server returns an error instead of silently omitting it.
- `sourceComplete: false`: inspect warnings. A page failed, the collection changed,
  pagination metadata was missing, or the configured page cap was reached.

Operational logs go to stderr and omit credentials, full URLs and task content.
Only compact history and local roles are maintained on disk. Attachments are fetched
into RAM, processed and released; neither originals nor extracted/rendered content
are written as files. PDF/Office/ZIP processing uses workers with timeouts and a
256 MiB V8 heap cap, plus explicit byte limits. Native allocations are outside the
V8 heap cap; this is not a general-purpose sandbox.

## See also

- [Tools and API](api.md)
- [Development and testing](development.md)
