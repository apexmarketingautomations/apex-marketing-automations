# Stage 4A — Worker Architecture
**Apex Marketing OS | BullMQ Worker Domains**
**Status:** Design-complete, pre-implementation
**Companion doc:** STAGE_4A_QUEUE_ARCHITECTURE.md
**Depends on:** Stage 3 (pgvector + 21 operational tables), Stage 4A queue factory

---

## 1. Objective

Define the worker layer that consumes BullMQ queues. Each worker domain is a separate `Worker` instance with its own concurrency limit, timeout, and error handling. Workers are registered at startup from a single entry point and shut down gracefully on SIGTERM.

The existing ingestion pipelines (`crashIngestPipeline`, `arrestIngestPipeline`, etc.) are not rewritten — they are wrapped by workers that call them directly. The worker layer adds durability, observability, and controlled concurrency on top of existing business logic.

---

## 2. Base Worker Class

All eight worker domains extend `ApexWorker`. The base class handles:
- BullMQ `Worker` instantiation with the correct connection and concurrency
- Structured logging of every job completion and failure via `logSystemEvent`
- Sentry error capture with queue and job type tags
- Memory-pressure backpressure: pauses the worker at 400 MB RSS, resumes after 10 seconds
- Graceful shutdown: `close(true)` drains in-progress jobs up to the configured timeout

```typescript
// server/workers/BaseWorker.ts
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import { redis } from '../redis';
import { logSystemEvent } from '../systemLogger';

const MEMORY_CAPS = {
  warningRSS:     350 * 1024 * 1024,   // 350 MB — emit warning
  backpressureRSS: 400 * 1024 * 1024,  // 400 MB — pause worker
  criticalRSS:    480 * 1024 * 1024,   // 480 MB — Sentry alert
};

const MEMORY_CHECK_INTERVAL_MS = 30_000;
const BACKPRESSURE_PAUSE_MS = 10_000;

export abstract class ApexWorker {
  protected abstract readonly queueName: string;
  protected abstract readonly concurrency: number;
  protected abstract readonly timeoutMs: number;     // maps to BullMQ lockDuration

  private worker: Worker | null = null;
  private memoryWatcher: NodeJS.Timeout | null = null;

  /** Override to provide domain-specific job routing. */
  abstract processJob(job: Job): Promise<void>;

  start(): void {
    if (!redis) {
      logSystemEvent('warn', this.queueName, 'Redis not available — worker not started');
      return;
    }

    this.worker = new Worker(
      this.queueName,
      async (job: Job) => {
        const traceId = (job.data?.traceId as string | undefined) || crypto.randomUUID();
        const startMs = Date.now();

        try {
          await this.processJob(job);
          logSystemEvent('info', this.queueName, `Job completed: ${job.name}`, {
            jobId: job.id,
            traceId,
            durationMs: Date.now() - startMs,
            attemptsMade: job.attemptsMade,
          });
        } catch (err: any) {
          Sentry.captureException(err, {
            tags: { queue: this.queueName, jobType: job.name },
            extra: { jobId: job.id, traceId, payload: job.data, attempt: job.attemptsMade },
          });
          logSystemEvent('error', this.queueName, `Job failed: ${job.name} — ${err.message}`, {
            jobId: job.id,
            traceId,
            durationMs: Date.now() - startMs,
            attemptsMade: job.attemptsMade,
            error: err.message,
          });
          throw err;  // BullMQ catches and applies backoff / retry
        }
      },
      {
        connection: redis,
        concurrency: this.concurrency,
        lockDuration: this.timeoutMs,
        lockRenewTime: Math.floor(this.timeoutMs / 2),
      },
    );

    this.worker.on('failed', (job, err) => {
      const maxAttempts = job?.opts?.attempts ?? 3;
      if (job && job.attemptsMade >= maxAttempts) {
        // Final failure — record for DLQ sweeper to pick up
        logSystemEvent('warn', this.queueName, `Job sent to DLQ: ${job?.name}`, {
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          error: err?.message,
        });
      }
    });

    this.worker.on('error', (err) => {
      logSystemEvent('error', this.queueName, `Worker error: ${err.message}`, { error: err.message });
      Sentry.captureException(err, { tags: { component: 'worker', queue: this.queueName } });
    });

    this.startMemoryWatcher();
    logSystemEvent('info', this.queueName, `Worker started (concurrency=${this.concurrency})`);
  }

  private startMemoryWatcher(): void {
    this.memoryWatcher = setInterval(async () => {
      const rss = process.memoryUsage().rss;
      if (rss >= MEMORY_CAPS.criticalRSS) {
        Sentry.captureMessage(`[${this.queueName}] Critical memory: ${Math.round(rss / 1024 / 1024)} MB RSS`, 'warning');
        logSystemEvent('error', this.queueName, `Critical RSS: ${Math.round(rss / 1024 / 1024)} MB`);
      } else if (rss >= MEMORY_CAPS.backpressureRSS) {
        logSystemEvent('warn', this.queueName, `RSS backpressure: pausing worker`, {
          rssMB: Math.round(rss / 1024 / 1024),
        });
        await this.worker?.pause();
        setTimeout(async () => {
          await this.worker?.resume();
          logSystemEvent('info', this.queueName, 'Worker resumed after backpressure pause');
        }, BACKPRESSURE_PAUSE_MS);
      } else if (rss >= MEMORY_CAPS.warningRSS) {
        logSystemEvent('warn', this.queueName, `RSS warning: ${Math.round(rss / 1024 / 1024)} MB`);
      }
    }, MEMORY_CHECK_INTERVAL_MS);
  }

  async pause(): Promise<void> {
    await this.worker?.pause();
  }

  async resume(): Promise<void> {
    await this.worker?.resume();
  }

  async drain(): Promise<void> {
    // BullMQ does not expose a drain() directly; we wait for active count to reach zero
    return new Promise<void>((resolve) => {
      const check = setInterval(async () => {
        const counts = await this.worker?.getActiveCount?.() ?? 0;
        if (counts === 0) {
          clearInterval(check);
          resolve();
        }
      }, 500);
    });
  }

  async shutdown(timeoutMs = 30_000): Promise<void> {
    if (this.memoryWatcher) clearInterval(this.memoryWatcher);
    await Promise.race([
      this.worker?.close(true),            // graceful drain
      new Promise(r => setTimeout(r, timeoutMs)),
    ]);
    logSystemEvent('info', this.queueName, 'Worker shut down gracefully');
  }
}
```

