import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import path from "path";
import fs from "fs";

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
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing signature" });

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        return res.status(500).json({ error: "Webhook processing error" });
      }

      await WebhookHandlers.processWebhook(req.body as Buffer, sig);

      const event = JSON.parse(req.body.toString());
      const { storage } = await import("./storage");

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
          const updateData: any = {
            status: subscription.status === "active" ? "active" : "inactive",
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          };
          if (subscription.status === "active") {
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

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("[STRIPE] Webhook error:", error.message);
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
    { key: "Gemini_API_Key_saas", label: "Gemini API Key (AI features)", critical: false },
    { key: "GOOGLE_API_KEY", label: "Google API Key (Maps, Places, etc.)", critical: false },
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

  console.log("=".repeat(60));
}

(async () => {
  validateEnvVars();
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
  await setupAuth(app);
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

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
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
