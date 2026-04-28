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

Set `MCP_FS_TOKEN` via the Replit Secrets panel (Tools → Secrets) so the
deployed HTTP workflow can pick it up.

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

## Security notes

- Stdio mode is unauthenticated because the client launches the process
  locally. Do not start stdio mode behind a network listener.
- HTTP mode requires `MCP_FS_TOKEN` and uses `crypto.timingSafeEqual` to
  compare the supplied bearer token. Tokens shorter than 8 characters
  are rejected at startup.
- The server does **not** sandbox shell access, run packages, or touch
  workflows. It is filesystem only.
