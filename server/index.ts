// @ts-nocheck
// ⚠️  MUST be first — Sentry instruments modules as they load
import "./instrument";
import { flushLogs, logger } from "./logger";
import { Sentry } from "./instrument";

import express, { type Request, Response, NextFunction } from "express";
import crypto from "crypto";
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
// Imported from the dedicated, bundle-safe router module (no `import.meta.url`,
// no CLI side-effects), so esbuild can inline it into dist/index.cjs without
// the ESM-only top-level constructs that live in the CLI shim mcp-fs-server.js.
// Type surface is declared in `mcp-fs-router.d.ts` (sibling to the .js file).
import { createMcpFsRouter } from "../mcp-fs-router.js";
import { runStartupChecks } from "./startupChecks";
import { logSystemError, logSystemEvent } from "./systemLogger";
import { clearLaylaCache } from "./services/laylaAccountResolver";
import { ensureAccountsUnprotected } from "./startupPatches";
import { getStitchApiKey } from "./stitchApi";

function isRedisQuotaError(reason: any): boolean {
  const s = `${reason?.message ?? ""} ${String(reason)}`;
  return s.includes("max requests limit exceeded") || s.includes("ERR max") || s.includes("QUOTA");
}

process.on("unhandledRejection", (reason: any) => {
  // Swallow Upstash quota errors silently — circuit breaker handles the worker shutdown
  if (isRedisQuotaError(reason)) return;
  console.error("[PROCESS] Unhandled promise rejection (caught, not crashing):", reason?.message || reason);
  logSystemError("process", "Unhandled promise rejection", {
    message: reason?.message || String(reason),
    stack: reason?.stack?.substring(0, 500),
  });
});

process.on("uncaughtException", (err: Error) => {
  if (isRedisQuotaError(err)) return;
  console.error("[PROCESS] Uncaught exception (caught, not crashing):", err.message);
  logSystemError("process", "Uncaught exception", {
    message: err.message,
    stack: err.stack?.substring(0, 500),
  });
});
import { apiLimiter, authLimiter, webhookLimiter, creditTopupLimiter, uploadLimiter } from "./rateLimiter";
import { dispatchAlert, generateDeepLink } from "./pushAlertService";
import { initEventSubscribers } from "./eventSubscribers";
import { eventBus } from "./eventBus";
import { recordSuccess as recordPulseSuccess } from "./pulse";
import { withIdempotency, markEventCompleted, markEventFailed } from "./idempotency";
import { enforceSmsProvider } from "./smsGatewayGuard";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { csrfProtection } from "./csrfProtection";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    frameguard: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],
        frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
        frameAncestors: [
          "'self'",
          "https://*.replit.dev",
          "https://*.repl.co",
          "https://replit.com"
        ],
      },
    },
  })
);

const voiceBrowserCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob: data: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.daily.co https://*.vapi.ai",
  "frame-ancestors 'self' https://*.replit.dev https://*.repl.co https://replit.com",
].join("; ");

app.use(["/kiosk/frontdesk", "/frontdesk", "/voice-agent"], (_req, res, next) => {
  res.setHeader("Content-Security-Policy", voiceBrowserCsp);
  next();
});

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

    console.log("[STRIPE] Webhook managed via Stripe Dashboard (automatic registration disabled)");

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
      if (!whSecret) {
        console.error("[STRIPE] Webhook signing credential not configured — rejecting webhook");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }
      const stripe = new Stripe(process.env.STRIPE_API_SECRET || "", { apiVersion: "2025-08-27.basil" as any });
      stripe.webhooks.constructEvent(req.body, sig, whSecret);

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

        if (meta?.source === "roomos" && meta?.cbUsername && meta?.roomosPlan) {
          try {
            const { provisionRoomOSAccount } = await import("./services/roomOS/provisioning");
            const result = await provisionRoomOSAccount({
              cbUsername: meta.cbUsername,
              email: meta.email || session.customer_email || "",
              plan: meta.roomosPlan as "roomos_starter" | "roomos_pro",
              userId: meta.userId,
              firstName: meta.firstName,
            });
            console.log(`[ROOMOS] Stripe fulfillment complete: account=${result.subAccountId}, pro=${result.cbProMode}, welcomeEmail=${result.welcomeEmailSent}`);
          } catch (roomErr: any) {
            console.error(`[ROOMOS] Stripe fulfillment error:`, roomErr.message);
          }
        }

        if (meta?.source === "standalone_card") {
          try {
            const { handleStandaloneCardWebhook } = await import("./routes/standalone-cards");
            await handleStandaloneCardWebhook(session);
            console.log(`[STANDALONE] Card fulfillment processed for session ${session.id}`);
          } catch (scErr: any) {
            console.error(`[STANDALONE] Card fulfillment error:`, scErr.message);
          }
        }

        if (meta?.source === "digital_card") {
          try {
            const { handleDigitalCardWebhook } = await import("./routes/cards");
            await handleDigitalCardWebhook(session);
            console.log(`[DIGITAL-CARD] Fulfillment processed for session ${session.id}`);
          } catch (dcErr: any) {
            console.error(`[DIGITAL-CARD] Fulfillment error:`, dcErr.message);
          }
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

      if (event?.type === "setup_intent.succeeded") {
        try {
          const setupIntent = event.data?.object;
          if (setupIntent?.metadata?.source === "event" && setupIntent.id) {
            const { validateAndProvision } = await import("./routes/event");
            const result = await validateAndProvision(setupIntent.id);
            console.log(`[EVENT-WEBHOOK] setup_intent.succeeded ${setupIntent.id} ->`, result);
          }
        } catch (e: any) {
          console.error("[EVENT-WEBHOOK] setup_intent handler error:", e?.message);
        }
      }

      if (event?.type === "customer.subscription.trial_will_end") {
        const subscription = event.data?.object;
        console.log(`[STRIPE] Trial will end for subscription ${subscription?.id} on ${new Date((subscription?.trial_end || 0) * 1000).toISOString()}`);
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
        } catch (err) { console.warn("[INDEX] caught:", err instanceof Error ? err.message : err); }
      }
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("[STRIPE] Webhook error:", error.message);
      logSystemError("stripe_webhook", error.message, { stack: error.stack?.substring(0, 500) });
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

