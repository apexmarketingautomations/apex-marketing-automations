import type { Express, Request } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { sendEmail } from "../messaging/sendEmail";
import { asyncHandler, verifyAccountOwnership } from "./helpers";
import { messagingLimiter, webhookLimiter } from "../rateLimiter";
import { storage } from "../storage";
import { db } from "../db";
import { messages } from "@shared/schema";

const sendEmailSchema = z.object({
  subAccountId: z.number().int().positive(),
  toEmail: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  from: z.string().email().optional(),
});

const inboundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, fields: 200, files: 20 },
});

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function extractEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle?.[1] || raw).trim();
  const m = candidate.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

function extractMessageIdsFromHeaders(headers: string | undefined, name: string): string[] {
  if (!headers) return [];
  const lines = headers.split(/\r?\n/);
  let collecting = false;
  let collected = "";
  const lower = name.toLowerCase() + ":";
  for (const line of lines) {
    if (collecting) {
      if (/^\s/.test(line)) {
        collected += " " + line.trim();
        continue;
      }
      break;
    }
    if (line.toLowerCase().startsWith(lower)) {
      collected = line.slice(name.length + 1).trim();
      collecting = true;
    }
  }
  if (!collected) return [];
  return Array.from(collected.matchAll(/<([^>]+)>/g)).map((m) => m[1]);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(\n)?/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function resolveSubAccountForInbound(opts: {
  senderEmail: string;
  recipientEmail: string | null;
  inReplyTo: string[];
  references: string[];
}): Promise<{ subAccountId: number; threadId: string } | null> {
  const sidCandidates = [...opts.inReplyTo, ...opts.references];
  for (const sid of sidCandidates) {
    if (!sid) continue;
    const row = await storage.getMessageByMessageSid(sid);
    if (row) {
      return {
        subAccountId: row.subAccountId,
        threadId: row.threadId || `${row.subAccountId}::${opts.senderEmail}::email`,
      };
    }
  }

  const [prior] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.channel, "email"),
        eq(messages.contactPhone, opts.senderEmail),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (prior) {
    return {
      subAccountId: prior.subAccountId,
      threadId: prior.threadId || `${prior.subAccountId}::${opts.senderEmail}::email`,
    };
  }
  return null;
}

export function registerMessagingEmailRoutes(app: Express) {
  app.post(
    "/api/messages/email",
    messagingLimiter,
    asyncHandler(async (req, res) => {
      const parsed = sendEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { subAccountId, toEmail, subject, body, from } = parsed.data;

      if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

      const result = await sendEmail({
        subAccountId,
        to: toEmail,
        subject,
        body,
        from,
      });

      if (!result.ok) {
        const status = result.reason === "not_configured" ? 503 : 502;
        return res.status(status).json({
          error: result.errorMessage || "Failed to send email",
          reason: result.reason,
          messageRowId: result.messageRowId,
        });
      }

      return res.status(201).json({
        ok: true,
        messageRowId: result.messageRowId,
      });
    }),
  );

  // SendGrid Inbound Parse webhook.
  // Configure in SendGrid: MX record on a domain pointing to mx.sendgrid.net,
  // and an Inbound Parse host pointing here, e.g.
  //   POST https://<host>/api/webhook/email/inbound
  // SendGrid sends multipart/form-data with fields: from, to, subject, text,
  // html, headers, envelope, dkim, SPF, attachments, etc. We always reply 2xx
  // (even on routing failures) to avoid SendGrid retry storms — failures are
  // logged for operators to investigate.
  app.post(
    "/api/webhook/email/inbound",
    webhookLimiter,
    inboundUpload.any(),
    asyncHandler(async (req: Request, res) => {
      const traceId = randomUUID();
      const form = (req.body || {}) as Record<string, unknown>;

      const senderEmail = extractEmail(form.from) || extractEmail(form.sender);
      const recipientEmail = extractEmail(form.to);
      const subject = typeof form.subject === "string" && form.subject.trim()
        ? form.subject.trim().slice(0, 998)
        : "(no subject)";

      let textBody = typeof form.text === "string" ? form.text : "";
      if (!textBody && typeof form.html === "string" && form.html) {
        textBody = htmlToText(form.html);
      }
      textBody = textBody.trim();

      if (!senderEmail) {
        console.warn(`[INBOUND-EMAIL][${traceId}] Missing/invalid sender — dropping. from=${String(form.from).slice(0, 200)}`);
        return res.status(200).json({ ok: false, reason: "no_sender" });
      }
      if (!textBody) {
        textBody = "(empty message body)";
      }

      const headers = typeof form.headers === "string" ? form.headers : "";
      const inReplyTo = extractMessageIdsFromHeaders(headers, "In-Reply-To");
      const references = extractMessageIdsFromHeaders(headers, "References");

      const route = await resolveSubAccountForInbound({
        senderEmail,
        recipientEmail,
        inReplyTo,
        references,
      });

      if (!route) {
        console.warn(
          `[INBOUND-EMAIL][${traceId}] Could not route to sub-account. from=${senderEmail} to=${recipientEmail || "?"} inReplyTo=${inReplyTo.join(",") || "-"} references=${references.length}`,
        );
        return res.status(200).json({ ok: false, reason: "no_route" });
      }

      const persistedBody = `${subject}\n\n${textBody}`;

      try {
        const row = await storage.createMessage({
          subAccountId: route.subAccountId,
          contactPhone: senderEmail,
          body: persistedBody,
          direction: "inbound",
          channel: "email",
          status: "received",
          messageSid: null,
          threadId: route.threadId,
          traceId,
          errorMessage: null,
        });
        console.log(
          `[INBOUND-EMAIL][${traceId}] persisted id=${row.id} subAccount=${route.subAccountId} from=${senderEmail} thread=${route.threadId}`,
        );
        return res.status(200).json({ ok: true, messageRowId: row.id });
      } catch (err) {
        console.error(
          `[INBOUND-EMAIL][${traceId}] persist failed:`,
          err instanceof Error ? err.message : err,
        );
        return res.status(200).json({ ok: false, reason: "persist_failed" });
      }
    }),
  );
}
