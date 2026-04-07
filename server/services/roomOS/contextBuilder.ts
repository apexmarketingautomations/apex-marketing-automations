export interface RoomContext {
  totalTokens: number;
  goalTokens: number;
  goalProgress: number;
  tipCount: number;
  topTipper: string | null;
  topTipAmount: number;
  goalCount: number;
  lastTipAt: number | null;
  lastTipAmount: number;
  lastTipUser: string;
  roomEnergy: "hot" | "warm" | "cooling" | "dead";
  sessionDurationMs: number;
  commandsFired: number;
  triggerType: string;
  triggerUser: string;
}

export interface SessionState {
  subAccountId: number;
  totalTokens: number;
  goalTokens: number;
  goalCount: number;
  tipCount: number;
  topTipper: string | null;
  topTipAmount: number;
  lastTipAt: number | null;
  lastTipAmount: number;
  lastTipUser: string;
  startedAt: number;
  peakViewers: number;
  commandsFired: number;
  commandCounts: Record<string, number>;
  tips: Array<{ user: string; amount: number; at: number }>;
}

export function createFreshSession(subAccountId: number, goalTokens: number): SessionState {
  return {
    subAccountId,
    totalTokens: 0,
    goalTokens,
    goalCount: 0,
    tipCount: 0,
    topTipper: null,
    topTipAmount: 0,
    lastTipAt: null,
    lastTipAmount: 0,
    lastTipUser: "",
    startedAt: Date.now(),
    peakViewers: 0,
    commandsFired: 0,
    commandCounts: {},
    tips: [],
  };
}

export function buildRoomContext(
  session: SessionState,
  event: { type: string; user?: string; amount?: number },
  goalTokens: number
): RoomContext {
  const now = Date.now();
  const timeSinceLastTip = session.lastTipAt ? (now - session.lastTipAt) / 1000 : 999;

  let roomEnergy: RoomContext["roomEnergy"] = "dead";
  if (timeSinceLastTip < 30) roomEnergy = "hot";
  else if (timeSinceLastTip < 90) roomEnergy = "warm";
  else if (timeSinceLastTip < 180) roomEnergy = "cooling";

  return {
    totalTokens: session.totalTokens,
    goalTokens,
    goalProgress: goalTokens > 0 ? Math.min(100, Math.round((session.totalTokens / goalTokens) * 100)) : 0,
    tipCount: session.tipCount,
    topTipper: session.topTipper,
    topTipAmount: session.topTipAmount,
    goalCount: session.goalCount,
    lastTipAt: session.lastTipAt,
    lastTipAmount: session.lastTipAmount,
    lastTipUser: session.lastTipUser,
    roomEnergy,
    sessionDurationMs: now - session.startedAt,
    commandsFired: session.commandsFired,
    triggerType: event.type,
    triggerUser: event.user || "",
  };
}