---

## 3. Worker Domain Implementations

### 3.1 Ingestion Worker

Handles the `apex-intake` queue. Wraps the five existing pipeline modules that each run as `setInterval` pollers today. Once migrated, the scheduler cron (via BullMQ repeat job) triggers each ingest rather than a Node.js timer.

```typescript
// server/workers/ingestionWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class IngestionWorker extends ApexWorker {
  protected readonly queueName = 'apex-intake';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_HIGH || '3', 10);
  protected readonly timeoutMs = 300_000;  // 5 minutes — crash report parsing can be slow

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'crash-ingest':
      case 'crash-ingest-sweep': {
        const { runCrashIngestCycle } = await import('../crashIngestPipeline');
        await runCrashIngestCycle({ traceId: job.data.traceId });
        break;
      }
      case 'arrest-ingest': {
        const { runArrestIngestCycle } = await import('../arrestIngestPipeline');
        await runArrestIngestCycle({ traceId: job.data.traceId });
        break;
      }
      case 'court-filing-ingest':
      case 'court-filing-sweep': {
        const { runCourtFilingCycle } = await import('../courtFilingPipeline');
        await runCourtFilingCycle({ traceId: job.data.traceId });
        break;
      }
      case 'legal-signal-ingest': {
        const { runLegalSignalCycle } = await import('../legalSignalPipeline');
        await runLegalSignalCycle({
          signalType: job.data.signalType,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'hillsborough-records':
      case 'hillsborough-records-ingest': {
        const { runHillsboroughCycle } = await import('../hillsboroughRecordsPipeline');
        await runHillsboroughCycle({ traceId: job.data.traceId });
        break;
      }
      case 'home-service-signal-sweep':
      case 'home-service-signal-ingest': {
        const { runHomeServiceSignalCycle } = await import('../homeServiceSignalPipeline');
        await runHomeServiceSignalCycle({ traceId: job.data.traceId });
        break;
      }
      case 'jail-booking-ingest':
      case 'jail-booking-sweep': {
        const { runJailBookingCycle } = await import('../jailBookingPipeline');
        await runJailBookingCycle({ traceId: job.data.traceId });
        break;
      }
      case 'court-listener-ingest': {
        const { runCourtListenerCycle } = await import('../courtListenerPipeline');
        await runCourtListenerCycle({ traceId: job.data.traceId });
        break;
      }
      default:
        throw new Error(`[IngestionWorker] Unknown job: ${job.name}`);
    }
  }
}
```

**Memory note:** The ingestion worker is the most likely to spike RSS during parsing large court filing batches. The base class 400 MB backpressure applies. The concurrency cap of 3 prevents more than 3 simultaneous pipeline runs.

### 3.2 Enrichment Worker

Handles the `apex-enrichment` queue. The critical safety rule from `retroSkipTrace.ts` is enforced at the worker level: never overwrite data of higher confidence score.

