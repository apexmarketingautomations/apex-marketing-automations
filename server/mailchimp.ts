import { db } from "./db";
import { storage } from "./storage";
import { mailchimpEmailLogs, mailchimpSyncLogs, integrationConnections } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const LOG_PREFIX = "[MAILCHIMP]";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

interface MailchimpConfig {
  apiKey: string;
  serverPrefix: string;
  audienceId: string;
}

interface MailchimpContact {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  source?: string;
  tags?: string[];
}

const TEMPLATE_KEYS = {
  LEAD_FOLLOW_UP: "lead_follow_up",
  CALL_CONFIRMATION: "call_confirmation",
  NO_RESPONSE: "no_response",
  OFFER_PROMO: "offer_promo",
  REACTIVATION: "reactivation",
  APPOINTMENT_CONFIRMATION: "appointment_confirmation",
} as const;

type TemplateKey = typeof TEMPLATE_KEYS[keyof typeof TEMPLATE_KEYS];

const DEFAULT_SUBJECTS: Record<TemplateKey, string> = {
  [TEMPLATE_KEYS.LEAD_FOLLOW_UP]: "Thanks for reaching out, {{first_name}}!",
  [TEMPLATE_KEYS.CALL_CONFIRMATION]: "Your call is confirmed, {{first_name}}",
  [TEMPLATE_KEYS.NO_RESPONSE]: "We haven't heard from you, {{first_name}}",
  [TEMPLATE_KEYS.OFFER_PROMO]: "A special offer just for you, {{first_name}}",
  [TEMPLATE_KEYS.REACTIVATION]: "We miss you, {{first_name}}!",
  [TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION]: "Your appointment is booked, {{first_name}}!",
};

async function getMailchimpConfig(subAccountId: number): Promise<MailchimpConfig | null> {
  try {
    const connection = await storage.getIntegrationConnection(subAccountId, "mailchimp");
    if (!connection || connection.status !== "connected" || !connection.config) return null;

    const cfg = connection.config as Record<string, any>;
    const apiKey = cfg.apiKey;
    if (!apiKey) return null;

    const serverPrefix = cfg.serverPrefix || apiKey.split("-").pop();
    const audienceId = cfg.audienceId;
    if (!serverPrefix || !audienceId) return null;

    return { apiKey, serverPrefix, audienceId };
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Config fetch failed for account ${subAccountId}:`, err.message);
    return null;
  }
}

async function mcFetch(
  config: MailchimpConfig,
  path: string,
  method: string = "GET",
  body?: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const url = `https://${config.serverPrefix}.api.mailchimp.com/3.0${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(10000) };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  return { ok: res.ok, status: res.status, data };
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`${LOG_PREFIX} ${label} attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError!;
}

function emailHash(email: string): string {
  return crypto.createHash("md5").update(email.toLowerCase().trim()).digest("hex");
}

function getBookingLink(account: any): string | null {
  const aiConfig = account.aiPromptConfig as Record<string, any> | null;
  const config = account.config as Record<string, any> | null;
  return aiConfig?.bookingLink || config?.bookingLink || null;
}

async function logSync(
  subAccountId: number,
  contactId: number | null,
  action: string,
  status: string,
  details?: any
) {
  try {
    await db.insert(mailchimpSyncLogs).values({
      subAccountId,
      contactId,
      action,
      status,
      details: details || null,
    });
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Sync log write failed:`, err.message);
  }
}

