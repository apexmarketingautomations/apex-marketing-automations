/**
 * server/workers/index.ts
 *
 * BullMQ Worker registry for Apex Marketing OS.
 *
 * Provides:
 *   startAllWorkers()  — start all 4 BullMQ workers (called from server/index.ts)
 *   stopAllWorkers()   — graceful shutdown (called from SIGTERM handler)
 *
 * Workers:
 *   enrichmentWorker  — skip_trace, address_verify, flhsmv_enrich, score_contact
 *   scoringWorker     — cross-vertical contact quality scoring
 *   routingWorker     — territory assignment, contact routing, lead export
 *   maintenanceWorker — expiry, placeholder aging, queue health, rescore
 */

export { enqueueEnrichment }   from "./enrichmentWorker";
export { enqueueScoringJob }   from "./scoringWorker";
export { enqueueRoutingJob }   from "./routingWorker";
export { enqueueMaintenanceJob } from "./maintenanceWorker";
export { computeContactScore, scoreToband, SCORER_VERSION } from "./scoringWorker";

import { startEnrichmentWorker,  stopEnrichmentWorker  } from "./enrichmentWorker";
import { startScoringWorker,     stopScoringWorker     } from "./scoringWorker";
import { startRoutingWorker,     stopRoutingWorker     } from "./routingWorker";
import { startMaintenanceWorker, stopMaintenanceWorker } from "./maintenanceWorker";

const WORKER_TAG = "WORKERS";

export function startAllWorkers(): void {
  try { startEnrichmentWorker();  console.log(`[${WORKER_TAG}] ✅ Enrichment worker started`);  }
  catch (err: any) { console.error(`[${WORKER_TAG}] Enrichment worker failed to start: ${err?.message}`); }

  try { startScoringWorker();     console.log(`[${WORKER_TAG}] ✅ Scoring worker started`);      }
  catch (err: any) { console.error(`[${WORKER_TAG}] Scoring worker failed to start: ${err?.message}`); }

  try { startRoutingWorker();     console.log(`[${WORKER_TAG}] ✅ Routing worker started`);      }
  catch (err: any) { console.error(`[${WORKER_TAG}] Routing worker failed to start: ${err?.message}`); }

  try { startMaintenanceWorker(); console.log(`[${WORKER_TAG}] ✅ Maintenance worker started`);  }
  catch (err: any) { console.error(`[${WORKER_TAG}] Maintenance worker failed to start: ${err?.message}`); }
}

export async function stopAllWorkers(): Promise<void> {
  await Promise.allSettled([
    stopEnrichmentWorker().catch(err => console.warn(`[${WORKER_TAG}] Enrichment stop error: ${err?.message}`)),
    stopScoringWorker().catch(err    => console.warn(`[${WORKER_TAG}] Scoring stop error: ${err?.message}`)),
    stopRoutingWorker().catch(err    => console.warn(`[${WORKER_TAG}] Routing stop error: ${err?.message}`)),
    stopMaintenanceWorker().catch(err => console.warn(`[${WORKER_TAG}] Maintenance stop error: ${err?.message}`)),
  ]);
  console.log(`[${WORKER_TAG}] All workers stopped`);
}