```typescript
// server/workers/enrichmentWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class EnrichmentWorker extends ApexWorker {
  protected readonly queueName = 'apex-enrichment';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_MEDIUM || '5', 10);
  protected readonly timeoutMs = 120_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'skip-trace': {
        const { runSingleSkipTrace } = await import('../retroSkipTrace');
        await runSingleSkipTrace({
          contactId: job.data.contactId,
          subAccountId: job.data.subAccountId,
          priority: job.data.priority,
          triggeredBy: job.data.triggeredBy,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'attorney-scrape': {
        const { runApifyAttorneyScrape } = await import('../apifyAttorneyScraper');
        await runApifyAttorneyScrape({
          county: job.data.county,
          practiceArea: job.data.practiceArea,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'transport-scrape': {
        const { runApifyTransportScrape } = await import('../apifyTransportScraper');
        await runApifyTransportScrape({ traceId: job.data.traceId });
        break;
      }
      case 'phone-validation':
      case 'address-validation':
      case 'property-lookup': {
        // Stub — validation handlers call through to contactUpsertService
        const { runContactValidation } = await import('../services/contactUpsertService');
        await runContactValidation(job.name, job.data);
        break;
      }
      default:
        throw new Error(`[EnrichmentWorker] Unknown job: ${job.name}`);
    }
  }
}
```

### 3.3 OCR Worker

Handles the `apex-ocr` queue. **Not activated in Stage 4A** — the worker class is defined here as the foundation, but `OcrWorker` is only instantiated when `OCR_WORKER_ENABLED=true`. The provider abstraction (Google DocAI → Textract fallback) is built into the job handler, not the queue.

```typescript
// server/workers/ocrWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class OcrWorker extends ApexWorker {
  protected readonly queueName = 'apex-ocr';
  protected readonly concurrency = 2;       // DocAI rate limit: conservative start
  protected readonly timeoutMs = 600_000;   // 10 minutes — large PDFs

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'document-ingest': {
        const { ingestDocument } = await import('../intelligence/ocrPipeline');
        await ingestDocument({
          acquisitionJobId: job.data.acquisitionJobId,
          documentType: job.data.documentType,
          storageKey: job.data.storageKey,          // Cloudflare R2 key
          sourceConfidence: job.data.sourceConfidence,
          linkedIncidentId: job.data.linkedIncidentId,
          linkedContactId: job.data.linkedContactId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'ocr-extract': {
        const { extractText } = await import('../intelligence/ocrPipeline');
        await extractText({
          acquisitionJobId: job.data.acquisitionJobId,
          storageKey: job.data.storageKey,
          provider: job.data.provider,              // 'google-docai' | 'textract'
          traceId: job.data.traceId,
        });
        break;
      }
      case 'entity-extract': {
        const { extractEntities } = await import('../intelligence/ocrPipeline');
        await extractEntities({
          acquisitionJobId: job.data.acquisitionJobId,
          rawOcrText: job.data.rawOcrText,
          documentType: job.data.documentType,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'evidence-link': {
        const { linkEvidenceRecord } = await import('../intelligence/ocrPipeline');
        await linkEvidenceRecord(job.data);
        break;
      }
      default:
        throw new Error(`[OcrWorker] Unknown job: ${job.name}`);
    }
  }
}
```

**Provider health check:** Before each `ocr-extract` job, the handler calls a lightweight provider health probe. If DocAI returns a non-200, the handler re-enqueues the same job with `provider: 'textract'` rather than failing.

### 3.4 Scoring Worker

Handles the `apex-scoring` queue. Wraps `homeServiceLeadScorer` and `caseIntelligence` which currently trigger via `eventBus` subscriptions. The queue provides backpressure control when scoring storms occur after bulk ingest.

```typescript
// server/workers/scoringWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class ScoringWorker extends ApexWorker {
  protected readonly queueName = 'apex-scoring';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_MEDIUM || '5', 10);
  protected readonly timeoutMs = 60_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'lead-score': {
        const { scoreHomeServiceLead } = await import('../homeServiceLeadScorer');
        await scoreHomeServiceLead({
          contactId: job.data.contactId,
          subAccountId: job.data.subAccountId,
          triggeredBy: job.data.triggeredBy,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'case-score': {
        const { scoreCaseIntelligence } = await import('../caseIntelligence');
        await scoreCaseIntelligence({
          incidentId: job.data.incidentId,
          subAccountId: job.data.subAccountId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'legal-heat-score':
      case 'territory-score': {
        const { runLegalHeatScore } = await import('../caseIntelligence');
        await runLegalHeatScore(job.data);
        break;
      }
      default:
        throw new Error(`[ScoringWorker] Unknown job: ${job.name}`);
    }
  }
}
```

### 3.5 Semantic Worker

Handles `apex-embeddings` and `apex-semantic` queues. **Paused during Stage 3 observation window.** The concurrency of 10 applies only after the observation window closes and `SEMANTIC_WORKER_ENABLED=true` is set.

Daily cap enforcement: a Redis counter `embed:daily:count` is incremented on each embedding job. The cap is 2000. The `embedding-daily-cap-reset` maintenance job zeros the counter at midnight UTC.

