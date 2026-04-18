export type RecoveryPersona = "layla" | "donte" | "default";
export type RecoveryReason = "ai_failed" | "ai_timeout" | "tool_delay";

export interface RecoveryRequest {
  persona?: RecoveryPersona;
  reason: RecoveryReason;
  threadKey?: string;
  channel?: string;
}

export interface RecoveryResult {
  text: string;
  persona: RecoveryPersona;
  reason: RecoveryReason;
  variantIndex: number;
}

const POOLS: Record<RecoveryPersona, Record<RecoveryReason, string[]>> = {
  layla: {
    ai_timeout: [
      "One sec love — putting a real answer together for you.",
      "Hold on babe, want to get this right.",
      "Hang tight love, thinking this through properly.",
      "Bear with me a sec — not gonna rush this one.",
    ],
    ai_failed: [
      "Ugh, my end glitched love — send that one more time?",
      "Something hiccuped on me babe, try again in a sec?",
      "Connection blip on my side — resend that for me?",
      "My brain skipped a beat love, can you say that again?",
    ],
    tool_delay: [
      "Looking that up for you love — give me a sec.",
      "Pulling it up babe, won't be long.",
      "Checking on that now love, hold tight.",
      "One moment — digging that up for you.",
    ],
  },
  donte: {
    ai_timeout: [
      "Give me a sec — want to give you a straight answer.",
      "Hang on, working through it.",
      "One moment — making sure I get this right for you.",
      "Bear with me, putting a real reply together.",
    ],
    ai_failed: [
      "Hit a snag on my end — mind resending that?",
      "Something glitched here, try that again?",
      "Quick hiccup on my side — send that one more time?",
      "My system blipped — can you resend?",
    ],
    tool_delay: [
      "Pulling that up — one sec.",
      "Checking on that now.",
      "Looking into it, won't be long.",
      "One moment while I dig that up.",
    ],
  },
  default: {
    ai_timeout: [
      "One moment — putting together a proper answer for you.",
      "Hang on a sec, working on it.",
      "Bear with me — want to give you a real answer, not a rushed one.",
      "Just a moment, thinking this through.",
    ],
    ai_failed: [
      "Something glitched on my end — could you resend that?",
      "Hit a quick snag here, mind trying again?",
      "Connection hiccup on my side — send that once more?",
      "Looks like my end blipped — could you say that again?",
    ],
    tool_delay: [
      "Looking into that for you — one sec.",
      "Pulling it up now, won't be long.",
      "Checking on this — hang tight.",
      "One moment while I look that up.",
    ],
  },
};

const TRACKER_MAX = 2000;
const lastIndexByKey = new Map<string, number>();

function trackerKey(persona: RecoveryPersona, reason: RecoveryReason, threadKey?: string): string {
  return `${persona}::${reason}::${threadKey || "_global"}`;
}

function pickNextIndex(poolSize: number, lastIndex: number | undefined): number {
  if (poolSize <= 1) return 0;
  if (lastIndex === undefined) {
    return Math.floor(Math.random() * poolSize);
  }
  let next = Math.floor(Math.random() * (poolSize - 1));
  if (next >= lastIndex) next += 1;
  return next;
}

function pruneTrackerIfNeeded(): void {
  if (lastIndexByKey.size <= TRACKER_MAX) return;
  const overflow = lastIndexByKey.size - TRACKER_MAX;
  const it = lastIndexByKey.keys();
  for (let i = 0; i < overflow; i++) {
    const k = it.next().value;
    if (k === undefined) break;
    lastIndexByKey.delete(k);
  }
}

export function pickRecoveryLine(req: RecoveryRequest): RecoveryResult {
  const persona: RecoveryPersona = req.persona || "default";
  const pool = POOLS[persona]?.[req.reason] || POOLS.default[req.reason];
  const key = trackerKey(persona, req.reason, req.threadKey);
  const last = lastIndexByKey.get(key);
  const idx = pickNextIndex(pool.length, last);
  lastIndexByKey.set(key, idx);
  pruneTrackerIfNeeded();
  return { text: pool[idx], persona, reason: req.reason, variantIndex: idx };
}

export function classifyAiFailure(errorMessage: string | undefined | null): RecoveryReason {
  if (!errorMessage) return "ai_failed";
  const m = errorMessage.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout") || m.includes("aborted") || m.includes("etimedout")) {
    return "ai_timeout";
  }
  return "ai_failed";
}

export function _resetRecoveryTrackerForTests(): void {
  lastIndexByKey.clear();
}
