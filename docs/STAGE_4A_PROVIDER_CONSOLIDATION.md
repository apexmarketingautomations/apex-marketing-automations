# STAGE 4A — Email Provider Consolidation Plan
**Apex Marketing OS | Production Hardening Series**
**Status:** Planned | **Target:** Railway + Neon environment | **Date:** 2026-05-15

---

## Executive Summary

Apex Marketing OS currently routes transactional email through four simultaneous providers: SendGrid, Resend, Mailchimp, and Mailgun. This fragmentation creates compliance risk (opt-out in one provider does not propagate to the others), inflated cost (paying for overlapping capacity), and developer overhead (four SDKs, four webhook endpoint handlers, four bounce/complaint pipelines). The `server/messaging/sendEmail.ts` file already implements provider-switching logic between Resend (primary) and SendGrid (fallback), but the switch is based on API key presence rather than an intentional architectural decision.

This document specifies consolidation to two providers: **Resend** for all transactional email and **Mailchimp** for all marketing campaigns. SendGrid and Mailgun are decommissioned. The consolidated state reduces monthly email cost by $15-75, eliminates suppression list fragmentation, and positions Resend's inbound email webhook for the document acquisition pipeline described in `docs/APEX_REPORT_ACQUISITION_ARCHITECTURE.md`.

---

## 1. Current Email Provider Audit

### Provider Inventory

| Provider | Package | Integration File | Purpose (Current) | Estimated Cost | Active Sending |
|----------|---------|-----------------|-------------------|----------------|----------------|
| SendGrid | `@sendgrid/mail ^8.1.6` | `server/messaging/sendEmail.ts` | Transactional fallback | $15-30/month | YES (fallback when Resend key absent) |
| Resend | `resend ^3.2.0` | `server/messaging/sendEmail.ts` | Transactional primary | $0-20/month | YES (primary) |
| Mailchimp | `server/mailchimp.ts` (HTTP API, no npm package) | `server/mailchimp.ts` | Marketing campaigns + sub-account onboarding transactional | $13-25/month | YES |
| Mailgun | HTTP API calls (no npm package) | `server/routes/property.ts` line 3184 | Transactional (referenced in env check) | $0-35/month | UNKNOWN — key may be present in env |

### Evidence from Codebase

**SendGrid:** Imported directly at top of `server/messaging/sendEmail.ts`:
```typescript
import sgMail from "@sendgrid/mail";
```
`ensureSendgrid()` initializes on first use if `SENDGRID_API_KEY` (or `sendgrid_api`, `SENDGRID_API`, `SendGrid_API_Key`) is present. Currently used as fallback when Resend key is absent.

**Resend:** Lazy-loaded via dynamic import in `getResendClient()`. Preferred provider — `logEmailProviderStartup()` confirms "Active email provider: resend" when key is present.

**Mailchimp:** `server/mailchimp.ts` is a 600+ line integration with its own retry logic, audience management, template system (`TEMPLATE_KEYS`), and per-sender `REPLY_TO_MAP`. Uses its own HTTP API calls. Handles marketing templates including `ROOMOS_WELCOME` and `ROOMOS_ONBOARDING` — these are transactional-adjacent (triggered by user action) and should remain in Mailchimp due to Mailchimp's merge tag system (`*|FNAME|*`).

**Mailgun:** Referenced in `server/routes/property.ts` line 3184 in a conditional env check: `!!process.env.MAILGUN_API_KEY`. No dedicated Mailgun SDK visible in `package.json`. Integration is via HTTP API (`fetch()`). Actual send volume is unknown without Railway env inspection.

### Current Provider-Switch Logic (`server/messaging/sendEmail.ts`)

```
if RESEND_API_KEY present:
  → send via Resend
elif SENDGRID_API_KEY present:
  → send via SendGrid (fallback)
else:
  → logEmailProviderStartup() warns: "No email provider configured"
```

