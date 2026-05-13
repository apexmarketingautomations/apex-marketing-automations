import {
  emitCrashIngested,
  emitCrashLeadCreated,
  emitCrashLeadRecovered,
} from "./intelligence/apexLearningFeed";

/**
 * Crash Ingest Pipeline
 *
 * Polls the FHP HSMV live feed every 5 minutes, inserts new crash reports into
 * crash_reports, and creates contact leads for qualifying crashes.
 *
 * Design notes:
 * - Deduplication is SHA-256 based (id|type|received|location) — primary idempotency
 * - A persisted poll watermark (lastPollCursorMs) tracks the last-known poll time so
 *   recovery cycles can log overlap context. Since FLHSMV is a live snapshot feed (not
 *   a time-ordered log), we ingest ALL returned incidents and rely on dedup — not
 *   time-based filtering — to avoid duplicates. This is the correct model for a snapshot feed.
 * - Failed lead conversions (processedToLead=false) are retried in a recovery pass that
 *   runs once per hour.
 * - HTTP/network/parse errors propagate explicitly via fetchFHPHSMVFeedSafe() and trigger
 *   exponential backoff retry.
 */
import crypto from "crypto";
import { storage } from "./storage";
import { fetchFHPHSMVFeedSafe, type SentinelIncidentRaw } from "./sentinel";
import { resolveBatchDataKey, recordBatchDataRun } from "./vendorConfig";

const PIPELINE_ID = crypto.randomUUID().slice(0, 8);
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const LEAD_RECOVERY_INTERVAL_MS = 60 * 60 * 1000;
const LEAD_RECOVERY_MAX_RETRIES = 3;

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 5_000;

const LEAD_QUALIFYING_TYPES = [
  "INJUR", "FATAL", "ENTRAP", "EXTRICAT", "TRAUMA", "ROLLOVER",
  "HIT AND RUN", "H&R", "HIT & RUN", "PEDESTRIAN", "BICYCLE",
  "MOTORCYCLE", "SIGNAL 4", "SIGNAL4", "CRITICAL",
];

// Only HIGH and CRITICAL severity crashes become leads for injury attorneys
const QUALIFYING_SEVERITIES = new Set(["critical", "high"]);

// Giovanni's account gets all injury leads
const GIOVANNI_ACCOUNT_ID = 14;
const APEX_MAIN_ACCOUNT_ID = 13;

interface PollCycleSummary {
  traceId: string;
  pollStart: string;
  pollStartET: string;
  requestSent: string;
  responseStatus: "ok" | "empty" | "error";
  httpStatus?: number;
  countReturned: number;
  countParsed: number;
  countInserted: number;
  countSkipped: number;
  countSkippedDuplicateFhpId: number;
  countExistingRawReconciled: number;
  countAlreadyConverted: number;
  countConvertedToLeads: number;
  countFailed: number;
  pollEnd: string;
  durationMs: number;
  error?: string;
  lastPollCursorMs?: number;
}

interface IngestStats {
  latestPollTime: string | null;
  latestPollTimeET: string | null;
  lastSuccessfulIngest: string | null;
  lastFailureDetail: string | null;
  lastFailureTime: string | null;
  totalCrashesDiscovered: number;
  totalInserted: number;
  totalLeadsCreated: number;
  consecutiveFailures: number;
  totalPolls: number;
  lastLeadRecovery: string | null;
  lastLeadRecoveryCount: number;
  recentCycles: PollCycleSummary[];
}

const stats: IngestStats = {
  latestPollTime: null,
  latestPollTimeET: null,
  lastSuccessfulIngest: null,
  lastFailureDetail: null,
  lastFailureTime: null,
  totalCrashesDiscovered: 0,
  totalInserted: 0,
  totalLeadsCreated: 0,
  consecutiveFailures: 0,
  totalPolls: 0,
  lastLeadRecovery: null,
  lastLeadRecoveryCount: 0,
  recentCycles: [],
};

let lastPollCursorMs: number | null = null;

export function getIngestStats(): IngestStats {
  return { ...stats, recentCycles: stats.recentCycles.slice(-10) };
}

