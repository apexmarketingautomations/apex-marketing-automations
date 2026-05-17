// @ts-nocheck
/**
 * server/workers/enrichmentWorker.ts
 *
 * BullMQ Worker consuming the `apex-enrichment` queue.
 *
 * Handles:
 *   skip_trace    — BatchData skip trace for contacts with no phone
 *   flhsmv_enrich — FLHSMV report fetch for crash contacts
 *   address_verify — Validate and normalize contact address
 *
 * Design:
 *   - Idempotent: always checks current contact state before acting
 *   - Retry-safe: 3 attempts with exponential backoff
 *   - Observable: logs all outcomes to stdout (Axiom picks up via drain)
 *   - Graceful shutdown: drains in-flight jobs on SIGTERM
 *
 * Enqueue via:
 *   import { enqueueEnrichment } from "./enrichmentWorker";
 *   await enqueueEnrichment({ jobType: "skip_trace", contactId: 123, subAccountId: 5 });
 */

import { Worker, Job } from "bullmq";
import { db } from "../db";
import { contacts, contactScores } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBullMQConnection, QUEUE_NAMES, getEnrichmentQueue, sendToDeadLetterQueue } from "../queues/queueFactory";
import { captureWorkerError } from "../instrument";
import { isBatchDataDisabled } from "../skip-trace";
import { resolveBatchDataKey } from "../vendorConfig";

const WORKER_TAG = "ENRICHMENT-WORKER";
const MAX_CONCURRENCY = 3; // conservative — BatchData rate limits

// ── Job payload types ─────────────────────────────────────────────────────────

export type EnrichmentJobType = "skip_trace" | "flhsmv_enrich" | "address_verify" | "score_contact";

export interface EnrichmentJobData {
  jobType: EnrichmentJobType;
  contactId: number;
  subAccountId: number;
  /** Optional: force re-enrichment even if already attempted */
  force?: boolean;
  /** Optional: report number for flhsmv_enrich */
  reportNumber?: string;
}

// ── Enqueue helper ────────────────────────────────────────────────────────────