This is implicit fallthrough, not an intentional dual-send architecture. The `sendEmail()` function sends through exactly one provider per invocation.

---

### Identified Problems

**1. Suppression list fragmentation**
`server/optOutGuard.ts` manages opt-out state in the Neon `contacts` table via `isOptedOut` field. This correctly prevents Apex from sending SMS to opted-out contacts. However, **email opt-outs recorded in SendGrid's suppression list do not propagate to Resend, and vice versa.** If a contact unsubscribes via a SendGrid-delivered email, then their next email is sent via Resend (after a provider switch), they receive it. This is a CAN-SPAM compliance failure.

**2. Webhook endpoint duplication**
Each provider requires its own inbound webhook for bounce, complaint, and delivery events. Currently there are at minimum two potential webhook handlers (SendGrid + Resend). Mailgun would add a third. Each webhook requires signature verification, payload parsing, and business logic to update contact status. This is four times the maintenance surface.

**3. Cost duplication**
Both SendGrid and Resend charge for sent email volume. Maintaining both active means paying for overlapping capacity. A contact's transactional email is sent by one provider, but both providers' monthly minimums are consumed.

**4. Analytics fragmentation**
Delivery rates, open rates, and bounce rates are visible in four separate dashboards. No unified view of email health across the platform.

**5. Developer cognitive overhead**
`server/messaging/sendEmail.ts` has two initialization paths, two error handling branches (`sendgrid_error`, `resend_error`), and two API key resolution functions. Every email-related code change must be considered twice.

---

## 2. Consolidation Decision

### Primary Transactional: Resend

**Decision:** All transactional email routes through Resend exclusively. SendGrid and Mailgun are removed.

**Rationale:**
- Already the primary provider in `server/messaging/sendEmail.ts` — Resend is active when `RESEND_API_KEY` is set (which it should be in production)
- TypeScript-first SDK with excellent type safety; `resend ^3.2.0` already in `package.json`
- Inbound email webhook support: Resend can receive email sent to `reports@<domain>` and POST the payload (including attachments as base64) to a webhook endpoint — directly enabling the email-based document acquisition pipeline in `APEX_REPORT_ACQUISITION_ARCHITECTURE.md`
- React Email template support for structured transactional templates (future Phase 4B work)
- Pricing: $0/month for 3,000 emails/month, then $0.30/1,000 — substantially cheaper than SendGrid at equivalent volume
- Webhook reliability: single endpoint for bounce, complaint, delivery, and inbound — all verified with HMAC signatures
- `getSenderVerificationStatus()` in `sendEmail.ts` is currently SendGrid-specific — removal simplifies the codebase

**Resend free tier:**
- 3,000 emails/month
- 1 custom domain
- 1 API key
- Scales to $20/month at ~60k emails/month

---

### Primary Marketing: Mailchimp

**Decision:** Mailchimp is retained for all campaign-style email (bulk sends, drip sequences, newsletters, sub-account marketing automations).

**Rationale:**
- `server/mailchimp.ts` is a mature, well-structured integration with audience management, tag-based segmentation, and merge-tag templating (`*|FNAME|*`) that Resend does not replicate
- Mailchimp's audience system maps directly to Apex sub-accounts — each sub-account's leads can be in a distinct Mailchimp audience
- The `TEMPLATE_KEYS` system (`LEAD_FOLLOW_UP`, `NO_RESPONSE`, `REACTIVATION`, etc.) uses Mailchimp-stored templates — migrating these to Resend React Email would be significant scope
- Mailchimp handles list management, CAN-SPAM footers, and unsubscribe link injection automatically for bulk sends
- **Mailchimp is NOT used for system alerts, routing notifications, or welcome emails** — those move to Resend

---

### Remove: SendGrid + Mailgun

**Decision:** Both providers are decommissioned. API keys removed from Railway env after migration validation.

---

## 3. Transactional Email Type Mapping

