import { google } from "googleapis";
import { db } from "./db";
import { appointments, contacts, subAccounts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// --- Replit Google Calendar Integration (handles token refresh automatically) ---
let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (connectionSettings && connectionSettings.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) throw new Error("X-Replit-Token not found");

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=google-calendar",
    { headers: { Accept: "application/json", "X-Replit-Token": xReplitToken } },
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error("Google Calendar not connected");
  return accessToken;
}

async function getCalendarClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

// --- Public API ---

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const cal = await getCalendarClient();
  const res = await cal.calendarList.list();
  return (res.data.items || []).map(c => ({
    id: c.id || "",
    summary: c.summary || c.id || "",
    primary: !!c.primary,
  }));
}

export async function syncGoogleCalendar(
  subAccountId: number,
  calendarId: string = "primary",
): Promise<{ synced: number; created: number; updated: number; skipped: number }> {
  const cal = await getCalendarClient();

  const res = await cal.events.list({
    calendarId,
    maxResults: 100,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const events = res.data.items || [];
  console.log(`[GCAL-SYNC] Fetched ${events.length} events from "${calendarId}" for account ${subAccountId}`);

  let created = 0, updated = 0, skipped = 0;

  for (const event of events) {
    if (!event.id || !event.summary) { skipped++; continue; }
    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    if (!startTime || !endTime) { skipped++; continue; }

    if (event.status === "cancelled") {
      const existing = await db.select().from(appointments)
        .where(and(eq(appointments.googleCalendarEventId, event.id), eq(appointments.subAccountId, subAccountId)))
        .limit(1);
      if (existing[0]) {
        await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, existing[0].id));
        updated++;
      }
      continue;
    }

    let contactId: number | null = null;
    if (event.attendees?.length) {
      for (const att of event.attendees) {
        if (att.email) {
          const rows = await db.select().from(contacts)
            .where(and(eq(contacts.email, att.email), eq(contacts.subAccountId, subAccountId)))
            .limit(1);
          if (rows[0]) { contactId = rows[0].id; break; }
        }
      }
    }

    const existing = await db.select().from(appointments)
      .where(and(eq(appointments.googleCalendarEventId, event.id), eq(appointments.subAccountId, subAccountId)))
      .limit(1);

    if (existing[0]) {
      await db.update(appointments).set({
        title: event.summary,
        description: event.description || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        location: event.location || null,
        contactId: contactId || existing[0].contactId,
      }).where(eq(appointments.id, existing[0].id));
      updated++;
    } else {
      await db.insert(appointments).values({
        subAccountId,
        title: event.summary,
        description: event.description || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: "scheduled",
        location: event.location || null,
        googleCalendarEventId: event.id,
        googleCalendarId: calendarId,
        contactId,
      });
      created++;

      try {
        const { fireAutomationTriggerGlobal } = await import("./routes/v1");
        fireAutomationTriggerGlobal("appointment_booked", subAccountId, {
          appointmentTitle: event.summary,
          appointmentTime: startTime,
          contactId,
          source: "google_calendar",
        });
      } catch {}
    }
  }

  console.log(`[GCAL-SYNC] Account ${subAccountId}: created=${created}, updated=${updated}, skipped=${skipped}`);
  return { synced: events.length, created, updated, skipped };
}

// --- Auto-sync background loop ---
//
// HARDENED: Auto-sync runs ONLY for sub-accounts whose `config.googleCalendarSync.enabled`
// is `true`. No hardcoded account IDs. To enable/disable for a sub-account, set the
// config flag (POST /api/calendar/sync-config/:subAccountId).

const SYNC_INTERVAL_MS = 3_600_000;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

export interface CalendarSyncStatus {
  enabled: boolean;
  calendarId: string;
  lastSyncAt: string | null;
  lastSyncResult: { created: number; updated: number; skipped: number } | null;
  lastSyncError: string | null;
}

export async function getCalendarSyncStatus(subAccountId: number): Promise<CalendarSyncStatus> {
  const [row] = await db.select({ config: subAccounts.config })
    .from(subAccounts).where(eq(subAccounts.id, subAccountId)).limit(1);
  const cfg = ((row?.config as any)?.googleCalendarSync) || {};
  return {
    enabled: cfg.enabled === true,
    calendarId: typeof cfg.calendarId === "string" && cfg.calendarId ? cfg.calendarId : "primary",
    lastSyncAt: cfg.lastSyncAt || null,
    lastSyncResult: cfg.lastSyncResult || null,
    lastSyncError: cfg.lastSyncError || null,
  };
}

export async function setCalendarSyncEnabled(
  subAccountId: number,
  enabled: boolean,
  calendarId?: string,
): Promise<CalendarSyncStatus> {
  // Atomic JSONB deep-merge — avoids the read-modify-write race where two
  // concurrent updaters (e.g. health checker + admin toggle) overwrite each
  // other's changes. We only need the existing calendarId when no override
  // is provided, so we read it once but the WRITE itself is a single
  // jsonb_set targeting only the googleCalendarSync subtree.
  const patch: Record<string, any> = { enabled };
  if (calendarId) {
    patch.calendarId = calendarId;
  } else {
    const [row] = await db.select({ config: subAccounts.config })
      .from(subAccounts).where(eq(subAccounts.id, subAccountId)).limit(1);
    const prevCalId = (row?.config as any)?.googleCalendarSync?.calendarId;
    patch.calendarId = prevCalId || "primary";
  }
  const patchJson = JSON.stringify(patch);
  await db.execute(sql`
    UPDATE sub_accounts
    SET config = jsonb_set(
      COALESCE(config, '{}'::jsonb),
      '{googleCalendarSync}',
      COALESCE(config->'googleCalendarSync', '{}'::jsonb) || ${patchJson}::jsonb,
      true
    )
    WHERE id = ${subAccountId}
  `);
  return getCalendarSyncStatus(subAccountId);
}