function toEasternTime(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function recordCycle(cycle: PollCycleSummary): void {
  stats.recentCycles.push(cycle);
  if (stats.recentCycles.length > 20) stats.recentCycles.shift();
}

function isQualifyingCrash(incident: SentinelIncidentRaw): boolean {
  const upper = incident.type.toUpperCase();
  const typeMatch = LEAD_QUALIFYING_TYPES.some(kw => upper.includes(kw));
  const severityMatch = QUALIFYING_SEVERITIES.has(incident.severity?.toLowerCase() || "");
  return typeMatch && severityMatch;
}

// Cache active accounts for 5 minutes to avoid DB spam
let _activeAccountCache: number[] = [];
let _activeAccountCacheTime = 0;

async function getActiveAccountIds(): Promise<number[]> {
  const now = Date.now();
  if (_activeAccountCache.length > 0 && now - _activeAccountCacheTime < 5 * 60 * 1000) {
    return _activeAccountCache;
  }
  try {
    const { storage } = await import("./storage");
    const accounts = await storage.getSubAccounts();

    // Only deliver crash leads to accounts that have Sentinel ENABLED
    // with niche=accident. Roofing, beauty, home service accounts must
    // never receive crash leads in their CRM.
    const crashAccounts: number[] = [];
    for (const account of accounts) {
      if (account.active === false) continue;
      try {
        const config = await storage.getSentinelConfig(account.id);
        if (config?.enabled && (config.niche === "accident" || config.niche === "crash")) {
          crashAccounts.push(account.id);
        }
      } catch (_e) { /* allow-silent-catch: skip accounts with no config */ }
    }

    // Fallback: if no accounts configured, only use known crash accounts
    _activeAccountCache = crashAccounts.length > 0
      ? crashAccounts
      : [GIOVANNI_ACCOUNT_ID, APEX_MAIN_ACCOUNT_ID];
    _activeAccountCacheTime = now;
    console.log(`[CRASH-INGEST] Delivering to ${_activeAccountCache.length} crash-enabled account(s): ${_activeAccountCache.join(", ")}`);
    return _activeAccountCache;
  } catch (_e) { // allow-silent-catch: DB unavailable during startup, fallback to known accounts
    return [GIOVANNI_ACCOUNT_ID, APEX_MAIN_ACCOUNT_ID];
  }
}

function buildReportNumber(incident: SentinelIncidentRaw): string {
  const hash = crypto.createHash("sha256")
    .update(`${incident.id}|${incident.type}|${incident.received || ""}|${incident.location}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `SENTINEL-${hash}`;
}

async function fetchWithBackoff(attempt: number): Promise<ReturnType<typeof fetchFHPHSMVFeedSafe>> {
  const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * 1000;
  if (attempt > 0) {
    const waitMs = Math.round(backoffMs + jitter);
    console.log(`[CRASH-INGEST] Backoff retry ${attempt}/${MAX_RETRIES - 1}, waiting ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  return fetchFHPHSMVFeedSafe();
}

async function createLeadFromCrash(
  report: NonNullable<Awaited<ReturnType<typeof storage.getCrashReport>>>,
  incident: { type: string; location: string; county?: string | null; severity: string; received?: string | null; remarks?: string | null; googleMaps?: string | null; lat?: number | null; lng?: number | null; ingestTraceId?: string | null },
  subAccountId: number,
): Promise<boolean> {
  try {
    // Deliver to ALL active accounts, not just Giovanni
    const allAccountIds = await getActiveAccountIds();
    // Skip trace once for all accounts
    let firstName = "Crash Lead";
    let lastName = `${incident.county || "FL"} — ${incident.type}`;
    let phone: string | undefined;
    let email: string | undefined;
    let skipTraceNotes = "Skip trace: not attempted";

    const batchDataKey = resolveBatchDataKey();
    if (batchDataKey && incident.location) {
      try {
        const { skipTraceLookup } = await import("./skip-trace");
        const traceResult = await skipTraceLookup(
          { address: incident.location, state: "FL", city: incident.county || "" },
          batchDataKey
        );
        if (traceResult.ownerName) {
          const parts = traceResult.ownerName.trim().split(" ");
          firstName = parts[0] || "Crash";
          lastName = parts.slice(1).join(" ") || `Lead — ${incident.county || "FL"}`;
        }
        if (traceResult.ownerPhone) phone = traceResult.ownerPhone;
        if (traceResult.ownerEmail) email = traceResult.ownerEmail;

        // Build rich notes with ALL persons and ALL contact data found
        const personLines: string[] = [];
        for (const p of traceResult.allPersons) {
          const pLine = [
            p.name || "Unknown",
            p.allPhones.length ? `Phones: ${p.allPhones.join(', ')}` : null,
            p.allEmails.length ? `Emails: ${p.allEmails.join(', ')}` : null,
            p.mailingAddress ? `Mail: ${p.mailingAddress}` : null,
            p.age ? `Age: ${p.age}` : null,
          ].filter(Boolean).join(' | ');
          personLines.push(pLine);
        }

        if (traceResult.additionalAddresses.length > 0) {
          personLines.push(`Additional addresses: ${traceResult.additionalAddresses.join('; ')}`);
        }

        skipTraceNotes = traceResult.totalPersonsFound > 0
          ? `Skip trace: FOUND ${traceResult.totalPersonsFound} person(s)\n${personLines.join('\n')}`
          : "Skip trace: no persons found";

        console.log(`[BATCHDATA] skip-trace response: location=${incident.location} persons=${traceResult.totalPersonsFound} hasPhone=${!!traceResult.ownerPhone} hasEmail=${!!traceResult.ownerEmail}`);
        recordBatchDataRun(traceResult.totalPersonsFound, `crash-ingest location=${incident.location}`);
      } catch (stErr: any) {
        skipTraceNotes = `Skip trace: failed — ${stErr.message}`;
        console.warn(`[BATCHDATA] skip-trace failed for ${incident.location}: ${stErr.message}`);
        recordBatchDataRun(0, `crash-ingest location=${incident.location}`, stErr.message);
      }
    }

    const contactData = {
      firstName,
      lastName,
      phone,
      email,
      source: "sentinel_crash",
      channel: "sentinel",
      tags: ["crash-lead", "sentinel-auto", incident.severity || "high", phone ? "has-phone" : "no-phone"],
      notes: [
        `Auto-generated from Sentinel crash ingest.`,
        skipTraceNotes,
        `Type: ${incident.type}`,
        `Location: ${incident.location}`,
        `County: ${incident.county || "Unknown"}`,
        `Severity: ${incident.severity}`,
        `Received: ${incident.received || "Unknown"}`,
        `Google Maps: ${incident.googleMaps || "N/A"}`,
        `Remarks: ${incident.remarks || "None"}`,
        `Crash Report ID: ${report.id} (${report.reportNumber})`,
        `Ingest Trace: ${incident.ingestTraceId || report.ingestTraceId || "N/A"}`,
      ].join("\n"),
      address: incident.location,
      city: incident.county ? `${incident.county} County` : undefined,
      state: "FL",
      lat: incident.lat ?? undefined,
      lng: incident.lng ?? undefined,
    };

    // Create contact in ALL active accounts
    const accountIds = await getActiveAccountIds();
    for (const accountId of accountIds) {
      try {
        await storage.createContact({ subAccountId: accountId, ...contactData });
      } catch (createErr: any) {
        // If contact already exists in this account, that's fine
        if (!createErr.message?.includes("unique") && !createErr.message?.includes("duplicate")) {
          console.warn(`[CRASH-INGEST] Contact creation failed for account ${accountId}:`, createErr.message);
        }
      }
    }

    await storage.markCrashReportAsLead(report.id);

    // Alert all account owners with a phone number (rate limited per account)
    try {
      const { publishEventAsync, EVENT_TYPES } = await import("./eventBus");
      const RATE_LIMIT_MS = 15 * 60 * 1000;
      const now = Date.now();
      if (!(globalThis as any).__sentinelAlertCache) (globalThis as any).__sentinelAlertCache = {};

      if (incident.severity && QUALIFYING_SEVERITIES.has(incident.severity.toLowerCase())) {
        for (const accountId of accountIds) {
          try {
            const account = await storage.getSubAccount(accountId);
            if (!account?.ownerPhone) continue;
            const lastAlertKey = `sentinel_last_alert_${accountId}`;
            const lastAlert = (globalThis as any).__sentinelAlertCache[lastAlertKey] || 0;
            if (now - lastAlert < RATE_LIMIT_MS) continue;
            (globalThis as any).__sentinelAlertCache[lastAlertKey] = now;
            publishEventAsync(EVENT_TYPES.MESSAGE_SENT, {
              subAccountId: accountId,
              to: account.ownerPhone,
              body: `🚨 APEX SENTINEL: New ${incident.severity?.toUpperCase()} injury lead — ${incident.type} in ${incident.county || "FL"}. ${incident.googleMaps || ""}. Check your CRM now.`,
              channel: "sms",
              source: "sentinel_alert",
            }, "crash-ingest-pipeline");
          } catch (_alertErr) { // allow-silent-catch: SMS alert failure must not block lead creation
          }
        }
      }
    } catch (notifyErr: any) {
      console.warn("[CRASH-INGEST] Alert notification failed:", notifyErr.message);
    }

    return true;
  } catch (err: any) {
    console.error(`[CRASH-INGEST] Lead creation failed for report ${report.id} (${report.reportNumber}): ${err.message}`);
    return false;
  }
}

async function runIngestCycle(
  incidents: SentinelIncidentRaw[],
  traceId: string,
  defaultSubAccountId: number,
): Promise<{ inserted: number; skipped: number; skippedDuplicateFhpId: number; existingRawReconciled: number; alreadyConverted: number; leads: number; failed: number }> {
  let inserted = 0;
  let skipped = 0;
  let skippedDuplicateFhpId = 0;
  let existingRawReconciled = 0;
  let alreadyConverted = 0;
  let leads = 0;
  let failed = 0;

  for (const incident of incidents) {
    if (!incident.type || !incident.location) {
      console.warn(`[CRASH-INGEST] Skipping malformed incident id=${incident.id}: missing type or location`);
      failed++;
      continue;
    }

    try {
      const reportNumber = buildReportNumber(incident);
      const existing = await storage.getCrashReportByNumber(reportNumber);
      if (existing) {
        skipped++;
        continue;
      }

      // Secondary dedup keyed on the FHP incident id (raw_payload->>'id'). The
      // FHP HSMV feed legitimately resends the same incident with mutated
      // fields (e.g. updated `received` timestamp, lightly edited `location`
      // string), which produces a different reportNumber hash and slips past
      // the primary dedup above. That is the root cause of the duplicate
      // sentinel_auto rows recovered in Task #176 — every such duplicate
      // orphans one parent's FLHSMV follow-up job because the canonical
      // FLHSMV-FOLLOWUP-<id> report_number can only be created once.
      //
      // Drop silently (the resend carries no new ground truth we trust over
      // what's already in the row) and account for it in cycle stats so the
      // behavior is observable.
      if (incident.id) {
        const existingByFhpId = await storage.getSentinelAutoCrashReportByFhpIncidentId(incident.id);
        if (existingByFhpId) {
          skippedDuplicateFhpId++;
          existingRawReconciled++;
          console.log(
            `[CRASH-INGEST] Existing FHP incident found; raw insert skipped, downstream reconciliation continuing — ` +
            `id=${incident.id} reportId=${existingByFhpId.id} (${existingByFhpId.reportNumber}) ` +
            `processedToLead=${existingByFhpId.processedToLead}; traceId=${traceId}`,
          );
          if (existingByFhpId.processedToLead) {
            alreadyConverted++;
          } else if (isQualifyingCrash(incident)) {
            const leadCreated = await createLeadFromCrash(existingByFhpId, {
              type: incident.type,
              location: incident.location,
              county: incident.county,
              severity: incident.severity,
              received: incident.received,
              remarks: incident.remarks,
              googleMaps: incident.googleMaps,
              lat: incident.lat,
              lng: incident.lng,
              ingestTraceId: traceId,
            }, defaultSubAccountId);
            if (leadCreated) {
              leads++;
              emitCrashLeadCreated(defaultSubAccountId, existingByFhpId.id, incident.severity || "unknown", incident.location || "unknown");
            } else {
              console.warn(`[CRASH-INGEST] Reconciliation lead creation failed for existing report ${existingByFhpId.id} — will retry in recovery pass`);
            }
          }
          continue;
        }
      }

      const rawPayloadValue: Record<string, unknown> = {
        id: incident.id,
        type: incident.type,
        location: incident.location,
        lat: incident.lat,
        lng: incident.lng,
        severity: incident.severity,
        actionRequired: incident.actionRequired,
        source: incident.source,
        state: incident.state,
        county: incident.county ?? null,
        remarks: incident.remarks ?? null,
        received: incident.received ?? null,
        distanceMiles: incident.distanceMiles ?? null,
        googleMaps: incident.googleMaps ?? null,
      };

      const qualifies = isQualifyingCrash(incident);

      // Sentinel parents start as AWAITING with only the raw CAD ping. They are
      // ONLY promoted to COMPLETED inside crashReportWorker.processReport when
      // the matching sentinel_followup job successfully attaches the official
      // FLHSMV detail (driver, insurance, narrative, diagram) via the atomic
      // mergeCrashReportData() write. Stamping COMPLETED here would block the
      // follow-up worker from ever reaching this row — see Task #184.
      const newReport = await storage.createCrashReport({
        reportNumber,
        status: "AWAITING",
        source: "sentinel_auto",
        subAccountId: defaultSubAccountId,
        ingestTraceId: traceId,
        rawPayload: rawPayloadValue,
        processedToLead: !qualifies,
        retryCount: 0,
        serviceFailureCount: 0,
        data: {
          type: incident.type,
          location: incident.location,
          county: incident.county ?? null,
          lat: incident.lat,
          lng: incident.lng,
          severity: incident.severity,
          received: incident.received ?? null,
          remarks: incident.remarks ?? null,
          googleMaps: incident.googleMaps ?? null,
          source: incident.source,
          state: incident.state,
          fetchedAt: new Date().toISOString(),
          ingestTraceId: traceId,
          qualifiesForLead: qualifies,
        },
      });

      if (!newReport) {
        console.error(`[CRASH-INGEST] DB insert returned null for incident ${incident.id}`);
        failed++;
        continue;
      }

      inserted++;
      emitCrashIngested(defaultSubAccountId, newReport.id, incident.severity || "unknown", incident.location || "unknown", qualifies);

      if (qualifies) {
        const leadCreated = await createLeadFromCrash(newReport, {
          type: incident.type,
          location: incident.location,
          county: incident.county,
          severity: incident.severity,
          received: incident.received,
          remarks: incident.remarks,
          googleMaps: incident.googleMaps,
          lat: incident.lat,
          lng: incident.lng,
          ingestTraceId: traceId,
        }, defaultSubAccountId);
        if (leadCreated) {
          leads++;
          emitCrashLeadCreated(defaultSubAccountId, newReport.id, incident.severity || "unknown", incident.location || "unknown");
          import("./operator/apexIntelligence").then(({ reportOutcome }) =>
            reportOutcome({
              agentName:    "crash-ingest",
              action:       "lead_created",
              subject:      "vehicle_crash",
              result:       `Lead created from crash (report #${newReport.id})`,
              confidence:   0.9,
              subAccountId: defaultSubAccountId,
              niche:        "accident",
              metadata:     { reportId: newReport.id, severity: incident.severity, location: incident.location },
            })
          ).catch((err) => console.warn("[CRASHINGESTPIPELINE] promise rejected:", err instanceof Error ? err.message : err));
        } else {
          console.warn(`[CRASH-INGEST] Lead creation failed for new report ${newReport.id} (qualifying) — will retry in recovery pass`);
        }
      } else {
        import("./operator/apexIntelligence").then(({ reportOutcome }) =>
          reportOutcome({
            agentName:    "crash-ingest",
            action:       "crash_ingested",
            subject:      "vehicle_crash",
            result:       `Crash ingested for account ${defaultSubAccountId}`,
            confidence:   0.9,
            subAccountId: defaultSubAccountId,
            niche:        "accident",
            metadata:     { reportId: newReport.id, type: incident.type },
          })
        ).catch((err) => console.warn("[CRASHINGESTPIPELINE] promise rejected:", err instanceof Error ? err.message : err));
        console.log(`[CRASH-INGEST] Non-qualifying crash ${newReport.id} (type=${incident.type}) — processedToLead=true, no lead created`);
      }
    } catch (err: any) {
      console.error(`[CRASH-INGEST] Error processing incident ${incident.id}: ${err.message}`);
      failed++;
    }
  }

  return { inserted, skipped, skippedDuplicateFhpId, existingRawReconciled, alreadyConverted, leads, failed };
}

async function runLeadRecoveryPass(defaultSubAccountId: number): Promise<number> {
  try {
    const unprocessed = await storage.getUnprocessedLeadCrashReports(defaultSubAccountId);
    if (unprocessed.length === 0) return 0;

    console.log(`[CRASH-INGEST] Lead recovery: found ${unprocessed.length} unprocessed sentinel_auto record(s)`);
    let recovered = 0;

    for (const report of unprocessed) {
      const retryCount = (report.retryCount ?? 0);
      if (retryCount >= LEAD_RECOVERY_MAX_RETRIES) {
        console.warn(`[CRASH-INGEST] Lead recovery: skipping report ${report.id} — max retries (${LEAD_RECOVERY_MAX_RETRIES}) exceeded`);
        continue;
      }

      const raw = (report.rawPayload as Record<string, unknown> | null) ?? {};
      const incidentData = {
        type: (raw.type as string) || report.reportNumber,
        location: (raw.location as string) || "",
        county: (raw.county as string | null) ?? null,
        severity: (raw.severity as string) || "high",
        received: (raw.received as string | null) ?? null,
        remarks: (raw.remarks as string | null) ?? null,
        googleMaps: (raw.googleMaps as string | null) ?? null,
        lat: (raw.lat as number | null) ?? null,
        lng: (raw.lng as number | null) ?? null,
        ingestTraceId: report.ingestTraceId,
      };

      if (!incidentData.type || !incidentData.location) {
        console.warn(`[CRASH-INGEST] Lead recovery: skipping report ${report.id} — missing type/location in rawPayload`);
        continue;
      }

      const stillQualifies = (raw.qualifiesForLead as boolean | undefined) ??
        isQualifyingCrash({ type: incidentData.type, severity: incidentData.severity } as SentinelIncidentRaw);

      if (!stillQualifies) {
        console.warn(`[CRASH-INGEST] Lead recovery: report ${report.id} does not qualify for lead — marking processedToLead=true without lead creation`);
        await storage.markCrashReportAsLead(report.id);
        continue;
      }

      const leadCreated = await createLeadFromCrash(report, incidentData, defaultSubAccountId);
      if (leadCreated) {
        recovered++;
        stats.totalLeadsCreated++;
        emitCrashLeadRecovered(defaultSubAccountId, report.id);
        console.log(`[CRASH-INGEST] Lead recovery: successfully created lead for report ${report.id}`);
      } else {
        await storage.updateCrashReport(report.id, { retryCount: retryCount + 1 });
        console.warn(`[CRASH-INGEST] Lead recovery: failed for report ${report.id}, retry ${retryCount + 1}/${LEAD_RECOVERY_MAX_RETRIES}`);
      }
    }

    return recovered;
  } catch (err: any) {
    console.error(`[CRASH-INGEST] Lead recovery pass error: ${err.message}`);
    return 0;
  }
}

async function getDefaultSubAccountId(): Promise<number> {
  try {
    const accounts = await storage.getSubAccounts();
    if (accounts.length > 0) return accounts[0].id;
  } catch (err: any) {
    console.error("[CRASH-INGEST] Could not fetch sub-accounts:", err.message);
  }
  return 1;
}

async function pollCycle(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 12);
  const pollStartDate = new Date();
  const pollStart = pollStartDate.toISOString();
  const pollStartET = toEasternTime(pollStartDate);
  const pollStartMs = pollStartDate.getTime();
  const startMs = Date.now();

  stats.latestPollTime = pollStart;
  stats.latestPollTimeET = pollStartET;
  stats.totalPolls++;

  const prevCursorMs = lastPollCursorMs;

  console.log(
    `[CRASH-INGEST] ── POLL CYCLE START ──` +
    ` traceId=${traceId}` +
    ` pollStart=${pollStart}` +
    ` pollStartET=${pollStartET}` +
    ` lastPollCursor=${prevCursorMs ? new Date(prevCursorMs).toISOString() : "none"}`,
  );

  let feedResult: Awaited<ReturnType<typeof fetchFHPHSMVFeedSafe>> | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    feedResult = await fetchWithBackoff(attempt);
    if (feedResult.status !== "error") break;
    if (attempt < MAX_RETRIES - 1) {
      console.warn(`[CRASH-INGEST] Feed fetch failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${feedResult.error}`);
    }
  }

  if (!feedResult) {
    feedResult = { status: "error", incidents: [], error: "Feed result was null after all retries" };
  }

  const requestSent = new Date().toISOString();
  const countReturned = feedResult.incidents.length;

  console.log(
    `[CRASH-INGEST] requestSent=${requestSent}` +
    ` responseStatus=${feedResult.status}` +
    ` countReturned=${countReturned}` +
    (feedResult.httpStatus ? ` httpStatus=${feedResult.httpStatus}` : "") +
    (feedResult.error ? ` error=${feedResult.error}` : ""),
  );

  if (feedResult.status === "error") {
    stats.consecutiveFailures++;
    stats.lastFailureDetail = feedResult.error || "Unknown feed error";
    stats.lastFailureTime = new Date().toISOString();

    const cycle: PollCycleSummary = {
      traceId, pollStart, pollStartET, requestSent,
      responseStatus: "error",
      httpStatus: feedResult.httpStatus,
      countReturned: 0, countParsed: 0, countInserted: 0,
      countSkipped: 0, countSkippedDuplicateFhpId: 0,
      countExistingRawReconciled: 0, countAlreadyConverted: 0,
      countConvertedToLeads: 0, countFailed: 1,
      pollEnd: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      error: feedResult.error,
      lastPollCursorMs: prevCursorMs ?? undefined,
    };
    recordCycle(cycle);
    console.log(`[CRASH-INGEST] ── POLL CYCLE END (ERROR) ── traceId=${traceId} error=${feedResult.error} durationMs=${cycle.durationMs}`);
    return;
  }

  stats.consecutiveFailures = 0;
  stats.totalCrashesDiscovered += countReturned;

  if (feedResult.status === "empty") {
    lastPollCursorMs = pollStartMs;
    const cycle: PollCycleSummary = {
      traceId, pollStart, pollStartET, requestSent,
      responseStatus: "empty",
      countReturned: 0, countParsed: 0, countInserted: 0,
      countSkipped: 0, countSkippedDuplicateFhpId: 0,
      countExistingRawReconciled: 0, countAlreadyConverted: 0,
      countConvertedToLeads: 0, countFailed: 0,
      pollEnd: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      lastPollCursorMs: prevCursorMs ?? undefined,
    };
    recordCycle(cycle);
    console.log(`[CRASH-INGEST] ── POLL CYCLE END (EMPTY) ── traceId=${traceId} durationMs=${cycle.durationMs}`);
    return;
  }

  const defaultSubAccountId = await getDefaultSubAccountId();
  const { inserted, skipped, skippedDuplicateFhpId, existingRawReconciled, alreadyConverted, leads, failed } = await runIngestCycle(
    feedResult.incidents,
    traceId,
    defaultSubAccountId,
  );

  lastPollCursorMs = pollStartMs;
  stats.totalInserted += inserted;
  stats.totalLeadsCreated += leads;
  if (inserted > 0) {
    stats.lastSuccessfulIngest = new Date().toISOString();
  }

  const pollEnd = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const cycle: PollCycleSummary = {
    traceId, pollStart, pollStartET, requestSent,
    responseStatus: "ok",
    countReturned,
    countParsed: countReturned,
    countInserted: inserted,
    countSkipped: skipped,
    countSkippedDuplicateFhpId: skippedDuplicateFhpId,
    countExistingRawReconciled: existingRawReconciled,
    countAlreadyConverted: alreadyConverted,
    countConvertedToLeads: leads,
    countFailed: failed,
    pollEnd,
    durationMs,
    lastPollCursorMs: prevCursorMs ?? undefined,
  };
  recordCycle(cycle);

  console.log(
    `[CRASH-INGEST] ── POLL CYCLE END ──` +
    ` traceId=${traceId}` +
    ` pollStart=${pollStart}` +
    ` requestSent=${requestSent}` +
    ` responseStatus=ok` +
    ` countReturned=${countReturned}` +
    ` countParsed=${countReturned}` +
    ` countInserted=${inserted}` +
    ` countSkipped=${skipped}` +
    ` countSkippedDuplicateFhpId=${skippedDuplicateFhpId}` +
    ` countExistingRawReconciled=${existingRawReconciled}` +
    ` countAlreadyConverted=${alreadyConverted}` +
    ` countConvertedToLeads=${leads}` +
    ` countFailed=${failed}` +
    ` pollEnd=${pollEnd}` +
    ` durationMs=${durationMs}`,
  );
}

