# Filesystem MCP Server

Lets an MCP-compatible client (Claude Desktop, or Claude on the web via a
remote-MCP connector) read and write files in this repo directly. Adds 11
filesystem tools: `list_directory`, `read_file`, `write_file`,
`append_file`, `create_file`, `delete_file`, `move_file`,
`make_directory`, `delete_directory`, `search_files` (filename glob), and
`search_in_files` (content grep).

The server entrypoint is `mcp-fs-server.js` at the repo root. It supports
two transports selected by a CLI flag or env var:

- **stdio** — for Claude Desktop. The client launches the process; no
  network, no token.
- **http** — for remote MCP clients (Claude on the web). Listens on a
  port, requires a bearer token.

## Configuration

| Env var             | Required        | Default                  | Notes                                              |
| ------------------- | --------------- | ------------------------ | -------------------------------------------------- |
| `MCP_FS_TOKEN`      | yes for `http`  | —                        | Bearer token (≥ 8 chars). HTTP refuses to start otherwise. |
| `MCP_FS_ROOT`       | no              | repo root                | Files outside this directory are rejected.         |
| `MCP_FS_PORT`       | no              | `8099`                   | HTTP port. Override with `--port`.                 |
| `MCP_FS_TRANSPORT`  | no              | `stdio`                  | Override with the `stdio`/`http` positional arg.   |

> ⚠️  The token grants full read/write/delete on every file under
> `MCP_FS_ROOT`. Treat it like an SSH key. Anyone with the token can
> delete the whole repo.

### Where the token actually lives (verified Apr 2026, Task #209)

`MCP_FS_TOKEN` is stored in **Replit Secrets** — *not* in any `.env`
file, *not* in `.replit`'s `[userenv.shared]` block, and *not* inline on
the `MCP Filesystem` workflow's `args = "node mcp-fs-server.js http"`
command. The audit walked every possible source:

| Source                                  | Holds the token? |
| --------------------------------------- | ---------------- |
| Replit Secrets (global, account-level)  | ✅ **yes**       |
| `.env*` files                           | ❌ none exist    |
| `.replit` → `[userenv.shared]`          | ❌ not present   |
| `.replit` → workflow inline env         | ❌ no env block  |
| Ad-hoc shell `export`                   | ❌ none          |

**How to find it in the UI** — this is the gotcha that prompted #209:
Replit Secrets are *not* in the same list as the `[userenv.shared]`
plaintext env vars. Open the workspace and click the **🔒 Secrets** tab
in the left sidebar (sometimes labelled **Tools → Secrets**). The list
is searchable but case-sensitive — search the exact key `MCP_FS_TOKEN`.
Only the key name is shown; the value is masked. In this workspace
Secrets are stored at account/global scope, so no "shared / development
/ production" dropdown is involved (unlike env vars, which *do* have a
scope picker). Replit may relabel the tab over time — if "Secrets" is
not in the sidebar, look for a 🔒 lock icon or use the workspace
search.

If `MCP_FS_TOKEN` is missing from that list, the standalone HTTP server
will refuse to start (`MCP_FS_TOKEN must be set (min 8 chars)…`) and
`server/index.ts` will skip mounting `/fs-mcp` with the log line
`[MCP-FS] /fs-mcp route NOT mounted (MCP_FS_TOKEN missing or <8 chars)`.

## Run the server

```bash
node mcp-fs-server.js stdio          # local stdio transport (Claude Desktop)
node mcp-fs-server.js http           # HTTP+SSE transport on port 8099
node mcp-fs-server.js http --port 9000  # override port
```

In Replit, the `MCP Filesystem` workflow runs the HTTP transport for you
once `MCP_FS_TOKEN` is set in Secrets — no manual command needed.

## Claude Desktop (stdio)