async function persistSyncResult(
  subAccountId: number,
  result: { created: number; updated: number; skipped: number } | null,
  error: string | null,
): Promise<void> {
  try {
    // Atomic JSONB merge — only touches the googleCalendarSync subtree, so
    // an admin toggling enabled / calendarId at the same instant cannot
    // clobber our sync timestamps and vice-versa.
    const patch = {
      lastSyncAt: new Date().toISOString(),
      lastSyncResult: result,
      lastSyncError: error,
    };
    const patchJson = JSON.stringify(patch);
    await db.execute(sql`
      UPDATE sub_accounts
      SET config = jsonb_set(
        COALESCE(config, '{}'::jsonb),
        '{googleCalendarSync}',
        COALESCE(config->'googleCalendarSync', '{}'::jsonb) || ${patchJson}::jsonb,
        true
      )
      WHERE id = ${subAccountId}
    `);
  } catch (e: any) {
    console.warn(`[GCAL-AUTO] Failed to persist sync result for ${subAccountId}: ${e.message}`);
  }
}

async function getSyncEnabledAccounts(): Promise<Array<{ id: number; calendarId: string }>> {
  // jsonb path query: config->'googleCalendarSync'->>'enabled' = 'true'
  const rows = await db.execute<{ id: number; calendar_id: string | null }>(sql`
    SELECT id, COALESCE(config->'googleCalendarSync'->>'calendarId', 'primary') AS calendar_id
    FROM sub_accounts
    WHERE config->'googleCalendarSync'->>'enabled' = 'true'
  `);
  return (rows.rows || []).map(r => ({ id: r.id, calendarId: r.calendar_id || "primary" }));
}

async function runAutoSync(): Promise<void> {
  let enabledAccounts: Array<{ id: number; calendarId: string }> = [];
  try {
    enabledAccounts = await getSyncEnabledAccounts();
  } catch (err: any) {
    console.warn(`[GCAL-AUTO] Failed to fetch sync-enabled accounts: ${err.message}`);
    return;
  }
  if (enabledAccounts.length === 0) return;
  console.log(`[GCAL-AUTO] Polling ${enabledAccounts.length} sync-enabled account(s)`);
  for (const { id: subAccountId, calendarId } of enabledAccounts) {
    try {
      const result = await syncGoogleCalendar(subAccountId, calendarId);
      await persistSyncResult(subAccountId, result, null);
      if (result.created > 0 || result.updated > 0) {
        console.log(`[GCAL-AUTO] Account ${subAccountId}: +${result.created} new, ~${result.updated} updated`);
      }
    } catch (err) {
      const msg = (err as any).message || String(err);
      console.warn(`[GCAL-AUTO] Sync failed for account ${subAccountId}: ${msg}`);
      await persistSyncResult(subAccountId, null, msg);
    }
  }
}

/**
 * One-time backfill: any sub-account that already has at least one appointment
 * synced from Google Calendar (googleCalendarEventId IS NOT NULL) has been
 * relying on the previously-hardcoded [13,14] auto-sync. Mark them as
 * sync-enabled so we preserve their behaviour without re-introducing the
 * hardcoded list. Idempotent — runs at startup, no-op once flagged.
 */
async function backfillSyncEnabledFromHistory(): Promise<void> {
  try {
    const rows = await db.execute<{ sub_account_id: number }>(sql`
      SELECT DISTINCT a.sub_account_id
      FROM appointments a
      JOIN sub_accounts s ON s.id = a.sub_account_id
      WHERE a.google_calendar_event_id IS NOT NULL
        AND (s.config->'googleCalendarSync'->>'enabled') IS NULL
    `);
    const ids = (rows.rows || []).map(r => r.sub_account_id);
    if (ids.length === 0) {
      console.log("[GCAL-AUTO] Backfill: no accounts with prior gcal history needing flag");
      return;
    }
    console.log(`[GCAL-AUTO] Backfill: enabling sync for ${ids.length} account(s) with prior gcal history: ${ids.join(", ")}`);
    for (const id of ids) {
      try {
        await setCalendarSyncEnabled(id, true);
      } catch (e: any) {
        console.warn(`[GCAL-AUTO] Backfill failed for account ${id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.warn(`[GCAL-AUTO] Backfill query failed: ${e.message}`);
  }
}

export function startAutoSync(): void {
  if (autoSyncTimer) return;
  console.log(`[GCAL-AUTO] Background sync started — polling every ${SYNC_INTERVAL_MS / 1000}s (config-gated, no hardcoded accounts)`);
  backfillSyncEnabledFromHistory()
    .then(() => runAutoSync())
    .catch(() => {});
  autoSyncTimer = setInterval(() => { runAutoSync().catch(() => {}); }, SYNC_INTERVAL_MS);
}

export function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
    console.log("[GCAL-AUTO] Background sync stopped");
  }
}