async function logEmail(
  subAccountId: number,
  contactId: number | null,
  email: string,
  templateKey: string,
  eventType: string,
  status: string,
  campaignId?: string,
  errorMessage?: string,
  metadata?: any
) {
  try {
    await db.insert(mailchimpEmailLogs).values({
      subAccountId,
      contactId,
      email,
      templateKey,
      eventType,
      status,
      campaignId: campaignId || null,
      errorMessage: errorMessage || null,
      metadata: metadata || null,
    });
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Email log write failed:`, err.message);
  }
}

export async function syncContactToMailchimp(
  subAccountId: number,
  contact: MailchimpContact,
  contactId?: number
): Promise<boolean> {
  const config = await getMailchimpConfig(subAccountId);
  if (!config) {
    console.log(`${LOG_PREFIX} No Mailchimp config for account ${subAccountId}, skipping sync`);
    return false;
  }

  if (!contact.email) {
    console.log(`${LOG_PREFIX} Contact has no email, skipping sync`);
    return false;
  }

  const hash = emailHash(contact.email);

  try {
    const result = await withRetry(async () => {
      const mergeFields: Record<string, string> = {};
      if (contact.firstName) mergeFields.FNAME = contact.firstName;
      if (contact.lastName) mergeFields.LNAME = contact.lastName;
      if (contact.phone) mergeFields.PHONE = contact.phone;

      const body: any = {
        email_address: contact.email.toLowerCase().trim(),
        status_if_new: "subscribed",
        merge_fields: mergeFields,
      };

      const res = await mcFetch(
        config,
        `/lists/${config.audienceId}/members/${hash}`,
        "PUT",
        body
      );

      if (!res.ok) {
        throw new Error(`Mailchimp upsert failed: ${res.status} — ${JSON.stringify(res.data)}`);
      }

      return res;
    }, `contact_sync:${contact.email}`);

    console.log(`${LOG_PREFIX} Contact synced: ${contact.email} (account ${subAccountId})`);
    await logSync(subAccountId, contactId || null, "contact_synced", "success", {
      email: contact.email,
      mailchimpId: result.data?.id,
    });

    if (contact.tags && contact.tags.length > 0) {
      await applyTagsToContact(subAccountId, contact.email, contact.tags, contactId);
    }

    return true;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Contact sync FAILED for ${contact.email}:`, err.message);
    await logSync(subAccountId, contactId || null, "contact_synced", "error", {
      email: contact.email,
      error: err.message,
    });
    return false;
  }
}

export async function applyTagsToContact(
  subAccountId: number,
  email: string,
  tags: string[],
  contactId?: number
): Promise<boolean> {
  const config = await getMailchimpConfig(subAccountId);
  if (!config || !email || tags.length === 0) return false;

  const hash = emailHash(email);

  try {
    await withRetry(async () => {
      const tagBody = {
        tags: tags.map(t => ({ name: t, status: "active" })),
      };

      const res = await mcFetch(
        config,
        `/lists/${config.audienceId}/members/${hash}/tags`,
        "POST",
        tagBody
      );

      if (!res.ok) {
        throw new Error(`Tag apply failed: ${res.status} — ${JSON.stringify(res.data)}`);
      }

      return res;
    }, `tag_apply:${email}`);

    console.log(`${LOG_PREFIX} Tags applied to ${email}: [${tags.join(", ")}]`);
    await logSync(subAccountId, contactId || null, "tag_applied", "success", {
      email,
      tags,
    });
    return true;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Tag apply FAILED for ${email}:`, err.message);
    await logSync(subAccountId, contactId || null, "tag_applied", "error", {
      email,
      tags,
      error: err.message,
    });
    return false;
  }
}

export async function removeTagsFromContact(
  subAccountId: number,
  email: string,
  tags: string[],
  contactId?: number
): Promise<boolean> {
  const config = await getMailchimpConfig(subAccountId);
  if (!config || !email || tags.length === 0) return false;

  const hash = emailHash(email);

  try {
    await withRetry(async () => {
      const tagBody = {
        tags: tags.map(t => ({ name: t, status: "inactive" })),
      };

      const res = await mcFetch(
        config,
        `/lists/${config.audienceId}/members/${hash}/tags`,
        "POST",
        tagBody
      );

      if (!res.ok) {
        throw new Error(`Tag remove failed: ${res.status} — ${JSON.stringify(res.data)}`);
      }

      return res;
    }, `tag_remove:${email}`);

    console.log(`${LOG_PREFIX} Tags removed from ${email}: [${tags.join(", ")}]`);
    await logSync(subAccountId, contactId || null, "tag_removed", "success", {
      email,
      tags,
    });
    return true;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Tag remove FAILED for ${email}:`, err.message);
    await logSync(subAccountId, contactId || null, "tag_removed", "error", {
      email,
      tags,
      error: err.message,
    });
    return false;
  }
}

