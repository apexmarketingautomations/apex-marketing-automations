import { enqueueMegaCycle, type MegaCycleDomain, type MegaCycleMode } from "./megaCycle";

let timer: NodeJS.Timeout | null = null;

function parseDomains(raw: string | undefined): MegaCycleDomain[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean) as MegaCycleDomain[];
  return parts.length ? parts : undefined;
}

export function startMegaCycleScheduler(): void {
  if (timer) return;
  if (process.env.MEGA_CYCLE_ENABLED !== "true") return;

  const subAccountId = parseInt(process.env.MEGA_CYCLE_SUB_ACCOUNT_ID || process.env.APEX_PARENT_ACCOUNT_ID || "3", 10);
  if (!Number.isFinite(subAccountId) || subAccountId <= 0) {
    console.warn("[MEGA-CYCLE] Invalid MEGA_CYCLE_SUB_ACCOUNT_ID; scheduler not started.");
    return;
  }

  const mode = (process.env.MEGA_CYCLE_MODE as MegaCycleMode | undefined) ?? "observe";
  const domains = parseDomains(process.env.MEGA_CYCLE_DOMAINS);
  const everySeconds = Math.max(60, parseInt(process.env.MEGA_CYCLE_WAKEUP_SECONDS || "900", 10) || 900);

  const tick = () => {
    enqueueMegaCycle({
      subAccountId,
      mode,
      domains,
      triggeredBy: "scheduler",
    });
  };

  timer = setInterval(tick, everySeconds * 1000);
  // kick once shortly after startup so it feels alive
  setTimeout(tick, 10_000);
  console.log(`[MEGA-CYCLE] Scheduler started: every ${everySeconds}s subAccountId=${subAccountId} mode=${mode}`);
}

export function stopMegaCycleScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log("[MEGA-CYCLE] Scheduler stopped");
}

