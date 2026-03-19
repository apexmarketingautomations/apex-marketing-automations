import { db } from "./db";
import { appointments, contacts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "./storage";

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  htmlLink?: string;
  created?: string;
  updated?: string;
}

interface CalendarListResponse {
  items?: Array<{ id: string; summary?: string; primary?: boolean }>;
}

interface EventsListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

async function refreshViaGoogleCalendarClientCreds(subAccountId: number): Promise<string | null> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const { getValidToken } = await import("./tokenService");
    const token = await getValidToken(subAccountId, "google");
    if (token?.accessToken) return token.accessToken;
  } catch {}
  return null;
}

export async function getCalendarAccessToken(subAccountId: number): Promise<string | null> {
  try {
    const { getValidToken } = await import("./tokenService");
    const token = await getValidToken(subAccountId, "google");
    if (token?.accessToken) return token.accessToken;
  } catch (err) {
    console.warn("[GCAL-SYNC] Failed to get token from tokenService:", (err as any).message);
  }

  return refreshViaGoogleCalendarClientCreds(subAccountId);
}

export async function seedGoogleCalendarToken(accessToken: string, refreshToken: string, subAccountIds: number[] = [13, 14]): Promise<void> {
  for (const subAccountId of subAccountIds) {
    try {
      await storage.upsertOAuthToken({
        provider: "google",
        subAccountId,
        accessToken,
        refreshToken,
        tokenExpiry: new Date(Date.now() + 3600 * 1000),
        scopes: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        providerEmail: "apexmarketingautomations@gmail.com",
        providerAccountId: "",
        connectionType: "replit_integration",
      });
      console.log(`[GCAL-SYNC] Seeded Google Calendar token for account ${subAccountId}`);
    } catch (err) {
      console.warn(`[GCAL-SYNC] Failed to seed token for account ${subAccountId}:`, (err as any).message);
    }
  }
}

export async function listCalendars(accessToken: string): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list calendars: ${res.status} ${errText}`);
  }
  const data = await res.json() as CalendarListResponse;
  return (data.items || []).map(c => ({
    id: c.id,
    summary: c.summary || c.id,
    primary: !!c.primary,
  }));
}

export async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string = "primary",
  timeMin?: string,
  timeMax?: string,
  maxResults: number = 100,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  if (timeMin) params.set("timeMin", timeMin);
  else params.set("timeMin", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  if (timeMax) params.set("timeMax", timeMax);
  else params.set("timeMax", new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString());

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch events: ${res.status} ${errText}`);
  }
  const data = await res.json() as EventsListResponse;
  return data.items || [];
}

export async function syncGoogleCalendar(
  subAccountId: number,
  calendarId: string = "primary",
  accessToken?: string,
): Promise<{ synced: number; created: number; updated: number; skipped: number }> {
  const token = accessToken || await getCalendarAccessToken(subAccountId);
  if (!token) {
    throw new Error("No Google Calendar access token available");
  }

  const events = await fetchCalendarEvents(token, calendarId);
  console.log(`[GCAL-SYNC] Fetched ${events.length} events from calendar "${calendarId}" for account ${subAccountId}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.id || !event.summary) {
      skipped++;
      continue;
    }

    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    if (!startTime || !endTime) {
      skipped++;
      continue;
    }

    if (event.status === "cancelled") {
      const existing = await db.select().from(appointments)
        .where(and(
          eq(appointments.googleCalendarEventId, event.id),
          eq(appointments.subAccountId, subAccountId),
        )).limit(1);
      if (existing[0]) {
        await db.update(appointments)
          .set({ status: "cancelled" })
          .where(eq(appointments.id, existing[0].id));
        updated++;
      }
      continue;
    }

    let contactId: number | null = null;
    if (event.attendees?.length) {
      for (const att of event.attendees) {
        if (att.email) {
          const contactRows = await db.select().from(contacts)
            .where(and(
              eq(contacts.email, att.email),
              eq(contacts.subAccountId, subAccountId),
            )).limit(1);
          if (contactRows[0]) {
            contactId = contactRows[0].id;
            break;
          }
        }
      }
    }

    const appointmentData = {
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
    };

    const existing = await db.select().from(appointments)
      .where(and(
        eq(appointments.googleCalendarEventId, event.id),
        eq(appointments.subAccountId, subAccountId),
      )).limit(1);

    if (existing[0]) {
      await db.update(appointments)
        .set({
          title: appointmentData.title,
          description: appointmentData.description,
          startTime: appointmentData.startTime,
          endTime: appointmentData.endTime,
          location: appointmentData.location,
          contactId: contactId || existing[0].contactId,
        })
        .where(eq(appointments.id, existing[0].id));
      updated++;
    } else {
      await db.insert(appointments).values(appointmentData);
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