let pipelineRunning = false;
let pipelineInterval: ReturnType<typeof setInterval> | null = null;
let leadRecoveryInterval: ReturnType<typeof setInterval> | null = null;

export function startCrashIngestPipeline(): void {
  if (pipelineRunning) {
    console.log("[CRASH-INGEST] Pipeline already running");
    return;
  }
  pipelineRunning = true;

  console.log(`[CRASH-INGEST] Pipeline started (id=${PIPELINE_ID}) — polling every ${POLL_INTERVAL_MS / 1000}s, dedup via SHA-256 report hash`);

  const tick = async () => {
    try {
      await pollCycle();
    } catch (err: any) {
      console.error("[CRASH-INGEST] Unexpected tick error:", err.message);
    }
  };

  const leadRecoveryTick = async () => {
    try {
      const defaultSubAccountId = await getDefaultSubAccountId();
      const recovered = await runLeadRecoveryPass(defaultSubAccountId);
      stats.lastLeadRecovery = new Date().toISOString();
      stats.lastLeadRecoveryCount = recovered;
      if (recovered > 0) {
        console.log(`[CRASH-INGEST] Lead recovery pass complete: ${recovered} lead(s) recovered`);
      }
    } catch (err: any) {
      console.error("[CRASH-INGEST] Lead recovery tick error:", err.message);
    }
  };

  tick();
  pipelineInterval = setInterval(tick, POLL_INTERVAL_MS);

  leadRecoveryInterval = setInterval(leadRecoveryTick, LEAD_RECOVERY_INTERVAL_MS);
}

