import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { spawnSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "twilio",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

function checkSilentCatches() {
  console.log("checking for silent error-swallowing in server/...");
  const result = spawnSync("node", ["scripts/check-silent-catches.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      "build aborted: silent catch blocks detected (see above). " +
        "Bind & log the error or add an explicit `// allow-silent-catch: <reason>` comment.",
    );
    process.exit(result.status ?? 1);
  }
}

function checkSecretLogs() {
  console.log("checking for accidental secret prints in server/ logs...");
  const result = spawnSync("node", ["scripts/check-secret-logs.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      "build aborted: env-secret values appear in console output (see above). " +
        "Print only a masked form / boolean / length, or add an explicit " +
        "`// allow-secret-log: <reason>` comment on the offending line.",
    );
    process.exit(result.status ?? 1);
  }
}

async function buildAll() {
  checkSilentCatches();
  checkSecretLogs();

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
