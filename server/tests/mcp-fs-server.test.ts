import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const TOKEN = "test-token-vitest-only-not-a-real-secret";
const SERVER_SCRIPT = resolve(__dirname, "..", "..", "mcp-fs-server.js");

let PORT: number;
let BASE: string;

async function findFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => res(port));
      } else {
        rej(new Error("Could not allocate ephemeral port"));
      }
    });
  });
}

let serverProc: ChildProcessWithoutNullStreams;
let projectRoot: string;
let externalRoot: string;
let client: Client;
let transport: SSEClientTransport;

const authHeaders = { Authorization: `Bearer ${TOKEN}` };

async function waitForHealth(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `MCP server did not become healthy within ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

function seedProjectRoot(root: string): void {
  // A handful of normal files
  writeFileSync(join(root, "README.md"), "# Test Project\n", "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "alpha.ts"),
    "export const alpha = 1;\n",
    "utf8",
  );
  writeFileSync(
    join(root, "src", "beta.ts"),
    "export const beta = 2;\n// TODO: refactor\n",
    "utf8",
  );

  // Default-ignored directories that should NOT show up unless includeIgnored
  mkdirSync(join(root, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "left-pad", "index.js"),
    "module.exports = () => {};\n",
    "utf8",
  );
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
}

function unwrapText(result: any): string {
  // MCP CallTool results carry a content array of `{type:"text", text:...}` entries.
  // For our server's JSON tools this is a JSON string.
  expect(result).toBeDefined();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content[0].type).toBe("text");
  return result.content[0].text as string;
}

function unwrapJson<T = any>(result: any): T {
  return JSON.parse(unwrapText(result)) as T;
}

beforeAll(async () => {
  // Two roots: one we hand to the server, one OUTSIDE its sandbox we'll try to
  // escape into via symlinks.
  projectRoot = mkdtempSync(join(tmpdir(), "mcp-fs-root-"));
  externalRoot = mkdtempSync(join(tmpdir(), "mcp-fs-external-"));
  writeFileSync(join(externalRoot, "secret.txt"), "TOP_SECRET\n", "utf8");

  seedProjectRoot(projectRoot);

  // Allocate an ephemeral free port so this suite never collides with another
  // running MCP-FS instance (e.g. the workflow on 8099) or with a parallel
  // CI run.
  PORT = await findFreePort();
  BASE = `http://127.0.0.1:${PORT}`;

  serverProc = spawn(
    process.execPath,
    [SERVER_SCRIPT, "http", String(PORT)],
    {
      env: {
        ...process.env,
        MCP_FS_PORT: String(PORT),
        MCP_FS_TOKEN: TOKEN,
        MCP_FS_ROOT: projectRoot,
        // Keep the child process quiet enough to not flood vitest output.
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverProc.stdout.on("data", () => {});
  serverProc.stderr.on("data", (chunk) => {
    // Only surface real failures; the server prints a banner on stdout.
    const text = chunk.toString();
    if (/Error|EADDR|throw/i.test(text)) {
      // eslint-disable-next-line no-console
      console.error("[mcp-fs-server stderr]", text);
    }
  });

  await waitForHealth();

  transport = new SSEClientTransport(new URL(`${BASE}/sse`), {
    requestInit: { headers: authHeaders },
    eventSourceInit: {
      // EventSource (the polyfill the SDK uses) calls this fetch when opening
      // the stream; we inject the bearer header here too.
      fetch: ((url: any, init: any) =>
        fetch(url, {
          ...init,
          headers: { ...(init?.headers ?? {}), ...authHeaders },
        })) as any,
    },
  });

  client = new Client(
    { name: "mcp-fs-vitest", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  try {
    await client?.close();
  } catch {
    // ignore
  }
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill("SIGTERM");
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        // `serverProc.killed` becomes true the moment a signal is *sent*, not
        // when the child actually exits, so we can't trust it here. Force a
        // SIGKILL unconditionally if we still haven't seen an exit.
        if (serverProc.exitCode === null) {
          try {
            serverProc.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        res();
      }, 2000);
      serverProc.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  }
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(externalRoot, { recursive: true, force: true });
});

describe("mcp-fs-server: HTTP auth", () => {
  it("rejects /sse without a bearer token", async () => {
    const res = await fetch(`${BASE}/sse`);
    expect(res.status).toBe(401);
    // Drain so we don't leak the connection
    await res.text().catch(() => undefined);
  });

  it("rejects /sse with a wrong bearer token", async () => {
    const res = await fetch(`${BASE}/sse`, {
      headers: { Authorization: "Bearer not-the-right-token" },
    });
    expect(res.status).toBe(401);
    await res.text().catch(() => undefined);
  });

  it("rejects /messages without a bearer token", async () => {
    const res = await fetch(`${BASE}/messages?sessionId=does-not-matter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    await res.text().catch(() => undefined);
  });

  it("rejects /messages with a wrong bearer token", async () => {
    const res = await fetch(`${BASE}/messages?sessionId=does-not-matter`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer not-the-right-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    await res.text().catch(() => undefined);
  });

  it("allows /healthz without a bearer token", async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.ok).toBe(true);
  });
});

describe("mcp-fs-server: tool catalog", () => {
  it("exposes the 11 documented tools", async () => {
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "append_file",
        "create_file",
        "delete_directory",
        "delete_file",
        "list_directory",
        "make_directory",
        "move_file",
        "read_file",
        "search_files",
        "search_in_files",
        "write_file",
      ].sort(),
    );
  });
});

describe("mcp-fs-server: 11 tools, happy path", () => {
  it("list_directory returns project root entries", async () => {
    const result = await client.callTool({
      name: "list_directory",
      arguments: { path: "." },
    });
    const data = unwrapJson<{ entries: { path: string; type: string }[] }>(
      result,
    );
    const paths = data.entries.map((e) => e.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("src");
  });

  it("read_file reads an existing file", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "README.md" },
    });
    const text = unwrapText(result);
    expect(text).toContain("Test Project");
  });

  it("create_file creates a new file and refuses to overwrite", async () => {
    const ok = await client.callTool({
      name: "create_file",
      arguments: { path: "created.txt", content: "hello\n" },
    });
    unwrapText(ok); // should not throw
    expect(existsSync(join(projectRoot, "created.txt"))).toBe(true);

    const dup = await client.callTool({
      name: "create_file",
      arguments: { path: "created.txt", content: "second time\n" },
    });
    expect(dup.isError).toBe(true);
  });

  it("write_file overwrites an existing file", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "written.txt", content: "v1" },
    });
    await client.callTool({
      name: "write_file",
      arguments: { path: "written.txt", content: "v2" },
    });
    expect(readFileSync(join(projectRoot, "written.txt"), "utf8")).toBe("v2");
  });

  it("append_file appends to an existing file", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "log.txt", content: "line1\n" },
    });
    await client.callTool({
      name: "append_file",
      arguments: { path: "log.txt", content: "line2\n" },
    });
    expect(readFileSync(join(projectRoot, "log.txt"), "utf8")).toBe(
      "line1\nline2\n",
    );
  });

  it("make_directory creates nested directories", async () => {
    await client.callTool({
      name: "make_directory",
      arguments: { path: "deep/nested/dir" },
    });
    expect(existsSync(join(projectRoot, "deep", "nested", "dir"))).toBe(true);
  });

  it("move_file renames a file", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "movable.txt", content: "x" },
    });
    await client.callTool({
      name: "move_file",
      arguments: { from: "movable.txt", to: "moved.txt" },
    });
    expect(existsSync(join(projectRoot, "movable.txt"))).toBe(false);
    expect(existsSync(join(projectRoot, "moved.txt"))).toBe(true);
  });

  it("delete_file removes a file", async () => {
    await client.callTool({
      name: "write_file",
      arguments: { path: "doomed.txt", content: "bye" },
    });
    expect(existsSync(join(projectRoot, "doomed.txt"))).toBe(true);
    await client.callTool({
      name: "delete_file",
      arguments: { path: "doomed.txt" },
    });
    expect(existsSync(join(projectRoot, "doomed.txt"))).toBe(false);
  });

  it("delete_directory removes a directory", async () => {
    await client.callTool({
      name: "make_directory",
      arguments: { path: "trash" },
    });
    // The server uses fs.rm under the hood, which requires recursive: true
    // to remove a directory at all (even an empty one).
    await client.callTool({
      name: "delete_directory",
      arguments: { path: "trash", recursive: true },
    });
    expect(existsSync(join(projectRoot, "trash"))).toBe(false);
  });

  it("delete_directory recursive removes a populated directory", async () => {
    await client.callTool({
      name: "make_directory",
      arguments: { path: "rmtree/sub" },
    });
    await client.callTool({
      name: "write_file",
      arguments: { path: "rmtree/sub/file.txt", content: "x" },
    });
    await client.callTool({
      name: "delete_directory",
      arguments: { path: "rmtree", recursive: true },
    });
    expect(existsSync(join(projectRoot, "rmtree"))).toBe(false);
  });

  it("search_files finds files by glob", async () => {
    // The server's glob is matched against each file's basename, so we scope
    // the search with `path` and use a basename-only pattern.
    const result = await client.callTool({
      name: "search_files",
      arguments: { pattern: "*.ts", path: "src" },
    });
    const data = unwrapJson<{ matches: string[] }>(result);
    const matches = data.matches.sort();
    expect(matches).toContain("src/alpha.ts");
    expect(matches).toContain("src/beta.ts");
  });

  it("search_in_files finds matches inside files", async () => {
    const result = await client.callTool({
      name: "search_in_files",
      arguments: { query: "TODO", path: "src" },
    });
    const data = unwrapJson<{ matches: { path: string; line: number }[] }>(
      result,
    );
    const paths = data.matches.map((m) => m.path);
    expect(paths).toContain("src/beta.ts");
  });
});

describe("mcp-fs-server: path-traversal hardening", () => {
  it("rejects '..' escape via read_file", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    expect(unwrapText(result)).toMatch(/escape|outside|root/i);
  });

  it("rejects '..' escape via write_file", async () => {
    const result = await client.callTool({
      name: "write_file",
      arguments: { path: "../escaped.txt", content: "no" },
    });
    expect(result.isError).toBe(true);
    // And it really didn't write anywhere outside the root.
    expect(existsSync(join(projectRoot, "..", "escaped.txt"))).toBe(false);
  });

  it("rejects absolute path that lands outside the root", async () => {
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "/etc/passwd" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects null-byte injection on read_file with the server-level message", async () => {
    // We pin the assertion to the server's own error string ("Path contains
    // null byte") rather than a generic "null|invalid" pattern, so this test
    // only passes if the application-level guard in resolveSafe() runs and
    // rejects the path BEFORE Node's filesystem layer ever sees it.
    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "README.md\u0000.evil" },
    });
    expect(result.isError).toBe(true);
    expect(unwrapText(result)).toContain("Path contains null byte");
  });

  it("rejects null-byte injection on write_file with the server-level message", async () => {
    const sentinel = join(projectRoot, "should-not-exist-null.txt");
    if (existsSync(sentinel)) rmSync(sentinel, { force: true });
    const result = await client.callTool({
      name: "write_file",
      arguments: {
        path: "should-not-exist-null.txt\u0000.evil",
        content: "PWNED",
      },
    });
    expect(result.isError).toBe(true);
    expect(unwrapText(result)).toContain("Path contains null byte");
    // And critically: nothing was written under the sandbox-relative name.
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe("mcp-fs-server: negative matrix across all path-bearing tools", () => {
  // For every handler that takes a path argument, confirm that traversal,
  // absolute-outside, and null-byte payloads are all rejected. This guards
  // against a future regression where one handler forgets to call resolveSafe
  // (e.g., reads its own raw `path` arg).
  type ToolCall = { name: string; build: (payload: string) => any };
  const callsByPath: ToolCall[] = [
    { name: "read_file", build: (p) => ({ path: p }) },
    { name: "write_file", build: (p) => ({ path: p, content: "x" }) },
    { name: "append_file", build: (p) => ({ path: p, content: "x" }) },
    { name: "create_file", build: (p) => ({ path: p, content: "x" }) },
    { name: "delete_file", build: (p) => ({ path: p }) },
    { name: "make_directory", build: (p) => ({ path: p }) },
    { name: "delete_directory", build: (p) => ({ path: p, recursive: true }) },
    { name: "list_directory", build: (p) => ({ path: p }) },
    { name: "search_files", build: (p) => ({ pattern: "*", path: p }) },
    { name: "search_in_files", build: (p) => ({ query: "x", path: p }) },
    // move_file: from-side
    { name: "move_file", build: (p) => ({ from: p, to: "anywhere.txt" }) },
    // move_file: to-side
    { name: "move_file", build: (p) => ({ from: "README.md", to: p }) },
  ];

  const payloads: { label: string; value: string; expect: RegExp }[] = [
    { label: "traversal '../'", value: "../etc/passwd", expect: /escape/i },
    { label: "absolute outside root", value: "/etc/passwd", expect: /escape/i },
    {
      label: "null-byte injection",
      value: "innocent.txt\u0000.evil",
      expect: /Path contains null byte/,
    },
  ];

  for (const tool of callsByPath) {
    for (const payload of payloads) {
      const variant =
        tool.name === "move_file"
          ? Object.keys(tool.build("X"))[0] === "from"
            ? "(from)"
            : "(to)"
          : "";
      it(`${tool.name}${variant} rejects ${payload.label}`, async () => {
        const result = await client.callTool({
          name: tool.name,
          arguments: tool.build(payload.value),
        });
        expect(result.isError).toBe(true);
        expect(unwrapText(result)).toMatch(payload.expect);
      });
    }
  }
});

describe("mcp-fs-server: symlink-escape hardening", () => {
  it("rejects reads through a symlink that points outside the root", async () => {
    // projectRoot/escape-link -> externalRoot
    const linkPath = join(projectRoot, "escape-link");
    if (existsSync(linkPath)) rmSync(linkPath, { force: true });
    symlinkSync(externalRoot, linkPath, "dir");

    const result = await client.callTool({
      name: "read_file",
      arguments: { path: "escape-link/secret.txt" },
    });
    expect(result.isError).toBe(true);
    expect(unwrapText(result)).toMatch(/symlink|escape|outside|root/i);
  });

  it("rejects writes through a symlink that points outside the root", async () => {
    // projectRoot/escape-link is still pointing at externalRoot from above.
    const sentinel = join(externalRoot, "should-not-exist.txt");
    if (existsSync(sentinel)) rmSync(sentinel, { force: true });

    const result = await client.callTool({
      name: "write_file",
      arguments: {
        path: "escape-link/should-not-exist.txt",
        content: "PWNED",
      },
    });
    expect(result.isError).toBe(true);
    // And critically: the file was NOT created outside the sandbox.
    expect(existsSync(sentinel)).toBe(false);
  });

  it("rejects deletes through a symlink that points outside the root", async () => {
    // Sentinel file inside externalRoot — must survive the call below.
    const sentinel = join(externalRoot, "do-not-delete-me.txt");
    writeFileSync(sentinel, "I should still exist after the test\n", "utf8");

    // Same `escape-link -> externalRoot` symlink from earlier tests.
    const result = await client.callTool({
      name: "delete_file",
      arguments: { path: "escape-link/do-not-delete-me.txt" },
    });
    expect(result.isError).toBe(true);
    expect(unwrapText(result)).toMatch(/symlink|escape|outside|root/i);
    // And critically: the external file was NOT deleted.
    expect(existsSync(sentinel)).toBe(true);
  });
});

describe("mcp-fs-server: default ignores", () => {
  it("list_directory recursive omits node_modules and .git by default", async () => {
    const result = await client.callTool({
      name: "list_directory",
      arguments: { path: ".", recursive: true },
    });
    const data = unwrapJson<{ entries: { name: string; path: string }[] }>(
      result,
    );
    const paths = data.entries.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
  });

  it("list_directory recursive includes ignored dirs when includeIgnored=true", async () => {
    const result = await client.callTool({
      name: "list_directory",
      arguments: { path: ".", recursive: true, includeIgnored: true },
    });
    const data = unwrapJson<{ entries: { name: string; path: string }[] }>(
      result,
    );
    const paths = data.entries.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(true);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(true);
  });

  it("search_files honors default ignores", async () => {
    // Pattern is matched against each file's basename. `index.js` only exists
    // inside node_modules in our fixture, so without includeIgnored the
    // default ignore should leave it out entirely.
    const result = await client.callTool({
      name: "search_files",
      arguments: { pattern: "*.js" },
    });
    const data = unwrapJson<{ matches: string[] }>(result);
    expect(data.matches.some((m) => m.startsWith("node_modules"))).toBe(false);
  });

  it("search_files with includeIgnored=true returns ignored matches", async () => {
    const result = await client.callTool({
      name: "search_files",
      arguments: { pattern: "*.js", includeIgnored: true },
    });
    const data = unwrapJson<{ matches: string[] }>(result);
    expect(data.matches.some((m) => m.startsWith("node_modules"))).toBe(true);
  });

  it("search_in_files honors default ignores", async () => {
    // The seeded `node_modules/left-pad/index.js` contains the word "module".
    const result = await client.callTool({
      name: "search_in_files",
      arguments: { query: "module" },
    });
    const data = unwrapJson<{ matches: { path: string }[] }>(result);
    expect(
      data.matches.some((m) => m.path.startsWith("node_modules")),
    ).toBe(false);
  });

  it("search_in_files with includeIgnored=true returns ignored matches", async () => {
    const result = await client.callTool({
      name: "search_in_files",
      arguments: { query: "module", includeIgnored: true },
    });
    const data = unwrapJson<{ matches: { path: string }[] }>(result);
    expect(
      data.matches.some((m) => m.path.startsWith("node_modules")),
    ).toBe(true);
  });
});
