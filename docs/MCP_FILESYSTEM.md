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

1. Set `MCP_FS_TOKEN` in Replit Secrets to a long random string (e.g.
   `openssl rand -hex 32`). The HTTP server refuses to start without it.
2. Start the `MCP Filesystem` workflow (or run
   `node mcp-fs-server.js http` from a shell for testing).
3. In Claude on the web, open Settings → Connectors → Add custom
   connector ("Custom integration via URL") and paste:

```
SSE URL:       https://<REPLIT_DEV_DOMAIN>:8099/sse
Auth header:   Authorization
Auth value:    Bearer <your MCP_FS_TOKEN>
```

`REPLIT_DEV_DOMAIN` is the hostname shown in the Replit webview, e.g.
`<repl-id>.<cluster>.replit.dev`. Port `8099` is forwarded externally
in `.replit` ([[ports]] block), so the SSE endpoint is available at
`https://<that-host>:8099/sse`. The HTTP server also exposes
`GET /healthz` (no auth) for liveness checks.

For a deployed app the public URL maps differently — only the port
mapped to `externalPort = 80` is exposed without an explicit port.
If you publish the FS server, run it as a separate Background Worker
deployment so it has its own public hostname, or mount it on the main
app. By default the workflow runs in dev only.

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