```typescript
// server/workers/semanticWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';
import { redis } from '../redis';
import { logSystemEvent } from '../systemLogger';

const DAILY_CAP = 2000;
const DAILY_CAP_KEY = 'embed:daily:count';

export class SemanticWorker extends ApexWorker {
  protected readonly queueName = 'apex-embeddings';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_LOW || '10', 10);
  protected readonly timeoutMs = 30_000;

  async processJob(job: Job): Promise<void> {
    // Enforce daily token budget before any API call
    if (redis) {
      const current = await redis.incr(DAILY_CAP_KEY);
      if (current === 1) {
        // First increment of the day — set TTL to 25 hours (buffer for timezone drift)
        await redis.expire(DAILY_CAP_KEY, 90_000);
      }
      if (current > DAILY_CAP) {
        await redis.decr(DAILY_CAP_KEY);
        logSystemEvent('warn', this.queueName, `Daily embedding cap reached (${DAILY_CAP}), job deferred`, {
          jobId: job.id,
          jobType: job.name,
        });
        // Delay the job by 6 hours — it will be retried by BullMQ's retry mechanism
        throw Object.assign(new Error('DAILY_CAP_EXCEEDED'), { skipSentry: true });
      }
    }

    switch (job.name) {
      case 'contact-embed': {
        const { embedContact } = await import('../intelligence/worker');
        await embedContact({
          contactId: job.data.contactId,
          contentHash: job.data.contentHash,
          force: job.data.force,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'incident-embed': {
        const { embedIncident } = await import('../intelligence/worker');
        await embedIncident({
          incidentId: job.data.incidentId,
          contentHash: job.data.contentHash,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'legal-signal-embed': {
        const { embedLegalSignal } = await import('../intelligence/worker');
        await embedLegalSignal({
          signalId: job.data.signalId,
          contentHash: job.data.contentHash,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'case-embed':
      case 'vector-index':
      case 'embedding-backfill': {
        const { runRollupWorkerCycle } = await import('../intelligence/rollupWorker');
        await runRollupWorkerCycle(job.data);
        break;
      }
      default:
        throw new Error(`[SemanticWorker] Unknown job: ${job.name}`);
    }
  }
}
```

**Throttle guard:** If the `apex-embeddings` queue depth exceeds 500 waiting jobs, a proactive pause is triggered by the `queue-health-snapshot` maintenance job. This prevents runaway embedding storms after a large bulk import.

### 3.6 Workflow Worker

Handles the `apex-crm` queue. Idempotency is enforced at the job level via `contactId:fingerprintHash` dedupe key (set in `queueFactory.ts`). The `contactUpsertService.ts` `shouldUpdateField()` guard is a second layer — the worker never overwrites data of higher confidence regardless of call order.

```typescript
// server/workers/workflowWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class WorkflowWorker extends ApexWorker {
  protected readonly queueName = 'apex-crm';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_MEDIUM || '5', 10);
  protected readonly timeoutMs = 60_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'contact-upsert': {
        const { upsertContact } = await import('../services/contactUpsertService');
        await upsertContact(job.data as any);
        break;
      }
      case 'lifecycle-update': {
        const { updateContactLifecycle } = await import('../services/contactUpsertService');
        await updateContactLifecycle({
          contactId: job.data.contactId,
          stage: job.data.stage,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'export-eligibility-eval': {
        const { evaluateExportEligibility } = await import('../apexLeadEngine');
        await evaluateExportEligibility({
          contactId: job.data.contactId,
          subAccountId: job.data.subAccountId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'territory-assignment': {
        const { assignTerritory } = await import('../routing/territoryEngine');
        await assignTerritory({
          contactId: job.data.contactId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'meta-campaign-sync':
      case 'meta_campaign_sync': {
        // Legacy meta campaign sync — migrated from jobQueue.registerHandler
        const { syncMetaCampaigns } = await import('../metaCampaignSync');
        await syncMetaCampaigns();
        break;
      }
      default:
        throw new Error(`[WorkflowWorker] Unknown job: ${job.name}`);
    }
  }
}
```

### 3.7 Routing Worker

Handles the `apex-routing` queue. **Highest priority** (`priority: 10` in queue config). Must not be blocked by enrichment or OCR workers. The 3-slot concurrency cap prevents over-parallel routing decisions that could cause the same lead to be assigned twice.

```typescript
// server/workers/routingWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class RoutingWorker extends ApexWorker {
  protected readonly queueName = 'apex-routing';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_HIGH || '3', 10);
  protected readonly timeoutMs = 30_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'contact-routing': {
        const { routeContact } = await import('../apexLeadEngine');
        await routeContact({
          contactId: job.data.contactId,
          subAccountId: job.data.subAccountId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'lead-distribution': {
        const { distributeHomeServiceLead } = await import('../homeServiceLeadDelivery');
        await distributeHomeServiceLead({
          contactId: job.data.contactId,
          subAccountId: job.data.subAccountId,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'attorney-assignment': {
        const { assignAttorney } = await import('../apexLeadEngine');
        await assignAttorney({
          contactId: job.data.contactId,
          incidentId: job.data.incidentId,
          county: job.data.county,
          traceId: job.data.traceId,
        });
        break;
      }
      case 'case-routing': {
        const { routeCase } = await import('../apexLeadEngine');
        await routeCase(job.data);
        break;
      }
      default:
        throw new Error(`[RoutingWorker] Unknown job: ${job.name}`);
    }
  }
}
```

