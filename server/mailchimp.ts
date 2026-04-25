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
  ROOMOS_WELCOME: "roomos_welcome",
  ROOMOS_ONBOARDING: "roomos_onboarding",
} as const;

type TemplateKey = typeof TEMPLATE_KEYS[keyof typeof TEMPLATE_KEYS];

const DEFAULT_SUBJECTS: Record<TemplateKey, string> = {
  [TEMPLATE_KEYS.LEAD_FOLLOW_UP]: "Thanks for reaching out, *|FNAME|*!",
  [TEMPLATE_KEYS.CALL_CONFIRMATION]: "Your call is confirmed, *|FNAME|*",
  [TEMPLATE_KEYS.NO_RESPONSE]: "We haven't heard from you, *|FNAME|*",
  [TEMPLATE_KEYS.OFFER_PROMO]: "A special offer just for you, *|FNAME|*",
  [TEMPLATE_KEYS.REACTIVATION]: "We miss you, *|FNAME|*!",
  [TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION]: "Your appointment is booked, *|FNAME|*!",
  [TEMPLATE_KEYS.ROOMOS_WELCOME]: "Welcome to RoomOS by Apex AI Smart Room — here's your webhook secret",
  [TEMPLATE_KEYS.ROOMOS_ONBOARDING]: "RoomOS Quick-Start — Go Live in 5 Minutes",
};

const REPLY_TO_MAP: Record<TemplateKey, string> = {
  [TEMPLATE_KEYS.LEAD_FOLLOW_UP]: "leads@apexmarketingautomations.com",
  [TEMPLATE_KEYS.CALL_CONFIRMATION]: "sales@apexmarketingautomations.com",
  [TEMPLATE_KEYS.NO_RESPONSE]: "hello@apexmarketingautomations.com",
  [TEMPLATE_KEYS.OFFER_PROMO]: "sales@apexmarketingautomations.com",
  [TEMPLATE_KEYS.REACTIVATION]: "hello@apexmarketingautomations.com",
  [TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION]: "onboarding@apexmarketingautomations.com",
  [TEMPLATE_KEYS.ROOMOS_WELCOME]: "onboarding@apexmarketingautomations.com",
  [TEMPLATE_KEYS.ROOMOS_ONBOARDING]: "onboarding@apexmarketingautomations.com",
};

const DEFAULT_FROM_EMAIL = "hello@apexmarketingautomations.com";
const FALLBACK_VERIFIED_EMAIL = "apexmarketingautomations@gmail.com";

