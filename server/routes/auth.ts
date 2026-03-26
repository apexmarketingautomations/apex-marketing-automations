import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";
import express from "express";
import { asyncHandler, getUserId, isUserAdmin, requireAdmin } from "./helpers";

export function registerAuthRoutes(app: Express) {
  // ---- Facebook Deauthorize Callback (Meta compliance, public) ----
  app.post("/api/auth/facebook/deauthorize", express.json(), asyncHandler(async (req, res) => {
    const deauthSchema = z.object({ signed_request: z.string().optional() }).passthrough();
    const parsed = deauthSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
    const { signed_request } = parsed.data;
    let userId = "unknown";

    if (signed_request) {
      try {
        const parts = signed_request.split(".");
        if (parts.length === 2) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          userId = payload.user_id || "unknown";
        }
      } catch (err: any) {
        console.error("[META-DEAUTH] Failed to parse signed_request:", err.message);
      }
    }

    console.log(`[META-DEAUTH] Facebook user ${userId} removed the app`);

    try {
      await storage.createSystemLog({
        level: "warn",
        source: "meta-deauth",
        message: `Facebook user ${userId} deauthorized the app`,
        details: { facebookUserId: userId, deauthorizedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[META-DEAUTH] Failed to log:", e);
    }

    const confirmationCode = "DEAUTH-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    res.json({
      url: "https://apexmarketingautomations.com/data-deletion",
      confirmation_code: confirmationCode,
    });
  }));

  // ---- User Data Deletion (Meta compliance, public) ----
  app.post("/api/data-deletion", express.json(), asyncHandler(async (req, res) => {
    const deletionSchema = z.object({ email: z.string().optional(), signed_request: z.string().optional() }).passthrough();
    const dparsed = deletionSchema.safeParse(req.body);
    if (!dparsed.success) return res.status(400).json({ error: "Invalid request body" });
    const { email, signed_request } = dparsed.data;

    let userEmail = email;
    if (!userEmail && signed_request) {
      try {
        const parts = signed_request.split(".");
        if (parts.length === 2) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
          userEmail = payload.email || payload.user_id || "meta-user";
        }
      } catch (err: any) {
        console.error("[DATA-DELETION] Failed to parse signed_request:", err.message);
      }
    }

    if (!userEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    const confirmationCode = "DEL-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    console.log(`[DATA-DELETION] Request received for ${userEmail}, confirmation: ${confirmationCode}`);

    try {
      await storage.createSystemLog({
        level: "warn",
        source: "data-deletion",
        message: `Data deletion requested for ${userEmail}`,
        details: { email: userEmail, confirmationCode, requestedAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error("[DATA-DELETION] Failed to log:", e);
    }

    res.json({
      url: "https://apexmarketingautomations.com/data-deletion",
      confirmation_code: confirmationCode,
      status: "pending",
      message: "Your data deletion request has been received and will be processed within 30 days.",
    });
  }));


  // ---- Auth Middleware ----
  app.use("/api", (req, res, next) => {
    const fullPath = req.originalUrl || req.baseUrl + req.path;
    const openPaths = ["/api/auth/", "/api/login", "/api/logout", "/api/callback", "/api/stripe/webhook", "/api/webhooks/", "/api/snapshots/marketplace", "/api/v1/serve-native-ad", "/api/v1/ad-click/", "/api/crash-reports/health"];
    const openExact = ["/api/reviews", "/api/alert-owner", "/api/languages"];

    if (openPaths.some(p => fullPath.startsWith(p))) return next();
    if (req.method === "POST" && openExact.some(p => fullPath === p)) return next();
    if (req.method === "GET" && fullPath === "/api/languages") return next();
    if (req.method === "GET" && fullPath.startsWith("/api/review-config/")) return next();
    if (fullPath === "/api/log-error") return next();
    if (fullPath === "/api/sms-webhook") return next();
    if (fullPath === "/api/twilio/inbound-sms") return next();
    if (fullPath.split("?")[0] === "/api/meta-webhook") return next();
    if (fullPath.startsWith("/api/public-card/")) return next();
    if (fullPath === "/api/sentinel/test-trigger") return next();
    if (fullPath === "/api/sentinel/live") return next();
    if (fullPath === "/api/sentinel/incoming-crash") return next();
    if (fullPath === "/api/sentinel/cad-ingest") return next();
    if (fullPath === "/api/sentinel-incoming") return next();
    if (fullPath === "/api/v1/sentinel-receiver") return next();
    if (fullPath === "/api/v1/sentinel-ingest") return next();
    if (fullPath === "/api/webhook/crashconnect") return next();
    if (fullPath.startsWith("/api/v1/external/sentinel")) return next();
    if (fullPath === "/api/v1/dispatch") return next();
    if (fullPath === "/api/form-submit") return next();
    if (fullPath === "/api/card-checkout") return next();
    if (fullPath === "/api/sales-chat") return next();
    if (fullPath === "/api/generate-liquid-site") return next();
    if (fullPath === "/api/liquid/contact-lookup") return next();
    if (fullPath === "/api/system/health") return next();
    if (fullPath === "/api/data-deletion") return next();
    if (fullPath === "/api/auth/facebook/deauthorize") return next();
    if (fullPath.startsWith("/api/portal/")) return next();
    if (fullPath.startsWith("/api/oauth/") && fullPath.includes("/callback")) return next();
    if (fullPath.startsWith("/api/standalone/")) return next();
    if (fullPath.startsWith("/api/card/edit/")) return next();
    if (fullPath.startsWith("/api/card/checkout")) return next();
    if (fullPath.startsWith("/api/card/session/")) return next();

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  });

  app.post("/api/admin/transfer-account", requireAdmin, asyncHandler(async (req, res) => {
    const parsed = z.object({
      subAccountId: z.number().int().positive(),
      newOwnerUserId: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { subAccountId, newOwnerUserId } = parsed.data;
    const account = await storage.getSubAccount(subAccountId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const updated = await storage.updateSubAccount(subAccountId, { ownerUserId: newOwnerUserId });

    await storage.createAuditLog({
      action: "ACCOUNT_TRANSFERRED",
      performedBy: getUserId((req as any).user),
      details: { subAccountId, previousOwner: account.ownerUserId, newOwner: newOwnerUserId, accountName: account.name },
    });

    console.log(`[ADMIN] Account #${subAccountId} "${account.name}" transferred to user ${newOwnerUserId}`);
    res.json({ success: true, account: updated });
  }));

  app.get("/api/config/google-api-key", asyncHandler(async (req, res) => {
    const key = process.env.GOOGLE_API_KEY || "";
    if (!key) return res.json({ apiKey: "", hasKey: false });
    res.json({ apiKey: key, hasKey: true });
  }));

  app.get("/api/config/maps-key", asyncHandler(async (req, res) => {
    const key = process.env.GOOGLE_API_KEY || "";
    if (!key) return res.status(404).json({ error: "Google API key not configured" });
    res.json({ apiKey: key });
  }));
}
