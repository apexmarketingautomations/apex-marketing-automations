import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, getStripeWebhookSecret } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import Stripe from "stripe";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import path from "path";
import fs from "fs";
import { runStartupChecks } from "./startupChecks";
import { logSystemError, logSystemEvent } from "./systemLogger";
import { apiLimiter, authLimiter, webhookLimiter } from "./rateLimiter";
import { dispatchAlert, generateDeepLink } from "./pushAlertService";
import { initEventSubscribers } from "./eventSubscribers";
import { eventBus } from "./eventBus";
import { recordSuccess as recordPulseSuccess } from "./pulse";
import { withIdempotency, markEventCompleted, markEventFailed } from "./idempotency";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}


async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[STRIPE] DATABASE_URL not found, skipping Stripe init");
    return;
  }

  try {
    console.log("[STRIPE] Initializing schema...");
    await runMigrations({ databaseUrl });
    console.log("[STRIPE] Schema ready");

    const stripeSync = await getStripeSync();

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domain) {
      try {
        const webhookBaseUrl = `https://${domain}`;
        const result = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        if (result?.webhook?.url) {
          console.log(`[STRIPE] Webhook configured: ${result.webhook.url}`);
        } else {
          console.log("[STRIPE] Webhook registered (no URL returned)");
        }
      } catch (whErr: any) {
        console.log("[STRIPE] Webhook setup deferred — will retry on next restart");
      }
    } else {
      console.log("[STRIPE] No public domain found, skipping webhook setup");
    }

    stripeSync.syncBackfill()
      .then(() => console.log("[STRIPE] Data synced"))
      .catch((err: any) => console.error("[STRIPE] Sync error:", err));
  } catch (error) {
    console.error("[STRIPE] Init failed:", error);
  }
}