Open `~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS (or the Windows equivalent) and add:

```json
{
  "mcpServers": {
    "apex-fs": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/THIS/REPO/mcp-fs-server.js", "stdio"],
      "env": {
        "MCP_FS_ROOT": "/ABSOLUTE/PATH/TO/THIS/REPO"
      }
    }
  }
}
```

Restart Claude Desktop. The server's tools should appear in the
hammer/tools menu.

## Claude on the web (remote HTTP+SSE)

The filesystem MCP exposes two URLs that both serve the same tools and
both require the same `Authorization: Bearer <MCP_FS_TOKEN>` header.
Pick whichever fits the situation.

### Recommended for published deployments — `/fs-mcp/sse` on the main app

The main Express app mounts the filesystem MCP at `/fs-mcp` whenever
`MCP_FS_TOKEN` is set in Secrets. This URL survives workspace sleep and
stays reachable on the published deployment, because it shares the same
`5000 → 80` port mapping as the rest of the app.

```
SSE URL:       https://<deployment-host>/fs-mcp/sse
Auth header:   Authorization
Auth value:    Bearer <your MCP_FS_TOKEN>
```

Where `<deployment-host>` is whatever Replit gave you when you ran
"Publish" (e.g. `apex-marketing-automations.replit.app`). For sanity
checks the route also exposes `GET /fs-mcp/healthz` (no auth) which
returns `{ ok: true, root, tools, mountedAt }`.

Trade-offs:
- Shares fate with the main app — if the main deploy is unhealthy, so
  is the file server. If you want them to crash independently, use the
  standalone dev URL below or run the server as its own Reserved-VM /
  Background Worker deployment with its own hostname.
- The `MCP_FS_TOKEN` grants full read/write/delete on the project,
  served from a public URL. Treat it like an SSH key. Rotate it
  immediately if it leaks.
- Mounted before the main app's body parsers and CSRF middleware so the
  `/fs-mcp` routes use their own 8 MB JSON limit and are not subject to
  `/api`-scoped rate limiting.

### Dev-only fallback — port 8099 (not always-on)

The `MCP Filesystem` workflow also keeps a standalone HTTP server alive
on port 8099 while the dev workspace is awake. It uses the dev domain:

```
SSE URL:       https://<REPLIT_DEV_DOMAIN>:8099/sse
Auth header:   Authorization
Auth value:    Bearer <your MCP_FS_TOKEN>
```

`REPLIT_DEV_DOMAIN` is the hostname shown in the Replit webview, e.g.
`<repl-id>.<cluster>.replit.dev`. Port `8099` is forwarded externally
in `.replit` ([[ports]] block). This URL **disappears** when the
workspace sleeps or when the main app is published, so use it only for
local testing.

### Setting up the connector

1. Set `MCP_FS_TOKEN` in Replit Secrets to a long random string (e.g.
   `openssl rand -hex 32`). Both the standalone server and the main-app
   mount refuse to expose anything without it.
2. (Optional) Start the `MCP Filesystem` workflow if you want the dev
   port-8099 endpoint as well. The `/fs-mcp` mount on the main app is
   automatic once `MCP_FS_TOKEN` is set.
3. In Claude on the web, open Settings → Connectors → Add custom
   connector ("Custom integration via URL") and paste the SSE URL +
   bearer header from one of the sections above.

## Tool reference

All tools take paths relative to `MCP_FS_ROOT`. Anything that resolves
above the root is rejected with `Path escapes project root`.

| Tool               | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `list_directory`   | List a directory; `recursive=true` for a deep walk.              |
| `read_file`        | Read text or base64 file contents.                                |
| `write_file`       | Overwrite (or create) a file.                                     |
| `append_file`      | Append to a file (creates if missing).                            |
| `create_file`      | Create a new file; errors if it already exists.                   |
| `delete_file`      | Delete a single file.                                             |
| `move_file`        | Move/rename a file or directory.                                  |
| `make_directory`   | `mkdir -p`.                                                       |
| `delete_directory` | Delete a directory (`recursive=true` for non-empty).              |
| `search_files`     | Filename glob (`*.ts`, `README*`).                                |
| `search_in_files`  | Substring or regex grep across file contents.                     |

Default ignores during recursive walks and searches: `node_modules`,
`.git`, `dist`, `uploads`, `.cache`, `.local`, `.replit_agent`,
`.pythonlibs`. Pass `includeIgnored: true` to override.

## Operating safely with Claude

The server happily exposes all 11 tools to anyone who holds the bearer
token. That includes destructive ones (`delete_file`, `delete_directory
recursive=true`, `move_file overwrite=true`, `write_file` over an
existing file). Claude Desktop and Claude on the web both let the
operator decide, **per conversation**, which of the connector's tools
the model is allowed to call and whether each call needs explicit
human approval. Use that — don't rely on the server alone.

### Recommended posture per tool

Use these labels when configuring the connector:

- **safe-to-allow** — read-only, leave on for the whole conversation.
- **ask-each-time** — mutates content; let Claude propose the call but
  require you to click "Approve" before it runs.
- **destructive-confirm-explicitly** — irreversible or capable of mass
  data loss; only enable for the specific turn that needs it, then
  disable again. Tell Claude the exact path you expect it to touch
  before approving.

| Tool                 | Posture                            | Why                                                                                       |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `list_directory`     | safe-to-allow                      | Read-only. Default ignores keep `node_modules` etc. out.                                  |
| `read_file`          | safe-to-allow                      | Read-only. Default `maxBytes=5_000_000` caps any single read at ~5 MB.                    |
| `search_files`       | safe-to-allow                      | Read-only filename glob. `limit=500` by default.                                          |
| `search_in_files`    | safe-to-allow                      | Read-only grep. Skips any file > 2 MB and caps results at `maxMatches=200`.               |
| `make_directory`     | ask-each-time                      | Mutates, but only adds an empty dir. Low blast radius, still worth a click.               |
| `create_file`        | ask-each-time                      | Refuses to overwrite (`flag: "wx"`), so the worst case is a stray new file.               |
| `append_file`        | ask-each-time                      | Adds bytes to an existing file. No clobber, but easy to dirty a doc you care about.       |
| `write_file`         | ask-each-time                      | Overwrites silently and creates parents. Always review the diff Claude proposes.          |
| `move_file`          | destructive-confirm-explicitly     | With `overwrite=true` it clobbers the destination. Scope to one turn at a time.           |
| `delete_file`        | destructive-confirm-explicitly     | Unrecoverable from the connector. Confirm the path before approving.                      |
| `delete_directory`   | destructive-confirm-explicitly     | With `recursive=true` removes a whole subtree. Refuses the project root, nothing else.    |

### Worked examples

**Read-only exploration ("help me understand this repo")**

In the connector settings, enable only:

- `list_directory`
- `read_file`
- `search_files`
- `search_in_files`

Leave every mutating tool **off**. Claude can browse, grep, and quote
files but cannot change anything. This is the right posture for
onboarding sessions, code review prep, and "what does this codebase do"
chats.

**Let Claude make edits ("apply this change end-to-end")**

Start from the read-only set above, then additionally enable:

- `write_file` — set to "ask before each call".
- `create_file` — set to "ask before each call".
- `append_file` — set to "ask before each call".
- `make_directory` — set to "ask before each call".

Keep `delete_file`, `delete_directory`, and `move_file` **off** until
the moment you actually need them. When Claude proposes a deletion or
move:

1. Re-read the path it wants to touch.
2. Toggle the specific destructive tool on for one turn.
3. Approve the single call.
4. Toggle it back off.

This is more clicks than "allow all", but it's the only way to keep an
LLM-driven session from accidentally `rm -rf`-ing a directory because
of a hallucinated cleanup step.

### Rate-limit and abuse-protection knobs available today

The server has **per-call output caps** but does **not** have a
per-token request-rate limiter. The `/fs-mcp` mount sits in front of
the main app's `/api`-scoped rate limiter, so the rate limits you've
seen documented for the rest of the API do not apply here.

What the server does enforce today:

| Knob                                    | Where                            | Default        | Notes                                                                  |
| --------------------------------------- | -------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Bearer token, timing-safe compare       | `createMcpFsRouter` auth check   | required       | Min 8 chars; HTTP refuses to mount otherwise.                          |
| Path sandbox                            | `resolveSafe()` in the router    | `MCP_FS_ROOT`  | Symlink-aware; rejects anything that escapes the root.                 |
| Refuse to delete project root           | `delete_directory` handler       | always on      | Hard-coded; not configurable.                                          |
| HTTP JSON body limit                    | `createMcpFsRouter({ jsonLimit })` | `8mb`        | Caps the size of a single tool call's payload.                         |
| `read_file` size cap                    | `maxBytes` argument              | 5 MB           | Per call. Caller can raise it; consider lowering it on the client.     |
| `list_directory` entry cap              | `maxEntries` argument            | 5 000          | Per call. Returns `truncated: true` when hit.                          |
| `search_files` match cap                | `limit` argument                 | 500            | Per call.                                                              |
| `search_in_files` match cap             | `maxMatches` argument            | 200            | Per call.                                                              |
| `search_in_files` per-file size skip    | hard-coded                       | 2 MB           | Files larger than this are silently skipped during grep.               |

What is **not** enforced today (TODO, file an issue if you need it):

- No per-token or per-IP request-rate limit. A misbehaving client can
  hammer `/fs-mcp/sse` and `/fs-mcp/messages` as fast as the network
  allows.
- No cap on the number of concurrent SSE sessions. The `sessions` Map
  only shrinks when the underlying socket closes.
- No audit log of which tool was called against which path. Mutations
  are invisible after the fact unless you correlate them with git.
- No allow-list / deny-list of tools at the server layer — the
  scoping has to happen in the Claude client.

Practical mitigations until those land:

1. Treat `MCP_FS_TOKEN` as single-tenant. Issue one token per human
   operator and rotate immediately if a session goes sideways.
2. For automated/long-running clients, run the server with a tighter
   `MCP_FS_ROOT` (e.g. `MCP_FS_ROOT=/path/to/this/repo/sandbox`) so
   the blast radius is bounded even if the rate limits aren't.
3. Keep the destructive tools disabled in the connector by default, as
   described above. The server cannot un-do a `delete_file`; the
   client-side toggle is the real safety net.

## Security notes

- Stdio mode is unauthenticated because the client launches the process
  locally. Do not start stdio mode behind a network listener.
- HTTP mode requires `MCP_FS_TOKEN` and uses `crypto.timingSafeEqual` to
  compare the supplied bearer token. Tokens shorter than 8 characters
  are rejected at startup.
- The server does **not** sandbox shell access, run packages, or touch
  workflows. It is filesystem only.
