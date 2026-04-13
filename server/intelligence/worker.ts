import { db } from "../db";
import { subAccounts } from "@shared/schema";
import { startRollupWorker } from "./rollupWorker";
import { runAllScoresForAccount } from "./scoringEngine";
import { runAllRecommendationsForAccount } from "./recommendationEngine";

let scoringInterval: NodeJS.Timeout | null = null;

export function startIntelligenceWorkers(): void {
  console.log("[APEX-INTEL] Starting intelligence workers...");

  startRollupWorker(15 * 60 * 1000);

  async function scoringCycle() {
    try {
      const accounts = await db.select({ id: subAccounts.id }).from(subAccounts);
      for (const account of accounts) {
        await runAllScoresForAccount(account.id);
        await runAllRecommendationsForAccount(account.id);
      }
      console.log(`[APEX-INTEL] Scoring + recommendations cycle complete: ${accounts.length} accounts`);
    } catch (err) {
      console.error("[APEX-INTEL] Scoring cycle failed:", (err as Error).message);
    }
  }

  setTimeout(scoringCycle, 60000);
  scoringInterval = setInterval(scoringCycle, 30 * 60 * 1000);

  console.log("[APEX-INTEL] Intelligence workers started — rollups every 15m, scoring every 30m");
}

export function stopIntelligenceWorkers(): void {
  if (scoringInterval) {
    clearInterval(scoringInterval);
    scoringInterval = null;
  }
}