export async function enqueueEnrichment(data: EnrichmentJobData): Promise<string | undefined> {
  try {
    const queue = getEnrichmentQueue();
    const job = await queue.add(`enrich:${data.jobType}:${data.contactId}`, data, {
      jobId:   `enrich-${data.jobType}-${data.contactId}`,  // prevents duplicate jobs
      attempts: 3,
      backoff:  { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 200 },
    });
    return job.id;
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] Failed to enqueue job for contact ${data.contactId}: ${err?.message}`);
    return undefined;
  }
}

// ── Job handlers ──────────────────────────────────────────────────────────────

async function handleSkipTrace(job: Job<EnrichmentJobData>): Promise<{ enriched: boolean; phone?: string }> {
  const { contactId, subAccountId, force } = job.data;

  if (isBatchDataDisabled()) {
    console.log(`[${WORKER_TAG}] BatchData disabled — skipping skip_trace for contact ${contactId}`);
    return { enriched: false };
  }

  // Load contact
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  // Idempotency: skip if already enriched via BatchData (unless forced)
  if (!force && contact.skipTraceStatus === "matched") {
    console.log(`[${WORKER_TAG}] Contact ${contactId} already skip-traced — skipping`);
    return { enriched: false };
  }

  // SOURCE INTELLIGENCE GUARD — never run BatchData when source already provided a phone.
  // If a first-party source (sheriff, FLHSMV, court) already gave us a phone,
  // running BatchData is wasted spend. Promote the status to source_matched and exit.
  if (!force && contact.phone) {
    const alreadySourceMatched = contact.skipTraceStatus === "source_matched";
    if (!alreadySourceMatched) {
      await db.update(contacts)
        .set({ skipTraceStatus: "source_matched" })
        .where(eq(contacts.id, contactId));
      console.log(`[${WORKER_TAG}] Contact ${contactId} already has source phone — promoted to source_matched, skipping BatchData`);
    }
    return { enriched: false };
  }

  const key = resolveBatchDataKey();
  if (!key) {
    console.warn(`[${WORKER_TAG}] No BatchData key — cannot skip-trace contact ${contactId}`);
    return { enriched: false };
  }

  const firstName = contact.firstName;
  const lastName  = contact.lastName ?? "";
  if (!firstName || firstName.length < 2) {
    console.log(`[${WORKER_TAG}] Contact ${contactId} has insufficient name data for skip trace`);
    await db.update(contacts).set({ skipTraceStatus: "no_match" }).where(eq(contacts.id, contactId));
    return { enriched: false };
  }

  // Mark in-progress
  await db.update(contacts)
    .set({ skipTraceStatus: "pending", enrichmentAttemptedAt: new Date(), enrichmentProvider: "batchdata" })
    .where(eq(contacts.id, contactId));

  await job.updateProgress(20);

  try {
    const res = await fetch("https://api.batchdata.com/api/v1/property/skip-trace/name", {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ firstName, lastName, state: contact.state || "FL" }),
      signal:  AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // allow-silent-catch: reading error body is best-effort — empty string is fine
      const body = await res.text().catch(() => "");
      console.warn(`[${WORKER_TAG}] BatchData HTTP ${res.status} for contact ${contactId}: ${body.slice(0, 200)}`);
      await db.update(contacts)
        .set({ skipTraceStatus: "failed" })
        .where(eq(contacts.id, contactId));
      return { enriched: false };
    }

    const data = await res.json();
    const phone =
      data?.results?.[0]?.phones?.[0]?.number ||
      data?.results?.[0]?.phone ||
      data?.phone ||
      null;

    await job.updateProgress(80);

    // BatchData mailing address from response
    const mailingAddress =
      data?.results?.[0]?.mailingAddress ||
      data?.results?.[0]?.address?.full ||
      null;

    const BATCHDATA_CONFIDENCE = 0.72; // ADDRESS_CONFIDENCE.BATCHDATA_INFERRED
    const existingConf = (contact as any).addressConfidence ?? 0;

    const updates: Record<string, any> = {
      skipTraceStatus:        phone ? "matched" : "no_match",
      enrichmentCompletedAt:  new Date(),
      enrichmentConfidence:   phone ? BATCHDATA_CONFIDENCE : 0.0,
    };
    if (phone) {
      updates.phone           = phone;
      updates.normalizedPhone = phone.replace(/\D/g, "");
      updates.identityStatus  = "verified";
      updates.isPlaceholder   = false;
      updates.viewClass       = "enriched_contact";
      updates.workflowStage   = "scored";
    }
    // Store mailing address in typed field; upgrade contact.address only if confidence is higher
    if (mailingAddress) {
      updates.mailingAddress    = mailingAddress;
      updates.probableResidence = mailingAddress;
      if (BATCHDATA_CONFIDENCE > existingConf) {
        updates.address           = mailingAddress;
        updates.addressConfidence = BATCHDATA_CONFIDENCE;
        updates.addressType       = "mailing";
        updates.addressSource     = "batchdata";
      }
    }
    await db.update(contacts).set(updates).where(eq(contacts.id, contactId));

    console.log(`[${WORKER_TAG}] ✓ skip_trace contact=${contactId} phone=${phone ? "found" : "not found"}`);
    return { enriched: !!phone, phone: phone ?? undefined };

  } catch (err: any) {
    await db.update(contacts).set({ skipTraceStatus: "failed" }).where(eq(contacts.id, contactId));
    throw err; // let BullMQ retry
  }
}

async function handleAddressVerify(job: Job<EnrichmentJobData>): Promise<{ verified: boolean; confidence?: number }> {
  const { contactId } = job.data;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) {
    console.log(`[${WORKER_TAG}] No Google API key — skipping address verify for contact ${contactId}`);
    return { verified: false };
  }

  // Victim-centric: select the best residential address target for geocoding.
  // Priority: probableResidence > registrationAddress > address (if residential confidence > 0.15)
  // NEVER geocode an incident_location / highway string — that would set wrong lat/lng on the contact.
  const c = contact as any;
  const geocodeTarget =
    c.probableResidence    ||
    c.registrationAddress  ||
    (contact.address && (c.addressConfidence ?? 0) > 0.15 ? contact.address : null);

  if (!geocodeTarget) {
    console.log(`[${WORKER_TAG}] address_verify contact=${contactId} — no residential address to geocode`);
    return { verified: false };
  }

  try {
    const encoded = encodeURIComponent(geocodeTarget + (contact.city ? `, ${contact.city}` : "") + ", FL");
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${googleKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { verified: false };

    const geoData = await res.json();
    const result  = geoData?.results?.[0];
    if (!result) return { verified: false };

    const loc        = result.geometry?.location;
    const formatted  = result.formatted_address;
    const components = result.address_components as any[] ?? [];
    const zipComp    = components.find((c: any) => c.types.includes("postal_code"));
    const cityComp   = components.find((c: any) => c.types.includes("locality"));
    const countyComp = components.find((c: any) => c.types.includes("administrative_area_level_2"));

    // Geocode confirmation upgrades the address to VERIFIED_RESIDENCE (0.95)
    // and promotes it to both verifiedResidence and contact.address (the canonical field).
    const VERIFIED_CONFIDENCE = 0.95;
    await db.update(contacts).set({
      formattedAddress: formatted || geocodeTarget,
      // Residential lat/lng — set only now that we have a confirmed residential location
      lat:    loc?.lat ?? contact.lat,
      lng:    loc?.lng ?? contact.lng,
      zip:    zipComp?.short_name ?? contact.zip,
      city:   cityComp?.short_name ?? contact.city,
      county: countyComp?.short_name?.replace(" County", "").toUpperCase() ?? contact.county,
      geocodeStatus: "verified",
      geocodedAt:    new Date(),
      // Victim-centric: promote geocoded address to verified_residence
      verifiedResidence:  formatted || geocodeTarget,
      address:            formatted || geocodeTarget,
      addressType:        "verified_residence",
      addressConfidence:  VERIFIED_CONFIDENCE,
      addressSource:      "google_geocode",
    } as any).where(eq(contacts.id, contactId));

    console.log(`[${WORKER_TAG}] ✓ address_verify contact=${contactId} conf=0.95 formatted="${formatted}"`);
    return { verified: true, confidence: VERIFIED_CONFIDENCE };
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] Address verify error contact=${contactId}: ${err?.message}`);
    return { verified: false };
  }
}