export async function getMailchimpTemplates(subAccountId: number): Promise<any[]> {
  const config = await getMailchimpConfig(subAccountId);
  if (!config) return [];

  try {
    const res = await mcFetch(config, "/templates?count=100&type=user");
    if (!res.ok) return [];
    return res.data?.templates || [];
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Template fetch failed:`, err.message);
    return [];
  }
}

export async function sendEmailViaCampaign(
  subAccountId: number,
  email: string,
  templateKey: TemplateKey,
  eventType: string,
  contactId?: number,
  mergeVars?: Record<string, string>
): Promise<{ success: boolean; campaignId?: string; error?: string }> {
  const config = await getMailchimpConfig(subAccountId);
  if (!config) {
    return { success: false, error: "No Mailchimp config" };
  }

  const account = await storage.getSubAccount(subAccountId);
  if (!account) {
    return { success: false, error: "Sub-account not found" };
  }

  const bookingLink = getBookingLink(account);
  const businessName = account.name || "Our Team";
  const subject = DEFAULT_SUBJECTS[templateKey] || "Message from " + businessName;

  try {
    const segmentRes = await withRetry(async () => {
      const res = await mcFetch(
        config,
        `/lists/${config.audienceId}/segments`,
        "POST",
        {
          name: `apex_${templateKey}_${Date.now()}`,
          static_segment: [email.toLowerCase().trim()],
        }
      );
      if (!res.ok) throw new Error(`Segment creation failed: ${res.status}`);
      return res;
    }, `segment:${email}`);

    const segmentId = segmentRes.data?.id;

    const templates = await getMailchimpTemplates(subAccountId);
    const matchedTemplate = templates.find((t: any) =>
      t.name?.toLowerCase().includes(templateKey.replace(/_/g, " ")) ||
      t.name?.toLowerCase().includes(templateKey.replace(/_/g, "-"))
    );

    const campaignBody: any = {
      type: "regular",
      recipients: {
        list_id: config.audienceId,
        segment_opts: {
          saved_segment_id: segmentId,
        },
      },
      settings: {
        subject_line: subject,
        from_name: businessName,
        reply_to: email,
        title: `Apex: ${templateKey} — ${email}`,
      },
    };

    if (matchedTemplate) {
      campaignBody.settings.template_id = matchedTemplate.id;
    }

    const campaignRes = await withRetry(async () => {
      const res = await mcFetch(config, "/campaigns", "POST", campaignBody);
      if (!res.ok) throw new Error(`Campaign creation failed: ${res.status} — ${JSON.stringify(res.data)}`);
      return res;
    }, `campaign_create:${templateKey}`);

    const campaignId = campaignRes.data?.id;

    if (!matchedTemplate) {
      const defaultVars: Record<string, string> = {
        "{{first_name}}": mergeVars?.first_name || "there",
        "{{business_name}}": businessName,
        "{{booking_link}}": bookingLink || "#",
      };

      const htmlContent = generateFallbackHtml(templateKey, defaultVars);

      await withRetry(async () => {
        const res = await mcFetch(
          config,
          `/campaigns/${campaignId}/content`,
          "PUT",
          { html: htmlContent }
        );
        if (!res.ok) throw new Error(`Content set failed: ${res.status}`);
        return res;
      }, `campaign_content:${campaignId}`);
    }

    await withRetry(async () => {
      const res = await mcFetch(config, `/campaigns/${campaignId}/actions/send`, "POST");
      if (!res.ok && res.status !== 204) {
        throw new Error(`Campaign send failed: ${res.status} — ${JSON.stringify(res.data)}`);
      }
      return res;
    }, `campaign_send:${campaignId}`);

    console.log(`${LOG_PREFIX} Email sent: ${templateKey} → ${email} (campaign: ${campaignId})`);
    await logEmail(subAccountId, contactId || null, email, templateKey, eventType, "sent", campaignId);

    cleanupSegment(config, segmentId).catch(() => {});

    return { success: true, campaignId };
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Email send FAILED: ${templateKey} → ${email}:`, err.message);
    await logEmail(subAccountId, contactId || null, email, templateKey, eventType, "failed", undefined, err.message);
    return { success: false, error: err.message };
  }
}

async function cleanupSegment(config: MailchimpConfig, segmentId: number) {
  try {
    await mcFetch(config, `/lists/${config.audienceId}/segments/${segmentId}`, "DELETE");
  } catch {}
}