All transactional email types are consolidated to Resend. The following is the complete inventory of transactional sends that currently route through `server/messaging/sendEmail.ts` or equivalent:

```typescript
// server/messaging/transactionalTypes.ts (new file)

export type TransactionalEmailType =
  // Contact/lead lifecycle
  | 'contact-welcome'              // New contact registration confirmation
  | 'lead-distribution-notify'     // Attorney notified of new lead assignment
  | 'attorney-case-alert'          // Case details sent to assigned attorney
  | 'routing-confirmation'         // Confirms lead routing decision to sub-account
  | 'case-assigned'                // Plaintiff notified of attorney assignment

  // Operator/system alerts
  | 'system-alert-operator'        // Critical system failures → operator email
  | 'export-ready'                 // Data export download link ready
  | 'skip-trace-complete'          // BatchData skip trace result notification

  // Sub-account management
  | 'sub-account-onboarding'       // New sub-account activated
  | 'invoice-receipt'              // Stripe invoice receipt (if not using Stripe's own emails)
  | 'password-reset'               // Auth password reset

  // Document acquisition (new — Phase 4B)
  | 'document-received'            // Confirms receipt of emailed crash report/police report
  | 'document-processing'          // OCR processing started confirmation

  // Retention
  | 'case-status-update';          // Plaintiff case status change notification
```

**Transactional emails that stay in Mailchimp (not migrated):**
- `LEAD_FOLLOW_UP`, `CALL_CONFIRMATION`, `NO_RESPONSE`, `OFFER_PROMO`, `REACTIVATION`, `APPOINTMENT_CONFIRMATION` — all campaign/sequence style, managed in Mailchimp audience workflows
- `ROOMOS_WELCOME`, `ROOMOS_ONBOARDING` — these use Mailchimp merge tags and are sent as part of sub-account setup flow managed in `server/mailchimp.ts`

---

## 4. Consolidated Resend Client

Replace the dual-provider `server/messaging/sendEmail.ts` with a clean Resend-only transactional module. The existing file retains `getSenderVerificationStatus()` temporarily during migration, then it is removed.

### `server/messaging/resendClient.ts` (new file)

