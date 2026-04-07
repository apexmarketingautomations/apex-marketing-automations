import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

const WEBHOOK_PATH_PREFIXES = [
  "/api/stripe-webhook",
  "/api/stripe/webhook",
  "/api/meta-webhook",
  "/api/twilio-webhook",
  "/api/twilio/webhook",
  "/api/twilio/inbound",
  "/api/sms-webhook",
  "/api/vapi/webhook",
  "/api/vapi/server-message",
  "/api/mailchimp/webhook",
  "/api/webhook/",
  "/api/webhooks/",
  "/api/shopify/webhooks/",
  "/api/sentinel",
  "/api/v1/sentinel",
  "/api/v1/external/sentinel",
  "/api/v1/dispatch",
  "/api/v1/ad-click/",
  "/api/sentinel-incoming",
  "/api/form-submit",
  "/api/card-checkout",
  "/api/sales-chat",
  "/api/generate-liquid-site",
  "/api/liquid/contact-lookup",
  "/api/public-card/",
  "/api/portal/",
  "/api/log-error",
  "/api/system/health",
  "/api/data-deletion",
  "/api/auth/facebook/deauthorize",
  "/api/auth/register",
  "/api/auth/email-login",
  "/api/auth/firebase-login",
  "/api/auth/google",
  "/api/auth/apex-logout",
  "/api/auth/callback",
  "/api/oauth/",
  "/api/login",
  "/api/logout",
  "/api/auth/fcm-token",
  "/api/standalone/",
  "/api/card/edit/",
  "/api/card/checkout",
  "/api/card/session/",
  "/api/v1/external/leads",
  "/api/v1/external/consultations",
  "/api/v1/external/events",
  "/api/v1/external/status",
  "/api/comment-bot/reengage",
  "/api/comment-bot/sync-dms",
  "/api/intelligence/insights",
  "/api/intelligence/extract",
  "/api/meta-test-send",
  "/api/meta-dm-catchup",
  "/api/chaturbate/webhook",
  "/api/chaturbate/command",
];

function isExempt(path: string): boolean {
  return WEBHOOK_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const fullPath = req.originalUrl?.split("?")[0] || req.baseUrl + req.path;
  if (isExempt(fullPath)) {
    return next();
  }

  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    if (!req.cookies?.[CSRF_COOKIE_NAME]) {
      const token = crypto.randomBytes(32).toString("hex");
      res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
    }
    return next();
  }

  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: "CSRF token missing" });
  }

  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);
  if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
    return res.status(403).json({ error: "CSRF token invalid" });
  }

  return next();
}
