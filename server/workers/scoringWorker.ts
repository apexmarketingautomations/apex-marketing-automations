// @ts-nocheck
/**
 * server/workers/scoringWorker.ts
 *
 * BullMQ Worker consuming the `apex-scoring` queue.
 *
 * Unified cross-vertical contact scoring.
 *
 * Scoring factors (weighted to sum 100):
 *   enrichment_quality  (25) — has real name, phone, verified address
 *   phone_presence      (20) — verified phone on file
 *   email_presence      (10) — verified email on file
 *   recency             (20) — age since contact was created / incident occurred
 *   source_confidence   (10) — enrichment confidence value from provider
 *   severity            (10) — lead_subtype severity (crash > arrest > permit)
 *   territory_relevance  (5) — contact's county matches operator territory
 *
 * Score bands:
 *   A+ = 90–100   (immediately actionable, high-value)
 *   A  = 75–89    (strong lead)
 *   B  = 55–74    (moderate lead)
 *   C  = 35–54    (weak lead, needs enrichment)
 *   D  = 0–34     (poor quality, placeholder)
 *
 * qualifies = score >= 55 (B or better) AND is_placeholder = false
 */

import { Worker, Job, Queue } from "bullmq";
import { db } from "../db";
import { contacts, contactScores } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBullMQConnection, QUEUE_NAMES, getScoringQueue, sendToDeadLetterQueue, attachCircuitBreaker } from "../queues/queueFactory";

const WORKER_TAG    = "SCORING-WORKER";
const MAX_CONCURRENCY = 5;  // scoring is CPU-cheap
const QUALIFY_THRESHOLD = 55;
const SCORE_EXPIRY_HOURS = 48;  // rescore after 48h if not updated

export const SCORER_VERSION = "v2.0"; // v2.0: victim-centric address confidence scoring

// ── Score bands ───────────────────────────────────────────────────────────────

export type ScoreBand = "A+" | "A" | "B" | "C" | "D";

export function scoreToband(score: number): ScoreBand {
  if (score >= 90) return "A+";
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "D";
}

// ── Job payload ───────────────────────────────────────────────────────────────

export interface ScoringJobData {
  contactId: number;
  subAccountId: number;
  /** Force rescore even if score is fresh */
  force?: boolean;
}

export interface ScoreResult {
  contactId: number;
  score: number;
  band: ScoreBand;
  qualifies: boolean;
  breakdown: Record<string, number>;
  scorerVersion: string;
}

// ── Enqueue helper ────────────────────────────────────────────────────────────

export async function enqueueScoringJob(data: ScoringJobData): Promise<string | undefined> {
  try {
    const queue = getScoringQueue();
    const job   = await queue.add(`score:${data.contactId}`, data, {
      jobId:    `score-${data.contactId}`,  // one scoring job per contact at a time
      attempts:  2,
      backoff:   { type: "fixed", delay: 3_000 },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 100 },
    });
    return job.id;
  } catch (err: any) {
    console.warn(`[${WORKER_TAG}] Failed to enqueue scoring job contact=${data.contactId}: ${err?.message}`);
    return undefined;
  }
}

// ── Scoring logic ─────────────────────────────────────────────────────────────

const SEVERITY_SCORES: Record<string, number> = {
  crash:      10,
  dui:        10,
  dui_arrest: 10,
  arrest:      8,
  bankruptcy:  8,
  foreclosure: 7,
  osha:        6,
  permit:      5,
  recall:      4,
  weather:     3,
  growth:      3,
  general:     2,
};