```typescript
import { Resend } from 'resend';
import { captureProviderError } from '../observability/sentry';
import { logSystemEvent } from '../systemLogger';

// Singleton client — initialized on first use
let _client: Resend | null = null;

function getClient(): Resend {
  if (_client) return _client;
  const key =
    process.env.RESEND_API_KEY ??
    process.env.RESEND_KEY ??
    process.env.EMAIL_RESEND_API_KEY;
  if (!key) throw new Error('[RESEND] API key not configured (RESEND_API_KEY)');
  _client = new Resend(key);
  return _client;
}

export function isResendConfigured(): boolean {
  return !!(
    process.env.RESEND_API_KEY ??
    process.env.RESEND_KEY ??
    process.env.EMAIL_RESEND_API_KEY
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransactionalEmailParams {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: string;                        // Defaults to platform sender address
  replyTo?: string;
  tags?: Array<{ key: string; value: string }>;
  traceId?: string;
  subAccountId?: number;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  errorMessage?: string;
}

// ── Primary send function ─────────────────────────────────────────────────────

export async function sendTransactionalEmail(
  params: TransactionalEmailParams
): Promise<SendEmailResult> {
  const from =
    params.from ??
    process.env.RESEND_FROM_EMAIL ??
    process.env.PLATFORM_FROM_EMAIL ??
    'noreply@apexmarketingautomations.com';

  const toArray = Array.isArray(params.to) ? params.to : [params.to];

  try {
    const client = getClient();
    const result = await client.emails.send({
      from,
      to: toArray,
      subject: params.subject,
      html: params.htmlBody,
      text: params.textBody,
      reply_to: params.replyTo,
      tags: params.tags?.map(t => ({ name: t.key, value: t.value })),
    });

    if (result.error) {
      const err = new Error(result.error.message);
      captureProviderError(err, 'resend', 'send', {
        to: toArray,
        subject: params.subject,
        traceId: params.traceId,
        subAccountId: params.subAccountId,
        resendErrorName: result.error.name,
      });
      await logSystemEvent('error', 'resend-client', `Resend send error: ${result.error.message}`, {
        traceId: params.traceId,
        resendError: result.error,
      });
      return { ok: false, errorMessage: result.error.message };
    }

    await logSystemEvent('info', 'resend-client', 'Email sent via Resend', {
      messageId: result.data?.id,
      to: toArray,
      subject: params.subject,
      traceId: params.traceId,
      subAccountId: params.subAccountId,
    });

    return { ok: true, messageId: result.data?.id };

  } catch (err: any) {
    captureProviderError(err, 'resend', 'send', {
      to: toArray,
      subject: params.subject,
      traceId: params.traceId,
    });
    await logSystemEvent('error', 'resend-client', `Resend client exception: ${err.message}`, {
      traceId: params.traceId,
      stack: err.stack?.substring(0, 400),
    });
    return { ok: false, errorMessage: err.message };
  }
}

// ── Opt-out guard integration ─────────────────────────────────────────────────

/**
 * Checks server/optOutGuard.ts before sending.
 * Email opt-outs are tracked in the contacts table (isOptedOut field).
 * This function is the single entry point for ALL transactional email sends.
 */
export async function sendTransactionalEmailGuarded(
  params: TransactionalEmailParams & { contactPhone?: string }
): Promise<SendEmailResult> {
  // For sub-account sends, check opt-out status before sending
  // The optOutGuard.ts module manages the contacts.isOptedOut field
  if (params.contactPhone && params.subAccountId) {
    const { isContactOptedOut } = await import('../optOutGuard');
    const optedOut = await isContactOptedOut(params.contactPhone, params.subAccountId);
    if (optedOut) {
      await logSystemEvent('info', 'resend-client', 'Email suppressed — contact opted out', {
        contactPhone: '[REDACTED]',
        subAccountId: params.subAccountId,
        traceId: params.traceId,
      });
      return { ok: false, errorMessage: 'Contact has opted out of email communications' };
    }
  }

  return sendTransactionalEmail(params);
}
```

---

## 5. Resend Inbound Email — Document Acquisition

Resend's inbound email feature allows a domain-verified email address (e.g., `reports@apexmarketingautomations.com`) to receive inbound email and POST the full payload — including base64-encoded attachments — to a webhook endpoint. This directly enables the crash report and police report acquisition pipeline described in `APEX_REPORT_ACQUISITION_ARCHITECTURE.md`.

### Inbound webhook handler