function generateFallbackHtml(templateKey: TemplateKey, vars: Record<string, string>): string {
  const firstName = vars["{{first_name}}"] || "there";
  const businessName = vars["{{business_name}}"] || "Our Team";
  const bookingLink = vars["{{booking_link}}"] || "#";

  const templates: Record<TemplateKey, string> = {
    [TEMPLATE_KEYS.LEAD_FOLLOW_UP]: `
      <h2>Hey ${firstName}!</h2>
      <p>Thanks for reaching out to ${businessName}. We're excited to connect with you.</p>
      <p>We'll be in touch shortly. In the meantime, feel free to book a time that works for you:</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Book a Call</a></p>
      <p>Best,<br/>${businessName}</p>
    `,
    [TEMPLATE_KEYS.CALL_CONFIRMATION]: `
      <h2>Call Confirmed, ${firstName}!</h2>
      <p>We've received your request and will be reaching out shortly.</p>
      <p>If you'd like to schedule a specific time:</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Schedule Now</a></p>
      <p>Talk soon,<br/>${businessName}</p>
    `,
    [TEMPLATE_KEYS.NO_RESPONSE]: `
      <h2>Hey ${firstName}, just checking in</h2>
      <p>We noticed we haven't connected yet. We'd love to hear from you!</p>
      <p>Book a time that works best:</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Let's Connect</a></p>
      <p>${businessName}</p>
    `,
    [TEMPLATE_KEYS.OFFER_PROMO]: `
      <h2>Special Offer for You, ${firstName}!</h2>
      <p>${businessName} has something special waiting for you.</p>
      <p>Don't miss out — book now to learn more:</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Claim Your Offer</a></p>
    `,
    [TEMPLATE_KEYS.REACTIVATION]: `
      <h2>We miss you, ${firstName}!</h2>
      <p>It's been a while since we last connected. ${businessName} has some great updates we'd love to share.</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Reconnect With Us</a></p>
    `,
    [TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION]: `
      <h2>You're booked, ${firstName}!</h2>
      <p>Your appointment with ${businessName} has been confirmed.</p>
      <p>If you need to reschedule:</p>
      <p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Manage Appointment</a></p>
      <p>See you soon!</p>
    `,
  };

  const body = templates[templateKey] || templates[TEMPLATE_KEYS.LEAD_FOLLOW_UP];

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">${body}</body></html>`;
}

export async function handleLeadCreated(
  subAccountId: number,
  contactId: number,
  contactData: { email?: string; firstName?: string; lastName?: string; phone?: string; source?: string }
) {
  if (!contactData.email) return;

  const synced = await syncContactToMailchimp(subAccountId, {
    email: contactData.email,
    firstName: contactData.firstName,
    lastName: contactData.lastName,
    phone: contactData.phone,
    source: contactData.source,
    tags: ["new_lead"],
  }, contactId);

  if (synced) {
    await sendEmailViaCampaign(
      subAccountId,
      contactData.email,
      TEMPLATE_KEYS.LEAD_FOLLOW_UP,
      "lead_created",
      contactId,
      { first_name: contactData.firstName || "there" }
    );
  }
}

export async function handleContactUpdated(
  subAccountId: number,
  contactId: number,
  contactData: { email?: string; firstName?: string; lastName?: string; phone?: string; source?: string; tags?: string[] }
) {
  if (!contactData.email) return;

  await syncContactToMailchimp(subAccountId, {
    email: contactData.email,
    firstName: contactData.firstName,
    lastName: contactData.lastName,
    phone: contactData.phone,
    source: contactData.source,
    tags: contactData.tags,
  }, contactId);
}

export async function handleCallRequested(
  subAccountId: number,
  contactId: number,
  contactData: { email?: string; firstName?: string; phone?: string }
) {
  if (!contactData.email) return;

  await syncContactToMailchimp(subAccountId, {
    email: contactData.email,
    firstName: contactData.firstName,
    phone: contactData.phone,
    tags: ["call_requested", "hot_lead"],
  }, contactId);

  await sendEmailViaCampaign(
    subAccountId,
    contactData.email,
    TEMPLATE_KEYS.CALL_CONFIRMATION,
    "call_requested",
    contactId,
    { first_name: contactData.firstName || "there" }
  );
}