export function computeContactScore(contact: typeof contacts.$inferSelect): ScoreResult {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Cast to access victim-centric address fields (added in 2026-05-16 migration)
  const c = contact as any;

  // 1. Enrichment quality (25pts)
  // Address scoring now uses addressConfidence, NOT mere non-null presence.
  // A roadway string ("I-75 NB MM 131") must NEVER score the same as a real home address.
  let enrichQuality = 0;
  const hasRealName = contact.firstName && contact.firstName.length > 1 &&
    !contact.firstName.toLowerCase().includes("unknown") &&
    !contact.firstName.toLowerCase().includes("placeholder") &&
    !contact.firstName.toLowerCase().includes("unidentified");
  if (hasRealName) enrichQuality += 10;

  // Address points are proportional to address confidence.
  // incident_location (0.15 confidence) → 1pt  (minimal — do not reward roadway placeholders)
  // FLHSMV license addr (0.85) → 6pt
  // DHSMV registration (0.90) → 7pt
  // Verified residence (0.95+) → 8pt (maximum address quality)
  const addrConf = c.addressConfidence ?? 0;
  if (addrConf >= 0.90) enrichQuality += 8;       // verified residence / DHSMV
  else if (addrConf >= 0.80) enrichQuality += 6;  // FLHSMV driver license
  else if (addrConf >= 0.60) enrichQuality += 4;  // BatchData inferred
  else if (addrConf > 0.15) enrichQuality += 2;   // probable household
  else if (addrConf > 0) enrichQuality += 1;      // incident location only — minimal credit

  // Geocode-confirmed residential is the gold standard (+7 only for residential confirmation)
  if (contact.geocodeStatus === "verified" && (c.addressType ?? "unknown") !== "incident_location") {
    enrichQuality += 7;
  }

  breakdown.enrichment_quality = Math.min(enrichQuality, 25);
  total += breakdown.enrichment_quality;

  // 1b. Residential intelligence bonus (separate from enrichment_quality, max 10pts)
  // Rewards contacts who have progressed through the victim-centric enrichment chain.
  let residentialBonus = 0;
  if (c.verifiedResidence)    residentialBonus += 5;  // geocode-confirmed residential
  if (c.registrationAddress)  residentialBonus += 3;  // FLHSMV/DHSMV registration
  if (c.incidentFingerprint)  residentialBonus += 2;  // linked to official crash report
  breakdown.residential_intelligence = Math.min(residentialBonus, 10);
  total += breakdown.residential_intelligence;

  // 2. Phone presence (20pts)
  const hasPhone = !!(contact.phone || contact.normalizedPhone);
  const hasVerifiedPhone = contact.skipTraceStatus === "matched" || contact.identityStatus === "verified";
  breakdown.phone_presence = hasPhone ? (hasVerifiedPhone ? 20 : 12) : 0;
  total += breakdown.phone_presence;

  // 3. Email presence (10pts)
  breakdown.email_presence = contact.email ? 10 : 0;
  total += breakdown.email_presence;

  // 4. Recency (20pts — decays over time)
  const ageHours = (Date.now() - new Date(contact.createdAt).getTime()) / (1000 * 3600);
  let recencyScore: number;
  if (ageHours <= 6)    recencyScore = 20;
  else if (ageHours <= 24)  recencyScore = 16;
  else if (ageHours <= 72)  recencyScore = 10;
  else if (ageHours <= 168) recencyScore = 5;
  else recencyScore = 1;
  breakdown.recency = recencyScore;
  total += breakdown.recency;

  // 5. Source confidence (10pts)
  const conf = contact.enrichmentConfidence ?? 0;
  breakdown.source_confidence = Math.round(conf * 10);
  total += breakdown.source_confidence;

  // 6. Severity (10pts)
  const subtype = (contact.leadSubtype || contact.leadVertical || "general").toLowerCase();
  breakdown.severity = SEVERITY_SCORES[subtype] ?? 2;
  total += breakdown.severity;

  // 7. Territory relevance (5pts — placeholder, always 3 until territories wired)
  breakdown.territory_relevance = 3;
  total += breakdown.territory_relevance;

  // Hard gate: isPlaceholder contacts cannot qualify regardless of score.
  // A roadway placeholder with a fabricated score must NEVER reach exports.
  const score   = Math.min(100, Math.max(0, total));
  const band    = scoreToband(score);
  const qualifies = score >= QUALIFY_THRESHOLD && !contact.isPlaceholder;

  return {
    contactId: contact.id,
    score,
    band,
    qualifies,
    breakdown,
    scorerVersion: SCORER_VERSION,
  };
}