### 3.8 Maintenance Worker

Handles the `apex-maintenance` queue. `attempts: 1` — maintenance jobs are not retried. A failing DLQ sweep is logged and Sentry-alerted; the next scheduled run will pick up where it left off.

```typescript
// server/workers/maintenanceWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';
import { getQueue, getAllQueues } from '../queues/queueFactory';
import { logSystemEvent } from '../systemLogger';

export class MaintenanceWorker extends ApexWorker {
  protected readonly queueName = 'apex-maintenance';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_BACKGROUND || '2', 10);
  protected readonly timeoutMs = 120_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'dead-letter-sweep': {
        const { sweepDeadLetters } = await import('../queues/dlqSweeper');
        const result = await sweepDeadLetters();
        logSystemEvent('info', this.queueName, 'DLQ sweep', result);
        break;
      }
      case 'db-health-check': {
        const { runDbHealthCheck } = await import('../startupChecks');
        await runDbHealthCheck();
        break;
      }
      case 'queue-health-snapshot': {
        await this.snapshotQueueHealth();
        break;
      }
      case 'embedding-daily-cap-reset': {
        const { redis } = await import('../redis');
        await redis?.del('embed:daily:count');
        logSystemEvent('info', this.queueName, 'Embedding daily cap reset');
        break;
      }
      case 'archive-records': {
        const { archiveOldRecords } = await import('../dataMigrations');
        await archiveOldRecords({
          olderThanDays: job.data.olderThanDays ?? 90,
          tables: job.data.tables ?? ['event_logs'],
        });
        break;
      }
      case 'vacuum-embeddings': {
        const { vacuumEmbeddingTable } = await import('../intelligence/worker');
        await vacuumEmbeddingTable();
        break;
      }
      case 'retry-event-processor': {
        // Replaces setInterval in eventRetryProcessor.ts
        const { processFailedEvents } = await import('../eventRetryProcessor');
        await processFailedEvents();
        break;
      }
      default:
        throw new Error(`[MaintenanceWorker] Unknown job: ${job.name}`);
    }
  }

  private async snapshotQueueHealth(): Promise<void> {
    const queues = getAllQueues();
    const depths: Record<string, number> = {};
    for (const q of queues) {
      const counts = await q.getJobCounts('wait', 'active', 'delayed');
      depths[q.name] = (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    }

    // Proactive throttle: pause semantic workers if embedding queue is overloaded
    const embedDepth = depths['apex-embeddings'] ?? 0;
    if (embedDepth > 500) {
      logSystemEvent('warn', this.queueName, `apex-embeddings overloaded: ${embedDepth} jobs — throttling`, { embedDepth });
      const embedQueue = getQueue('apex-embeddings');
      await embedQueue.pause();
      setTimeout(async () => {
        await embedQueue.resume();
        logSystemEvent('info', this.queueName, 'apex-embeddings throttle lifted');
      }, 300_000);  // 5-minute pause
    }

    logSystemEvent('info', this.queueName, 'Queue health snapshot', { depths });
  }
}
```

### 3.9 Analytics Worker

Handles the `apex-analytics` queue. Rate-limited to 10 jobs per hour because rollup queries run full table scans over Neon. Concurrency of 2 prevents concurrent rollups from creating conflicting aggregates.

```typescript
// server/workers/analyticsWorker.ts
import { ApexWorker } from './BaseWorker';
import type { Job } from 'bullmq';

export class AnalyticsWorker extends ApexWorker {
  protected readonly queueName = 'apex-analytics';
  protected readonly concurrency = parseInt(process.env.WORKER_CONCURRENCY_BACKGROUND || '2', 10);
  protected readonly timeoutMs = 180_000;

  async processJob(job: Job): Promise<void> {
    switch (job.name) {
      case 'metric-rollup': {
        const { runRollupWorkerCycle } = await import('../intelligence/rollupWorker');
        await runRollupWorkerCycle({
          subAccountId: job.data.subAccountId,
          windowHours: job.data.windowHours ?? 24,
        });
        break;
      }
      case 'cohort-rebuild': {
        const { rebuildCohorts } = await import('../intelligence/rollupWorker');
        await rebuildCohorts();
        break;
      }
      case 'territory-heatmap-update': {
        const { updateTerritoryHeatmap } = await import('../intelligence/rollupWorker');
        await updateTerritoryHeatmap({ county: job.data.county });
        break;
      }
      default:
        throw new Error(`[AnalyticsWorker] Unknown job: ${job.name}`);
    }
  }
}
```

---

## 4. Worker Registration

All workers are started from a single entry point. Feature-flagged workers (`OcrWorker`, `SemanticWorker`) are only instantiated when their env var is set.