export async function handleAppointmentBooked(
  subAccountId: number,
  contactId: number,
  contactData: { email?: string; firstName?: string; phone?: string }
) {
  if (!contactData.email) return;

  await syncContactToMailchimp(subAccountId, {
    email: contactData.email,
    firstName: contactData.firstName,
    phone: contactData.phone,
    tags: ["booked_call"],
  }, contactId);

  await removeTagsFromContact(subAccountId, contactData.email, ["no_response"], contactId);

  await sendEmailViaCampaign(
    subAccountId,
    contactData.email,
    TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION,
    "appointment_booked",
    contactId,
    { first_name: contactData.firstName || "there" }
  );
}

export async function handleDealStageChanged(
  subAccountId: number,
  contactId: number | null,
  contactData: { email?: string; firstName?: string },
  newStage: string
) {
  if (!contactData.email) return;

  const tagMap: Record<string, string[]> = {
    won: ["customer"],
    lost: ["no_response"],
    qualified: ["hot_lead"],
    contacted: [],
  };

  const stageKey = newStage.toLowerCase().replace(/\s+/g, "_");
  const tags = tagMap[stageKey] || [];

  if (tags.length > 0) {
    await applyTagsToContact(subAccountId, contactData.email, tags, contactId || undefined);
  }

  if (stageKey === "won") {
    await removeTagsFromContact(subAccountId, contactData.email, ["new_lead", "hot_lead", "no_response"], contactId || undefined);
  }
}

export async function handleNoResponse(
  subAccountId: number,
  contactId: number,
  contactData: { email?: string; firstName?: string }
) {
  if (!contactData.email) return;

  await applyTagsToContact(subAccountId, contactData.email, ["no_response"], contactId);

  await sendEmailViaCampaign(
    subAccountId,
    contactData.email,
    TEMPLATE_KEYS.NO_RESPONSE,
    "no_response",
    contactId,
    { first_name: contactData.firstName || "there" }
  );
}

export async function getEmailLogs(subAccountId: number, limit: number = 50) {
  return db.select().from(mailchimpEmailLogs)
    .where(eq(mailchimpEmailLogs.subAccountId, subAccountId))
    .orderBy(desc(mailchimpEmailLogs.createdAt))
    .limit(limit);
}

export async function getSyncLogs(subAccountId: number, limit: number = 50) {
  return db.select().from(mailchimpSyncLogs)
    .where(eq(mailchimpSyncLogs.subAccountId, subAccountId))
    .orderBy(desc(mailchimpSyncLogs.createdAt))
    .limit(limit);
}

export async function getMailchimpAudienceStats(subAccountId: number) {
  const config = await getMailchimpConfig(subAccountId);
  if (!config) return null;

  try {
    const res = await mcFetch(config, `/lists/${config.audienceId}`);
    if (!res.ok) return null;
    return {
      memberCount: res.data?.stats?.member_count || 0,
      unsubscribeCount: res.data?.stats?.unsubscribe_count || 0,
      cleanedCount: res.data?.stats?.cleaned_count || 0,
      campaignCount: res.data?.stats?.campaign_count || 0,
      lastSub: res.data?.stats?.last_sub_date || null,
    };
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Audience stats failed:`, err.message);
    return null;
  }
}

export async function bulkSyncContacts(subAccountId: number): Promise<{ synced: number; failed: number; skipped: number }> {
  const contacts = await storage.getContacts(subAccountId);
  let synced = 0, failed = 0, skipped = 0;

  for (const contact of contacts) {
    if (!contact.email) {
      skipped++;
      continue;
    }

    const success = await syncContactToMailchimp(subAccountId, {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName || undefined,
      phone: contact.phone || undefined,
      source: contact.source || undefined,
      tags: (contact.tags as string[]) || [],
    }, contact.id);

    if (success) synced++;
    else failed++;

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`${LOG_PREFIX} Bulk sync complete for account ${subAccountId}: synced=${synced} failed=${failed} skipped=${skipped}`);
  return { synced, failed, skipped };
}

export { TEMPLATE_KEYS, type TemplateKey };