async function handleScoreContact(job: Job<EnrichmentJobData>): Promise<{ score: number; band: string }> {
  const { contactId, subAccountId } = job.data;
  // Delegate to scoring worker via queue (avoid duplicating scoring logic here)
  const { enqueueScoringJob } = await import("./scoringWorker");
  await enqueueScoringJob({ contactId, subAccountId });
  return { score: 0, band: "pending" };
}

// ── Worker factory ────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startEnrichmentWorker(): void {
  if (_worker) return;

  _worker = new Worker<EnrichmentJobData>(
    QUEUE_NAMES.ENRICHMENT,
    async (job) => {
      const start = Date.now();
      console.log(`[${WORKER_TAG}] Processing job=${job.id} type=${job.data.jobType} contact=${job.data.contactId}`);

      try {
        let result: Record<string, unknown>;
        switch (job.data.jobType) {
          case "skip_trace":    result = await handleSkipTrace(job);      break;
          case "address_verify": result = await handleAddressVerify(job);  break;
          case "score_contact": result = await handleScoreContact(job);   break;
          case "flhsmv_enrich": {
            // Delegate to the existing FLHSMV enrichment function
            const { enrichCrashLeadContacts } = await import("../crashReportWorker");
            const { fetchReportDetail }        = await import("../crashReportWorker");
            if (!job.data.reportNumber) throw new Error("reportNumber required for flhsmv_enrich");
            const detail = await fetchReportDetail(job.data.reportNumber);
            result = (await enrichCrashLeadContacts({
              sentinelReportNumber: job.data.reportNumber,
              subAccountId:         job.data.subAccountId,
              detailData:           detail as any,
              officialReportNumber: job.data.reportNumber,
            })) as unknown as Record<string, unknown>;
            break;
          }
          default:
            throw new Error(`Unknown job type: ${(job.data as any).jobType}`);
        }

        const latencyMs = Date.now() - start;
        console.log(`[${WORKER_TAG}] ✓ job=${job.id} type=${job.data.jobType} latency=${latencyMs}ms result=${JSON.stringify(result)}`);
        return result;

      } catch (err: any) {
        const latencyMs = Date.now() - start;
        console.error(`[${WORKER_TAG}] ✗ job=${job.id} type=${job.data.jobType} latency=${latencyMs}ms error=${err?.message}`);
        throw err;
      }
    },
    {
      connection:  getBullMQConnection(),
      concurrency: MAX_CONCURRENCY,
      limiter: { max: 10, duration: 60_000 },  // max 10 jobs/min across all concurrency
    }
  );

  _worker.on("failed", async (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    console.error(`[${WORKER_TAG}] Job ${job?.id} failed (${attempts}/${maxAttempts}): ${err?.message}`);

    // Only dead-letter after all retries are exhausted
    if (job && attempts >= maxAttempts) {
      // Report exhausted job to Sentry before dead-lettering
      captureWorkerError(WORKER_TAG, (job.data as EnrichmentJobData).jobType, err, {
        contactId:  (job.data as EnrichmentJobData).contactId,
        jobId:      job.id,
        attempts,
      });

      await sendToDeadLetterQueue({
        sourceQueue: QUEUE_NAMES.ENRICHMENT,
        jobName:     job.name,
        payload:     job.data,
        attempts,
        lastError:   err?.message ?? "unknown error",
        failedAt:    new Date().toISOString(),
        meta:        { jobId: job.id, jobType: (job.data as EnrichmentJobData).jobType },
      });
    }
  });

  _worker.on("stalled", (jobId) => {
    console.warn(`[${WORKER_TAG}] Job ${jobId} stalled`);
  });

  console.log(`[${WORKER_TAG}] Started — concurrency=${MAX_CONCURRENCY} queue=${QUEUE_NAMES.ENRICHMENT}`);
}

export async function stopEnrichmentWorker(): Promise<void> {
  if (!_worker) return;
  await _worker.close();
  _worker = null;
  console.log(`[${WORKER_TAG}] Stopped`);
}
