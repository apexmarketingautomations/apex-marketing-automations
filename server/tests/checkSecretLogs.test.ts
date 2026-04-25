import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// We exercise both the in-process API (scanFile) and the CLI binary itself
// so that regressions in either layer are caught.
import {
  scanFile,
  buildTaintSets,
  isSecretEnvName,
  type SecretLogViolation,
} from "../../scripts/check-secret-logs.mjs";

function withFixture(content: string, run: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "secret-logs-"));
  try {
    const file = join(dir, "fixture.ts");
    writeFileSync(file, content, "utf8");
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("isSecretEnvName", () => {
  it("recognises common secret-segment names", () => {
    expect(isSecretEnvName("STUDIO_WEBHOOK_SECRET")).toBe(true);
    expect(isSecretEnvName("AGENT_SECRET")).toBe(true);
    expect(isSecretEnvName("META_ACCESS_TOKEN")).toBe(true);
    expect(isSecretEnvName("STRIPE_API_SECRET")).toBe(true);
    expect(isSecretEnvName("GOOGLE_API_KEY")).toBe(true);
    expect(isSecretEnvName("MAILGUN_APIKEY")).toBe(true);
    expect(isSecretEnvName("DB_PASSWORD")).toBe(true);
    expect(isSecretEnvName("ADMIN_PIN")).toBe(true);
  });

  it("ignores unrelated env var names", () => {
    expect(isSecretEnvName("NODE_ENV")).toBe(false);
    expect(isSecretEnvName("DATABASE_URL")).toBe(false);
    expect(isSecretEnvName("PORT")).toBe(false);
    expect(isSecretEnvName("LOG_LEVEL")).toBe(false);
  });

  it("matches secret words as substrings, not just whole segments (Task #175 contract)", () => {
    expect(isSecretEnvName("FOO_SECRETV2")).toBe(true);
    expect(isSecretEnvName("MYTOKENVALUE")).toBe(true);
    expect(isSecretEnvName("PASSWORD_HASH")).toBe(true);
    expect(isSecretEnvName("OLD_PIN")).toBe(true);
    expect(isSecretEnvName("LEGACY_APIKEY_V3")).toBe(true);
    expect(isSecretEnvName("WEIRDSECRET123")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSecretEnvName("my_api_key")).toBe(true);
    expect(isSecretEnvName("Stripe_Secret")).toBe(true);
    expect(isSecretEnvName("password")).toBe(true);
  });
});

describe("buildTaintSets", () => {
  it("taints variables assigned directly from process.env.<SECRET>", () => {
    const src = `const AGENT_SECRET = process.env.AGENT_SECRET;`;
    const { taintedVars } = buildTaintSets(src);
    expect(taintedVars.has("AGENT_SECRET")).toBe(true);
  });

  it("propagates taint transitively through alternative chains", () => {
    const src = `
      const FROM_ENV = process.env.STUDIO_WEBHOOK_SECRET;
      const SECRET = FROM_ENV || "fallback";
    `;
    const { taintedVars } = buildTaintSets(src);
    expect(taintedVars.has("FROM_ENV")).toBe(true);
    expect(taintedVars.has("SECRET")).toBe(true);
  });

  it("does NOT taint variables built by passing the secret to a constructor", () => {
    const src = `const stripe = new Stripe(process.env.STRIPE_API_SECRET || "");`;
    const { taintedVars } = buildTaintSets(src);
    expect(taintedVars.has("stripe")).toBe(false);
  });

  it("does NOT taint comparison results", () => {
    const src = `
      const verifyToken = process.env.META_VERIFY_TOKEN;
      const tokenMatches = token === verifyToken;
    `;
    const { taintedVars } = buildTaintSets(src);
    expect(taintedVars.has("verifyToken")).toBe(true);
    expect(taintedVars.has("tokenMatches")).toBe(false);
  });

  it("taints variables assigned from bracket-notation process.env access", () => {
    const srcDouble = `const x = process.env["AGENT_SECRET"];`;
    expect(buildTaintSets(srcDouble).taintedVars.has("x")).toBe(true);

    const srcSingle = `const y = process.env['META_ACCESS_TOKEN'];`;
    expect(buildTaintSets(srcSingle).taintedVars.has("y")).toBe(true);

    const srcSpaced = `const z = process.env[ "STRIPE_API_SECRET" ];`;
    expect(buildTaintSets(srcSpaced).taintedVars.has("z")).toBe(true);
  });

  it("taints variables assigned from lowercase / mixed-case env property access", () => {
    const src = `const a = process.env.password; const b = process.env.MyApiKey;`;
    const { taintedVars } = buildTaintSets(src);
    expect(taintedVars.has("a")).toBe(true);
    expect(taintedVars.has("b")).toBe(true);
  });

  it("taints functions whose return value reads a secret env", () => {
    const src = `
      function getApexSecret(): string {
        return process.env.STUDIO_WEBHOOK_SECRET || "";
      }
      const secret = getApexSecret();
    `;
    const { taintedVars, taintedFuncs } = buildTaintSets(src);
    expect(taintedFuncs.has("getApexSecret")).toBe(true);
    expect(taintedVars.has("secret")).toBe(true);
  });
});

describe("scanFile — positive cases (must flag)", () => {
  it("flags a literal interpolation of an env-derived secret", () => {
    withFixture(
      `
      const STUDIO_WEBHOOK_SECRET = process.env.STUDIO_WEBHOOK_SECRET || "fallback";
      console.log(\`Secret: \${STUDIO_WEBHOOK_SECRET}\`);
      `,
      (file) => {
        const v = scanFile(file);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0].leak).toBe("STUDIO_WEBHOOK_SECRET");
      },
    );
  });

  it("flags direct process.env.<SECRET> inside a console call", () => {
    withFixture(
      `console.warn("agent secret:", process.env.AGENT_SECRET);`,
      (file) => {
        const v = scanFile(file);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0].leak).toBe("process.env.AGENT_SECRET");
      },
    );
  });

  it("flags bracket-notation process.env access inside a console call", () => {
    withFixture(
      `console.log("v=", process.env["STUDIO_WEBHOOK_SECRET"]);`,
      (file) => {
        const v = scanFile(file);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0].leak).toContain("STUDIO_WEBHOOK_SECRET");
      },
    );
  });

  it("flags single-quoted bracket-notation process.env access inside a console call", () => {
    withFixture(
      `console.log('v=', process.env['META_ACCESS_TOKEN']);`,
      (file) => {
        const v = scanFile(file);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0].leak).toContain("META_ACCESS_TOKEN");
      },
    );
  });

  it("flags transitively-tainted variables", () => {
    withFixture(
      `
      const FROM_ENV = process.env.STUDIO_WEBHOOK_SECRET;
      const SECRET = FROM_ENV || "x";
      console.log(\`secret=\${SECRET}\`);
      `,
      (file) => {
        const v: SecretLogViolation[] = scanFile(file);
        expect(v.some((x) => x.leak === "SECRET")).toBe(true);
      },
    );
  });

  it("flags secrets returned via a wrapper function", () => {
    withFixture(
      `
      function getApexSecret(): string { return process.env.STUDIO_WEBHOOK_SECRET || ""; }
      const s = getApexSecret();
      console.log(\`apex=\${s}\`);
      `,
      (file) => {
        const v = scanFile(file);
        expect(v.length).toBeGreaterThan(0);
        expect(v[0].leak).toBe("s");
      },
    );
  });

  it("flags toString() of a tainted variable", () => {
    withFixture(
      `
      const TOKEN = process.env.SOME_TOKEN;
      console.log("v=", TOKEN.toString());
      `,
      (file) => {
        const v = scanFile(file);
        // toString isn't in the mask list — should be flagged.
        expect(v.length).toBeGreaterThan(0);
      },
    );
  });
});