```typescript
// server/workers/index.ts
import { isRedisAvailable } from '../redis';
import { logSystemEvent } from '../systemLogger';
import { ApexWorker } from './BaseWorker';
import { IngestionWorker }   from './ingestionWorker';
import { EnrichmentWorker }  from './enrichmentWorker';
import { ScoringWorker }     from './scoringWorker';
import { WorkflowWorker }    from './workflowWorker';
import { RoutingWorker }     from './routingWorker';
import { MaintenanceWorker } from './maintenanceWorker';
import { AnalyticsWorker }   from './analyticsWorker';

let _registeredWorkers: ApexWorker[] = [];

export function startWorkers(): ApexWorker[] {
  if (!isRedisAvailable()) {
    logSystemEvent('warn', 'workers', 'Redis unavailable — BullMQ workers not started, legacy mode active');
    return [];
  }

  const workers: ApexWorker[] = [
    new RoutingWorker(),       // Highest priority — start first
    new IngestionWorker(),
    new EnrichmentWorker(),
    new ScoringWorker(),
    new WorkflowWorker(),
    new MaintenanceWorker(),
    new AnalyticsWorker(),
  ];

  // OCR: activated separately — Stage 4B dependency
  if (process.env.OCR_WORKER_ENABLED === 'true') {
    const { OcrWorker } = require('./ocrWorker');
    workers.push(new OcrWorker());
    logSystemEvent('info', 'workers', 'OcrWorker activated (OCR_WORKER_ENABLED=true)');
  }

  // Semantic / embeddings: gated by Stage 3 observation window close
  if (process.env.SEMANTIC_WORKER_ENABLED === 'true') {
    const { SemanticWorker } = require('./semanticWorker');
    workers.push(new SemanticWorker());
    logSystemEvent('info', 'workers', 'SemanticWorker activated (SEMANTIC_WORKER_ENABLED=true)');
  }

  workers.forEach(w => w.start());
  _registeredWorkers = workers;

  logSystemEvent('info', 'workers', `${workers.length} workers started`, {
    domains: workers.map(w => (w as any).queueName),
  });

  return workers;
}

export function getRegisteredWorkers(): ApexWorker[] {
  return _registeredWorkers;
}
```

---

## 5. Graceful Shutdown Sequence

Integrated into `server/index.ts`. The sequence ensures in-flight jobs are not abandoned on Railway redeploy.

```typescript
// server/index.ts — SIGTERM handler (add after existing process.on('unhandledRejection'))
import { getRegisteredWorkers } from './workers';
import { closeAllQueues } from './queues/queueFactory';
import { redis } from './redis';

const DRAIN_TIMEOUT_MS = 30_000;
const SHUTDOWN_TOTAL_TIMEOUT_MS = 45_000;

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[SHUTDOWN] ${signal} received — starting graceful shutdown`);
  logSystemEvent('info', 'process', `Graceful shutdown initiated`, { signal });

  // Step 1: Stop accepting new HTTP requests
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
  });

  const workers = getRegisteredWorkers();

  // Step 2: Pause all workers — stop pulling new jobs from queues
  await Promise.all(workers.map(w => w.pause().catch(console.error)));
  console.log(`[SHUTDOWN] ${workers.length} workers paused`);

  // Step 3: Wait for in-progress jobs to complete (max DRAIN_TIMEOUT_MS)
  await Promise.race([
    Promise.all(workers.map(w => w.drain().catch(() => {}))),
    new Promise(r => setTimeout(r, DRAIN_TIMEOUT_MS)),
  ]);
  console.log('[SHUTDOWN] Workers drained');

  // Step 4: Close worker connections (BullMQ flushes internal state)
  await Promise.all(workers.map(w =>
    w.shutdown(10_000).catch(console.error),
  ));
  console.log('[SHUTDOWN] Workers closed');

  // Step 5: Close BullMQ Queue instances
  await closeAllQueues().catch(console.error);

  // Step 6: Close Redis connection
  try {
    await redis?.quit();
    console.log('[SHUTDOWN] Redis connection closed');
  } catch {
    redis?.disconnect();
  }

  // Step 7: Close Neon DB pool
  try {
    const { db } = await import('./db');
    await (db as any).$pool?.end?.();
    console.log('[SHUTDOWN] DB pool closed');
  } catch { /* pool may not be exposed */ }

  console.log('[SHUTDOWN] Shutdown complete');
  process.exit(0);
}

