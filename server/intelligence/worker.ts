import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { startRollupWorker } from "./rollupWorker";
import { runAllScoresForAccount } from "./scoringEngine";
import { runAllRecommendationsForAccount } from "./recommendationEngine";
import { eventBus, EVENT_TYPES, type ApexEvent } from "../eventBus";
import { MODULE_GROUP_EVENT_MAP } from "./moduleRegistry";

let scoringInterval: NodeJS.Timeout | null = null;

// Every signal flows to Apex Intelligence — it learns from everything
// Events that should trigger rescoring — deliberately excludes internal
// intelligence events (SCORE_UPDATED, ROLLUP_COMPUTED, AI_TOOL_EXECUTED)
// to prevent the scoring cycle from triggering itself.
const SCORING_TRIGGER_EVENTS = new Set<string>([
  EVENT_TYPES.CONTACT_CREATED,
  EVENT_TYPES.CONTACT_UPDATED,
  EVENT_TYPES.CONTACT_DELETED,
  EVENT_TYPES.DEAL_CREATED,
  EVENT_TYPES.DEAL_STAGE_CHANGED,
  EVENT_TYPES.DEAL_WON,
  EVENT_TYPES.DEAL_LOST,
  EVENT_TYPES.DEAL_UPDATED,
  EVENT_TYPES.APPOINTMENT_BOOKED,
  EVENT_TYPES.APPOINTMENT_CANCELLED,
  EVENT_TYPES.APPOINTMENT_RESCHEDULED,
  EVENT_TYPES.SITE_PUBLISHED,
  EVENT_TYPES.SITE_CREATED,
  EVENT_TYPES.SITE_UPDATED,
  EVENT_TYPES.DOMAIN_VERIFIED,
  EVENT_TYPES.INTEGRATION_CONNECTED,
  EVENT_TYPES.INTEGRATION_DISCONNECTED,
  EVENT_TYPES.INTEGRATION_ERROR,
  EVENT_TYPES.WORKFLOW_COMPLETED,
  EVENT_TYPES.WORKFLOW_STARTED,
  EVENT_TYPES.WORKFLOW_FAILED,
  EVENT_TYPES.AUTOMATION_TRIGGERED,
  EVENT_TYPES.AUTOMATION_COMPLETED,
  EVENT_TYPES.FORM_SUBMITTED,
  EVENT_TYPES.FORM_ABANDONED,
  EVENT_TYPES.LEAD_CREATED,
  EVENT_TYPES.LEAD_UPDATED,
  EVENT_TYPES.REVIEW_RECEIVED,
  EVENT_TYPES.REVIEW_REPLIED,
  EVENT_TYPES.MESSAGE_RECEIVED,
  EVENT_TYPES.MESSAGE_SENT,
  EVENT_TYPES.MESSAGE_FAILED,
  EVENT_TYPES.CALL_COMPLETED,
  EVENT_TYPES.CALL_MISSED,
  EVENT_TYPES.INSTAGRAM_MESSAGE_RECEIVED,
  EVENT_TYPES.META_LEAD_RECEIVED,
  EVENT_TYPES.CAMPAIGN_SENT,
  EVENT_TYPES.CAMPAIGN_COMPLETED,
  EVENT_TYPES.CAMPAIGN_OPENED,
  EVENT_TYPES.CAMPAIGN_CLICKED,
  EVENT_TYPES.PAYMENT_COMPLETED,
  EVENT_TYPES.PAYMENT_FAILED,
  EVENT_TYPES.SUBSCRIPTION_CHANGED,
  EVENT_TYPES.AD_CAMPAIGN_LAUNCHED,
  EVENT_TYPES.CARD_SCANNED,
  EVENT_TYPES.CARD_SHARED,
  EVENT_TYPES.BUTTON_CLICKED,
  EVENT_TYPES.CTA_CLICKED,
  EVENT_TYPES.FUNNEL_LEAD_CAPTURED,
  EVENT_TYPES.FUNNEL_LEAD_CONVERTED,
  // NOTE: AI_TOOL_EXECUTED intentionally removed — operator tool executions
  // happen during scoring, so including this caused an infinite loop.
  // NOTE: DM_KEYWORD_TRIGGERED removed — messaging events already covered above.
]);