describe("scanFile — negative cases (must NOT flag)", () => {
  it("ignores logs that only mention the env var NAME as a string", () => {
    withFixture(
      `
      const AGENT_SECRET = process.env.AGENT_SECRET;
      if (!AGENT_SECRET) console.warn("[X] AGENT_SECRET not set — webhook will reject");
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("ignores boolean coercion of a tainted variable", () => {
    withFixture(
      `
      const SECRET = process.env.STUDIO_WEBHOOK_SECRET;
      console.log(\`hasSecret=\${!!SECRET}, len=\${SECRET?.length}\`);
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("ignores comparison results", () => {
    withFixture(
      `
      const SECRET = process.env.ADMIN_SECRET;
      console.log(\`match=\${header === SECRET}\`);
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("ignores masked substrings (.substring / .slice)", () => {
    withFixture(
      `
      const TOKEN = process.env.META_ACCESS_TOKEN;
      console.log(\`token=\${TOKEN.substring(0, 8)}...\`);
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("ignores secret values passed to constructors / clients (not logged)", () => {
    withFixture(
      `
      import Stripe from "stripe";
      const stripe = new Stripe(process.env.STRIPE_API_SECRET || "");
      console.log("[stripe] initialised");
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("respects the // allow-secret-log: <reason> escape hatch", () => {
    withFixture(
      `
      const TOKEN = process.env.CP_META_TOKEN;
      const masked = TOKEN.substring(0, 8) + "..." + TOKEN.slice(-4);
      // allow-secret-log: pre-masked elsewhere; printed for ops audit
      console.log(\`masked=\${TOKEN}\`);
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });

  it("ignores variables whose name happens to contain 'token' but are not env-derived", () => {
    withFixture(
      `
      const editToken = "abc123";
      console.log(\`(editToken: \${editToken})\`);
      `,
      (file) => {
        expect(scanFile(file)).toEqual([]);
      },
    );
  });
});

describe("CLI", () => {
  it("exits 0 when the server tree is clean (current state)", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-secret-logs.mjs"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/no env-secret leaks/);
  });

  it("exits 1 when a fresh leak is introduced", () => {
    const dir = mkdtempSync(join(tmpdir(), "secret-logs-cli-"));
    try {
      // Lay out a minimal repo: scripts/ + server/ in a temp tree.
      mkdirSync(join(dir, "scripts"), { recursive: true });
      mkdirSync(join(dir, "server"), { recursive: true });
      const realScript = join(process.cwd(), "scripts/check-secret-logs.mjs");
      writeFileSync(
        join(dir, "scripts/check-secret-logs.mjs"),
        // Reuse the real script verbatim by symlinking via copy.
        require("node:fs").readFileSync(realScript, "utf8"),
        "utf8",
      );
      writeFileSync(
        join(dir, "server/leak.ts"),
        `
        const SECRET = process.env.SOME_SECRET;
        console.log(\`oops: \${SECRET}\`);
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        ["scripts/check-secret-logs.mjs"],
        { encoding: "utf8", cwd: dir },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/leaks SECRET/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers the files named in Task #175", () => {
    // The check must scan all .ts files under server/, including the three
    // Task #175 explicitly calls out.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
        import("./scripts/check-secret-logs.mjs").then(({ listTsFiles, SCAN_DIR }) => {
          const files = listTsFiles(SCAN_DIR);
          const targets = [
            "server/routes/studioWebhook.ts",
            "server/routes/agentWorker.ts",
            "server/routes/studioApexProxy.ts",
            "server/index.ts",
          ];
          for (const t of targets) {
            if (!files.some(f => f.endsWith(t))) {
              console.error("MISSING " + t);
              process.exit(1);
            }
          }
          console.log("OK");
        });
        `,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  });
});
