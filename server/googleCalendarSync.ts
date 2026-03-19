import { google } from "googleapis";
import { db } from "./db";
import { appointments, contacts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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

const SYNC_INTERVAL_MS = 3 * 60 * 1000;
const TARGET_ACCOUNTS = [13, 14];
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

async function runAutoSync(): Promise<void> {
  for (const subAccountId of TARGET_ACCOUNTS) {
    try {
      const result = await syncGoogleCalendar(subAccountId, "primary");
      if (result.created > 0 || result.updated > 0) {
        console.log(`[GCAL-AUTO] Account ${subAccountId}: +${result.created} new, ~${result.updated} updated`);
      }
    } catch (err) {
      console.warn(`[GCAL-AUTO] Sync failed for account ${subAccountId}:`, (err as any).message);
    }
  }
}

export function startAutoSync(): void {
  if (autoSyncTimer) return;
  console.log(`[GCAL-AUTO] Background sync started — polling every ${SYNC_INTERVAL_MS / 1000}s`);
  runAutoSync().catch(() => {});
  autoSyncTimer = setInterval(() => { runAutoSync().catch(() => {}); }, SYNC_INTERVAL_MS);
}

export function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
    console.log("[GCAL-AUTO] Background sync stopped");
  }
}