const pendingScoringAccounts = new Set<number>();
let scoringDebounceTimer: NodeJS.Timeout | null = null;
const SCORING_DEBOUNCE_MS = 10_000; // 10s debounce — don't thrash on burst events

// Cooldown: don't re-score the same account more than once every 5 minutes
// via event triggers. The 30-min scheduled cycle bypasses this.
const lastEventScoredAt = new Map<number, number>();
const SCORING_COOLDOWN_MS = 5 * 60 * 1000;

// Guard against concurrent scoring cycles
let scoringCycleRunning = false;

function scheduleScoringForAccount(accountId: number): void {
  const now = Date.now();
  const last = lastEventScoredAt.get(accountId) ?? 0;
  if (now - last < SCORING_COOLDOWN_MS) return; // still in cooldown

  pendingScoringAccounts.add(accountId);
  if (scoringDebounceTimer) return;
  scoringDebounceTimer = setTimeout(async () => {
    scoringDebounceTimer = null;
    const accounts = [...pendingScoringAccounts];
    pendingScoringAccounts.clear();
    for (const id of accounts) {
      try {
        lastEventScoredAt.set(id, Date.now());
        await runAllScoresForAccount(id);
        await runAllRecommendationsForAccount(id);
      } catch (err) {
        console.error(`[APEX-INTEL] Event-triggered scoring failed for account ${id}:`, (err as Error).message);
      }
    }
  }, SCORING_DEBOUNCE_MS);
}

function subscribeToModuleGroups(): void {
  for (const [moduleGroup, eventTypes] of Object.entries(MODULE_GROUP_EVENT_MAP)) {
    for (const eventType of eventTypes) {
      eventBus.subscribe(eventType, `intelligence-worker:${moduleGroup}`, async (event: ApexEvent) => {
        const accountId = event.payload.subAccountId ?? event.payload.accountId ?? event.payload.sub_account_id;
        if (!accountId || typeof accountId !== "number") return;

        if (SCORING_TRIGGER_EVENTS.has(event.event_type)) {
          scheduleScoringForAccount(accountId);
        }

        if (event.payload.contactId && event.event_type === EVENT_TYPES.FORM_SUBMITTED) {
          const { linkSessionToContact } = await import("./identityEngine");
          if (event.payload.sessionId) {
            await linkSessionToContact(accountId, event.payload.sessionId, event.payload.contactId).catch((err) => console.warn("[WORKER] promise rejected:", err instanceof Error ? err.message : err));
          }
        }

        if (event.event_type === EVENT_TYPES.INTEGRATION_CONNECTED || event.event_type === EVENT_TYPES.INTEGRATION_ERROR || event.event_type === EVENT_TYPES.INTEGRATION_DISCONNECTED) {
          const { trackIntegrationSuccess, trackIntegrationFailure, trackIntegrationDisconnected } = await import("./integrationHealth");
          if (event.event_type === EVENT_TYPES.INTEGRATION_CONNECTED) {
            await trackIntegrationSuccess(accountId, event.payload.provider || "unknown", event.payload.integrationKey || event.payload.provider || "unknown").catch((err) => console.warn("[WORKER] promise rejected:", err instanceof Error ? err.message : err));
          } else if (event.event_type === EVENT_TYPES.INTEGRATION_ERROR) {
            await trackIntegrationFailure(accountId, event.payload.provider || "unknown", event.payload.integrationKey || event.payload.provider || "unknown", event.payload.error || "Unknown error").catch((err) => console.warn("[WORKER] promise rejected:", err instanceof Error ? err.message : err));
          } else if (event.event_type === EVENT_TYPES.INTEGRATION_DISCONNECTED) {
            await trackIntegrationDisconnected(accountId, event.payload.provider || "unknown", event.payload.integrationKey || event.payload.provider || "unknown", event.payload.reason).catch((err) => console.warn("[WORKER] promise rejected:", err instanceof Error ? err.message : err));
          }
        }

        if (event.event_type === EVENT_TYPES.CARD_SCANNED && event.payload.contactId && event.payload.cardId) {
          const { linkCardScanToContact } = await import("./identityEngine");
          await linkCardScanToContact(accountId, event.payload.cardId, event.payload.contactId, event.payload.sessionId).catch((err) => console.warn("[WORKER] promise rejected:", err instanceof Error ? err.message : err));
        }
      }, 0);
    }
  }

  console.log(`[APEX-INTEL] Subscribed to ${Object.values(MODULE_GROUP_EVENT_MAP).reduce((n, arr) => n + arr.length, 0)} event types across ${Object.keys(MODULE_GROUP_EVENT_MAP).length} module groups`);
}