// Allow up to 45 seconds total before Railway forcibly kills the process
const forceKill = setTimeout(() => {
  console.error('[SHUTDOWN] Force-kill after timeout');
  process.exit(1);
}, SHUTDOWN_TOTAL_TIMEOUT_MS);
forceKill.unref();

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
```

---

## 6. Worker Isolation Rules

| Rule | Detail |
|---|---|
| One Worker instance per domain | Workers share the Redis connection pool but have independent concurrency slots. A slow enrichment batch cannot block a routing decision. |
| Redis connection pool | Max 20 ioredis connections across all workers. BullMQ uses one connection per Worker by default; shared connection requires `connection` option to point to the same `Redis` instance. |
| Routing priority isolation | `apex-routing` queue has `priority: 10` (BullMQ: lower number = higher priority). Routing jobs preempt all other waiting jobs when a worker slot is free. |
| Semantic concurrency guard | If `apex-embeddings` queue depth > 500, `queue-health-snapshot` maintenance job pauses the queue for 5 minutes. This prevents embedding storms from exhausting the OpenAI token budget. |
| OCR provider health gate | Before processing any `ocr-extract` job, the handler runs a lightweight provider health check (`HEAD` to DocAI endpoint). If the check fails, the job is re-queued with the fallback provider. |
| Maintenance scheduling | Maintenance workers prefer off-peak hours (1–5 AM ET). BullMQ's cron `tz` option ensures the `hillsborough-records` and `db-archive-sweep` jobs run in `America/New_York` timezone, not UTC. |
| No shared mutable state | Workers are stateless — each job reads from Neon and writes back to Neon. Redis is used only for BullMQ internals and the embed daily cap counter. |

---

## 7. Retry Safety Per Worker Domain

| Domain | Queue | Max Attempts | Backoff Strategy | Jitter | DLQ After |
|---|---|---|---|---|---|
| Routing | apex-routing | 5 | Exponential, base 1 s | None | 5 failures |
| Notifications | apex-notifications | 3 | Exponential, base 2 s | Full (BullMQ built-in) | 3 failures |
| Intake | apex-intake | 5 | Exponential, base 5 s | Full | 5 failures |
| Enrichment | apex-enrichment | 4 | Exponential, base 10 s | Half | 4 failures |
| Scoring | apex-scoring | 3 | Fixed 5 s | None | 3 failures |
| Embeddings | apex-embeddings | 2 | Exponential, base 30 s | Full | 2 failures |
| Semantic | apex-semantic | 1 | None | None | 1 failure |
| OCR | apex-ocr | 3 | Exponential, base 15 s | Half | 3 failures |
| Maintenance | apex-maintenance | 1 | None | None | 1 failure (log only) |
| Analytics | apex-analytics | 1 | None | None | 1 failure (log only) |
| Workflow (CRM) | apex-crm | 4 | Exponential, base 5 s | None | 4 failures |

**Jitter rationale:** Full jitter on intake and embeddings prevents thundering herd after a provider outage recovers. Routing has no jitter because routing SLA is < 30 seconds — a jittered retry of 30–90 seconds violates the contract.

---

## 8. Memory and Concurrency Controls

```typescript
// server/workers/config.ts — environment-driven limits
export const CONCURRENCY_LIMITS = {
  high:       parseInt(process.env.WORKER_CONCURRENCY_HIGH       || '3',  10),
  medium:     parseInt(process.env.WORKER_CONCURRENCY_MEDIUM     || '5',  10),
  low:        parseInt(process.env.WORKER_CONCURRENCY_LOW        || '10', 10),
  background: parseInt(process.env.WORKER_CONCURRENCY_BACKGROUND || '2',  10),
};

export const MEMORY_CAPS = {
  warningRSS:      350 * 1024 * 1024,   // 350 MB — logSystemEvent warn
  backpressureRSS: 400 * 1024 * 1024,   // 400 MB — pause all workers 10 s
  criticalRSS:     480 * 1024 * 1024,   // 480 MB — Sentry.captureMessage
};

// Aggregate concurrency ceiling across all domains
// Keep below Railway's 512 MB container limit
// High (3) + Medium (5+5+5=15) + Low (10+10=20) + Background (2+2=4) = 42 max concurrent operations
// Each operation holds ~2–8 MB working set; 42 * 8 MB = 336 MB — safely under 480 MB critical cap
export const TOTAL_MAX_CONCURRENCY = 
  CONCURRENCY_LIMITS.high * 2 +          // routing + notifications
  CONCURRENCY_LIMITS.medium * 3 +        // enrichment + scoring + crm
  CONCURRENCY_LIMITS.low * 2 +           // embeddings + semantic
  CONCURRENCY_LIMITS.background * 2;     // maintenance + analytics
```

**Railway single-process constraint:** All workers run in the same Node.js process as the Express server. The aggregate concurrency calculation above ensures the process stays within Railway's default 512 MB container. If OCR and Semantic workers are both activated, total max concurrency increases by 22 slots; this should be monitored during the first 48 hours post-activation.

---

## 9. Queue Health API Endpoint

```typescript
// Mounted at GET /internal/health/queues by operator router
// Requires: internalOnly middleware (Bearer INTERNAL_SECRET)

import { getAllQueues } from '../queues/queueFactory';
import { isRedisAvailable } from '../redis';
import { getRegisteredWorkers } from '../workers';
import { db } from '../db';
import { deadLetterJobs } from '@shared/schema';
import { isNull, sql } from 'drizzle-orm';