// Mount the Filesystem MCP server at /fs-mcp BEFORE the global JSON body
// parser so it can apply its own (larger) limit and so its SSE endpoint
// keeps the response stream open without interference from later middleware.
// Gives Claude on the web a stable always-on URL on the published deployment:
//   https://<deployment-host>/fs-mcp/sse  (Authorization: Bearer <MCP_FS_TOKEN>)
// When MCP_FS_TOKEN is unset (e.g. local dev without filesystem access enabled),
// the route is silently skipped.
if (process.env.MCP_FS_TOKEN && process.env.MCP_FS_TOKEN.trim().length >= 8) {
  try {
    app.use("/fs-mcp", createMcpFsRouter({ messagesPath: "/fs-mcp/messages" }));
    console.log("[MCP-FS] mounted on main app at /fs-mcp (SSE: /fs-mcp/sse)");
  } catch (mcpErr: unknown) {
    const msg = mcpErr instanceof Error ? mcpErr.message : String(mcpErr);
    console.error("[MCP-FS] failed to mount router on main app:", msg);
  }
} else {
  console.log("[MCP-FS] /fs-mcp route NOT mounted (MCP-FS credential missing or too short)");
}

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());


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
        const SENSITIVE = new Set(["apiKey","token","accessToken","refreshToken","secret","password","privateKey","clientSecret"]);
        const redact = (o: any, d=0): any => {
          if (d > 3 || !o || typeof o !== "object") return o;
          const r: any = Array.isArray(o) ? [] : {};
          for (const k of Object.keys(o)) {
            r[k] = SENSITIVE.has(k) && typeof o[k] === "string" ? o[k].slice(0,4)+"...[redacted]" : redact(o[k], d+1);
          }
          return r;
        };
        const responseStr = JSON.stringify(redact(capturedJsonResponse));
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

  // P1 security check: STANDALONE_ADMIN_SECRET must be set in production.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !process.env.STANDALONE_ADMIN_SECRET?.trim()) {
    console.error("[STARTUP] [SECURITY] STANDALONE_ADMIN_SECRET is not set in production. Internal admin routes will return 503. Set this env var in Railway immediately.");
    // Do not throw — log loudly but keep the app running so other services stay up.
  }
  console.log(`[STARTUP] [SECURITY] STANDALONE_ADMIN_SECRET present=${!!process.env.STANDALONE_ADMIN_SECRET?.trim()}`);

  const checks: { key: string; altKey?: string; label: string; critical: boolean }[] = [
    { key: "STANDALONE_ADMIN_SECRET", label: "Admin Secret (internal route auth — REQUIRED in production)", critical: isProd },
    { key: "VAPI_PRIVATE_KEY_APEX", altKey: "VAPI_PRIVATE_KEY", label: "Vapi Private Key (server-side API calls)", critical: true },
    { key: "VAPI_PUBLIC_KEY", altKey: "apex_public_vapi", label: "Vapi Public Key (browser demo calls)", critical: false },
    { key: "VAPI_ORG_ID", label: "Vapi Organization ID", critical: false },
    { key: "VAPI_PHONE_NUMBER_ID", label: "Vapi Default Phone Number ID (auto-inject for outbound)", critical: false },
    { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID (phone provisioning)", critical: false },
    { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token (phone provisioning)", critical: false },
    { key: "OPENAI_APEX_INT_KEY", label: "OpenAI API Key (AI features, primary)", critical: false },
    { key: "Gemini_API_Key_saas", label: "Gemini API Key (AI features, fallback)", critical: false },
    { key: "GOOGLE_API_KEY", label: "Google API Key (Maps, Places, etc.)", critical: false },
    { key: "META_APP_ID", label: "Meta App ID (optional, for app-level ops)", critical: false },
    { key: "AGENT_SECRET", label: "Agent Worker HMAC Secret (webhook signature verification)", critical: false },
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
    console.log("[STARTUP] Critical voice credentials missing. Voice agent features will be unavailable.");
  }

  if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN) {
    console.log("[WARN] Twilio SID is set but auth credential is missing — Twilio will not work.");
  }
  if (!process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log("[WARN] Twilio auth credential is set but SID is missing — Twilio will not work.");
  }

  console.log("  [INFO] Meta/Facebook credentials are now per-account (stored in sub_accounts table).");

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
      console.log("[META STARTUP] Found global Meta env credentials — migrating to default sub-account...");
      const defaultAccount = allAccounts.find(a => a.ownerUserId !== "_archived") || allAccounts[0];
      if (defaultAccount) {
        await db.update(subAccounts).set({
          metaPageId: process.env.META_PAGE_ID,
          metaAccessToken: process.env.META_ACCESS_TOKEN,
          metaAppSecret: process.env.META_APP_SECRET || null,
        }).where(eq(subAccounts.id, defaultAccount.id));
        console.log(`[META STARTUP] Migrated global Meta credentials to account ${defaultAccount.id} (${defaultAccount.name}). Remove legacy Meta env vars — credentials are now stored per-account.`);
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
  clearLaylaCache();
  await ensureAccountsUnprotected();
  // Sequence audit runs in the listen callback where Railway captures logs (see below)
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
    const { ensureAgentWorkerTables } = await import("./agentWorkerMigration");
    await ensureAgentWorkerTables();
  } catch (migErr) {
    console.error("[STARTUP] Agent worker migration failed (non-fatal):", migErr);
  }

  try {
    await seed();
  } catch (seedErr) {
    console.error("[STARTUP] Seed failed (non-fatal):", seedErr);
  }

  // ── Email provider boot log ─────────────────────────────────────────────────
  try {
    const { logEmailProviderStartup } = await import("./messaging/sendEmail");
    logEmailProviderStartup();
  } catch (emailErr) {
    console.error("[STARTUP] Email provider boot log failed (non-fatal):", emailErr);
  }

  // ── AI provider boot log ────────────────────────────────────────────────────
  try {
    const { logProviderStartup } = await import("./aiGateway");
    logProviderStartup();
  } catch (aiErr) {
    console.error("[STARTUP] AI provider boot log failed (non-fatal):", aiErr);
  }

  const DISABLE_BACKGROUND_WORKERS = process.env.DISABLE_BACKGROUND_WORKERS === "true";
  if (DISABLE_BACKGROUND_WORKERS) {
    console.log("[STARTUP] ⏸ Background workers DISABLED (DISABLE_BACKGROUND_WORKERS=true)");
  } else {
    console.log("[STARTUP] ✅ Background workers ENABLED (DISABLE_BACKGROUND_WORKERS is not 'true')");
  }

  if (!DISABLE_BACKGROUND_WORKERS) {
  try {
    const { startCrashReportWorker } = await import("./crashReportWorker");
    startCrashReportWorker();
    console.log("[STARTUP] ✅ Crash report worker started");
  } catch (workerErr) {
    console.error("[STARTUP] Crash report worker failed (non-fatal):", workerErr);
  }
  }

  if (!DISABLE_BACKGROUND_WORKERS) {
  try {
    const { startCrashIngestPipeline } = await import("./crashIngestPipeline");
    startCrashIngestPipeline();
    console.log("[STARTUP] ✅ Crash ingest pipeline started");
  } catch (pipeErr) {
    console.error("[STARTUP] Crash ingest pipeline failed (non-fatal):", pipeErr);
  }
  }

  if (!DISABLE_BACKGROUND_WORKERS) {
  try {
    const { startApexLeadEngine } = await import("./apexLeadEngine");
    startApexLeadEngine();
    console.log("[STARTUP] ✅ Apex Lead Engine started — all verticals active (legal/home/beauty/auto)");
  } catch (engineErr: any) {
    console.error("[STARTUP] Apex Lead Engine failed to start:", engineErr.message);
  }
  try {
    const { startLegalPipeline } = await import("./legalSignalPipeline");
    startLegalPipeline(); // runs for all accounts
    console.log("[STARTUP] ✅ Legal signal pipeline started — FL arrests, OSHA, FDA/CPSC recalls, Google Places local businesses");
  } catch (legalErr) {
    console.error("[STARTUP] Legal pipeline failed (non-fatal):", legalErr);
  }

  try {
    const { startDolSafetyPipeline } = await import("./dolSafetyPipeline");
    startDolSafetyPipeline();
    console.log("[STARTUP] ✅ DOL Safety Intelligence pipeline started — OSHA accidents/inspections, MSHA violations → legal + insurance leads");
  } catch (dolErr: any) {
    console.error("[STARTUP] DOL Safety pipeline failed (non-fatal):", dolErr?.message);
  }

  try {
    const { startApifyLeadScrapers } = await import("./apifyLeadScrapers");
    startApifyLeadScrapers();
    console.log("[STARTUP] ✅ Apify lead scrapers started — Google Maps (12h) + Zillow (24h)");
  } catch (apifyErr: any) {
    console.error("[STARTUP] Apify lead scrapers failed (non-fatal):", apifyErr?.message);
  }

  try {
    const { startCaseIntelligence } = await import("./caseIntelligence");
    startCaseIntelligence();
    console.log("[STARTUP] ✅ Case Intelligence Engine started — entity resolution + case grouping");
  } catch (caseErr: any) {
    console.error("[STARTUP] Case Intelligence failed to start (non-fatal):", caseErr?.message);
  }

  try {
    // ── One-time idempotent Nimble agent setup (runs on every boot, skips if agents already exist) ──
    // Creates all jail-booking + court-filing named agents in Nimble before pipelines start.
    // Safe to run repeatedly — each county agent is checked for existence first.
    try {
      const { setupAllBookingAgents } = await import("./nimbleAgentSetup");
      console.log("[STARTUP] 🔧 Running Nimble jail-booking agent setup (idempotent)...");
      await setupAllBookingAgents();
      console.log("[STARTUP] ✅ Nimble jail-booking agents ready");
    } catch (agentErr: any) {
      console.error("[STARTUP] Nimble jail-booking agent setup failed (non-fatal):", agentErr?.message);
    }

    try {
      const { setupAllCourtFilingAgents } = await import("./courtFilingAgentSetup");
      console.log("[STARTUP] 🔧 Running Nimble court-filing agent setup (idempotent)...");
      await setupAllCourtFilingAgents();
      console.log("[STARTUP] ✅ Nimble court-filing agents ready");
    } catch (courtAgentErr: any) {
      console.error("[STARTUP] Nimble court-filing agent setup failed (non-fatal):", courtAgentErr?.message);
    }

    const { startJailBookingScheduler } = await import("./jailBookingPipeline");
    startJailBookingScheduler();
    console.log("[STARTUP] ✅ Jail Booking Pipeline started — 11 FL counties via Nimble browser agents (LEE/CHARLOTTE/COLLIER/HENDRY/GLADES/SARASOTA/MANATEE/POLK/HILLSBOROUGH/PINELLAS/PASCO)");
  } catch (jailErr: any) {
    console.error("[STARTUP] Jail Booking Pipeline failed to start (non-fatal):", jailErr?.message);
  }

  try {
    const { startArrestIngestScheduler } = await import("./arrestIngestPipeline");
    startArrestIngestScheduler();
    console.log("[STARTUP] ✅ Arrest Ingest Pipeline started — direct Nimble REST + Apify fallback, every 6h (LEE/CHARLOTTE/COLLIER/HENDRY/GLADES/SARASOTA/MANATEE/POLK/HILLSBOROUGH/PINELLAS/PASCO)");
  } catch (arrestErr: any) {
    console.error("[STARTUP] Arrest Ingest Pipeline failed to start (non-fatal):", arrestErr?.message);
  }

  try {
    const { startHomeServicePipeline } = await import("./homeServiceSignalPipeline");
    startHomeServicePipeline();
    console.log("[STARTUP] ✅ Home Service pipeline started — FL roofing/plumbing/HVAC/pest-control signals");
  } catch (homeErr: any) {
    console.error("[STARTUP] Home Service pipeline failed to start (non-fatal):", homeErr?.message);
  }

  try {
    const { startCourtFilingScheduler } = await import("./courtFilingPipeline");
    startCourtFilingScheduler();
    console.log("[STARTUP] ✅ Court Filing pipeline started — FL family law/probate signals (every 6 hours)");
  } catch (courtErr: any) {
    console.error("[STARTUP] Court Filing pipeline failed to start (non-fatal):", courtErr?.message);
  }

  try {
    const { startCourtListenerScheduler } = await import("./courtListenerPipeline");
    startCourtListenerScheduler();
    console.log("[STARTUP] ✅ CourtListener pipeline started — FL bankruptcy filings (flmb/flsb/flnb, every 6h)");
  } catch (clErr: any) {
    console.error("[STARTUP] CourtListener pipeline failed to start (non-fatal):", clErr?.message);
  }

  try {
    const { startClerkTrafficScheduler } = await import("./clerkTrafficEnrich");
    startClerkTrafficScheduler();
    console.log("[STARTUP] ✅ Clerk Traffic enrichment started — SWFL crash name recovery (LEE/COLLIER/CHARLOTTE, every 6h)");
  } catch (clerkErr: any) {
    console.error("[STARTUP] Clerk Traffic enrichment failed to start (non-fatal):", clerkErr?.message);
  }

  try {
    const { startHillsboroughRecordsScheduler } = await import("./hillsboroughRecordsPipeline");
    startHillsboroughRecordsScheduler();
    console.log("[STARTUP] ✅ Hillsborough Official Records pipeline started — lis pendens + judgments (daily at 06:00 ET)");
  } catch (hillsErr: any) {
    console.error("[STARTUP] Hillsborough Records pipeline failed to start (non-fatal):", hillsErr?.message);
  }

  try {
    const { startHillsboroughFilingsScheduler } = await import("./hillsboroughCourtFilingsPipeline");
    startHillsboroughFilingsScheduler();
    console.log("[STARTUP] ✅ Hillsborough Court Filings pipeline started — divorce/custody/probate/foreclosure (daily at 07:00 ET)");
  } catch (hillsFilingsErr: any) {
    console.error("[STARTUP] Hillsborough Filings pipeline failed to start (non-fatal):", hillsFilingsErr?.message);
  }

  try {
    const { startRetroSkipTraceScheduler } = await import("./retroSkipTrace");
    startRetroSkipTraceScheduler();

    // Apify attorney lead scraper
    const { startApifyScheduler } = await import("./apifyAttorneyScraper");
    startApifyScheduler();
  } catch (retroErr: any) {
    console.error("[STARTUP] Retro skip trace scheduler failed (non-fatal):", retroErr?.message);
  }

  try {
    const { startSentinelFollowupScheduler } = await import("./crashIngestPipeline");
    startSentinelFollowupScheduler();
    console.log("[STARTUP] ✅ Sentinel follow-up scheduler started — creates FLHSMV lookup jobs for AWAITING crash reports (every 4h)");
  } catch (followupErr: any) {
    console.error("[STARTUP] Sentinel follow-up scheduler failed to start (non-fatal):", followupErr?.message);
  }

  try {
    const { startFLHSMVDirectScanScheduler } = await import("./flhsmvDirectScan");
    startFLHSMVDirectScanScheduler();
    console.log("[STARTUP] ✅ FLHSMV direct scan scheduler started — discovers local agency crashes (Cape Coral PD, Fort Myers PD, etc.) every 2h");
  } catch (directScanErr: any) {
    console.error("[STARTUP] FLHSMV direct scan scheduler failed to start (non-fatal):", directScanErr?.message);
  }
  }

  // Phase 11 — Enterprise Control Center startup
  try {
    const { seedSystemRoles } = await import("./enterprise/rbacPermissionSystem");
    await seedSystemRoles();
  } catch (enterpriseErr: any) {
    console.error("[STARTUP] Enterprise RBAC seed failed (non-fatal):", enterpriseErr?.message);
  }

  try {
    const { storage } = await import("./storage");
    initEventSubscribers(storage);
    console.log("[STARTUP] Event bus initialized");
  } catch (ebErr) {
    console.error("[STARTUP] Event bus init failed (non-fatal):", ebErr);
  }

  if (!DISABLE_BACKGROUND_WORKERS) {
  try {
    const { initOperator } = await import("./operator/index");
    initOperator();
    console.log("[STARTUP] ✅ Operator initialized");
  } catch (opErr) {
    console.error("[STARTUP] Operator init failed (non-fatal):", opErr);
  }
  }

  const { vapiCallLogs } = await import("@shared/schema");
  const { db: vapiDb } = await import("./db");
  const { eq: vapiEq, isNotNull: vapiIsNotNull, sql: vapiSql, desc: vapiDesc } = await import("drizzle-orm");
  const { vapiConfig: vapiCfg } = await import("./routes/helpers");
  const { analyzeCallTranscript, analyzeAllUnprocessed, generatePatternReport, generatePromptEnrichment, injectPatternsIntoAgent, onCallAnalyzed, startAutoLearningLoop } = await import("./callIntelligence");

  const { contacts } = await import("@shared/schema");
  const { like: vapiLike, and: vapiAnd } = await import("drizzle-orm");
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

  async function patchVapiPhoneNumbers(): Promise<void> {
    if (!vapiCfg.isConfigured) return;
    try {
      const listRes = await fetch("https://api.vapi.ai/phone-number", {
        headers: vapiCfg.privateHeaders(),
      });
      if (!listRes.ok) {
        console.warn(`[VAPI PATCH] Failed to list phone numbers: ${listRes.status}`);
        return;
      }
      const numbers = await listRes.json() as any[];
      for (const num of numbers) {
        if (num.serverUrl !== VAPI_SERVER_URL) {
          const patchRes = await fetch(`https://api.vapi.ai/phone-number/${num.id}`, {
            method: "PATCH",
            headers: vapiCfg.privateHeaders(),
            body: JSON.stringify({ serverUrl: VAPI_SERVER_URL }),
          });
          if (patchRes.ok) {
            console.log(`[VAPI PATCH] Phone ${num.number || num.id} patched: serverUrl set for assistant-request routing`);
          } else {
            const errTxt = await patchRes.text();
            console.warn(`[VAPI PATCH] Failed to patch phone ${num.id}: ${patchRes.status} ${errTxt.substring(0, 200)}`);
          }
        }
      }
    } catch (err: any) {
      console.error("[VAPI PATCH] Phone number patch error:", err?.message);
    }
  }

  patchVapiPhoneNumbers().catch(err => console.error("[VAPI PATCH] Phone patch failed:", err?.message));

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
      const { sendSms: sendSmsOptOut } = await import("./messaging/sendSms");
      const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
      const optOutResult = await sendSmsOptOut({
        subAccountId,
        to: senderClean,
        body: "You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.",
        from: fromNumber || undefined,
        source: "vapi-sms-opt-out",
        path: "auto-reply",
        channel: "vapi-sms",
      });
      if (!optOutResult.ok) {
        console.error(`[VAPI SMS OPT-OUT] confirmation send failed reason=${optOutResult.reason} err=${optOutResult.errorMessage}`);
      }
      return;
    }

    if (isIn(smsBody)) {
      await optIn(senderClean, subAccountId);
      console.log(`[VAPI SMS OPT-IN] ${senderClean} opted in`);
      const { sendSms: sendSmsOptIn } = await import("./messaging/sendSms");
      const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
      const optInResult = await sendSmsOptIn({
        subAccountId,
        to: senderClean,
        body: "You have been re-subscribed and will receive messages from us again.",
        from: fromNumber || undefined,
        source: "vapi-sms-opt-in",
        path: "auto-reply",
        channel: "vapi-sms",
      });
      if (!optInResult.ok) {
        console.error(`[VAPI SMS OPT-IN] confirmation send failed reason=${optInResult.reason} err=${optInResult.errorMessage}`);
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

    let contactName = "Unknown";
    try {
      const cleaned = senderClean.replace(/\D/g, "").slice(-10);
      const e164Phone = cleaned.length === 10 ? `+1${cleaned}` : `+${cleaned}`;
      const existingContacts = await vapiDb.select().from(contacts)
        .where(vapiAnd(
          vapiEq(contacts.subAccountId, subAccountId),
          vapiLike(contacts.phone, `%${cleaned}`)
        )).limit(1);

      if (existingContacts.length === 0) {
        const newContact = await vapiStorage.createContact({
          subAccountId,
          firstName: "Unknown",
          phone: e164Phone,
          source: "vapi-sms",
          tags: ["vapi-sms", "sms_lead"],
        });
        console.log(`[VAPI SMS] Created CRM contact id=${newContact.id} phone="${e164Phone}" subAccount=${subAccountId}`);
      } else {
        const c = existingContacts[0];
        const rawN = `${c.firstName} ${c.lastName || ""}`.trim();
        contactName = /^(SMS\s*\d+|Unknown|Vapi SMS\s*\d+|user\s*\d+)$/i.test(rawN) ? "Unknown" : rawN;
        console.log(`[VAPI SMS] Found existing CRM contact id=${c.id} name="${contactName}" subAccount=${subAccountId}`);
      }
    } catch (crmErr: any) {
      console.error("[VAPI SMS] CRM contact error:", crmErr?.message);
    }

    const isOptedOut = await checkPhoneOptOut(senderClean, subAccountId).catch((err) => { console.warn("[INDEX] promise rejected, using default false:", err instanceof Error ? err.message : err); return false; });
    if (isOptedOut) {
      console.log(`[VAPI SMS] ${senderClean} is opted out — skipping AI reply`);
      return;
    }

    const aiReply = await generateVapiAiReply(smsBody);

    const fromNumber = account.twilioNumber || process.env.TWILIO_PHONE_NUMBER;
    {
      const { sendSms: sendSmsAiReply } = await import("./messaging/sendSms");
      const aiReplyResult = await sendSmsAiReply({
        subAccountId,
        to: senderClean,
        body: aiReply,
        from: fromNumber || undefined,
        source: "vapi-sms-ai-reply",
        path: "auto-reply",
        channel: "vapi-sms",
      });
      if (aiReplyResult.ok) {
        console.log(`[VAPI SMS] AI reply sent to ${senderClean} via Twilio sid=${aiReplyResult.twilioSid}`);
      } else {
        console.error(`[VAPI SMS] AI reply send failed reason=${aiReplyResult.reason} err=${aiReplyResult.errorMessage}`);
      }
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

              if ((action === "send_sms" || action === "SMS") && stepPayload.to && stepPayload.body) {
                const { sendSms: sendSmsStep } = await import("./messaging/sendSms");
                const stepResult = await sendSmsStep({
                  subAccountId,
                  to: stepPayload.to,
                  body: stepPayload.body,
                  from: stepPayload.from || account.twilioNumber || process.env.TWILIO_PHONE_NUMBER || undefined,
                  source: "vapi-sms-automation-step",
                  path: "automation",
                  channel: "vapi-sms",
                  metadata: { automationId: automation.id, action },
                });
                if (stepResult.ok) {
                  console.log(`[VAPI SMS] Automation step sent SMS to ${stepPayload.to} sid=${stepResult.twilioSid}`);
                } else {
                  console.error(`[VAPI SMS] Automation step send failed to=${stepPayload.to} reason=${stepResult.reason} err=${stepResult.errorMessage}`);
                }
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
        const callId = body.message?.call?.id ||
          body.message?.id ||
          body.call?.id ||
          body.id ||
          body.messageId ||
          null;
        const msgType = body.message?.type || "unknown";
        return callId ? `${callId}:${msgType}` : null;
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
        if (msg?.status === "no-answer" || msg?.status === "busy" || msg?.status === "failed") {
          const custNum = msg?.call?.customer?.number;
          if (custNum) {
            (async () => {
              try {
                const { contacts: ct } = await import("@shared/schema");
                const { eq: eqOp2 } = await import("drizzle-orm");
                const rows = await vapiDb.select().from(ct).where(eqOp2(ct.phone, custNum)).limit(1);
                const missedSubId = rows[0]?.subAccountId || 13;
                eventBus.publish({ type: "call.missed" as any, subAccountId: missedSubId, data: { callId: msg?.call?.id, customerNumber: custNum, status: msg.status } });
                const { fireAutomationTriggerGlobal } = await import("./routes/v1");
                fireAutomationTriggerGlobal("call_missed", missedSubId, { leadPhone: custNum, status: msg.status, source: "vapi_call" });
                import("./intelligence/eventEmitter").then(({ emitUniversalEvent, EVENT_TYPES: EVT }) => {
                  emitUniversalEvent({ eventType: EVT.CALL_MISSED, sourceModule: "voice", sourceRecordId: msg?.call?.id || "unknown", subAccountId: missedSubId, metadata: { callId: msg?.call?.id, customerNumber: custNum, status: msg.status } });
                }).catch((err) => console.warn("[INDEX] promise rejected:", err instanceof Error ? err.message : err));
              } catch (err) { console.warn("[INDEX] caught:", err instanceof Error ? err.message : err); }
            })();
          }
        }
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
              const { sendSms: sendSmsBooking } = await import("./messaging/sendSms");
              const bookingResult = await sendSmsBooking({
                subAccountId: 0,
                to: phoneNumber,
                body: "Here's your booking link to schedule a call with Apex: https://calendar.app.google/Fwdtvy7Sy3P8Z1CV6",
                from: "+18777030325",
                source: "vapi-tool-booking-link",
                path: "auto-reply",
                channel: "vapi-sms",
              });
              if (bookingResult.ok) {
                console.log(`[VAPI TOOL] Sent booking link SMS to ${phoneNumber} sid=${bookingResult.twilioSid}`);
                results.push({ toolCallId: tc.id, result: "Booking link sent successfully via text." });
              } else {
                console.error(`[VAPI TOOL] Booking link SMS failed reason=${bookingResult.reason} err=${bookingResult.errorMessage}`);
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
                const toolCalledNumber = req.body.message.call?.phoneNumber?.number || req.body.message.call?.to || "";
                let toolSubAccountId: number | null = null;
                if (toolCalledNumber) {
                  const toolCalledDigits = toolCalledNumber.replace(/\D/g, "").slice(-10);
                  const accts = await vapiStorage.getSubAccounts();
                  const m = accts.find((a: any) => (a.twilioNumber || "").replace(/\D/g, "").slice(-10) === toolCalledDigits);
                  if (m) toolSubAccountId = m.id;
                }
                let rows: any[];
                if (toolSubAccountId) {
                  rows = await vapiDb.select().from(contacts).where(vapiAnd(vapiLike(contacts.phone, `%${cleaned}`), vapiEq(contacts.subAccountId, toolSubAccountId))).limit(1);
                } else {
                  rows = [];
                  console.warn(`[VAPI TOOL] lookupProspect: no sub_account_id resolved — skipping to prevent cross-tenant leak`);
                }
                if (rows.length > 0) {
                  const c = rows[0];
                  const rawN = `${c.firstName} ${c.lastName || ""}`.trim();
                  const displayName = /^(SMS\s*\d+|Unknown|user\s*\d+)$/i.test(rawN) ? "Unknown" : rawN;
                  const info = [`Name: ${displayName}`];
                  if (c.company) info.push(`Company: ${c.company}`);
                  if (c.city && c.state) info.push(`Location: ${c.city}, ${c.state}`);
                  if (c.tags && c.tags.length > 0) info.push(`Tags: ${c.tags.join(", ")}`);
                  if (c.notes) info.push(`Notes: ${c.notes}`);
                  if (c.source) info.push(`Source: ${c.source}`);
                  console.log(`[VAPI TOOL] lookupProspect: found contact id=${c.id} name="${displayName}" subAccount=${c.subAccountId}`);
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
        const call = req.body.message.call || {};
        const callType = call.type || "";
        const callDirection = call.direction || "";
        const isInbound = callType === "inboundPhoneCall" || callDirection === "inbound";
        const customerNumber = call.customer?.number || req.body.message.call?.customer?.number;
        const calledNumber = call.phoneNumber?.number || call.to || "";

        let callSubAccountId: number | null = null;
        try {
          if (calledNumber) {
            const calledDigits = calledNumber.replace(/\D/g, "").slice(-10);
            const allAccts = await vapiStorage.getSubAccounts();
            const match = allAccts.find((a: any) => {
              const tn = (a.twilioNumber || "").replace(/\D/g, "").slice(-10);
              return tn && tn === calledDigits;
            });
            if (match) callSubAccountId = match.id;
          }
          if (!callSubAccountId) {
            const allAccts = await vapiStorage.getSubAccounts();
            const active = allAccts.filter((a: any) => a.ownerUserId !== "_archived");
            if (active.length === 1) callSubAccountId = active[0].id;
          }
        } catch (acctErr: any) {
          console.warn(`[CALL-ROUTING] Sub-account resolution failed: ${acctErr.message}`);
        }
        console.log(`[CALL-ROUTING] Resolved sub_account_id=${callSubAccountId} for calledNumber="${calledNumber}"`);

        let contactRecord: any = null;
        let leadType: "new_lead" | "existing_lead" | "customer" | "unknown" = "unknown";
        let contactName = "";
        let contactSource = "";
        let contactStage = "";

        if (customerNumber) {
          try {
            const cleaned = customerNumber.replace(/\D/g, "").slice(-10);
            let rows: any[];
            if (callSubAccountId) {
              rows = await vapiDb.select().from(contacts).where(vapiAnd(vapiLike(contacts.phone, `%${cleaned}`), vapiEq(contacts.subAccountId, callSubAccountId))).limit(1);
            } else {
              rows = [];
              console.warn(`[CALL-ROUTING] No sub_account_id resolved — skipping CRM lookup to prevent cross-tenant data leak`);
            }
            if (rows.length > 0) {
              contactRecord = rows[0];
              const rawName = [contactRecord.firstName, contactRecord.lastName].filter(Boolean).join(" ").trim();
              const isGarbageName = !rawName || /^(SMS\s*\d+|Unknown|user\s*\d+)$/i.test(rawName);
              contactName = isGarbageName ? "" : rawName;
              contactSource = contactRecord.source || "";

              const { deals: dealsTable, pipelineStages: stagesTable } = await import("@shared/schema");
              const { desc: descOp } = await import("drizzle-orm");
              try {
                const dealRows = await vapiDb.select({ stageId: dealsTable.stageId })
                  .from(dealsTable)
                  .where(vapiAnd(
                    vapiEq(dealsTable.subAccountId, contactRecord.subAccountId),
                    vapiEq(dealsTable.contactId, contactRecord.id)
                  ))
                  .orderBy(descOp(dealsTable.id))
                  .limit(1);
                if (dealRows.length > 0) {
                  const [stageRow] = await vapiDb.select({ name: stagesTable.name })
                    .from(stagesTable)
                    .where(vapiEq(stagesTable.id, dealRows[0].stageId))
                    .limit(1);
                  if (stageRow) contactStage = stageRow.name;
                }
              } catch (stageErr: any) {
                console.warn(`[CALL-ROUTING] Deal/stage lookup failed (non-fatal): ${stageErr.message}`);
              }

              const tags: string[] = contactRecord.tags || [];
              const hasCustomerTag = tags.some((t: string) => ["customer", "client", "active_client", "paying"].includes(t.toLowerCase()));
              const hasLeadTag = tags.some((t: string) => ["lead", "prospect", "new_lead", "dm_lead", "inbound"].includes(t.toLowerCase()));
              const isCustomerStage = ["closed_won", "customer", "active", "onboarded"].includes((contactStage || "").toLowerCase());

              if (hasCustomerTag || isCustomerStage) {
                leadType = "customer";
              } else if (hasLeadTag || contactSource) {
                leadType = "existing_lead";
              } else {
                leadType = "existing_lead";
              }
            } else {
              leadType = "new_lead";
            }
            console.log(`[CALL-ROUTING] Contact lookup: phone=${customerNumber} | contactId=${contactRecord?.id || "none"} | name="${contactName || "none"}" | source="${contactSource || "none"}" | stage="${contactStage || "none"}" | leadType=${leadType} | subAccount=${callSubAccountId}`);
          } catch (lookupErr: any) {
            console.warn(`[CALL-ROUTING] Contact lookup failed: ${lookupErr.message}`);
            leadType = "unknown";
          }
        }

        const greeting = contactName ? `Hey ${contactName.split(" ")[0]}` : "Hey there";

        if (isInbound) {
          let contextBlock = "";
          if (contactRecord) {
            const details: string[] = [];
            if (contactName) details.push(`Name: ${contactName}`);
            if (contactRecord.company) details.push(`Company: ${contactRecord.company}`);
            if (contactSource) details.push(`Source: ${contactSource}`);
            if (contactStage) details.push(`Stage: ${contactStage}`);
            if (contactRecord.city && contactRecord.state) details.push(`Location: ${contactRecord.city}, ${contactRecord.state}`);
            if (contactRecord.tags?.length > 0) details.push(`Tags: ${contactRecord.tags.join(", ")}`);
            if (contactRecord.notes) details.push(`Notes: ${contactRecord.notes}`);
            contextBlock = `\n\nCALLER CONTEXT (use naturally, never reveal you looked them up):\n- Lead Type: ${leadType}\n- ${details.join("\n- ")}`;
          }

          const inboundLeadPrompt = `You are the AI receptionist for Apex Marketing Automations, a full-service digital marketing agency. Someone is calling in.

CALLER TYPE: ${leadType}
${leadType === "customer" ? "This is an EXISTING CUSTOMER. Be familiar, reference their relationship with Apex. Ask how their campaigns are going." : ""}
${leadType === "existing_lead" ? "This is a RETURNING LEAD. They've interacted before. Be warm and pick up where things left off." : ""}
${leadType === "new_lead" ? "This is a BRAND NEW CALLER. Make a great first impression. Be curious about their business." : ""}
${leadType === "unknown" ? "Caller not in the system yet. Treat as a potential new lead — be welcoming and curious." : ""}

GREETING: "${greeting}, thanks for calling Apex Marketing! How can I help you today?"

YOUR CAPABILITIES:
- Answer questions about Apex Marketing services (social media management, paid ads, AI automations, website design, SEO, reputation management, lead generation)
- Qualify leads by understanding their business needs and goals
- Schedule consultations/callbacks with the team
- Send a booking link via text so they can schedule at their convenience
- Take messages if they need to speak with a specific team member

CONVERSATION FLOW:
1. Greet warmly — they called you, so be welcoming
2. Listen to what they need — let them talk first
3. Ask clarifying questions about their business (industry, current marketing, goals, budget range)
4. If they're interested in services, offer to send the booking link via text to schedule a proper consultation
5. If they need a specific person, take a message with their name, number, and reason for calling

RULES:
- Never say "I'm just an AI" apologetically — you ARE the front desk, own it
- Keep responses conversational and concise (2-3 sentences max)
- If you don't know something specific, say "Let me have the team get back to you on that — can I grab your number?"
- Always try to capture their phone number and name for follow-up
- When sending the booking link, use the sendBookingLink tool — never read the URL aloud${contextBlock}`;

          console.log(`[CALL-ROUTING] INBOUND from ${customerNumber} | leadType=${leadType} | contact=${contactName || "none"} | source=${contactSource || "none"} | stage="${contactStage || "none"}" | subAccount=${callSubAccountId} | prompt=inbound_lead_prompt`);

          await markEventCompleted(req);
          return res.json({
            assistant: {
              model: {
                provider: "openai",
                model: "gpt-4o",
                messages: [{ role: "system", content: inboundLeadPrompt }],
              },
              voice: call.assistant?.voice || { provider: "11labs", voiceId: "pFZP5JQG7iQjIQuC4Bku" },
              firstMessage: `${greeting}, thanks for calling Apex Marketing! How can I help you today?`,
              serverUrl: VAPI_SERVER_URL,
              serverMessages: VAPI_SERVER_MESSAGES,
            },
          });
        }

        let outboundContext = "";
        if (contactRecord) {
          const details: string[] = [];
          if (contactName) details.push(`Name: ${contactName}`);
          if (contactRecord.company) details.push(`Company: ${contactRecord.company}`);
          if (contactSource) details.push(`Source: ${contactSource}`);
          if (contactStage) details.push(`Stage: ${contactStage}`);
          if (contactRecord.city && contactRecord.state) details.push(`Location: ${contactRecord.city}, ${contactRecord.state}`);
          if (contactRecord.tags?.length > 0) details.push(`Tags: ${contactRecord.tags.join(", ")}`);
          if (contactRecord.notes) details.push(`Notes: ${contactRecord.notes}`);
          outboundContext = `\n\nPROSPECT INTEL (use naturally, never reveal you looked them up):\n- Lead Type: ${leadType}\n- ${details.join("\n- ")}`;
        }

        const coldOutboundPrompt = `You are an outbound sales agent for Apex Marketing Automations, a full-service digital marketing agency. You are calling a prospect.

CALLER TYPE: ${leadType}
${leadType === "customer" ? "This is an EXISTING CUSTOMER. This is a check-in call. Ask how things are going, if they need anything." : ""}
${leadType === "existing_lead" ? "This is a WARM LEAD who has interacted before. Reference that naturally — don't start cold." : ""}
${leadType === "new_lead" || leadType === "unknown" ? "This is a COLD CALL. You need to earn their attention in the first 10 seconds." : ""}

OPENING: "${greeting}, this is Apex Marketing — ${leadType === "customer" || leadType === "existing_lead" ? "just wanted to check in real quick, do you have a sec?" : "I know this is out of the blue, mind if I take 30 seconds to tell you why I'm calling?"}"

YOUR PITCH (deliver naturally, not scripted):
- Apex helps businesses grow through AI-powered marketing automation
- We handle social media, paid ads, lead generation, reputation management, website design
- We have AI tools that automate follow-ups, book appointments, and close leads 24/7

CONVERSATION FLOW:
1. Introduce yourself — be direct about who you are and why you're calling
2. Ask one qualifying question: "What does your marketing look like right now?"
3. Listen and find their pain point
4. Briefly explain how Apex solves that specific problem
5. Close with offering to send a booking link via text for a free consultation

RULES:
- If they say they're busy, ask for a better time to call back
- If they're not interested, thank them and move on — no pressure
- Keep it under 2 minutes unless they're engaged
- Never read URLs aloud — use the sendBookingLink tool
- Keep responses to 2-3 sentences max${outboundContext}`;

        console.log(`[CALL-ROUTING] OUTBOUND to ${customerNumber} | leadType=${leadType} | contact=${contactName || "none"} | source=${contactSource || "none"} | stage="${contactStage || "none"}" | subAccount=${callSubAccountId} | prompt=cold_outbound_prompt`);

        await markEventCompleted(req);
        return res.json({
          assistant: {
            model: {
              provider: "openai",
              model: "gpt-4o",
              messages: [{ role: "system", content: coldOutboundPrompt }],
            },
            voice: call.assistant?.voice || { provider: "11labs", voiceId: "pFZP5JQG7iQjIQuC4Bku" },
            firstMessage: `${greeting}, this is Apex Marketing — ${leadType === "customer" || leadType === "existing_lead" ? "just wanted to check in real quick, do you have a sec?" : "I know this is out of the blue, mind if I take 30 seconds to tell you why I'm calling?"}`,
            serverUrl: VAPI_SERVER_URL,
            serverMessages: VAPI_SERVER_MESSAGES,
          },
        });
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
                .then(result => { if (result) onCallAnalyzed().catch((err) => console.warn("[INDEX] promise rejected:", err instanceof Error ? err.message : err)); })
                .catch(err => console.error(`[VAPI WEBHOOK] Analysis failed for call ${inserted[0].id} (${callId}):`, err?.message ?? err, err?.stack));
            }
            const custNum = call.call?.customer?.number;
            if (custNum) {
              try {
                const { fireAutomationTriggerGlobal } = await import("./routes/v1");
                const { contacts: contactsTable } = await import("@shared/schema");
                const { eq: eqOp } = await import("drizzle-orm");
                const contactRows = await vapiDb.select().from(contactsTable).where(eqOp(contactsTable.phone, custNum)).limit(1);
                const subId = contactRows[0]?.subAccountId || 13;
                fireAutomationTriggerGlobal("call_completed", subId, {
                  leadName: contactRows[0]?.firstName || "Caller",
                  leadPhone: custNum,
                  callId,
                  duration,
                  summary,
                  source: "vapi_call",
                });
                eventBus.publish({ type: "call.completed" as any, subAccountId: subId, data: { callId, customerNumber: custNum, duration, summary } });
                import("./intelligence/eventEmitter").then(({ emitUniversalEvent, EVENT_TYPES: EVT }) => {
                  emitUniversalEvent({ eventType: EVT.CALL_COMPLETED, sourceModule: "voice", sourceRecordId: callId, subAccountId: subId, contactId: contactRows[0]?.id || undefined, metadata: { callId, customerNumber: custNum, duration, summary, endedReason: call.endedReason || null, recordingUrl } });
                }).catch((err) => console.warn("[INDEX] promise rejected:", err instanceof Error ? err.message : err));
              } catch (err) { console.warn("[INDEX] caught:", err instanceof Error ? err.message : err); }
            }
          }
        }
      }
      await markEventCompleted(req);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[VAPI WEBHOOK] Error:", err);
      await markEventFailed(req, err?.message || "Vapi webhook error").catch((err) => console.warn("[INDEX] promise rejected:", err instanceof Error ? err.message : err));
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
  app.use("/api/auth/email-login", authLimiter);
  app.use("/api/auth/firebase-login", authLimiter);
  app.use("/api/auth/google", authLimiter);
  app.use("/api/event/signup", authLimiter);
  app.use("/api/event/finalize", authLimiter);
  app.use("/api/subscription/checkout", creditTopupLimiter);
  app.use("/api/upload-ad-image", uploadLimiter);
  app.use("/api", apiLimiter);

  const { registerAgentWorkerRoutes } = await import("./routes/agentWorker");
  registerAgentWorkerRoutes(app);

  const { registerAiAdminRoutes } = await import("./routes/aiAdmin");
  registerAiAdminRoutes(app);

  const { registerHomeServiceRoutes } = await import("./routes/homeService");
  registerHomeServiceRoutes(app);

  const { registerHplAdminRoutes } = await import("./routes/hplAdmin");
  registerHplAdminRoutes(app);

  const { registerInsuranceAdminRoutes } = await import("./routes/insuranceAdmin");
  registerInsuranceAdminRoutes(app);

  const { registerServiceIndustryAdminRoutes } = await import("./routes/serviceIndustryAdmin");
  registerServiceIndustryAdminRoutes(app);

  const { registerCommunicationsAdminRoutes } = await import("./routes/communicationsAdmin");
  registerCommunicationsAdminRoutes(app);

  const { registerNewResidentAdminRoutes } = await import("./routes/newResidentAdmin");
  registerNewResidentAdminRoutes(app);

  const { registerEnterpriseAdminRoutes } = await import("./routes/enterpriseAdmin");
  registerEnterpriseAdminRoutes(app);

  const { registerFrontDeskRoutes } = await import("./routes/frontDesk");
  registerFrontDeskRoutes(app);

  await setupAuth(app);

  // Admin-secret bypass: when an internal/trusted caller (e.g. the Apex
  // Intelligence chatbot's apexApi tool) presents the STANDALONE_ADMIN_SECRET
  // header, synthesize an authenticated admin user so legacy routes that
  // gate on req.user / req.isAuthenticated() pass cleanly. Tenancy is still
  // scoped via x-sub-account-id by the tenantMiddleware below.
  app.use("/api", (req, _res, next) => {
    const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
    const headerVal = (req.headers["x-admin-secret"] as string | undefined)?.trim();
    let secretMatches = false;
    if (adminSecret && headerVal) {
      const a = Buffer.from(adminSecret);
      const b = Buffer.from(headerVal);
      if (a.length === b.length) {
        try { secretMatches = crypto.timingSafeEqual(a, b); } catch (err) { console.warn("[INDEX] timing-safe compare error:", err instanceof Error ? err.message : err); secretMatches = false; }
      }
    }
    if (secretMatches) {
      const adminUserId = process.env.ADMIN_USER_ID || "admin";
      const synthesized = {
        id: adminUserId,
        claims: { sub: adminUserId, email: "bot@apex.internal" },
        email: "bot@apex.internal",
        isAdminBypass: true,
      };
      (req as any).user = synthesized;
      (req as any).isAuthenticated = () => true;
      (req as any)._apexAdminBypass = true;
    }
    next();
  });

  const { tenantMiddleware } = await import("./middleware/tenant");
  app.use("/api", (req, res, next) => {
    Promise.resolve(tenantMiddleware(req as any, res as any, next)).catch(next);
  });
  app.use("/api", csrfProtection);

  // Universal Apex reporter: every mutating /api request reports its outcome
  // (action, status, duration, errorPreview) to Apex Intelligence so the brain
  // sees every single thing that happens on the platform.
  const { apexReporter } = await import("./middleware/apexReporter");
  app.use("/api", apexReporter);
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);

  const { customDomainMiddleware } = await import("./middleware/customDomain");
  const { renderSiteHtml } = await import("./routes/sites");
  app.use(customDomainMiddleware(renderSiteHtml));

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    let status = err.status || err.statusCode || 500;
    let rawMessage = err.message || "Internal Server Error";

    // Translate Postgres unique-violation (Task #143) on the
    // (sub_account_id, name) index for workflows into a deterministic
    // 409 with a friendly message, instead of a generic 500. The
    // matching pipeline_stages_sub_account_name_uniq index was dropped
    // because production data already had duplicates that blocked the
    // CREATE UNIQUE INDEX during deploy validation. Other
    // unique-violation paths fall through to the existing 500 handling.
    if (err?.code === "23505" && typeof err?.constraint === "string") {
      if (err.constraint === "workflows_sub_account_name_uniq") {
        status = 409;
        rawMessage = "A workflow with this name already exists for this account.";
      }
    }

    const requestId = (_req as any).requestId ?? "unknown";

    if (status >= 500) {
      // 1. Local console (always)
      console.error(`[ERROR] ${_req.method} ${_req.path} → ${status}: ${rawMessage}`, err?.stack?.split("\n")[1]?.trim());

      // 2. Axiom structured log (picks up via drain if AXIOM_TOKEN set)
      logger.error("http.server_error", {
        status,
        method: _req.method,
        path: _req.path,
        requestId,
        errorName: err?.name,
      }, err instanceof Error ? err : new Error(rawMessage));

      // 3. Sentry (if DSN configured)
      Sentry.withScope((scope) => {
        scope.setTag("http.method", _req.method);
        scope.setTag("http.status", String(status));
        scope.setContext("request", { path: _req.path, requestId });
        Sentry.captureException(err);
      });

      // 4. Legacy system error log (DB audit trail)
      logSystemError("server", rawMessage, {
        path: _req.path,
        method: _req.method,
        requestId,
        stack: err.stack?.substring(0, 500),
      });
    } else {
      // 4xx — debug only, no Sentry noise
      console.warn(`[WARN] ${_req.method} ${_req.path} → ${status}: ${rawMessage}`);
    }

    if (res.headersSent) {
      return next(err);
    }

    const isProd = process.env.NODE_ENV === "production";
    const clientMessage =
      status >= 500 && isProd ? "Internal Server Error" : rawMessage;
    return res.status(status).json({ message: clientMessage });
  });

  app.get("/big-mama-beauty", (_req, res) => {
    const landingPath = path.join(process.cwd(), "client", "public", "big-mama-beauty.html");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(landingPath);
  });

  app.get("/roomos-landing", (_req, res) => {
    const landingPath = path.join(process.cwd(), "client", "public", "roomos-landing.html");
    if (fs.existsSync(landingPath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.sendFile(landingPath);
    }
    res.redirect("/roomos");
  });

  // Sentry Express error handler — must be registered AFTER all routes
  // and BEFORE the static/vite catch-all so it captures route errors.
  const { Sentry: SentryRuntime } = await import("./instrument");
  SentryRuntime.setupExpressErrorHandler(app);

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
  const listenOptions: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform !== "darwin") {
    listenOptions.reusePort = true;
  }
  httpServer.listen(
    listenOptions,
    async () => {
      log(`serving on port ${port}`);

      // Warn once at startup if Stitch is not configured (server-only secret).
      // Do not log the key value.
      getStitchApiKey();

      // ── Create new tables if they don't exist yet ─────────────────────────
      try {
        const { createCaseTables } = await import("./startup/createCaseTables");
        await createCaseTables();
      } catch (ctErr: any) {
        console.error("[CASE-TABLES] createCaseTables error:", ctErr?.message);
      }

      // ── Generic sequence audit — discovers and repairs ALL drifted sequences ──
      // Push schema using drizzle-kit
  if (process.env.SKIP_STARTUP_DB_MAINTENANCE === "true") {
    console.log("[STARTUP] Skipping database schema push (SKIP_STARTUP_DB_MAINTENANCE=true)");
  } else {
    try {
      const { execSync } = await import("child_process");
      console.log("[STARTUP] Running database schema push...");
      execSync("npx drizzle-kit push --force", { 
        encoding: "utf8",
        env: { ...process.env },
        stdio: "pipe",
      });
      console.log("[STARTUP] ✅ Database schema push complete");
    } catch (migErr: any) {
      console.error("[STARTUP] Schema push failed:", migErr?.message?.slice(0, 300));
    }
  }

  console.error("[STARTUP] BOOT ENTRY REACHED — running sequence audit");
      if (process.env.SKIP_STARTUP_DB_MAINTENANCE === "true") {
        console.log("[SEQ-AUDIT] Skipped (SKIP_STARTUP_DB_MAINTENANCE=true)");
      } else {
        try {
          const { auditAndRepairSequences, repairAgentTasksSequence } = await import("./startup/sequenceAudit");
          await repairAgentTasksSequence();
          await auditAndRepairSequences();
        } catch (auditErr: any) {
          console.error("[SEQ-AUDIT] FATAL — audit threw:", auditErr?.message, auditErr?.stack);
        }
      }

      try {
        const { runDataMigrations } = await import("./dataMigrations");
        await runDataMigrations();
      } catch (dataMigrationErr) {
        console.error(
          "[STARTUP] Data migrations failed (continuing — productionSeed may also fail):",
          dataMigrationErr instanceof Error ? dataMigrationErr.message : dataMigrationErr,
        );
      }

      // ── Phase 1A: Database boot validation ──────────────────────────────────
      try {
        const { runBootValidation } = await import("./db/bootValidator");
        const bootResult = await runBootValidation();
        if (!bootResult.passed) {
          console.error(
            `[STARTUP] ⚠ DB boot validation FAILED — ${bootResult.criticalFailures.length} critical issue(s). ` +
            `Server continues but integrity is degraded. Check /api/admin/db-health.`
          );
        } else if (bootResult.warnings.length > 0) {
          console.warn(`[STARTUP] DB boot validation passed with ${bootResult.warnings.length} warning(s)`);
        } else {
          console.log(`[STARTUP] ✅ DB boot validation passed in ${bootResult.durationMs}ms`);
        }
      } catch (bootValidErr: any) {
        console.error("[STARTUP] DB boot validation threw (non-fatal):", bootValidErr?.message);
      }

      try {
        const { runProductionSeed } = await import("./intelligence/productionSeed");
        const seedResult = await runProductionSeed();
        if (!seedResult.ready) {
          console.warn("[STARTUP] ⚠️ Apex Intelligence production seed completed with issues — check logs above");
        }
      } catch (intSeedErr) {
        console.error("[STARTUP] Apex Intelligence production seed failed (non-fatal):", intSeedErr);
      }

      if (!DISABLE_BACKGROUND_WORKERS) {
      console.log("[STARTUP] Starting post-listen background workers...");
      try {
        const { startAutoLearningLoop: startLoop } = await import("./callIntelligence");
        startLoop();
        console.log("[STARTUP] ✅ Auto-learning loop started");
      } catch (err: any) {
        console.error("[CALL-INTEL] Failed to start auto-learning loop:", err?.message);
      }
      // ── Phase 4A: Redis + Durable Queue init ──────────────────────────────
      try {
        const { initRedis } = await import("./redis");
        const redisConnected = await initRedis();
        if (redisConnected) {
          const { initQueues } = await import("./queues/queueFactory");
          initQueues();
          console.log("[STARTUP] ✅ Upstash Redis connected, BullMQ queues ready");
        } else {
          console.warn("[STARTUP] ⚠️  Redis unavailable — jobQueue running in-memory fallback mode");
        }
      } catch (err: any) {
        console.error("[STARTUP] Redis/Queue init failed (non-fatal):", err?.message);
      }
      // ── Phase 4B: BullMQ Workers ──────────────────────────────────────────
      try {
        const { startAllWorkers } = await import("./workers/index");
        startAllWorkers();
        console.log("[STARTUP] ✅ BullMQ workers started (enrichment, scoring, routing, maintenance)");
      } catch (err: any) {
        console.error("[STARTUP] BullMQ workers failed to start (non-fatal):", err?.message);
      }
      // ─────────────────────────────────────────────────────────────────────

      try {
        const { startRetryProcessor } = await import("./eventRetryProcessor");
        startRetryProcessor();
        console.log("[STARTUP] ✅ Retry processor started");
      } catch (err: any) {
        console.error("[RETRY-PROCESSOR] Failed to start:", err?.message);
      }
      try {
        const { startFollowupWorker } = await import("./callRequestFlow");
        startFollowupWorker();
        console.log("[STARTUP] ✅ Follow-up worker started");
      } catch (err: any) {
        console.error("[FOLLOWUP-WORKER] Failed to start:", err?.message);
      }
      try {
        const { startAutoSync } = await import("./googleCalendarSync");
        startAutoSync();
        console.log("[STARTUP] ✅ Calendar sync started");
      } catch (err: any) {
        console.error("[GCAL-AUTO] Failed to start:", err?.message);
      }
      try {
        const { startIntegrationHealthChecker } = await import("./intelligence/integrationHealthChecker");
        startIntegrationHealthChecker();
        console.log("[STARTUP] ✅ Integration health populator started");
      } catch (err: any) {
        console.error("[INTEG-HEALTH] Failed to start:", err?.message);
      }
      try {
        const { registerMetaCampaignSyncJob, startMetaCampaignSyncScheduler } = await import("./metaCampaignSync");
        registerMetaCampaignSyncJob();
        startMetaCampaignSyncScheduler();
        console.log("[STARTUP] ✅ Meta campaign sync started");
      } catch (err: any) {
        console.error("[META-SYNC] Failed to start:", err?.message);
      }

      try {
        const { startContentPublisherWorker } = await import("./services/contentPlanner/schedulerWorker");
        startContentPublisherWorker();
        console.log("[STARTUP] ✅ Content publisher worker started");
      } catch (err: any) {
        console.error("[CP-WORKER] Failed to start:", err?.message);
      }

      try {
        const { startSentinelScheduler } = await import("./sentinel");
        startSentinelScheduler();
        console.log("[STARTUP] ✅ Sentinel scan scheduler started (every 15m)");
      } catch (err: any) {
        console.error("[SENTINEL] Failed to start scheduler:", err?.message);
      }

      try {
        const { startReengageScheduler } = await import("./services/commentBot/reengageJob");
        startReengageScheduler();
        console.log("[STARTUP] ✅ Re-engagement background scheduler started (every 6h)");
      } catch (err: any) {
        console.error("[REENGAGE] Failed to start scheduler:", err?.message);
      }

      try {
        const { startIntelligenceWorkers } = await import("./intelligence/worker");
        startIntelligenceWorkers();
        console.log("[STARTUP] ✅ Apex Intelligence workers started (rollups 15m, scoring 30m)");
      } catch (err: any) {
        console.error("[APEX-INTEL] Failed to start intelligence workers:", err?.message);
      }

      try {
        const { startOrchestrator } = await import("./autonomy/orchestrator");
        startOrchestrator();
        console.log("[STARTUP] ✅ Autonomy orchestrator started (interval: 10min)");
      } catch (err: any) {
        console.error("[AUTONOMY-ORCH] Failed to start orchestrator:", err?.message);
      }

      try {
        const { drainQueuedBacklog } = await import("./operator/taskAgent");
        drainQueuedBacklog().then(result => {
          if (result.drained > 0 || result.failed > 0) {
            console.log(`[STARTUP] ✅ Task agent backlog drained: ${result.drained} executed, ${result.failed} failed`);
          } else {
            console.log("[STARTUP] ✅ Task agent backlog: no stuck tasks found");
          }
        }).catch(err => console.error("[TASK-AGENT] Backlog drain startup error:", err?.message));
      } catch (err: any) {
        console.error("[TASK-AGENT] Failed to drain backlog:", err?.message);
      }

      try {
        const { validateMetaConfigForAccount } = await import("./metaConfig");
        const { storage: metaStorage } = await import("./storage");
        const account21 = await metaStorage.getSubAccount(21);
        if (account21) {
          const hasPageId = !!account21.metaPageId;
          const hasToken = !!account21.metaAccessToken;
          console.log(`[STARTUP][META-DIAG] Account 21 (${account21.name}): pageId=${hasPageId ? "configured" : "MISSING"}, accessCredential=${hasToken ? "configured" : "MISSING"}`);
          if (hasPageId && hasToken) {
            const validation = await validateMetaConfigForAccount(21);
            console.log(`[STARTUP][META-DIAG] Account 21 Meta API validation: ${validation.valid ? "✅ VALID" : "❌ INVALID"} ${validation.pageName ? `(page: ${validation.pageName})` : ""} ${validation.error ? `error: ${validation.error}` : ""}`);
          } else {
            console.warn(`[STARTUP][META-DIAG] Account 21 is missing Meta credentials — webhook pipeline will not route to this account`);
          }
        } else {
          console.warn(`[STARTUP][META-DIAG] Account 21 does not exist in sub_accounts table`);
        }
      } catch (diagErr: any) {
        console.warn(`[STARTUP][META-DIAG] Account 21 diagnostic check failed: ${diagErr.message}`);
      }
      }
    },
  );

  // ── Graceful shutdown — flush Axiom buffer + drain BullMQ ────────────────
  const gracefulShutdown = async (signal: string) => {
    console.log(`[SHUTDOWN] ${signal} received — flushing logs and closing queues...`);
    try {
      await flushLogs();
    } catch (err) { console.warn("[SHUTDOWN] flushLogs caught:", err instanceof Error ? err.message : err); }
    try {
      const { stopAllWorkers } = await import("./workers/index");
      await stopAllWorkers();
    } catch (err) { console.warn("[SHUTDOWN] stopAllWorkers caught:", err instanceof Error ? err.message : err); }
    try {
      const { closeQueues } = await import("./queues/queueFactory");
      await closeQueues();
    } catch (err) { console.warn("[SHUTDOWN] closeQueues caught:", err instanceof Error ? err.message : err); }
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
})();