export async function seedModuleEventRegistry(): Promise<void> {
  const { storage } = await import("../storage");
  for (const [moduleGroup, eventTypes] of Object.entries(MODULE_GROUP_EVENT_MAP)) {
    for (const eventType of eventTypes) {
      try {
        await storage.registerModuleEvent({
          moduleGroup,
          eventType,
          description: `${moduleGroup} module: ${eventType}`,
          isActive: true,
        });
      } catch (err) {
        console.warn("[WORKER] caught:", err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(`[APEX-INTEL] Module event registry seeded: ${Object.keys(MODULE_GROUP_EVENT_MAP).length} module groups`);
}

export function startIntelligenceWorkers(): void {
  console.log("[APEX-INTEL] Starting intelligence workers...");

  startRollupWorker(15 * 60 * 1000);

  subscribeToModuleGroups();

  seedModuleEventRegistry().catch(err => {
    console.warn("[APEX-INTEL] Module event registry seed failed (non-fatal):", (err as Error).message);
  });

  async function scoringCycle() {
    if (scoringCycleRunning) {
      console.warn("[APEX-INTEL] Scoring cycle already running — skipping this tick");
      return;
    }
    scoringCycleRunning = true;
    try {
      const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
      for (const account of accounts) {
        await runAllScoresForAccount(account.id);
        await runAllRecommendationsForAccount(account.id);
      }
      console.log(`[APEX-INTEL] Scoring + recommendations cycle complete: ${accounts.length} accounts`);

      // Report to Apex Intelligence brain (fire-and-forget)
      import("../operator/apexIntelligence").then(({ reportOutcome }) => reportOutcome({
        agentName:    "scoring-worker",
        action:       "accounts_scored",
        subject:      "scoring-cycle",
        result:       `Intelligence scoring cycle complete — ${accounts.length} accounts scored and recommendations generated`,
        confidence:   0.9,
        subAccountId: parseInt(process.env.APEX_PARENT_ACCOUNT_ID || "3"),
        metadata: {
          accountsScored: accounts.length,
        },
      })).catch(() => {});
    } catch (err) {
      console.error("[APEX-INTEL] Scoring cycle failed:", (err as Error).message);
    } finally {
      scoringCycleRunning = false;
    }
  }

  setTimeout(scoringCycle, 60000);
  scoringInterval = setInterval(scoringCycle, 30 * 60 * 1000);

  console.log("[APEX-INTEL] Intelligence workers started — rollups every 15m, scoring every 30m, event subscriptions active");
}

export function stopIntelligenceWorkers(): void {
  if (scoringInterval) {
    clearInterval(scoringInterval);
    scoringInterval = null;
  }
  if (scoringDebounceTimer) {
    clearTimeout(scoringDebounceTimer);
    scoringDebounceTimer = null;
  }
}