```typescript
// server/routes/webhooks.ts — append to existing webhook router
import { logSystemEvent } from '../systemLogger';

interface ResendInboundAttachment {
  filename: string;
  content_type: string;
  content: string;   // base64 encoded
  size: number;
}

interface ResendInboundPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: ResendInboundAttachment[];
  headers?: Record<string, string>;
}

// POST /webhooks/resend/inbound
// Receives crash reports, police reports sent to reports@apexmarketingautomations.com
// Queues each attachment for OCR processing
router.post('/webhooks/resend/inbound', async (req, res) => {
  // Verify Resend webhook signature
  const signature = req.headers['resend-signature'] as string;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (webhookSecret && signature) {
    const crypto = await import('crypto');
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== `sha256=${expected}`) {
      await logSystemEvent('warn', 'resend-inbound', 'Invalid webhook signature rejected');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const payload = req.body as ResendInboundPayload;
  const attachments = payload.attachments ?? [];

  await logSystemEvent('info', 'resend-inbound', `Inbound email received — ${attachments.length} attachment(s)`, {
    from: payload.from,
    subject: payload.subject,
    attachmentCount: attachments.length,
    attachmentTypes: attachments.map(a => a.content_type),
  });

  for (const attachment of attachments) {
    const supportedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'image/webp',
    ];

    if (!supportedTypes.includes(attachment.content_type)) {
      await logSystemEvent('info', 'resend-inbound', `Skipping unsupported attachment type: ${attachment.content_type}`);
      continue;
    }

    // Queue to OCR pipeline — jobQueue.ts (in-process) or apex-ocr queue (Phase 4B BullMQ)
    await jobQueue.enqueue('document-ingest', {
      source: 'email-inbound',
      fromEmail: payload.from,
      subject: payload.subject,
      fileName: attachment.filename,
      contentType: attachment.content_type,
      contentBase64: attachment.content,
      fileSizeBytes: attachment.size,
      triggeredAt: new Date().toISOString(),
    });
  }

  // Always return 200 immediately — Resend will retry on non-2xx
  res.status(200).json({ received: true, queued: attachments.length });
});

// POST /webhooks/resend/events
// Handles Resend delivery events: delivered, bounced, complained, opened, clicked
router.post('/webhooks/resend/events', async (req, res) => {
  const { type, data } = req.body as { type: string; data: Record<string, any> };

  await logSystemEvent('info', 'resend-events', `Resend event: ${type}`, {
    emailId: data?.email_id,
    to: data?.to,
    event: type,
  });

  switch (type) {
    case 'email.bounced':
      // Mark contact email as bounced in contacts table
      // TODO: implement updateContactEmailStatus(data.to, 'bounced')
      break;

    case 'email.complained':
      // Mark contact as opted out — spam complaint = permanent suppression
      // TODO: implement optOutContact(data.to, 'spam-complaint')
      break;

    case 'email.delivered':
      // Update message row status if messageId tracked
      break;
  }

  res.status(200).json({ received: true });
});
```

### Resend inbound DNS setup

Add to domain DNS (one-time):
```
MX  reports.apexmarketingautomations.com  10  feedback-smtp.us-east-1.amazonses.com
```
Resend's inbound routing config: `reports@apexmarketingautomations.com` → `POST https://apexmarketingautomations.com/webhooks/resend/inbound`

---

## 6. Suppression List Unification

### Current state

The existing `server/optOutGuard.ts` manages SMS opt-outs correctly via the `contacts` table. Email opt-outs, however, are managed by whichever provider sent the email — a contact who clicks "unsubscribe" in a Resend-delivered email is added to Resend's suppression list, but the `contacts` table is not updated. If the next email is sent via SendGrid (after a provider switch), the contact receives it.

### Unified email opt-out flow (post-consolidation)

After consolidation to Resend-only transactional:

1. **Contact unsubscribes via email link** → Resend fires `email.complained` or list-unsubscribe webhook → `POST /webhooks/resend/events`
2. Webhook handler calls `optOutContact(email, 'email-unsubscribe')` → sets `contacts.emailOptedOut = true`
3. Future sends via `sendTransactionalEmailGuarded()` check `contacts.emailOptedOut` before calling Resend
4. Resend's own suppression list is the secondary guard (belt + suspenders)

**Required schema addition** (add to `shared/schema.ts`, pending Phase 4A migration):
```typescript
// In contacts table definition:
emailOptedOut: boolean('email_opted_out').default(false).notNull(),
emailOptedOutAt: timestamp('email_opted_out_at'),
emailOptedOutReason: varchar('email_opted_out_reason', { length: 100 }),
```

### Migration: export existing suppression lists

Before removing SendGrid:
1. Export SendGrid Global Suppressions via `GET /v3/suppression/bounces` and `GET /v3/suppression/unsubscribes`
2. Export Mailgun bounces/unsubscribes (if Mailgun was actively sending)
3. Import into Resend suppression list via Resend contacts API
4. Import into `contacts` table: set `emailOptedOut = true` for all exported addresses
5. Verify `optOutGuard.ts` is called before every transactional send