app.post(
  "/api/stripe/webhook",
  webhookLimiter,
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing signature" });

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        return res.status(500).json({ error: "Webhook processing error" });
      }

      const whSecret = getStripeWebhookSecret();
      if (whSecret) {
        const stripe = new Stripe(process.env.STRIPE_API_SECRET || "", { apiVersion: "2025-08-27.basil" as any });
        stripe.webhooks.constructEvent(req.body, sig, whSecret);
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      const event = JSON.parse(req.body.toString());
      const { storage } = await import("./storage");

      const stripeEventId = event?.id as string | undefined;
      if (stripeEventId) {
        try {
          const existingEvent = await storage.getEventLogByExternalId("stripe", stripeEventId);
          if (existingEvent && (existingEvent.status === "completed" || existingEvent.status === "processing")) {
            console.log(`[IDEMPOTENCY] Duplicate Stripe event ${stripeEventId} (status: ${existingEvent.status}) — skipping`);
            return res.status(200).json({ received: true, duplicate: true });
          }
          if (!existingEvent) {
            const { default: crypto } = await import("crypto");
            await storage.createEventLog({
              traceId: crypto.randomUUID(),
              type: event.type || "stripe.event",
              source: "stripe",
              externalId: stripeEventId,
              payload: event as any,
              status: "processing",
              maxRetries: 3,
            });
          } else {
            await storage.updateEventLogStatus(existingEvent.id, "processing");
          }
        } catch (idempErr: any) {
          if (!idempErr?.message?.includes("unique")) {
            console.error("[STRIPE WEBHOOK] Idempotency error:", idempErr.message);
          }
        }
      }

      if (event?.type === "checkout.session.completed") {
        const session = event.data?.object;
        const meta = session?.metadata;

        if (meta?.type === "credit_topup" && meta?.subAccountId && meta?.creditAmount) {
          const subAccountId = parseInt(meta.subAccountId);
          const amount = parseFloat(meta.creditAmount);

          const existingTx = await storage.getCreditTransactionByStripeSession(session.id);
          if (!existingTx) {
            let wallet = await storage.getCreditWallet(subAccountId);
            if (!wallet) {
              wallet = await storage.upsertCreditWallet({ subAccountId, balance: 0, lifetimeTopUp: 0, lifetimeSpend: 0 });
            }
            const updated = await storage.updateCreditWalletBalance(subAccountId, amount);
            await storage.createCreditTransaction({
              subAccountId,
              type: "topup",
              amount,
              balanceAfter: updated?.balance || amount,
              description: `Credit top-up via Stripe`,
              stripeSessionId: session.id,
            });
            console.log(`[WALLET] +$${amount} credited to account #${subAccountId}`);
          } else {
            console.log(`[WALLET] Duplicate webhook for session ${session.id}, skipping`);
          }
        }

        if (meta?.userId && meta?.tierName) {
          const existing = await storage.getSubscription(meta.userId);
          const isGrandfathered = meta.isGrandfathered === "true";
          const billingInterval = meta.billingInterval || "monthly";
          const subData: any = {
            userId: meta.userId,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            planTier: meta.tierName,
            status: "active",
            aiCredits: 50,
            isGrandfathered,
            billingInterval,
            ...(isGrandfathered ? { blitzJoinedDate: new Date() } : {}),
          };
          if (existing) {
            await storage.updateSubscription(existing.id, subData);
          } else {
            await storage.createSubscription(subData);
          }
          console.log(`[STRIPE] Subscription activated for user ${meta.userId} — ${meta.tierName}`);
        }
      }

      if (event?.type === "customer.subscription.updated" || event?.type === "customer.subscription.deleted") {
        const subscription = event.data?.object;
        const existing = await storage.getSubscriptionByStripeId(subscription.id);
        if (existing) {
          const stripeStatus = subscription.status;
          const statusMap: Record<string, string> = {
            active: "active",
            trialing: "active",
            past_due: "past_due",
            canceled: "canceled",
            incomplete: "incomplete",
            incomplete_expired: "canceled",
            unpaid: "suspended",
            paused: "inactive",
          };
          const mappedStatus = statusMap[stripeStatus] || "inactive";
          const updateData: any = {
            status: mappedStatus,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          };
          if (stripeStatus === "active" || stripeStatus === "trialing") {
            updateData.paymentStatus = "ok";
            updateData.paymentFailedAt = null;
          }
          await storage.updateSubscription(existing.id, updateData);
          console.log(`[STRIPE] Subscription ${event.type} for ${subscription.id}`);
        }

        if (event.type === "customer.subscription.deleted" && existing?.isGrandfathered) {
          await storage.updateSubscription(existing.id, {
            isGrandfathered: false,
            status: "inactive",
            paymentStatus: "revoked",
          });
          await storage.createAuditLog({
            action: "LEGACY_STATUS_REVOKED",
            performedBy: existing.userId,
            details: {
              message: "Subscription lapsed. Grandfathered pricing permanently revoked.",
              subscriptionId: existing.id,
              planTier: existing.planTier,
              originalBlitzDate: existing.blitzJoinedDate,
            },
          });
          console.log(`[ENFORCEMENT] User ${existing.userId} has LOST Legacy status permanently.`);
        }
      }

      if (event?.type === "invoice.payment_succeeded") {
        const invoice = event.data?.object;
        const subId = invoice?.subscription;
        if (subId) {
          const existing = await storage.getSubscriptionByStripeId(subId as string);
          if (existing) {
            await storage.updateSubscription(existing.id, {
              status: "active",
              paymentStatus: "ok",
              paymentFailedAt: null,
            });
            console.log(`[STRIPE] Payment succeeded for subscription ${subId}`);
          }
        }
      }

      if (event?.type === "customer.subscription.created") {
        const subscription = event.data?.object;
        const customerId = subscription.customer;
        const existing = await storage.getSubscriptionByStripeCustomer?.(customerId);
        if (existing) {
          await storage.updateSubscription(existing.id, {
            stripeSubscriptionId: subscription.id,
            status: subscription.status === "active" || subscription.status === "trialing" ? "active" : existing.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          });
          console.log(`[STRIPE] Subscription created ${subscription.id} for customer ${customerId}`);
        }
      }

      if (event?.type === "invoice.payment_failed") {
        const invoice = event.data?.object;
        const subId = invoice?.subscription;
        if (subId) {
          const existing = await storage.getSubscriptionByStripeId(subId as string);
          if (existing) {
            await storage.updateSubscription(existing.id, {
              paymentStatus: "failed",
              paymentFailedAt: new Date(),
            });
            console.log(`[STRIPE] Payment failed for subscription ${subId}`);

            try {
              const userAccounts = await storage.getSubAccountsByUser(existing.userId);
              for (const acct of userAccounts) {
                dispatchAlert(acct.id, "payment_failed", {
                  title: "Payment Failed",
                  body: `Your subscription payment could not be processed. Please update your payment method.`,
                  link: generateDeepLink("/billing"),
                  tag: `payment-fail-${existing.id}`,
                  urgency: "high",
                }).catch(e => console.error("[PUSH-ALERT] payment failed dispatch error:", e instanceof Error ? e.message : e));
              }
            } catch (e) {
              console.error("[PUSH-ALERT] payment failed alert lookup error:", e instanceof Error ? (e as Error).message : e);
            }

            if (existing.isGrandfathered) {
              console.log(`[ENFORCEMENT] Legacy user ${existing.userId} payment failed - 72hr grace period started`);
              await storage.createAuditLog({
                action: "LEGACY_PAYMENT_WARNING",
                performedBy: existing.userId,
                details: {
                  message: "Payment failed. 72-hour grace period before Legacy status revocation.",
                  subscriptionId: existing.id,
                  planTier: existing.planTier,
                },
              });
            }
          }
        }
      }

      if (stripeEventId) {
        try {
          const finalEvent = await storage.getEventLogByExternalId("stripe", stripeEventId);
          if (finalEvent) {
            await storage.updateEventLogStatus(finalEvent.id, "completed", { processedAt: new Date() });
          }
        } catch {}
      }
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("[STRIPE] Webhook error:", error.message);
      logSystemError("stripe_webhook", error.message, { stack: error.stack?.substring(0, 500) });
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));


