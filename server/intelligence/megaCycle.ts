import { jobQueue } from "../jobQueue";
import { getSystemHealthReport } from "./systemHealthOrchestrator";
import { reportOutcome } from "../operator/apexIntelligence";
import { logSystemEvent } from "../systemLogger";

export type MegaCycleMode = "observe" | "propose" | "ship";
export type MegaCycleDomain =
  | "health"
  | "security"
  | "web"
  | "data-integrity"
  | "ingestion";

export type MegaCyclePayload = {
  subAccountId: number;
  mode?: MegaCycleMode;
  domains?: MegaCycleDomain[];
  triggeredBy?: "scheduler" | "api";
};

type MegaCycleState = {
  lastRunAt?: string;
  lastResult?: { ok: boolean; summary: string };
  nextDomainIdx: number;
  running: boolean;
};

const stateByAccount = new Map<number, MegaCycleState>();

function getState(subAccountId: number): MegaCycleState {
  const existing = stateByAccount.get(subAccountId);
  if (existing) return existing;
  const s: MegaCycleState = { nextDomainIdx: 0, running: false };
  stateByAccount.set(subAccountId, s);
  return s;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function nowIso() {
  return new Date().toISOString();
}

function clampDomains(domains: MegaCycleDomain[] | undefined): MegaCycleDomain[] {
  const d = domains && domains.length ? domains : (["health", "security", "web"] as MegaCycleDomain[]);
  return uniq(d);
}

function allowShell(): boolean {
  return process.env.MEGA_CYCLE_ALLOW_SHELL === "true";
}

async function runShellCheck(cmd: string, label: string): Promise<{ ok: boolean; output: string }> {
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(cmd, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=4096" },
    }).toString("utf8");
    return { ok: true, output: `${label}: OK\n${out}`.slice(0, 1200) };
  } catch (err: any) {
    const msg = String(err?.stdout || err?.stderr || err?.message || err).slice(0, 1200);
    return { ok: false, output: `${label}: FAILED\n${msg}` };
  }
}

async function runDomainOnce(subAccountId: number, domain: MegaCycleDomain): Promise<{ ok: boolean; summary: string; meta?: any }> {
  if (domain === "health") {
    const report = await getSystemHealthReport();
    const summary = `System health: status=${report.overallStatus} score=${report.overallScore} recommendations=${report.recommendations.length}`;
    return { ok: report.overallStatus !== "critical", summary, meta: report };
  }

  if (domain === "security") {
    if (!allowShell()) {
      return {
        ok: true,
        summary: "Security checks: MEGA_CYCLE_ALLOW_SHELL=false (skipped local shell checks; CI still enforces secrets scan).",
      };
    }
    const secrets = await runShellCheck("npm run -s check:secrets", "check:secrets");
    return { ok: secrets.ok, summary: secrets.output };
  }

  if (domain === "web") {
    // Keep this lightweight by default (no browser automation in prod).
    return {
      ok: true,
      summary: "Web polish: scheduled (no-op cycle). Enable dedicated tasks (screenshots/perf budgets) in the next iteration.",
    };
  }

  if (domain === "data-integrity") {
    return { ok: true, summary: "Data integrity: scheduled (no-op cycle). Enable audits (duplicates/orphans/tenant leaks) in the next iteration." };
  }

  if (domain === "ingestion") {
    return { ok: true, summary: "Ingestion: scheduled (no-op cycle). Enable pipeline heartbeat + backlog audits in the next iteration." };
  }

  return { ok: true, summary: `Unknown domain: ${domain}` };
}

export async function runMegaCycle(payload: MegaCyclePayload): Promise<{ ok: boolean; ranDomain: MegaCycleDomain; summary: string }> {
  const subAccountId = payload.subAccountId;
  const mode: MegaCycleMode = payload.mode ?? "observe";
  const domains = clampDomains(payload.domains);
  const st = getState(subAccountId);

  if (st.running) {
    return { ok: true, ranDomain: domains[st.nextDomainIdx % domains.length], summary: "Mega Cycle already running; skipping duplicate tick." };
  }

  st.running = true;
  try {
    const domain = domains[st.nextDomainIdx % domains.length];
    st.nextDomainIdx = (st.nextDomainIdx + 1) % domains.length;

    await logSystemEvent("info", "mega-cycle", "Mega Cycle tick", {
      subAccountId,
      mode,
      domain,
      triggeredBy: payload.triggeredBy ?? "scheduler",
    });

    const result = await runDomainOnce(subAccountId, domain);
    st.lastRunAt = nowIso();
    st.lastResult = { ok: result.ok, summary: result.summary };

    reportOutcome({
      agentName: "mega-cycle",
      action: "cycle_completed",
      subject: domain,
      result: result.summary,
      confidence: result.ok ? 0.75 : 0.4,
      subAccountId,
      metadata: { mode, domain, triggeredBy: payload.triggeredBy ?? "scheduler" },
    });

    return { ok: result.ok, ranDomain: domain, summary: result.summary };
  } finally {
    st.running = false;
  }
}

export function enqueueMegaCycle(payload: MegaCyclePayload): string {
  return jobQueue.enqueue("mega_cycle_tick", payload as any, 1);
}

export function getMegaCycleStatus(subAccountId: number) {
  const st = getState(subAccountId);
  return {
    subAccountId,
    running: st.running,
    lastRunAt: st.lastRunAt ?? null,
    lastResult: st.lastResult ?? null,
  };
}