---

## 7. Cost Reduction Analysis

### Current state (estimated monthly)

| Provider | Estimated Volume | Monthly Cost |
|----------|-----------------|--------------|
| SendGrid | ~5,000 emails/month | $15-30/month (Essentials plan) |
| Resend | ~3,000 emails/month | $0/month (free tier) |
| Mailchimp | ~2,000 emails/month (campaigns) | $13-25/month (Essentials plan, up to 5k contacts) |
| Mailgun | Unknown (HTTP API) | $0-35/month (Flex plan) |
| **Total** | | **$28-90/month** |

### Post-consolidation state

| Provider | Purpose | Monthly Cost |
|----------|---------|--------------|
| Resend | All transactional email | $0/month (under 3k) → $3-10/month if volume grows |
| Mailchimp | Marketing campaigns only | $13-25/month (unchanged) |
| SendGrid | Removed | $0 |
| Mailgun | Removed | $0 |
| **Total** | | **$13-35/month** |

**Monthly savings: $15-55/month**
**Annual savings: $180-660/year**

---

## 8. Migration Execution Plan

### Phase A — Audit and mapping (Week 1, Days 1-2)

```bash
# Find all SendGrid references
grep -rn 'sendgrid\|SENDGRID\|sgMail\|@sendgrid' server/ --include="*.ts"

# Find all Mailgun references
grep -rn 'mailgun\|MAILGUN' server/ --include="*.ts"

# Find all calls to sendEmail (the current unified wrapper)
grep -rn 'sendEmail\|sendTransactionalEmail\|sgMail.send\|resend.emails.send' server/ --include="*.ts"

# Identify sub-account fromEmail configurations (affect from-address resolution)
grep -rn 'fromEmail\|SENDGRID_FROM_EMAIL\|RESEND_FROM_EMAIL' server/ --include="*.ts"
```

Expected output: all call sites for transactional email currently routed through `server/messaging/sendEmail.ts` plus any direct provider calls.

### Phase A — Implementation (Days 2-4)

1. Create `server/messaging/resendClient.ts` (this document, section 4)
2. Create `server/messaging/transactionalTypes.ts` (this document, section 3)
3. Update all call sites in `server/` from the existing `sendEmail()` signature to `sendTransactionalEmailGuarded()`
4. Add `emailOptedOut` column to `contacts` table in `shared/schema.ts` + Drizzle migration
5. Add inbound webhook and events webhook handlers to `server/routes/webhooks.ts`
6. Add `RESEND_WEBHOOK_SECRET` to Railway env
7. Deploy with Resend as sole transactional provider (SendGrid key still present but code no longer calls it)

### Phase B — Parallel validation (Days 4-7)

1. Monitor `server/systemLogger.ts` logs in Axiom for `resend-client` module entries
2. Verify delivery rates ≥ current baseline in Resend dashboard
3. Test bounce handling: send to known-bad address, verify `email.bounced` webhook fires, verify contact updated in DB
4. Test unsubscribe: use list-unsubscribe link, verify `contacts.emailOptedOut` set

### Phase C — Cutover and cleanup (Week 2)

1. Export SendGrid suppression lists → import to Resend + contacts table
2. Export Mailgun suppressions (if any) → import to Resend + contacts table
3. Remove `import sgMail from "@sendgrid/mail"` from `server/messaging/sendEmail.ts`
4. Remove `ensureSendgrid()`, `resolveSendgridApiKey()`, all SendGrid branches from `server/messaging/sendEmail.ts`
5. Remove `sendgrid_error` from `SendEmailFailureReason` type
6. Remove `getSenderVerificationStatus()` function (SendGrid-specific)
7. Remove SendGrid webhook route from `server/routes/webhooks.ts` (if exists)
8. Remove `SENDGRID_API_KEY` from Railway env
9. Remove `MAILGUN_API_KEY` from Railway env
10. Deploy