// ── Job handler ───────────────────────────────────────────────────────────────

async function processScoring(job: Job<ScoringJobData>): Promise<ScoreResult> {
  const { contactId, subAccountId, force } = job.data;

  // Load contact
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error(`Contact ${contactId} not found`);

  // Idempotency: check if score is fresh
  if (!force) {
    const [existing] = await db.select()
      .from(contactScores)
      .where(eq(contactScores.contactId, contactId))
      .limit(1);

    if (existing && existing.expiresAt && new Date(existing.expiresAt) > new Date()) {
      console.log(`[${WORKER_TAG}] Contact ${contactId} score is fresh (expires ${existing.expiresAt.toISOString()}) — skipping`);
      return {
        contactId,
        score:         existing.score,
        band:          existing.scoreBand as ScoreBand,
        qualifies:     existing.qualifies,
        breakdown:     (existing.breakdown as Record<string, number>) ?? {},
        scorerVersion: existing.scorerVersion,
      };
    }
  }

  await job.updateProgress(20);

  // Compute score
  const result = computeContactScore(contact);
  await job.updateProgress(60);

  // Persist score
  const expiresAt = new Date(Date.now() + SCORE_EXPIRY_HOURS * 3600 * 1000);

  await db.insert(contactScores).values({
    contactId,
    subAccountId,
    score:         result.score,
    scoreBand:     result.band,
    qualifies:     result.qualifies,
    breakdown:     result.breakdown,
    scorerVersion: result.scorerVersion,
    expiresAt,
  }).onConflictDoNothing();

  // Update contact with score
  await db.update(contacts).set({
    contactQualityScore: result.score,
    workflowStage:       result.qualifies ? "routed" : "scored",
    exportEligible:      result.qualifies,
  }).where(eq(contacts.id, contactId));

  await job.updateProgress(100);
  console.log(`[${WORKER_TAG}] ✓ Scored contact=${contactId} score=${result.score} band=${result.band} qualifies=${result.qualifies}`);
  return result;
}

// ── Worker factory ────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

export function startScoringWorker(): void {
  if (_worker) return;

  _worker = new Worker<ScoringJobData>(
    QUEUE_NAMES.SCORING,
    async (job) => {
      const start = Date.now();
      try {
        const result = await processScoring(job);
        console.log(`[${WORKER_TAG}] job=${job.id} contact=${job.data.contactId} latency=${Date.now() - start}ms`);
        return result;
      } catch (err: any) {
        console.error(`[${WORKER_TAG}] ✗ job=${job.id} error=${err?.message}`);
        throw err;
      }
    },
    {
      connection:  getBullMQConnection(),
      concurrency: MAX_CONCURRENCY,
    }
  );

  _worker.on("failed", async (job, err) => {
    const attempts    = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    console.error(`[${WORKER_TAG}] Job ${job?.id} failed (${attempts}/${maxAttempts}): ${err?.message}`);

    if (job && attempts >= maxAttempts) {
      await sendToDeadLetterQueue({
        sourceQueue: QUEUE_NAMES.SCORING,
        jobName:     job.name,
        payload:     job.data,
        attempts,
        lastError:   err?.message ?? "unknown error",
        failedAt:    new Date().toISOString(),
        meta:        { jobId: job.id },
      });
    }
  });

  attachCircuitBreaker(_worker, WORKER_TAG);
  console.log(`[${WORKER_TAG}] Started — concurrency=${MAX_CONCURRENCY} queue=${QUEUE_NAMES.SCORING}`);
}

export async function stopScoringWorker(): Promise<void> {
  if (!_worker) return;
  await _worker.close();
  _worker = null;
  console.log(`[${WORKER_TAG}] Stopped`);
}