const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const responseStr = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${responseStr.length > 200 ? responseStr.substring(0, 200) + "...[truncated]" : responseStr}`;
      }

      log(logLine);
    }
  });

  next();
});

function validateEnvVars() {
  console.log("=".repeat(60));
  console.log("[STARTUP] Apex Marketing Automations — Environment Check");
  console.log("=".repeat(60));

  const checks: { key: string; altKey?: string; label: string; critical: boolean }[] = [
    { key: "VAPI_PRIVATE_KEY", altKey: "apex_private_vapi", label: "Vapi Private Key (server-side API calls)", critical: true },
    { key: "VAPI_PUBLIC_KEY", altKey: "apex_public_vapi", label: "Vapi Public Key (browser demo calls)", critical: false },
    { key: "VAPI_ORG_ID", label: "Vapi Organization ID", critical: false },
    { key: "VAPI_PHONE_NUMBER_ID", label: "Vapi Default Phone Number ID (auto-inject for outbound)", critical: false },
    { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID (phone provisioning)", critical: false },
    { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token (phone provisioning)", critical: false },
    { key: "OPENAI_APEX_INT_KEY", label: "OpenAI API Key (AI features, primary)", critical: false },
    { key: "Gemini_API_Key_saas", label: "Gemini API Key (AI features, fallback)", critical: false },
    { key: "GOOGLE_API_KEY", label: "Google API Key (Maps, Places, etc.)", critical: false },
    { key: "META_APP_ID", label: "Meta App ID (optional, for app-level ops)", critical: false },
  ];

  let missingCritical = false;
  for (const { key, altKey, label, critical } of checks) {
    const hasKey = !!process.env[key] || (altKey ? !!process.env[altKey] : false);
    if (!hasKey) {
      const level = critical ? "ERROR" : "WARN";
      console.log(`  [${level}] ${key} — ${label}`);
      if (critical) missingCritical = true;
    } else {
      console.log(`  [OK]    ${key} — ${label}`);
    }
  }

  if (missingCritical) {
    console.log("[STARTUP] Critical secrets missing. Voice agent features will be unavailable.");
  }

  if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    console.log("[WARN] TWILIO_ACCOUNT_SID is set but TWILIO_AUTH_TOKEN is missing — Twilio will not work.");
  }
  if (!process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log("[WARN] TWILIO_AUTH_TOKEN is set but TWILIO_ACCOUNT_SID is missing — Twilio will not work.");
  }

  console.log("  [INFO] Meta/Facebook credentials are now per-account (sub_accounts.meta_page_id, meta_access_token).");

  console.log("=".repeat(60));
}

async function validateMetaCredentials() {
  const { validateMetaConfigForAccount } = await import("./metaConfig");
  const { storage } = await import("./storage");
  const { db } = await import("./db");
  const { subAccounts } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const allAccounts = await storage.getSubAccounts();
  const configuredAccounts = allAccounts.filter(a => a.metaAccessToken && a.metaPageId);

  if (configuredAccounts.length === 0) {
    if (process.env.META_ACCESS_TOKEN && process.env.META_PAGE_ID) {
      console.log("[META STARTUP] Found global META_ACCESS_TOKEN/META_PAGE_ID — migrating to default sub-account...");
      const defaultAccount = allAccounts.find(a => a.ownerUserId !== "_archived") || allAccounts[0];
      if (defaultAccount) {
        await db.update(subAccounts).set({
          metaPageId: process.env.META_PAGE_ID,
          metaAccessToken: process.env.META_ACCESS_TOKEN,
          metaAppSecret: process.env.META_APP_SECRET || null,
        }).where(eq(subAccounts.id, defaultAccount.id));
        console.log(`[META STARTUP] Migrated global Meta credentials to account ${defaultAccount.id} (${defaultAccount.name}). Remove META_ACCESS_TOKEN, META_PAGE_ID, META_APP_SECRET from env vars — they are now stored per-account.`);
        configuredAccounts.push({ ...defaultAccount, metaPageId: process.env.META_PAGE_ID!, metaAccessToken: process.env.META_ACCESS_TOKEN!, metaAppSecret: process.env.META_APP_SECRET || null });
      }
    } else {
      console.log("[META STARTUP] No accounts have Meta credentials configured — skipping validation");
      return;
    }
  }

  console.log(`[META STARTUP] Validating ${configuredAccounts.length} account(s) with Meta credentials...`);

  for (const acc of configuredAccounts) {
    const result = await validateMetaConfigForAccount(acc.id);
    if (result.valid) {
      console.log(`[META] Account ${acc.id} (${acc.name}) — Page "${result.pageName}" verified (pageId=${acc.metaPageId})`);
    } else {
      console.warn(`[META] Account ${acc.id} (${acc.name}) — validation failed: ${result.error}`);
    }
  }
}

(async () => {
  validateEnvVars();
  runStartupChecks();
  try {
    await validateMetaCredentials();
  } catch (metaErr: any) {
    console.warn("[META] ===================================================");
    console.warn("[META] WARNING:", metaErr.message);
    console.warn("[META] ===================================================");
  }
  try {
    await initStripe();
  } catch (stripeErr) {
    console.error("[STARTUP] Stripe init failed (non-fatal):", stripeErr);
  }

  try {
    await seed();
  } catch (seedErr) {
    console.error("[STARTUP] Seed failed (non-fatal):", seedErr);
  }

  try {
    const { startCrashReportWorker } = await import("./crashReportWorker");
    startCrashReportWorker();
  } catch (workerErr) {
    console.error("[STARTUP] Crash report worker failed (non-fatal):", workerErr);
  }

  try {
    const { storage } = await import("./storage");
    initEventSubscribers(storage);
    console.log("[STARTUP] Event bus initialized");
  } catch (ebErr) {
    console.error("[STARTUP] Event bus init failed (non-fatal):", ebErr);
  }

  try {
    const { initOperator } = await import("./operator/index");
    initOperator();
  } catch (opErr) {
    console.error("[STARTUP] Operator init failed (non-fatal):", opErr);
  }

  const { vapiCallLogs } = await import("@shared/schema");
  const { db: vapiDb } = await import("./db");
  const { eq: vapiEq, isNotNull: vapiIsNotNull, sql: vapiSql, desc: vapiDesc } = await import("drizzle-orm");
  const { vapiConfig: vapiCfg } = await import("./routes/helpers");
  const { analyzeCallTranscript, analyzeAllUnprocessed, generatePatternReport, generatePromptEnrichment, injectPatternsIntoAgent, onCallAnalyzed, startAutoLearningLoop } = await import("./callIntelligence");

  const { contacts } = await import("@shared/schema");
  const { like: vapiLike, and: vapiAnd } = await import("drizzle-orm");
  const { getTwilioClient } = await import("./routes/helpers");
  const { storage: vapiStorage } = await import("./storage");
  const { aiChat: vapiAiChat, isAIConfigured: vapiIsAIConfigured } = await import("./aiGateway");

  const VAPI_ASSISTANT_ID = "e30434f7-e7e0-4be7-8b89-40c384a52b4a";
  const VAPI_SERVER_URL = "https://apexmarketingautomations.com/api/vapi/webhook";
  const VAPI_SERVER_MESSAGES = [
    "assistant.started",
    "conversation-update",
    "end-of-call-report",
    "function-call",
    "hang",
    "speech-update",
    "status-update",
    "tool-calls",
    "transcript",
    "transfer-destination-request",
    "user-interrupted",
  ];

  async function patchVapiAssistant(): Promise<void> {
    if (!vapiCfg.isConfigured) {
      console.log("[VAPI PATCH] Skipping — Vapi not configured");
      return;
    }
    try {
      const patchRes = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
        method: "PATCH",
        headers: vapiCfg.privateHeaders(),
        body: JSON.stringify({
          serverUrl: VAPI_SERVER_URL,
          serverMessages: VAPI_SERVER_MESSAGES,
        }),
      });
      if (patchRes.ok) {
        console.log(`[VAPI PATCH] Assistant ${VAPI_ASSISTANT_ID} patched: serverUrl + serverMessages set`);
      } else {
        const errTxt = await patchRes.text();
        console.warn(`[VAPI PATCH] Failed to patch assistant ${VAPI_ASSISTANT_ID}: ${patchRes.status} ${errTxt.substring(0, 200)}`);
      }
    } catch (patchErr: any) {
      console.error("[VAPI PATCH] Error patching assistant:", patchErr?.message);
    }
  }

  patchVapiAssistant().catch(err => console.error("[VAPI PATCH] Startup patch failed:", err?.message));

  const processedVapiEvents = new Map<string, number>();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, ts] of processedVapiEvents) {
      if (ts < cutoff) processedVapiEvents.delete(k);
    }
  }, 30_000);

  async function generateVapiAiReply(messageBody: string): Promise<string> {
    const systemPrompt = "You are a helpful business receptionist. Keep text replies under 160 characters. Be warm, professional, and concise. If someone wants to book an appointment, suggest they call the office number.";
    const staticFallback = "Thanks for your message! We'll get back to you shortly.";

    if (vapiIsAIConfigured()) {
      try {
        const aiResult = await vapiAiChat([
          { role: "system", content: systemPrompt },
          { role: "user", content: messageBody.substring(0, 1000) },
        ], { temperature: 0.7, maxTokens: 200, route: "vapi-sms-reply" });
        if (aiResult.text) {
          console.log(`[VAPI SMS] AI reply generated via ${aiResult.provider}`);
          return aiResult.text;
        }
      } catch (aiErr: any) {
        console.warn("[VAPI SMS] AI gateway failed, using static fallback:", aiErr?.message);
      }
    }

    return staticFallback;
  }

  async function resolveVapiSubAccount(
    senderPhone: string,
    destinationNumber?: string | null
  ): Promise<{ id: number; twilioNumber: string | null } | null> {
    try {
      const allAccounts = await vapiStorage.getSubAccounts();
      const active = allAccounts.filter((a: any) => a.ownerUserId !== "_archived");

      if (active.length === 0) {
        console.error("[VAPI SMS] No active sub-accounts found — dropping message");
        return null;
      }

      if (active.length === 1) {
        return { id: active[0].id, twilioNumber: active[0].twilioNumber || null };
      }

      if (destinationNumber) {
        const destCleaned = destinationNumber.replace(/\D/g, "").slice(-10);
        const byDest = active.find((a: any) => {
          const tn = (a.twilioNumber || "").replace(/\D/g, "").slice(-10);
          return tn && tn === destCleaned;
        });
        if (byDest) {
          console.log(`[VAPI SMS] Routing to account id=${byDest.id} (matched by destination number ${destinationNumber})`);
          return { id: byDest.id, twilioNumber: byDest.twilioNumber || null };
        }
      }

      const cleaned = senderPhone.replace(/\D/g, "").slice(-10);
      const existingInAnyAccount = await vapiDb.select().from(contacts)
        .where(vapiLike(contacts.phone, `%${cleaned}`)).limit(1);
      if (existingInAnyAccount.length > 0) {
        const accountId = existingInAnyAccount[0].subAccountId;
        const match = active.find((a: any) => a.id === accountId);
        if (match) {
          console.log(`[VAPI SMS] Routing to account id=${match.id} (matched by existing contact)`);
          return { id: match.id, twilioNumber: match.twilioNumber || null };
        }
      }

      console.warn(`[VAPI SMS] Multi-tenant: no deterministic account match for ${senderPhone} — dropping to prevent cross-tenant data leak`);
      return null;
    } catch (err: any) {
      console.error("[VAPI SMS] Account resolution error:", err?.message);
      return null;
    }
  }

  async function handleVapiSms(
    smsFrom: string,
    smsBody: string,
    messageId: string | null,
    destinationNumber?: string | null
  ): Promise<void> {
    const senderClean = smsFrom.replace(/\s+/g, "");
    const bodyFingerprint = smsBody.substring(0, 80).replace(/\s+/g, " ");
    const dedupeKey = messageId
      ? `msgid:${messageId}:${senderClean}`
      : `msg:${senderClean}:${bodyFingerprint}`;
    if (processedVapiEvents.has(dedupeKey)) {
      console.log(`[VAPI SMS] Duplicate event skipped: ${dedupeKey.substring(0, 60)}`);
      return;
    }
    processedVapiEvents.set(dedupeKey, Date.now());

    console.log(`[VAPI SMS] Inbound from ${senderClean}: "${smsBody.substring(0, 100)}"`);

    const { isOptOutMessage: isOpt, isOptInMessage: isIn, handleSmsOptOut: optOut, handleSmsOptIn: optIn, checkPhoneOptOut } = await import("./optOutGuard");

    const account = await resolveVapiSubAccount(senderClean, destinationNumber);
    if (!account) {
      console.error(`[VAPI SMS] Cannot process message from ${senderClean}: no account resolved`);
      return;
    }
    const subAccountId = account.id;

    if (isOpt(smsBody)) {
      await optOut(senderClean, subAccountId);
      console.log(`[VAPI SMS OPT-OUT] ${senderClean} opted out`);
      const twilioClientForOptOut = await getTwilioClient();
      if (twilioClientForOptOut) {
        const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
        if (fromNumber) {
          await twilioClientForOptOut.messages.create({
            body: "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.",
            from: fromNumber,
            to: senderClean,
          }).catch((e: any) => console.error("[VAPI SMS OPT-OUT] Twilio send failed:", e?.message));
        }
      }
      return;
    }

    if (isIn(smsBody)) {
      await optIn(senderClean, subAccountId);
      console.log(`[VAPI SMS OPT-IN] ${senderClean} opted in`);
      const twilioClientForOptIn = await getTwilioClient();
      if (twilioClientForOptIn) {
        const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
        if (fromNumber) {
          await twilioClientForOptIn.messages.create({
            body: "You have been re-subscribed and will receive messages from us again.",
            from: fromNumber,
            to: senderClean,
          }).catch((e: any) => console.error("[VAPI SMS OPT-IN] Twilio send failed:", e?.message));
        }
      }
      return;
    }

    try {
      await vapiStorage.createMessage({
        subAccountId,
        contactPhone: senderClean,
        body: smsBody,
        direction: "inbound",
        channel: "vapi-sms",
        status: "received",
      });
    } catch (msgErr: any) {
      console.error("[VAPI SMS] Message storage error:", msgErr?.message);
    }

    let contactName = `Vapi SMS ${senderClean.slice(-4)}`;
    try {
      const cleaned = senderClean.replace(/\D/g, "").slice(-10);
      const existingContacts = await vapiDb.select().from(contacts)
        .where(vapiAnd(
          vapiEq(contacts.subAccountId, subAccountId),
          vapiLike(contacts.phone, `%${cleaned}`)
        )).limit(1);

      if (existingContacts.length === 0) {
        const newContact = await vapiStorage.createContact({
          subAccountId,
          firstName: contactName,
          phone: senderClean,
          source: "vapi-sms",
          tags: ["vapi-sms", "sms_lead"],
        });
        console.log(`[VAPI SMS] Created CRM contact id=${newContact.id} for ${senderClean}`);
      } else {
        const c = existingContacts[0];
        contactName = `${c.firstName} ${c.lastName || ""}`.trim() || contactName;
        console.log(`[VAPI SMS] Found existing CRM contact id=${c.id} for ${senderClean}`);
      }
    } catch (crmErr: any) {
      console.error("[VAPI SMS] CRM contact error:", crmErr?.message);
    }

    const isOptedOut = await checkPhoneOptOut(senderClean, subAccountId).catch(() => false);
    if (isOptedOut) {
      console.log(`[VAPI SMS] ${senderClean} is opted out — skipping AI reply`);
      return;
    }

    const aiReply = await generateVapiAiReply(smsBody);

    const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
    if (fromNumber) {
      const twilioClient = await getTwilioClient();
      if (twilioClient) {
        try {
          await twilioClient.messages.create({
            body: aiReply,
            from: fromNumber,
            to: senderClean,
          });
          console.log(`[VAPI SMS] AI reply sent to ${senderClean} via Twilio`);
          await vapiStorage.createMessage({
            subAccountId,
            contactPhone: senderClean,
            body: aiReply,
            direction: "outbound",
            channel: "vapi-sms",
            status: "sent",
          });
        } catch (sendErr: any) {
          console.error("[VAPI SMS] Twilio send failed:", sendErr?.message);
          await vapiStorage.createMessage({
            subAccountId,
            contactPhone: senderClean,
            body: aiReply,
            direction: "outbound",
            channel: "vapi-sms",
            status: "failed",
          }).catch(() => {});
        }
      } else {
        console.warn("[VAPI SMS] Twilio not configured — AI reply generated but not sent");
        await vapiStorage.createMessage({
          subAccountId,
          contactPhone: senderClean,
          body: aiReply,
          direction: "outbound",
          channel: "vapi-sms",
          status: "failed",
        }).catch(() => {});
      }
    } else {
      console.warn(`[VAPI SMS] No outbound phone number configured for account ${subAccountId}`);
    }

    try {
      const { checkAutomationSafety } = await import("./automationSafety");
      const automations = await vapiStorage.getLiveAutomations(subAccountId);
      const matching = (automations as any[]).filter((a: any) =>
        (a.status === "compiled" || a.status === "active") &&
        a.manifest?.trigger === "OnVapiSms"
      );

      if (matching.length > 0) {
        console.log(`[VAPI SMS] Found ${matching.length} OnVapiSms automation(s) to evaluate`);
        const accountRecord = await vapiStorage.getSubAccount(subAccountId);

        for (const automation of matching) {
          const triggerId = `OnVapiSms:${senderClean}:${Date.now()}`;
          const safety = checkAutomationSafety({
            automationId: automation.id,
            triggerId,
            depth: 0,
            accountId: subAccountId,
          });

          if (!safety.safe) {
            console.warn(`[VAPI SMS] Automation ${automation.id} blocked: ${safety.reason}`);
            continue;
          }

          console.log(`[VAPI SMS] Executing OnVapiSms automation id=${automation.id}`);
          const steps = automation.manifest?.steps || [];
          const triggerContext = {
            leadName: contactName,
            leadPhone: senderClean,
            senderPhone: senderClean,
            message: smsBody,
            channel: "vapi-sms",
            source: "vapi-sms",
          };

          for (const step of steps) {
            try {
              const action = step.action || step.type;
              if (!action) continue;

              if (action === "Wait" || action === "wait") {
                const waitMs = (step.payload?.seconds || step.seconds || 5) * 1000;
                await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 30000)));
                continue;
              }

              if (action === "Condition" || action === "condition") continue;

              const stepPayload = { ...step.payload };
              if (stepPayload.body && typeof stepPayload.body === "string") {
                stepPayload.body = stepPayload.body
                  .replace(/\{\{leadName\}\}/g, triggerContext.leadName)
                  .replace(/\{\{leadPhone\}\}/g, triggerContext.leadPhone)
                  .replace(/\{\{senderPhone\}\}/g, triggerContext.senderPhone)
                  .replace(/\{\{message\}\}/g, triggerContext.message);
              }
              if ((action === "send_sms" || action === "SMS") && !stepPayload.to) {
                stepPayload.to = senderClean;
              }
              if (!stepPayload.from && accountRecord?.twilioNumber) {
                stepPayload.from = accountRecord.twilioNumber;
              }
              stepPayload.subAccountId = subAccountId;

              const twilioClientStep = await getTwilioClient();
              if ((action === "send_sms" || action === "SMS") && twilioClientStep && stepPayload.to && stepPayload.body) {
                await twilioClientStep.messages.create({
                  body: stepPayload.body,
                  to: stepPayload.to,
                  from: stepPayload.from || account.twilioNumber || process.env.TWILIO_PHONE_NUMBER,
                });
                console.log(`[VAPI SMS] Automation step sent SMS to ${stepPayload.to}`);
              } else if (action !== "send_sms" && action !== "SMS") {
                console.log(`[VAPI SMS] Automation step action "${action}" not handled inline; skipping`);
              }
            } catch (stepErr: any) {
              console.error(`[VAPI SMS] Automation step error:`, stepErr?.message);
            }
          }

          try {
            await vapiStorage.updateLiveAutomation(automation.id, {
              lastRunAt: new Date(),
              runCount: (automation.runCount || 0) + 1,
              runLogs: [...((automation.runLogs as any[]) || []), {
                timestamp: new Date().toISOString(),
                trigger: "OnVapiSms",
                context: { leadName: contactName, leadPhone: senderClean },
                status: "completed",
              }].slice(-50),
            });
          } catch (logErr: any) {
            console.error("[VAPI SMS] Automation log update error:", logErr?.message);
          }
        }
      }
    } catch (automErr: any) {
      console.error("[VAPI SMS] Automation trigger error:", automErr?.message);
    }
  }

  app.post("/api/vapi/patch-assistant", async (req, res) => {
    try {
      await patchVapiAssistant();
      res.json({ ok: true, message: "Assistant patch triggered" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Patch failed" });
    }
  });

  app.post(
    "/api/vapi/webhook",
    withIdempotency({
      source: "vapi",
      extractExternalId: (req) => {
        const body = req.body || {};
        return (
          body.message?.call?.id ||
          body.message?.id ||
          body.call?.id ||
          body.id ||
          body.messageId ||
          null
        ) as string | null | undefined;
      },
      eventType: "vapi.webhook",
      maxRetries: 3,
    }),
    async (req, res) => {
    try {
      const msgType = req.body?.message?.type;

      if (!msgType) {
        const body = req.body || {};

        const smsFrom = body.from || body.From || body.customer?.number ||
          body.message?.customer?.number || body.call?.customer?.number;
        const smsBody = body.text || body.body || body.Body || body.content ||
          (typeof body.message === "string" ? body.message : null) ||
          body.transcript || body.lastMessage;
        const destNumber = body.to || body.To || body.phoneNumber?.number ||
          body.call?.phoneNumber?.number || null;
        const msgBodyId = body.messageId || body.id || null;

        if (smsFrom && (typeof smsBody === "string") && smsBody.trim()) {
          await handleVapiSms(smsFrom, smsBody.trim(), msgBodyId, destNumber);
          await markEventCompleted(req);
          return res.json({ ok: true });
        }

        if (body.type === "sms" || body.type === "message" || body.sms || body.text) {
          const altFrom = body.from || body.customer?.number;
          const altBody = body.text || body.sms || body.content || "";
          if (altFrom && altBody) {
            await handleVapiSms(altFrom, altBody, body.id || null, destNumber);
            await markEventCompleted(req);
            return res.json({ ok: true });
          }
          console.log(`[VAPI SMS] Inbound event (no extractable content):`, JSON.stringify(body).substring(0, 500));
          await markEventCompleted(req);
          return res.json({ ok: true });
        }

        console.log(`[VAPI WEBHOOK] Unknown payload (no message.type):`, JSON.stringify(body).substring(0, 300));
        await markEventCompleted(req);
        return res.json({ ok: true });
      }

      if (msgType === "conversation-update" || msgType === "transcript") {
        const msg = req.body.message;
        const customerNumber = msg?.customer?.number || msg?.call?.customer?.number;
        const destinationNumber = msg?.phoneNumber?.number || msg?.call?.phoneNumber?.number || null;
        const artifact = msg?.artifact || msg;
        const messages = artifact?.messages || [];

        const lastUserMessage = [...messages].reverse().find((m: any) =>
          m.role === "user" && m.content && typeof m.content === "string"
        );

        if (customerNumber && lastUserMessage) {
          const lastUserMsgIndex = messages.length - 1 - [...messages].reverse().findIndex((m: any) =>
            m.role === "user" && m.content && typeof m.content === "string"
          );
          const conversationId = msg?.conversationId || msg?.call?.id || null;
          const messageId = lastUserMessage.id
            ? String(lastUserMessage.id)
            : conversationId
              ? `${conversationId}:${lastUserMsgIndex}`
              : null;
          await handleVapiSms(customerNumber, lastUserMessage.content, messageId, destinationNumber).catch(
            err => console.error("[VAPI WEBHOOK] conversation-update SMS handler error:", err?.message)
          );
        }
      }

      if (msgType === "status-update") {
        const msg = req.body.message;
        console.log(`[VAPI WEBHOOK] status-update: status=${msg?.status}, callId=${msg?.call?.id}`);
      }

      if (msgType === "speech-update") {
        const msg = req.body.message;
        console.log(`[VAPI WEBHOOK] speech-update: status=${msg?.status}, role=${msg?.role}`);
      }

      if (msgType === "user-interrupted") {
        const msg = req.body.message;
        console.log(`[VAPI WEBHOOK] user-interrupted: callId=${msg?.call?.id}`);
      }

      if (msgType === "assistant.started") {
        const msg = req.body.message;
        console.log(`[VAPI WEBHOOK] assistant.started: assistantId=${msg?.assistant?.id || msg?.call?.assistantId}`);
      }

      if (msgType === "transfer-destination-request") {
        const msg = req.body.message;
        console.log(`[VAPI WEBHOOK] transfer-destination-request: callId=${msg?.call?.id}`);
      }

      if (msgType === "tool-calls") {
        const toolCalls = req.body.message.toolCalls || req.body.message.toolCallList || [];
        const results: any[] = [];
        for (const tc of toolCalls) {
          if (tc.function?.name === "sendBookingLink") {
            const phoneNumber = tc.function.arguments?.phoneNumber || req.body.message.call?.customer?.number;
            if (phoneNumber) {
              try {
                const client = await getTwilioClient();
                if (client) {
                  await client.messages.create({
                    body: "Here's your booking link to schedule a call with Apex: https://calendar.app.google/Fwdtvy7Sy3P8Z1CV6",
                    to: phoneNumber,
                    from: "+18777030325",
                  });
                  console.log(`[VAPI TOOL] Sent booking link SMS to ${phoneNumber}`);
                  results.push({ toolCallId: tc.id, result: "Booking link sent successfully via text." });
                } else {
                  results.push({ toolCallId: tc.id, result: "Could not send text right now. Ask them to visit apexmarketingautomations.com instead." });
                }
              } catch (smsErr: any) {
                console.error(`[VAPI TOOL] SMS failed:`, smsErr?.message);
                results.push({ toolCallId: tc.id, result: "Text failed to send. Ask them to visit apexmarketingautomations.com instead." });
              }
            } else {
              results.push({ toolCallId: tc.id, result: "No phone number available to send text to." });
            }
          } else if (tc.function?.name === "lookupProspect") {
            const phoneNumber = tc.function.arguments?.phoneNumber || req.body.message.call?.customer?.number;
            if (phoneNumber) {
              try {
                const cleaned = phoneNumber.replace(/\D/g, "").slice(-10);
                const rows = await vapiDb.select().from(contacts).where(vapiLike(contacts.phone, `%${cleaned}`)).limit(1);
                if (rows.length > 0) {
                  const c = rows[0];
                  const info = [`Name: ${c.firstName} ${c.lastName || ""}`.trim()];
                  if (c.company) info.push(`Company: ${c.company}`);
                  if (c.city && c.state) info.push(`Location: ${c.city}, ${c.state}`);
                  if (c.tags && c.tags.length > 0) info.push(`Tags: ${c.tags.join(", ")}`);
                  if (c.notes) info.push(`Notes: ${c.notes}`);
                  if (c.source) info.push(`Source: ${c.source}`);
                  results.push({ toolCallId: tc.id, result: `Found prospect in CRM: ${info.join(". ")}. Use this info naturally in the conversation — do not reveal you looked them up.` });
                } else {
                  results.push({ toolCallId: tc.id, result: "No existing record found for this number. This is a cold prospect." });
                }
              } catch (lookupErr: any) {
                console.error(`[VAPI TOOL] Lookup failed:`, lookupErr?.message);
                results.push({ toolCallId: tc.id, result: "Lookup unavailable. Treat as cold prospect." });
              }
            } else {
              results.push({ toolCallId: tc.id, result: "No phone number to look up." });
            }
          } else {
            results.push({ toolCallId: tc.id, result: "Unknown tool." });
          }
        }
        await markEventCompleted(req);
        return res.json({ results });
      }

      if (msgType === "assistant-request") {
        const customerNumber = req.body.message.call?.customer?.number;
        let contextNote = "";
        if (customerNumber) {
          try {
            const cleaned = customerNumber.replace(/\D/g, "").slice(-10);
            const rows = await vapiDb.select().from(contacts).where(vapiLike(contacts.phone, `%${cleaned}`)).limit(1);
            if (rows.length > 0) {
              const c = rows[0];
              const info = [`Name: ${c.firstName} ${c.lastName || ""}`.trim()];
              if (c.company) info.push(`Company: ${c.company}`);
              if (c.city && c.state) info.push(`Location: ${c.city}, ${c.state}`);
              if (c.tags && c.tags.length > 0) info.push(`Tags: ${c.tags.join(", ")}`);
              if (c.notes) info.push(`Notes: ${c.notes}`);
              contextNote = `\n\nPRE-CALL INTEL — you know this about the person you are calling: ${info.join(". ")}. Use this naturally. Do not say "I looked you up." Just weave it in like you already know.`;
            }
          } catch {}
        }
        if (contextNote) {
          console.log(`[VAPI WEBHOOK] Injecting pre-call context for ${customerNumber}`);
        }
        await markEventCompleted(req);
        return res.json({ assistantId: "e30434f7-e7e0-4be7-8b89-40c384a52b4a" });
      }

      if (msgType === "end-of-call-report") {
        const call = req.body.message;
        const transcript = call.transcript || call.artifact?.transcript || "";
        const summary = call.summary || call.artifact?.summary || "";
        const recordingUrl = call.recordingUrl || call.artifact?.recordingUrl || "";
        const startedAt = call.startedAt ? new Date(call.startedAt) : null;
        const endedAt = call.endedAt ? new Date(call.endedAt) : null;
        const duration = startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : call.duration || null;
        const callId = call.call?.id;
        if (callId) {
          const existing = await vapiDb.select().from(vapiCallLogs).where(vapiEq(vapiCallLogs.vapiCallId, callId)).limit(1);
          if (existing.length === 0) {
            const inserted = await vapiDb.insert(vapiCallLogs).values({
              vapiCallId: callId, assistantId: call.call.assistantId || null, assistantName: call.assistant?.name || null,
              customerNumber: call.call.customer?.number || null, type: call.call.type || null, status: call.call.status || "ended",
              startedAt, endedAt, duration, cost: call.cost || null, transcript, summary, recordingUrl, endedReason: call.endedReason || null, analysis: null,
            }).returning({ id: vapiCallLogs.id });
            console.log(`[VAPI WEBHOOK] Stored call log: ${callId}`);
            if (inserted[0]?.id) {
              analyzeCallTranscript(inserted[0].id)
                .then(result => { if (result) onCallAnalyzed().catch(() => {}); })
                .catch(err => console.error(`[VAPI WEBHOOK] Analysis failed for call ${inserted[0].id} (${callId}):`, err?.message ?? err, err?.stack));
            }
          }
        }
      }
      await markEventCompleted(req);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[VAPI WEBHOOK] Error:", err);
      await markEventFailed(req, err?.message || "Vapi webhook error").catch(() => {});
      res.json({ ok: true });
    }
  });

  app.post("/api/vapi/sync-calls", async (req, res) => {
    try {
      if (!vapiCfg.isConfigured) return res.status(503).json({ error: "Vapi not configured" });
      const resp = await fetch(`https://api.vapi.ai/call?limit=50`, { headers: vapiCfg.privateHeaders() });
      if (!resp.ok) return res.status(500).json({ error: "Failed to fetch calls" });
      const calls: any[] = await resp.json() as any[];
      let synced = 0;
      for (const c of calls) {
        if (!c.id || c.status !== "ended") continue;
        const existing = await vapiDb.select().from(vapiCallLogs).where(vapiEq(vapiCallLogs.vapiCallId, c.id)).limit(1);
        if (existing.length > 0) continue;
        const transcript = c.transcript || c.artifact?.transcript || "";
        const summary = c.summary || c.artifact?.summary || "";
        const recordingUrl = c.recordingUrl || c.artifact?.recordingUrl || "";
        const startedAt = c.startedAt ? new Date(c.startedAt) : null;
        const endedAt = c.endedAt ? new Date(c.endedAt) : null;
        const duration = startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : c.duration || null;
        await vapiDb.insert(vapiCallLogs).values({
          vapiCallId: c.id, assistantId: c.assistantId || null, assistantName: c.assistant?.name || null,
          customerNumber: c.customer?.number || null, type: c.type || null, status: c.status,
          startedAt, endedAt, duration, cost: c.cost || null, transcript, summary, recordingUrl, endedReason: c.endedReason || null, analysis: null,
        });
        synced++;
      }
      console.log(`[VAPI SYNC] Synced ${synced} new call logs`);
      res.json({ synced, total: calls.length });
    } catch (err) { console.error("[VAPI SYNC] Error:", err); res.status(500).json({ error: "Sync failed" }); }
  });

  app.post("/api/vapi/analyze-all", async (req, res) => {
    try {
      const count = await analyzeAllUnprocessed();
      res.json({ analyzed: count });
    } catch (err) { console.error("[VAPI ANALYZE] Error:", err); res.status(500).json({ error: "Analysis failed" }); }
  });

  app.get("/api/vapi/pattern-report", async (req, res) => {
    try {
      const report = await generatePatternReport();
      res.json(report);
    } catch (err) { console.error("[VAPI PATTERNS] Error:", err); res.status(500).json({ error: "Pattern report failed" }); }
  });

  app.post("/api/vapi/inject-patterns/:assistantId", async (req, res) => {
    try {
      const assistantId = req.params.assistantId as string;
      if (!assistantId) return res.status(400).json({ error: "assistantId required" });
      const result = await injectPatternsIntoAgent(assistantId);
      res.json(result);
    } catch (err) { console.error("[VAPI INJECT] Error:", err); res.status(500).json({ error: "Injection failed" }); }
  });

  app.get("/api/vapi/call-insights", async (req, res) => {
    try {
      const outcome = req.query.outcome as string | undefined;
      const minEngagement = parseInt(req.query.minEngagement as string || "0", 10);
      const objection = req.query.objection as string | undefined;

      let query = vapiDb.select().from(vapiCallLogs).where(vapiIsNotNull(vapiCallLogs.analysis)).orderBy(vapiDesc(vapiCallLogs.id)).limit(100);
      const rows = await query;

      let filtered = rows.filter(r => {
        const a = r.analysis as any;
        if (!a) return false;
        if (outcome && a.outcome !== outcome) return false;
        if (minEngagement && a.engagement_score < minEngagement) return false;
        if (objection) {
          const hasObj = a.objections?.some((o: any) => o.objection?.toLowerCase().includes(objection.toLowerCase()));
          if (!hasObj) return false;
        }
        return true;
      });

      res.json(filtered.map(r => ({
        id: r.id,
        vapiCallId: r.vapiCallId,
        customerNumber: r.customerNumber,
        duration: r.duration,
        cost: r.cost,
        endedReason: r.endedReason,
        analysis: r.analysis,
        createdAt: r.createdAt,
      })));
    } catch (err) { console.error("[VAPI INSIGHTS] Error:", err); res.status(500).json({ error: "Query failed" }); }
  });

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/google", authLimiter);
  app.use("/api", apiLimiter);

  await setupAuth(app);
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);
    if (status >= 500) {
      logSystemError("server", message, {
        path: _req.path,
        method: _req.method,
        stack: err.stack?.substring(0, 500),
      });
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      try {
        const { startAutoLearningLoop: startLoop } = await import("./callIntelligence");
        startLoop();
      } catch (err: any) {
        console.error("[CALL-INTEL] Failed to start auto-learning loop:", err?.message);
      }
      try {
        const { startRetryProcessor } = await import("./eventRetryProcessor");
        startRetryProcessor(60_000);
      } catch (err: any) {
        console.error("[RETRY-PROCESSOR] Failed to start:", err?.message);
      }
    },
  );
})();