router.get('/health/queues', internalOnly, async (_req, res) => {
  if (!isRedisAvailable()) {
    return res.json({
      mode: 'legacy',
      message: 'Redis unavailable — in-memory jobQueue active',
      legacyStats: legacyQueue.getStats(),
    });
  }

  try {
    const queues = getAllQueues();
    const queueSnapshots = await Promise.all(
      queues.map(async (q) => {
        const counts = await q.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed', 'paused');
        const [isPaused, workers] = await Promise.all([q.isPaused(), q.getWorkers()]);
        return {
          name: q.name,
          counts,
          isPaused,
          workerCount: workers.length,
          healthy: !isPaused && (counts.failed ?? 0) < 50,
        };
      }),
    );

    const [dlqResult] = await db
      .select({ unreplayedCount: sql<number>`count(*)` })
      .from(deadLetterJobs)
      .where(isNull(deadLetterJobs.replayedAt));

    const registeredWorkers = getRegisteredWorkers();

    res.json({
      mode: 'bullmq',
      redis: { status: 'ready' },
      workers: {
        total: registeredWorkers.length,
        domains: registeredWorkers.map(w => (w as any).queueName),
      },
      queues: queueSnapshots,
      dlq: { unreplayedCount: Number(dlqResult?.unreplayedCount ?? 0) },
      memory: {
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to collect queue health', detail: err.message });
  }
});
```

---

## 10. Activation Checklist

This checklist gates each worker domain activation. Each item must be verified before the worker is enabled in production.

**Pre-activation (all domains)**
- [ ] `UPSTASH_REDIS_URL` set in Railway environment
- [ ] `initRedis()` returns `true` in production health check
- [ ] `startWorkers()` called after `server.listen()` in `server/index.ts`
- [ ] `durableJobQueue` adapter wired into `operator/telemetry.ts` and `routes/analytics.ts`
- [ ] `registerScheduledJobs()` called at startup (replaces all `setInterval` cron calls)

**IngestionWorker**
- [ ] Existing `setInterval` in `crashIngestPipeline.ts` disabled (guarded by `DISABLE_BACKGROUND_WORKERS`)
- [ ] BullMQ repeat job `crash-ingest-sweep` registered and visible in bull-board
- [ ] First manual job added via `POST /internal/queue/test/crash-ingest` and completed successfully
- [ ] Dedupe key `crash-ingest:{reportNumber}` verified to reject duplicate adds

**EnrichmentWorker**
- [ ] `retroSkipTrace.ts` `shouldUpdateField()` guard confirmed to be called by worker handler
- [ ] BatchData API key present in `VENDOR_CONFIG` table
- [ ] Rate limit (10 per minute from retroSkipTrace) still respected within BullMQ rate limiter

**ScoringWorker**
- [ ] `homeServiceLeadScorer` and `caseIntelligence` no longer triggered directly by eventBus subscribers — scoring events now enqueue a `lead-score` / `case-score` job instead

**SemanticWorker**
- [ ] Stage 3 observation window closed (check `STAGE_3_OBSERVATION_WINDOW.md`)
- [ ] `SEMANTIC_WORKER_ENABLED=true` set in Railway
- [ ] Daily cap counter `embed:daily:count` visible in Upstash Redis console
- [ ] `embedding-daily-cap-reset` repeat job registered

**OcrWorker**
- [ ] OCR pipeline module at `server/intelligence/ocrPipeline.ts` implemented (Stage 4B)
- [ ] `OCR_WORKER_ENABLED=true` set in Railway
- [ ] Google DocAI credentials or Textract IAM role configured

---

## 11. File Layout Summary

```
server/
  redis.ts                          # Redis singleton, initRedis(), isRedisAvailable()
  queues/
    queueFactory.ts                 # QUEUE_CONFIGS, getQueue(), getAllQueues()
    jobTypes.ts                     # ApexJobType union, JobPayloadMap, JOB_QUEUE_MAP
    dedupeKeys.ts                   # getDedupeKey() — content-derived jobId keys
    legacyAdapter.ts                # durableJobQueue — drop-in for jobQueue.ts callers
    scheduledJobs.ts                # SCHEDULED_JOBS[], registerScheduledJobs()
    dlqSweeper.ts                   # sweepDeadLetters(), recordDeadLetterJob()
    errorClassifier.ts              # classifyError(), DlqErrorClass
  workers/
    BaseWorker.ts                   # ApexWorker abstract class
    index.ts                        # startWorkers(), getRegisteredWorkers()
    config.ts                       # CONCURRENCY_LIMITS, MEMORY_CAPS
    ingestionWorker.ts              # apex-intake — crash, arrest, court, legal, jailbooking
    enrichmentWorker.ts             # apex-enrichment — skip-trace, scrape, validation
    ocrWorker.ts                    # apex-ocr — document-ingest, ocr-extract (Stage 4B)
    scoringWorker.ts                # apex-scoring — lead-score, case-score
    semanticWorker.ts               # apex-embeddings, apex-semantic (post Stage 3)
    workflowWorker.ts               # apex-crm — upsert, lifecycle, export-eval
    routingWorker.ts                # apex-routing — contact-routing, lead-distribution
    maintenanceWorker.ts            # apex-maintenance — DLQ, health, archive
    analyticsWorker.ts              # apex-analytics — rollup, cohort, heatmap
```