### Phase D — Package cleanup (Week 3)

```bash
npm uninstall @sendgrid/mail
```

Update `package.json`. Confirm `resend` remains. Cancel SendGrid account. Cancel Mailgun account (if active subscription). Final deploy with clean dependencies.

---

## 9. Updated `server/messaging/sendEmail.ts`

After Phase C, the file is reduced from ~300 lines to a thin compatibility shim that delegates to `resendClient.ts`, maintaining the existing `SendEmailArgs` / `SendEmailResult` interface for callers that haven't been migrated yet:

```typescript
// server/messaging/sendEmail.ts — post-consolidation (compatibility shim)
import { sendTransactionalEmailGuarded, isResendConfigured } from './resendClient';
import { storage } from '../storage';
import { randomUUID } from 'crypto';

export type SendEmailFailureReason =
  | 'not_configured'
  | 'no_from_address'
  | 'resend_error'        // sendgrid_error removed
  | 'row_write_failed';

export interface SendEmailArgs {
  subAccountId: number;
  to: string;
  subject: string;
  body: string;
  from?: string;
  traceId?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageRowId?: number;
  errorMessage?: string;
  reason?: SendEmailFailureReason;
}

export function logEmailProviderStartup(): void {
  if (isResendConfigured()) {
    console.log('[EMAIL] Active email provider: resend (sole transactional provider)');
  } else {
    console.warn('[EMAIL] WARNING: RESEND_API_KEY not configured — transactional email disabled');
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const traceId = args.traceId ?? randomUUID();

  if (!isResendConfigured()) {
    return { ok: false, reason: 'not_configured', errorMessage: 'Resend not configured' };
  }

  // Resolve from address
  let from = args.from;
  if (!from) {
    try {
      const account = await storage.getSubAccount(args.subAccountId);
      from = account?.fromEmail?.trim() || undefined;
    } catch { /* non-fatal */ }
    from = from ?? process.env.RESEND_FROM_EMAIL ?? null!;
  }

  if (!from) {
    return { ok: false, reason: 'no_from_address', errorMessage: 'No from address available' };
  }

  const result = await sendTransactionalEmailGuarded({
    to: args.to,
    subject: args.subject,
    htmlBody: args.body,
    from,
    traceId,
    subAccountId: args.subAccountId,
  });

  return result.ok
    ? { ok: true }
    : { ok: false, reason: 'resend_error', errorMessage: result.errorMessage };
}
```

---

## 10. Other Provider Consolidation Decisions

| Provider | Current Use | Decision | Reason |
|----------|------------|----------|--------|
| Twilio | SMS + voice (inbound/outbound) | **Keep** | No viable consolidation target; core infrastructure |
| OpenAI | GPT-4o for lead analysis, embeddings | **Keep** | Primary LLM |
| Anthropic | Claude for operator reasoning | **Keep** | Different capability than OpenAI |
| Google Gemini | `server/gemini.ts` — multimodal | **Keep** | Document OCR use case |
| ScrapingBee | FLHSMV proxy scraping | **Keep** | Unique residential proxy capability for state DMV |
| BatchData | Skip trace, property lookup | **Keep** | Primary enrichment provider; no viable alternative at price point |
| Apify | Court scraping, attorney research | **Keep** | `server/apifyAttorneyScraper.ts`, `server/apifyTransportScraper.ts` — specialized scrapers |
| Stripe | Billing | **Keep** | Standard billing infrastructure |
| VAPI | Voice AI | **Keep** | `server/messaging/voiceStore.ts` — specialized voice AI capability |

---

## 11. Webhook Endpoint Audit Post-Consolidation

### Endpoints to keep