export function stopCrashIngestPipeline(): void {
  if (pipelineInterval) {
    clearInterval(pipelineInterval);
    pipelineInterval = null;
  }
  if (leadRecoveryInterval) {
    clearInterval(leadRecoveryInterval);
    leadRecoveryInterval = null;
  }
  pipelineRunning = false;
  console.log("[CRASH-INGEST] Pipeline stopped");
}

/**
 * Backfill reconciliation: scan all sentinel_auto crash reports from the last
 * `daysBack` days that still have processedToLead=false and attempt downstream
 * lead creation for any that qualify.  Safe to run multiple times — the
 * createLeadFromCrash path is idempotent (duplicate contacts are silently skipped).
 *
 * Usage: npx tsx server/crashIngestPipeline.ts --backfill
 */
export async function runBackfillReconcile(daysBack = 30): Promise<{ examined: number; converted: number; alreadyDone: number; skippedNoQualify: number; failed: number }> {
  const defaultSubAccountId = await getDefaultSubAccountId();
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  console.log(`[CRASH-INGEST] Backfill reconcile — scanning sentinel_auto reports since ${since.toISOString()} (${daysBack}d)`);

  let examined = 0;
  let converted = 0;
  let alreadyDone = 0;
  let skippedNoQualify = 0;
  let failed = 0;

  try {
    const reports = await storage.getUnprocessedLeadCrashReports(defaultSubAccountId);
    examined = reports.length;
    console.log(`[CRASH-INGEST] Backfill: ${examined} unprocessed report(s) found`);

    for (const report of reports) {
      const raw = (report.rawPayload as Record<string, unknown> | null) ?? {};
      const incidentData = {
        type: (raw.type as string) || report.reportNumber,
        location: (raw.location as string) || "",
        county: (raw.county as string | null) ?? null,
        severity: (raw.severity as string) || "high",
        received: (raw.received as string | null) ?? null,
        remarks: (raw.remarks as string | null) ?? null,
        googleMaps: (raw.googleMaps as string | null) ?? null,
        lat: (raw.lat as number | null) ?? null,
        lng: (raw.lng as number | null) ?? null,
        ingestTraceId: report.ingestTraceId,
      };

      if (report.processedToLead) {
        alreadyDone++;
        continue;
      }

      const qualifies = (raw.qualifiesForLead as boolean | undefined) ??
        isQualifyingCrash({ type: incidentData.type, severity: incidentData.severity } as SentinelIncidentRaw);

      if (!qualifies) {
        skippedNoQualify++;
        await storage.markCrashReportAsLead(report.id);
        continue;
      }

      try {
        const leadCreated = await createLeadFromCrash(report, incidentData, defaultSubAccountId);
        if (leadCreated) {
          converted++;
          console.log(`[CRASH-INGEST] Backfill: converted report ${report.id} (${report.reportNumber})`);
        } else {
          failed++;
          console.warn(`[CRASH-INGEST] Backfill: lead creation failed for report ${report.id}`);
        }
      } catch (err: any) {
        failed++;
        console.error(`[CRASH-INGEST] Backfill: error on report ${report.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[CRASH-INGEST] Backfill reconcile error: ${err.message}`);
  }

  console.log(`[CRASH-INGEST] Backfill complete — examined=${examined} converted=${converted} alreadyDone=${alreadyDone} skippedNoQualify=${skippedNoQualify} failed=${failed}`);
  return { examined, converted, alreadyDone, skippedNoQualify, failed };
}

if (process.argv.includes("--backfill")) {
  runBackfillReconcile(30).then(result => {
    console.log("[CRASH-INGEST] Backfill result:", JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error("[CRASH-INGEST] Backfill failed:", err);
    process.exit(1);
  });
}

export async function runTestHarness(
  scenario: "success" | "empty" | "malformed" | "transient_failure" | "duplicate",
): Promise<{
  scenario: string;
  traceId: string;
  inserted: number;
  skipped: number;
  leads: number;
  failed: number;
  details: Array<{ id?: string; reportNumber?: string; type?: string; location?: string; severity?: string; outcome?: string; error?: string }>;
  cycleSummary: PollCycleSummary;
}> {
  const traceId = `TEST-${crypto.randomUUID().slice(0, 8)}`;
  const pollStart = new Date().toISOString();
  const pollStartET = toEasternTime(new Date());
  const startMs = Date.now();

  const sampleIncidents: SentinelIncidentRaw[] = [
    {
      id: `FHP-LEE-test001-${traceId}`,
      type: "CRASH WITH INJURIES",
      location: "I-75 NB MM 131, LEE County, FL",
      lat: 26.6406,
      lng: -81.8723,
      severity: "critical",
      actionRequired: true,
      source: "fhp_hsmv",
      state: "FL",
      county: "LEE",
      remarks: "Multiple vehicles involved, injuries reported, FHP on scene",
      received: new Date().toISOString(),
      distanceMiles: "5.2",
      googleMaps: "https://www.google.com/maps?q=26.6406,-81.8723",
    },
    {
      id: `FHP-COLLIER-test002-${traceId}`,
      type: "FATAL CRASH",
      location: "US-41 at Collier Blvd, COLLIER County, FL",
      lat: 26.1420,
      lng: -81.7948,
      severity: "critical",
      actionRequired: true,
      source: "fhp_hsmv",
      state: "FL",
      county: "COLLIER",
      remarks: "Fatality reported, road blocked",
      received: new Date().toISOString(),
      distanceMiles: "12.8",
      googleMaps: "https://www.google.com/maps?q=26.1420,-81.7948",
    },
    {
      id: `FHP-CHARLOTTE-test003-${traceId}`,
      type: "ROLLOVER WITH ENTRAPMENT",
      location: "SR-776 near Kings Hwy, CHARLOTTE County, FL",
      lat: 26.9637,
      lng: -82.0785,
      severity: "critical",
      actionRequired: true,
      source: "fhp_hsmv",
      state: "FL",
      county: "CHARLOTTE",
      remarks: "Entrapment, extrication in progress",
      received: new Date().toISOString(),
      distanceMiles: "18.1",
      googleMaps: "https://www.google.com/maps?q=26.9637,-82.0785",
    },
  ];

  const details: Array<{ id?: string; reportNumber?: string; type?: string; location?: string; severity?: string; outcome?: string; error?: string }> = [];

  if (scenario === "empty") {
    const cycle: PollCycleSummary = {
      traceId, pollStart, pollStartET, requestSent: new Date().toISOString(),
      responseStatus: "empty",
      countReturned: 0, countParsed: 0, countInserted: 0, countSkipped: 0,
      countSkippedDuplicateFhpId: 0,
      countConvertedToLeads: 0, countFailed: 0,
      pollEnd: new Date().toISOString(), durationMs: Date.now() - startMs,
    };
    console.log(`[CRASH-INGEST] TEST-HARNESS scenario=empty traceId=${traceId}`);
    return { scenario, traceId, inserted: 0, skipped: 0, leads: 0, failed: 0, details, cycleSummary: cycle };
  }

  if (scenario === "malformed") {
    const malformedIncidents = [
      { id: "malformed-001", type: "", location: "", lat: NaN, lng: NaN, severity: "", actionRequired: false, source: "fhp_hsmv", state: "FL" },
    ] as SentinelIncidentRaw[];
    let failed = 0;
    for (const inc of malformedIncidents) {
      if (!inc.type || !inc.location) {
        failed++;
        details.push({ id: inc.id, outcome: "rejected", error: "Malformed incident: missing type or location" });
        console.warn(`[CRASH-INGEST] TEST-HARNESS malformed incident rejected id=${inc.id}: missing type or location`);
      }
    }
    const cycle: PollCycleSummary = {
      traceId, pollStart, pollStartET, requestSent: new Date().toISOString(),
      responseStatus: "error",
      countReturned: malformedIncidents.length, countParsed: 0, countInserted: 0,
      countSkipped: 0, countSkippedDuplicateFhpId: 0, countConvertedToLeads: 0, countFailed: failed,
      pollEnd: new Date().toISOString(), durationMs: Date.now() - startMs,
      error: "Malformed payload test — all incidents rejected at validation stage",
    };
    console.log(`[CRASH-INGEST] TEST-HARNESS scenario=malformed traceId=${traceId} countFailed=${failed}`);
    return { scenario, traceId, inserted: 0, skipped: 0, leads: 0, failed, details, cycleSummary: cycle };
  }

  if (scenario === "transient_failure") {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      console.warn(`[CRASH-INGEST] TEST-HARNESS transient_failure: Simulated HTTP 503 (attempt ${attempt + 1}/${MAX_RETRIES})`);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    const cycle: PollCycleSummary = {
      traceId, pollStart, pollStartET, requestSent: new Date().toISOString(),
      responseStatus: "error",
      countReturned: 0, countParsed: 0, countInserted: 0,
      countSkipped: 0, countSkippedDuplicateFhpId: 0, countConvertedToLeads: 0, countFailed: MAX_RETRIES,
      pollEnd: new Date().toISOString(), durationMs: Date.now() - startMs,
      error: `Simulated transient HTTP failure after ${MAX_RETRIES} attempts with exponential backoff`,
    };
    console.log(`[CRASH-INGEST] TEST-HARNESS scenario=transient_failure traceId=${traceId} exhausted ${MAX_RETRIES} attempts`);
    return { scenario, traceId, inserted: 0, skipped: 0, leads: 0, failed: MAX_RETRIES, details, cycleSummary: cycle };
  }

  const incidentsToProcess = scenario === "duplicate"
    ? [...sampleIncidents, ...sampleIncidents]
    : sampleIncidents;

  const defaultSubAccountId = await getDefaultSubAccountId();

  const { inserted, skipped, skippedDuplicateFhpId, leads, failed } = await runIngestCycle(
    incidentsToProcess,
    traceId,
    defaultSubAccountId,
  );

  for (const inc of incidentsToProcess) {
    const reportNumber = buildReportNumber(inc);
    details.push({ id: inc.id, reportNumber, type: inc.type, location: inc.location, severity: inc.severity });
  }

  const pollEnd = new Date().toISOString();
  const cycle: PollCycleSummary = {
    traceId, pollStart, pollStartET, requestSent: pollStart,
    responseStatus: "ok",
    countReturned: incidentsToProcess.length,
    countParsed: incidentsToProcess.length,
    countInserted: inserted,
    countSkipped: skipped,
    countSkippedDuplicateFhpId: skippedDuplicateFhpId,
    countConvertedToLeads: leads,
    countFailed: failed,
    pollEnd,
    durationMs: Date.now() - startMs,
    lastPollCursorMs: lastPollCursorMs ?? undefined,
  };
  recordCycle(cycle);

  stats.totalInserted += inserted;
  stats.totalLeadsCreated += leads;
  if (inserted > 0) stats.lastSuccessfulIngest = pollEnd;

  console.log(
    `[CRASH-INGEST] TEST-HARNESS scenario=${scenario} traceId=${traceId}` +
    ` inserted=${inserted} skipped=${skipped} skippedDuplicateFhpId=${skippedDuplicateFhpId} leads=${leads} failed=${failed}`,
  );

  return { scenario, traceId, inserted, skipped, leads, failed, details, cycleSummary: cycle };
}