async function getMailchimpConfig(subAccountId: number): Promise<MailchimpConfig | null> {
  try {
    let apiKey: string | undefined;
    let serverPrefix: string | undefined;
    let audienceId: string | undefined;

    const connection = await storage.getIntegrationConnection(subAccountId, "mailchimp");
    if (connection && connection.status === "connected" && connection.config) {
      const cfg = connection.config as Record<string, any>;
      apiKey = cfg.apiKey && cfg.apiKey !== "configured" ? cfg.apiKey : undefined;
      serverPrefix = cfg.serverPrefix;
      audienceId = cfg.audienceId;
    }

    if (!apiKey) apiKey = process.env.MAILCHIMP_API_KEY;
    if (!audienceId) audienceId = process.env.MAILCHIMP_AUDIENCE_ID || process.env["AUDIENCE ID MAIL CHIMP"];
    if (!apiKey) return null;

    if (!serverPrefix) serverPrefix = apiKey.split("-").pop();
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
  const basicAuth = Buffer.from(`anystring:${config.apiKey}`).toString("base64");
  const headers: Record<string, string> = {
    "Authorization": `Basic ${basicAuth}`,
    "Content-Type": "application/json",
  };

  const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(10000) };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    console.warn("[MAILCHIMP] caught:", err instanceof Error ? err.message : err);
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

function getBookingLink(account: any): string {
  const aiConfig = account.aiPromptConfig as Record<string, any> | null;
  const config = account.config as Record<string, any> | null;
  return aiConfig?.bookingLink || config?.bookingLink || aiConfig?.calendarLink || config?.calendarLink || config?.websiteUrl || aiConfig?.websiteUrl || "";
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
        throw new Error(`Mailchimp upsert failed: ${res.status} — mailchimp_error`);
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
        throw new Error(`Tag apply failed: ${res.status} — mailchimp_error`);
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
        throw new Error(`Tag remove failed: ${res.status} — mailchimp_error`);
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

let verifiedDomainsCache: { domains: string[]; fetchedAt: number } | null = null;

async function getVerifiedDomains(config: MailchimpConfig): Promise<string[]> {
  if (verifiedDomainsCache && Date.now() - verifiedDomainsCache.fetchedAt < 300000) {
    return verifiedDomainsCache.domains;
  }
  try {
    const res = await mcFetch(config, "/verified-domains");
    if (res.ok && res.data?.domains) {
      const domains = (res.data.domains as any[])
        .filter((d: any) => d.verified || d.status === "VERIFIED")
        .map((d: any) => d.verification_email as string)
        .filter(Boolean);
      verifiedDomainsCache = { domains, fetchedAt: Date.now() };
      return domains;
    }
  } catch (err) { console.warn("[MAILCHIMP] caught:", err instanceof Error ? err.message : err); }
  return [];
}

async function resolveVerifiedReplyTo(config: MailchimpConfig, templateKey: TemplateKey): Promise<string> {
  const preferred = REPLY_TO_MAP[templateKey] || DEFAULT_FROM_EMAIL;
  const verified = await getVerifiedDomains(config);

  if (verified.length === 0) return FALLBACK_VERIFIED_EMAIL;
  if (verified.includes(preferred)) return preferred;

  const domainMatch = verified.find(v => v.endsWith("@apexmarketingautomations.com"));
  if (domainMatch) return domainMatch;

  return verified[0] || FALLBACK_VERIFIED_EMAIL;
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
          match: "all",
          conditions: [
            {
              condition_type: "EmailAddress",
              field: "EMAIL",
              op: "is",
              value: email.toLowerCase().trim(),
            },
          ],
        },
      },
      settings: {
        subject_line: subject,
        from_name: businessName,
        reply_to: await resolveVerifiedReplyTo(config, templateKey),
        title: `Apex: ${templateKey} — ${email}`,
      },
    };

    if (matchedTemplate) {
      campaignBody.settings.template_id = matchedTemplate.id;
    }

    const campaignRes = await withRetry(async () => {
      const res = await mcFetch(config, "/campaigns", "POST", campaignBody);
      if (!res.ok) throw new Error(`Campaign creation failed: ${res.status} — mailchimp_error`);
      return res;
    }, `campaign_create:${templateKey}`);

    const campaignId = campaignRes.data?.id;

    if (!matchedTemplate) {
      const defaultVars: Record<string, string> = {
        "{{business_name}}": businessName,
        "{{booking_link}}": bookingLink,
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
        throw new Error(`Campaign send failed: ${res.status} — mailchimp_error`);
      }
      return res;
    }, `campaign_send:${campaignId}`);

    console.log(`${LOG_PREFIX} Email sent: ${templateKey} → ${email} (campaign: ${campaignId})`);
    await logEmail(subAccountId, contactId || null, email, templateKey, eventType, "sent", campaignId);

    return { success: true, campaignId };
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Email send FAILED: ${templateKey} → ${email}:`, err.message);
    await logEmail(subAccountId, contactId || null, email, templateKey, eventType, "failed", undefined, err.message);
    return { success: false, error: err.message };
  }
}

function generateFallbackHtml(templateKey: TemplateKey, vars: Record<string, string>): string {
  const businessName = vars["{{business_name}}"] || "Our Team";
  const bookingLink = vars["{{booking_link}}"] || "";
  const fname = "*|FNAME|*";

  const btn = (label: string) =>
    bookingLink
      ? `<p><a href="${bookingLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">${label}</a></p>`
      : "";

  const templates: Record<TemplateKey, string> = {
    [TEMPLATE_KEYS.LEAD_FOLLOW_UP]: `
      <h2>Hey ${fname}!</h2>
      <p>Thanks for reaching out to ${businessName}. We're excited to connect with you.</p>
      <p>We'll be in touch shortly.${bookingLink ? " In the meantime, feel free to book a time that works for you:" : ""}</p>
      ${btn("Book a Call")}
      <p>Best,<br/>${businessName}</p>
    `,
    [TEMPLATE_KEYS.CALL_CONFIRMATION]: `
      <h2>Call Confirmed, ${fname}!</h2>
      <p>We've received your request and will be reaching out shortly.</p>
      ${bookingLink ? `<p>If you'd like to schedule a specific time:</p>${btn("Schedule Now")}` : ""}
      <p>Talk soon,<br/>${businessName}</p>
    `,
    [TEMPLATE_KEYS.NO_RESPONSE]: `
      <h2>Hey ${fname}, just checking in</h2>
      <p>We noticed we haven't connected yet. We'd love to hear from you!</p>
      ${bookingLink ? `<p>Book a time that works best:</p>${btn("Let's Connect")}` : "<p>Reply to this email and let's connect!</p>"}
      <p>${businessName}</p>
    `,
    [TEMPLATE_KEYS.OFFER_PROMO]: `
      <h2>Special Offer for You, ${fname}!</h2>
      <p>${businessName} has something special waiting for you.</p>
      ${bookingLink ? `<p>Don't miss out — book now to learn more:</p>${btn("Claim Your Offer")}` : "<p>Reply to this email to learn more!</p>"}
    `,
    [TEMPLATE_KEYS.REACTIVATION]: `
      <h2>We miss you, ${fname}!</h2>
      <p>It's been a while since we last connected. ${businessName} has some great updates we'd love to share.</p>
      ${btn("Reconnect With Us")}
    `,
    [TEMPLATE_KEYS.APPOINTMENT_CONFIRMATION]: `
      <h2>You're booked, ${fname}!</h2>
      <p>Your appointment with ${businessName} has been confirmed.</p>
      ${bookingLink ? `<p>If you need to reschedule:</p>${btn("Manage Appointment")}` : ""}
      <p>See you soon!</p>
    `,
    [TEMPLATE_KEYS.ROOMOS_WELCOME]: `
      <h2>Welcome to RoomOS by Apex AI Smart Room, ${fname}!</h2>
      <p>Your account is set up and ready to go. Here's everything you need to start streaming with AI-powered coaching.</p>
      <div style="background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="color:#aaa;margin:0 0 8px;">Your Webhook Secret:</p>
        <code style="background:#0d0d1a;color:#00ff88;padding:8px 12px;border-radius:4px;display:block;word-break:break-all;font-size:13px;">${vars["{{webhook_token}}"] || "—"}</code>
      </div>
      <p><strong>Paste this token into your Chaturbate bot/overlay settings</strong> as the <code>x-roomos-token</code> header value.</p>
      <p>Your webhook URL:</p>
      <code style="background:#f0f0f0;padding:6px 10px;border-radius:4px;display:block;margin:8px 0;font-size:13px;">https://apexmarketingautomations.com/api/chaturbate/webhook</code>
      <p style="margin-top:16px;">
        <a href="https://apexmarketingautomations.com/roomos" style="background:#7c3aed;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:bold;">Open RoomOS Dashboard</a>
      </p>
      <p>Welcome aboard,<br/>The Apex Team</p>
    `,
    [TEMPLATE_KEYS.ROOMOS_ONBOARDING]: `
      <h2>Go Live in 5 Minutes, ${fname}</h2>
      <p>Here's a quick-start checklist to get the most out of RoomOS:</p>
      <ol style="line-height:2;">
        <li><strong>Paste your webhook secret</strong> into your Chaturbate bot config (Events API or overlay)</li>
        <li><strong>Set your webhook URL</strong> to: <code>https://apexmarketingautomations.com/api/chaturbate/webhook</code></li>
        <li><strong>Open your dashboard</strong> at <a href="https://apexmarketingautomations.com/roomos">apexmarketingautomations.com/roomos</a></li>
        <li><strong>Start a broadcast</strong> — tips and AI coaching suggestions appear in real-time</li>
        <li><strong>Use command buttons</strong> — tap Hype, Goal Push, or VIP to fire quick chat messages</li>
      </ol>
      <p><strong>Pro tip:</strong> The AI coach learns your room energy. The more you stream, the better the suggestions get.</p>
      <p>Questions? Reply to this email — we're here to help.</p>
      <p>— The Apex Team</p>
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