| Endpoint | Provider | Purpose |
|----------|----------|---------|
| `POST /webhooks/resend/events` | Resend | Bounce, complaint, delivery events for all transactional email |
| `POST /webhooks/resend/inbound` | Resend | Crash report / police report attachment ingestion |
| `POST /webhooks/mailchimp` | Mailchimp | Campaign open/click/unsubscribe events |
| `POST /webhooks/twilio/voice` | Twilio | Inbound voice call routing |
| `POST /webhooks/twilio/sms` | Twilio | Inbound SMS + opt-out handling |
| `POST /webhooks/twilio/status` | Twilio | Message delivery status updates |
| `POST /webhooks/stripe` | Stripe | Invoice, subscription, payment events |
| `POST /webhooks/vapi` | VAPI | Voice AI call events |

### Endpoints to remove after consolidation

| Endpoint | Provider | Status |
|----------|----------|--------|
| `POST /webhooks/sendgrid` | SendGrid | **Remove** — decommission after Phase C |
| `POST /webhooks/mailgun` | Mailgun | **Remove** — decommission after Phase C |

### Webhook secret management

After consolidation, the following secrets are required:

```
RESEND_API_KEY            — transactional sending
RESEND_WEBHOOK_SECRET     — inbound + events webhook signature verification
MAILCHIMP_API_KEY         — marketing campaign management (existing)
MAILCHIMP_WEBHOOK_SECRET  — campaign event signature verification (existing if used)
```

The following are removed from Railway env:
```
SENDGRID_API_KEY          — removed
sendgrid_api              — removed (alternate env var name in sendEmail.ts)
SENDGRID_API              — removed
SendGrid_API_Key          — removed
SENDGRID_FROM_EMAIL       — removed
MAILGUN_API_KEY           — removed
```

---

## 12. Environment Variable Cleanup Matrix

| Variable | Current State | Post-Consolidation |
|----------|--------------|-------------------|
| `RESEND_API_KEY` | Present (primary) | **KEEP** |
| `RESEND_FROM_EMAIL` | Present | **KEEP** |
| `RESEND_WEBHOOK_SECRET` | Missing | **ADD** |
| `RESEND_INBOUND_DOMAIN` | Missing | **ADD** (`reports.apexmarketingautomations.com`) |
| `SENDGRID_API_KEY` | Present | **REMOVE** (Phase C) |
| `sendgrid_api` | May be present | **REMOVE** (Phase C) |
| `SENDGRID_FROM_EMAIL` | May be present | **REMOVE** (Phase C) |
| `MAILGUN_API_KEY` | Present | **REMOVE** (Phase C) |
| `MAILCHIMP_API_KEY` | Present | **KEEP** |
| `MAILCHIMP_SERVER_PREFIX` | Present | **KEEP** |
| `MAILCHIMP_AUDIENCE_ID` | Present | **KEEP** |

---

## 13. Success Criteria

Post-consolidation validation (Phase B):

- [ ] All transactional email sent via Resend (`server/systemLogger.ts` shows no `sendgrid_error` or `mailgun_error` events in Axiom)
- [ ] Resend delivery rate ≥ 95% (check Resend dashboard 48 hours post-cutover)
- [ ] Bounce webhook fires correctly: `POST /webhooks/resend/events` with `type: email.bounced` updates `contacts` table
- [ ] Unsubscribe webhook fires correctly: `POST /webhooks/resend/events` with `type: email.complained` sets `contacts.emailOptedOut = true`
- [ ] Inbound webhook receives test attachment: send PDF to `reports@apexmarketingautomations.com`, verify job queued in `server/jobQueue.ts`
- [ ] Suppression list migration complete: exported SendGrid suppressions present in `contacts` table
- [ ] Mailchimp campaign sends unaffected (no change to `server/mailchimp.ts`)
- [ ] Monthly Railway env has no `SENDGRID_API_KEY` or `MAILGUN_API_KEY`
- [ ] `npm ls @sendgrid/mail` returns empty (Phase D)
- [ ] Total monthly email cost reduced (verify in Stripe/billing for SendGrid and Mailgun after account cancellations)
