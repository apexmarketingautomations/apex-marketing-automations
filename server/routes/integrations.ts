import type { Express, Request, Response } from "express";
import { webhooks } from "@shared/schema";
import { storage } from "../storage";
import { isAIConfigured } from "../aiGateway";
import express from "express";
import crypto from "crypto";
import { getValidToken, revokeToken, checkTokenHealth } from "../tokenService";
import { asyncHandler, parseIntParam, verifyAccountOwnership, vapiConfig } from "./helpers";

export function registerIntegrationsRoutes(app: Express) {
  // ---- Webhook Events ----
  app.get("/api/webhook-events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const events = await storage.getWebhookEvents(subAccountId);
    res.json(events);
  }));

  // ---- Integration Connections ----
  app.get("/api/integrations/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const connections = await storage.getIntegrationConnections(subAccountId);
    const oauthTokens = await storage.getOAuthTokensBySubAccount(subAccountId);
    const tokenMap = new Map(oauthTokens.map((t: any) => [t.provider, t]));
    const formatted = connections.map((c: any) => {
      const token = tokenMap.get(c.provider);
      return {
        provider: c.provider,
        connected: c.status === "connected",
        status: c.status,
        config: c.config || {},
        connectionType: c.connectionType || "legacy",
        scopes: token?.scopes ? token.scopes.split(" ") : [],
      };
    });
    res.json(formatted);
  }));

  app.post("/api/integrations/:subAccountId/connect", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { provider, config } = req.body;

    const COMING_SOON_PROVIDERS: string[] = [];
    if (COMING_SOON_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `${provider} integration is coming soon. This provider is not yet fully supported.` });
    }

    const VALIDATED_PROVIDERS = ["twilio", "mailchimp", "facebook", "meta-ads", "stripe", "google-maps", "shopify", "google-analytics", "google-business", "elevenlabs"];
    const isValidatedProvider = VALIDATED_PROVIDERS.includes(provider);

    let validationResult: { valid: boolean; error?: string } = { valid: true };
    try {
      if (provider === "twilio" && config?.accountSid && config?.authToken) {
        const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`, {
          headers: { "Authorization": "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64") },
          signal: AbortSignal.timeout(5000),
        });
        if (!twilioRes.ok) validationResult = { valid: false, error: "Invalid Twilio credentials. Check your Account SID and Auth Token." };
      } else if (provider === "mailchimp" && config?.apiKey) {
        const dc = config.serverPrefix || config.apiKey.split("-").pop();
        const mcBasicAuth = Buffer.from(`anystring:${config.apiKey}`).toString("base64");
        const mcRes = await fetch(`https://${dc}.api.mailchimp.com/3.0/ping`, {
          headers: { "Authorization": `Basic ${mcBasicAuth}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!mcRes.ok) validationResult = { valid: false, error: "Invalid Mailchimp API key or server prefix." };
      } else if (provider === "facebook" && config?.pageAccessToken) {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (appId && appSecret) {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${config.pageAccessToken}&access_token=${appId}|${appSecret}`, {
            signal: AbortSignal.timeout(5000),
          });
          const debugData = await debugRes.json() as any;
          if (!debugRes.ok || !debugData?.data?.is_valid) {
            validationResult = { valid: false, error: `Invalid Facebook Page Access Token. ${debugData?.data?.error?.message || "Token validation failed."}` };
          }
        } else {
          const fbRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${config.pageAccessToken}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!fbRes.ok) validationResult = { valid: false, error: "Invalid Facebook Page Access Token." };
        }
      } else if (provider === "meta-ads" && config?.accessToken) {
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        if (appId && appSecret) {
          const debugRes = await fetch(`https://graph.facebook.com/v19.0/debug_token?input_token=${config.accessToken}&access_token=${appId}|${appSecret}`, {
            signal: AbortSignal.timeout(5000),
          });
          const debugData = await debugRes.json() as any;
          if (!debugRes.ok || !debugData?.data?.is_valid) {
            validationResult = { valid: false, error: `Invalid Meta Access Token. ${debugData?.data?.error?.message || "Token validation failed."}` };
          }
        } else {
          const metaRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${config.accessToken}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!metaRes.ok) validationResult = { valid: false, error: "Invalid Meta Access Token." };
        }
      } else if (provider === "stripe" && config?.secretKey) {
        const stripeRes = await fetch("https://api.stripe.com/v1/products?limit=1", {
          headers: { "Authorization": `Bearer ${config.secretKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!stripeRes.ok) validationResult = { valid: false, error: "Invalid Stripe Secret Key. Check your API key." };
      } else if (provider === "google-maps" && config?.apiKey) {
        const gmRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${config.apiKey}`, {
          signal: AbortSignal.timeout(5000),
        });
        const gmData = await gmRes.json() as any;
        if (gmData.error_message) validationResult = { valid: false, error: `Google Maps API error: ${gmData.error_message}` };
      } else if (provider === "shopify" && config?.storeDomain && config?.accessToken) {
        const domain = config.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const shopRes = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
          headers: { "X-Shopify-Access-Token": config.accessToken },
          signal: AbortSignal.timeout(5000),
        });
        if (!shopRes.ok) validationResult = { valid: false, error: "Invalid Shopify credentials. Check your store domain and access token." };
      } else if (provider === "google-analytics" && config?.measurementId) {
        if (!config.measurementId.startsWith("G-")) {
          validationResult = { valid: false, error: "Measurement ID should start with 'G-'" };
        }
      } else if (provider === "google-business" && config?.accountId) {
        if (!config.accountId.startsWith("accounts/")) {
          validationResult = { valid: false, error: "Business Profile ID should start with 'accounts/'" };
        }
      } else if (provider === "elevenlabs" && config?.apiKey) {
        const elRes = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": config.apiKey },
          signal: AbortSignal.timeout(5000),
        });
        if (!elRes.ok) validationResult = { valid: false, error: "Invalid ElevenLabs API key. Check your key in ElevenLabs settings." };
      }
    } catch (validErr: any) {
      console.warn(`[INTEGRATIONS] Validation failed for ${provider}:`, validErr.message);
      validationResult = { valid: false, error: `Could not validate credentials: ${validErr.message}` };
    }

    if (!validationResult.valid) {
      return res.status(400).json({ error: validationResult.error, validated: false });
    }

    const connectionStatus = isValidatedProvider ? "connected" : "stored_unverified";

    const connection = await storage.upsertIntegrationConnection({
      subAccountId,
      provider,
      status: connectionStatus,
      config: config || {},
      connectedAt: new Date(),
    });
    res.json({ ...connection, validated: isValidatedProvider, status: connectionStatus });
  }));

  app.post("/api/integrations/:subAccountId/disconnect", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const { provider } = req.body;

    const existingConnection = await storage.getIntegrationConnection(subAccountId, provider);
    if (existingConnection?.connectionType === "oauth") {
      await revokeToken(subAccountId, provider);
      await storage.deleteProviderAssets(subAccountId, provider);
    }

    const connection = await storage.upsertIntegrationConnection({
      subAccountId,
      provider,
      status: "disconnected",
      config: {},
      connectionType: existingConnection?.connectionType || "legacy",
      connectedAt: null,
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider,
      eventType: "disconnected",
      payload: { connectionType: existingConnection?.connectionType || "legacy" },
    });

    res.json(connection);
  }));

  // ---- OAuth Initiation Endpoints ----

  interface OAuthTokenExchangeResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  }

  interface GoogleUserInfo {
    id?: string;
    email?: string;
    name?: string;
  }

  interface MetaUserInfo {
    id?: string;
    email?: string;
    name?: string;
  }

  interface GoogleCalendarListResponse {
    items?: Array<{ id: string; summary?: string }>;
  }

  interface GoogleDriveFilesResponse {
    files?: Array<{ id: string; name: string; mimeType: string }>;
  }

  interface GoogleBusinessAccountsResponse {
    accounts?: Array<{ name: string; accountName?: string }>;
  }

  interface MetaAccountsResponse {
    data?: Array<{ id: string; name: string; instagram_business_account?: { id: string; name?: string; username?: string } }>;
  }

  interface MetaAdAccountsResponse {
    data?: Array<{ id: string; name?: string; account_status?: number }>;
  }

  const GOOGLE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/business.manage",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const META_OAUTH_SCOPES = [
    "pages_manage_metadata",
    "pages_read_engagement",
    "pages_messaging",
    "instagram_basic",
    "instagram_manage_messages",
    "ads_read",
    "leads_retrieval",
    "pages_manage_ads",
    "email",
    "public_profile",
  ];

  app.get("/api/oauth/google/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "google";

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));

  app.get("/api/oauth/meta/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const appId = process.env.META_APP_ID;
    if (!appId) {
      return res.status(500).json({ error: "Meta OAuth not configured" });
    }

    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "meta";

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/meta/callback`;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: META_OAUTH_SCOPES.join(","),
      state,
    });

    res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
  }));

  // ---- YouTube OAuth ----
  const YOUTUBE_OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  app.get("/api/oauth/youtube/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "youtube";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/youtube/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YOUTUBE_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));

  app.get("/api/oauth/youtube/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=youtube_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=youtube_oauth_invalid_state");
    }
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/youtube/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=youtube_token_failed");
    }
    let providerEmail = "", providerAccountId = "";
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.email || "";
      providerAccountId = profile.id || "";
    } catch (err: any) {
      console.error("[INTEGRATIONS] YouTube profile fetch failed:", err.message);
    }
    const expiresIn = tokenData.expires_in || 3600;
    await storage.upsertOAuthToken({
      provider: "youtube", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: YOUTUBE_OAUTH_SCOPES.join(" "), providerAccountId, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "youtube", status: "connected", config: { email: providerEmail }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "youtube", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=youtube_connected");
  }));

  // ---- LinkedIn OAuth ----
  app.get("/api/oauth/linkedin/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "LinkedIn OAuth not configured. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "linkedin";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/linkedin/callback`;
    const scopes = ["openid", "profile", "email", "w_member_social", "r_organization_social", "w_organization_social"];
    const params = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: scopes.join(" "),
    });
    res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
  }));

  app.get("/api/oauth/linkedin/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=linkedin_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=linkedin_oauth_invalid_state");
    }
    const clientId = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/linkedin/callback`;
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=linkedin_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.email || "";
      providerName = profile.name || "";
    } catch (err: any) {
      console.error("[INTEGRATIONS] LinkedIn profile fetch failed:", err.message);
    }
    const scopes = ["openid", "profile", "email", "w_member_social", "r_organization_social", "w_organization_social"];
    const expiresIn = tokenData.expires_in || 5184000;
    await storage.upsertOAuthToken({
      provider: "linkedin", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "linkedin", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "linkedin", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=linkedin_connected");
  }));

  // ---- TikTok for Business OAuth ----
  app.get("/api/oauth/tiktok/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const appId = process.env.TIKTOK_APP_ID;
    if (!appId) return res.status(500).json({ error: "TikTok OAuth not configured. Add TIKTOK_APP_ID and TIKTOK_APP_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "tiktok";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/tiktok/callback`;
    const params = new URLSearchParams({
      app_id: appId, redirect_uri: redirectUri, state,
    });
    res.redirect(`https://business-api.tiktok.com/portal/auth?${params}`);
  }));

  app.get("/api/oauth/tiktok/callback", asyncHandler(async (req, res) => {
    const { auth_code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=tiktok_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!auth_code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=tiktok_oauth_invalid_state");
    }
    const appId = process.env.TIKTOK_APP_ID!;
    const appSecret = process.env.TIKTOK_APP_SECRET!;
    const tokenResponse = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code }),
    });
    const tokenResult = await tokenResponse.json() as any;
    const tokenData = tokenResult.data;
    if (!tokenData?.access_token) {
      return res.redirect("/integrations?error=tiktok_token_failed");
    }
    const scopes = ["ad.operation.read", "ad.operation.write", "audience.read", "audience.write", "report.read"];
    await storage.upsertOAuthToken({
      provider: "tiktok", subAccountId, accessToken: tokenData.access_token, refreshToken: null,
      tokenExpiry: new Date(Date.now() + 86400 * 1000), scopes: scopes.join(" "), providerAccountId: tokenData.advertiser_id || "", providerEmail: "", connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "tiktok", status: "connected", config: { advertiserId: tokenData.advertiser_id || "" }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "tiktok", eventType: "oauth_connected", payload: { advertiserId: tokenData.advertiser_id } });
    res.redirect("/integrations?success=tiktok_connected");
  }));

  // ---- Microsoft 365 OAuth ----
  app.get("/api/oauth/microsoft/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Microsoft OAuth not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "microsoft";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
    const scopes = ["openid", "profile", "email", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite", "ChannelMessage.Send", "offline_access"];
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes.join(" "), state, response_mode: "query",
    });
    res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
  }));

  app.get("/api/oauth/microsoft/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=microsoft_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=microsoft_oauth_invalid_state");
    }
    const clientId = process.env.MICROSOFT_CLIENT_ID!;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/microsoft/callback`;
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: code as string, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=microsoft_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const profile = await profileRes.json() as any;
      providerEmail = profile.mail || profile.userPrincipalName || "";
      providerName = profile.displayName || "";
    } catch (err: any) {
      console.error("[INTEGRATIONS] Microsoft profile fetch failed:", err.message);
    }
    const scopes = ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite", "ChannelMessage.Send"];
    const expiresIn = tokenData.expires_in || 3600;
    await storage.upsertOAuthToken({
      provider: "microsoft", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "microsoft", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "microsoft", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=microsoft_connected");
  }));

  // ---- Calendly OAuth ----
  app.get("/api/oauth/calendly/authorize/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const clientId = process.env.CALENDLY_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: "Calendly OAuth not configured. Add CALENDLY_CLIENT_ID and CALENDLY_CLIENT_SECRET to your secrets." });
    const state = crypto.randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    (req.session as any).oauthSubAccountId = subAccountId;
    (req.session as any).oauthProvider = "calendly";
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/calendly/callback`;
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", state,
    });
    res.redirect(`https://auth.calendly.com/oauth/authorize?${params}`);
  }));

  app.get("/api/oauth/calendly/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect("/integrations?error=calendly_oauth_denied");
    const sessionState = (req.session as any)?.oauthState;
    const subAccountId = (req.session as any)?.oauthSubAccountId;
    if (!code || !state || state !== sessionState || !subAccountId) {
      return res.redirect("/integrations?error=calendly_oauth_invalid_state");
    }
    const clientId = process.env.CALENDLY_CLIENT_ID!;
    const clientSecret = process.env.CALENDLY_CLIENT_SECRET!;
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/calendly/callback`;
    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code as string, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
    });
    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.redirect("/integrations?error=calendly_token_failed");
    }
    let providerEmail = "", providerName = "";
    try {
      const meRes = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const meData = await meRes.json() as any;
      providerEmail = meData.resource?.email || "";
      providerName = meData.resource?.name || "";
    } catch (err: any) {
      console.error("[INTEGRATIONS] Calendly profile fetch failed:", err.message);
    }
    const scopes = ["events", "scheduling_links"];
    const expiresIn = tokenData.expires_in || 7200;
    await storage.upsertOAuthToken({
      provider: "calendly", subAccountId, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000), scopes: scopes.join(" "), providerAccountId: providerName, providerEmail, connectionType: "oauth",
    });
    await storage.upsertIntegrationConnection({
      subAccountId, provider: "calendly", status: "connected", config: { email: providerEmail, name: providerName }, connectionType: "oauth", connectedAt: new Date(),
    });
    await storage.createIntegrationEvent({ subAccountId, provider: "calendly", eventType: "oauth_connected", payload: { email: providerEmail } });
    res.redirect("/integrations?success=calendly_connected");
  }));

  // ---- OAuth Callback Handlers ----

  app.get("/api/oauth/google/callback", asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[OAUTH] Google OAuth error:", error);
      return res.redirect("/integrations?error=google_oauth_denied");
    }

    if (!code || typeof code !== "string") {
      return res.redirect("/integrations?error=missing_code");
    }

    const sessionState = (req.session as any).oauthState;
    const subAccountId = parseInt((req.session as any).oauthSubAccountId, 10);
    const sessionProvider = (req.session as any).oauthProvider;

    if (!state || state !== sessionState || sessionProvider !== "google" || isNaN(subAccountId) || subAccountId < 1) {
      return res.redirect("/integrations?error=invalid_state");
    }

    delete (req.session as any).oauthState;
    delete (req.session as any).oauthSubAccountId;
    delete (req.session as any).oauthProvider;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect("/integrations?error=google_not_configured");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("[OAUTH] Google token exchange failed:", errText);
      return res.redirect("/integrations?error=google_token_exchange_failed");
    }

    const tokenData = await tokenResponse.json() as OAuthTokenExchangeResponse;

    let providerEmail = "";
    let providerAccountId = "";
    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (profileRes.ok) {
        const profile = await profileRes.json() as GoogleUserInfo;
        providerEmail = profile.email || "";
        providerAccountId = profile.id || "";
      }
    } catch (err) {
      console.warn("[OAUTH] Failed to fetch Google profile:", err);
    }

    const expiresIn = tokenData.expires_in || 3600;

    await storage.upsertOAuthToken({
      provider: "google",
      subAccountId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      scopes: GOOGLE_OAUTH_SCOPES.join(" "),
      providerAccountId,
      providerEmail,
      connectionType: "oauth",
    });

    await storage.upsertIntegrationConnection({
      subAccountId,
      provider: "google",
      status: "connected",
      config: { email: providerEmail, accountId: providerAccountId },
      connectionType: "oauth",
      connectedAt: new Date(),
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider: "google",
      eventType: "oauth_connected",
      payload: { email: providerEmail },
    });

    res.redirect("/integrations?success=google_connected");
  }));

  app.get("/api/oauth/meta/callback", asyncHandler(async (req, res) => {
    const { code, state, error, error_reason } = req.query;

    if (error) {
      console.error("[OAUTH] Meta OAuth error:", error, error_reason);
      return res.redirect("/integrations?error=meta_oauth_denied");
    }

    if (!code || typeof code !== "string") {
      return res.redirect("/integrations?error=missing_code");
    }

    const sessionState = (req.session as any).oauthState;
    const subAccountId = parseInt((req.session as any).oauthSubAccountId, 10);
    const sessionProvider = (req.session as any).oauthProvider;

    if (!state || state !== sessionState || sessionProvider !== "meta" || isNaN(subAccountId) || subAccountId < 1) {
      return res.redirect("/integrations?error=invalid_state");
    }

    delete (req.session as any).oauthState;
    delete (req.session as any).oauthSubAccountId;
    delete (req.session as any).oauthProvider;

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return res.redirect("/integrations?error=meta_not_configured");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/meta/callback`;

    const tokenResponse = await fetch("https://graph.facebook.com/v19.0/oauth/access_token?" +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code: code as string,
      }),
      { signal: AbortSignal.timeout(10000) }
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("[OAUTH] Meta token exchange failed:", errText);
      return res.redirect("/integrations?error=meta_token_exchange_failed");
    }

    const shortLivedData = await tokenResponse.json() as OAuthTokenExchangeResponse;

    const longLivedResponse = await fetch("https://graph.facebook.com/v19.0/oauth/access_token?" +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedData.access_token,
      }),
      { signal: AbortSignal.timeout(10000) }
    );

    let accessToken = shortLivedData.access_token;
    let expiresIn = shortLivedData.expires_in || 3600;

    if (longLivedResponse.ok) {
      const longLivedData = await longLivedResponse.json() as OAuthTokenExchangeResponse;
      accessToken = longLivedData.access_token;
      expiresIn = longLivedData.expires_in || 5184000;
    }

    let providerEmail = "";
    let providerAccountId = "";
    try {
      const profileRes = await fetch("https://graph.facebook.com/v19.0/me?fields=id,name,email", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (profileRes.ok) {
        const profile = await profileRes.json() as MetaUserInfo;
        providerEmail = profile.email || "";
        providerAccountId = profile.id || "";
      }
    } catch (err) {
      console.warn("[OAUTH] Failed to fetch Meta profile:", err);
    }

    await storage.upsertOAuthToken({
      provider: "meta",
      subAccountId,
      accessToken,
      refreshToken: null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      scopes: META_OAUTH_SCOPES.join(","),
      providerAccountId,
      providerEmail,
      connectionType: "oauth",
    });

    await storage.upsertIntegrationConnection({
      subAccountId,
      provider: "meta",
      status: "connected",
      config: { email: providerEmail, accountId: providerAccountId },
      connectionType: "oauth",
      connectedAt: new Date(),
    });

    await storage.createIntegrationEvent({
      subAccountId,
      provider: "meta",
      eventType: "oauth_connected",
      payload: { email: providerEmail },
    });

    res.redirect("/integrations?success=meta_connected");
  }));

  // ---- Provider Asset Endpoints ----

  app.get("/api/integrations/:subAccountId/google/assets", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const token = await getValidToken(subAccountId, "google");
    if (!token) {
      return res.status(401).json({ error: "Google not connected or token expired" });
    }

    const assets: any[] = [];

    try {
      const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (calRes.ok) {
        const calData = await calRes.json() as GoogleCalendarListResponse;
        for (const cal of (calData.items || [])) {
          assets.push({ type: "calendar", id: cal.id, name: cal.summary || cal.id });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google calendars:", err);
    }

    try {
      const driveRes = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType)", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (driveRes.ok) {
        const driveData = await driveRes.json() as GoogleDriveFilesResponse;
        for (const file of (driveData.files || [])) {
          if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
            assets.push({ type: "sheet", id: file.id, name: file.name });
          } else {
            assets.push({ type: "drive_file", id: file.id, name: file.name });
          }
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google Drive files:", err);
    }

    try {
      const bizRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (bizRes.ok) {
        const bizData = await bizRes.json() as GoogleBusinessAccountsResponse;
        for (const account of (bizData.accounts || [])) {
          assets.push({ type: "business_profile", id: account.name, name: account.accountName || account.name });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Google Business profiles:", err);
    }

    const savedAssets = await storage.getProviderAssets(subAccountId, "google");
    const selectedIds = new Set(savedAssets.filter(a => a.selected).map(a => a.assetId));

    const enriched = assets.map(a => ({
      ...a,
      selected: selectedIds.has(a.id),
    }));

    res.json(enriched);
  }));

  app.post("/api/integrations/:subAccountId/google/verify", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { service } = req.body || {};
    const servicesToVerify = service ? [service] : ["gmail", "google-calendar", "google-sheets", "google-drive", "google-business"];

    const token = await getValidToken(subAccountId, "google");
    if (!token) {
      const results: Record<string, any> = {};
      for (const s of servicesToVerify) {
        results[s] = { verified: false, error: "Google not connected or token expired", reconnectRequired: true, lastVerified: new Date().toISOString() };
      }
      return res.json({ results });
    }

    const results: Record<string, any> = {};

    async function verifyService(serviceId: string) {
      const result: any = { verified: false, lastVerified: new Date().toISOString(), reconnectRequired: false, error: null };
      try {
        let apiUrl = "";
        switch (serviceId) {
          case "gmail":
            apiUrl = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
            break;
          case "google-calendar":
            apiUrl = "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1";
            break;
          case "google-sheets":
            apiUrl = "https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&pageSize=1";
            break;
          case "google-drive":
            apiUrl = "https://www.googleapis.com/drive/v3/files?pageSize=1";
            break;
          case "google-business":
            apiUrl = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
            break;
          default:
            result.error = "Unknown service";
            return result;
        }

        const response = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${token!.accessToken}` },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          result.verified = true;
        } else if (response.status === 401 || response.status === 403) {
          result.reconnectRequired = true;
          result.error = `Access denied (${response.status}) — scope may be missing or token revoked`;
        } else {
          result.error = `API returned status ${response.status}`;
        }
      } catch (err: any) {
        result.error = err.message || "Connection failed";
      }
      return result;
    }

    const verifications = await Promise.allSettled(
      servicesToVerify.map(async (s) => {
        results[s] = await verifyService(s);
      })
    );

    res.json({ results });
  }));

  app.get("/api/integrations/:subAccountId/meta/assets", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const token = await getValidToken(subAccountId, "meta");
    if (!token) {
      return res.status(401).json({ error: "Meta not connected or token expired" });
    }

    const assets: any[] = [];

    try {
      const pagesRes = await fetch("https://graph.facebook.com/v19.0/me/accounts", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json() as MetaAccountsResponse;
        for (const page of (pagesData.data || [])) {
          assets.push({ type: "page", id: page.id, name: page.name });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Meta pages:", err);
    }

    try {
      const adsRes = await fetch("https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (adsRes.ok) {
        const adsData = await adsRes.json() as MetaAdAccountsResponse;
        for (const account of (adsData.data || [])) {
          assets.push({ type: "ad_account", id: account.id, name: account.name || account.id });
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Meta ad accounts:", err);
    }

    try {
      const igRes = await fetch("https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account{id,name,username}", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (igRes.ok) {
        const igData = await igRes.json() as MetaAccountsResponse;
        for (const page of (igData.data || [])) {
          const igAccount = page.instagram_business_account;
          if (igAccount) {
            assets.push({ type: "instagram", id: igAccount.id, name: igAccount.username || igAccount.name || igAccount.id });
          }
        }
      }
    } catch (err) {
      console.warn("[ASSETS] Failed to fetch Instagram profiles:", err);
    }

    const savedAssets = await storage.getProviderAssets(subAccountId, "meta");
    const selectedIds = new Set(savedAssets.filter(a => a.selected).map(a => a.assetId));

    const enriched = assets.map(a => ({
      ...a,
      selected: selectedIds.has(a.id),
    }));

    res.json(enriched);
  }));

  app.post("/api/integrations/:subAccountId/assets/select", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const { provider, assets: assetSelections } = req.body;
    if (!provider || !Array.isArray(assetSelections)) {
      return res.status(400).json({ error: "provider and assets array are required" });
    }

    const results = [];
    for (const asset of assetSelections) {
      const saved = await storage.upsertProviderAsset({
        subAccountId,
        provider,
        assetType: asset.type,
        assetId: asset.id,
        assetName: asset.name,
        selected: asset.selected ?? true,
      });
      results.push(saved);
    }

    if (provider === "meta") {
      const selectedPage = assetSelections.find((a: any) => a.type === "page" && (a.selected ?? true));
      if (selectedPage) {
        const oauthToken = await storage.getOAuthToken(subAccountId, "meta");
        const existingConn = await storage.getIntegrationConnection(subAccountId, "meta");
        const existingConfig = (existingConn?.config as any) || {};
        await storage.upsertIntegrationConnection({
          subAccountId,
          provider: "meta",
          status: "connected",
          config: {
            ...existingConfig,
            pageId: selectedPage.id,
            pageName: selectedPage.name,
            accessToken: oauthToken?.accessToken || existingConfig.accessToken || null,
          },
          connectionType: existingConn?.connectionType || "oauth",
          connectedAt: existingConn?.connectedAt || new Date(),
        });
        console.log(`[META] Integration connection updated with pageId=${selectedPage.id} for subAccount=${subAccountId}`);
      }
    }

    res.json(results);
  }));

  // ---- Integration Event Endpoints ----

  app.post("/api/integrations/events", asyncHandler(async (req, res) => {
    const { subAccountId, provider, eventType, payload } = req.body;
    if (!subAccountId || !provider || !eventType) {
      return res.status(400).json({ error: "subAccountId, provider, and eventType are required" });
    }

    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const event = await storage.createIntegrationEvent({
      subAccountId,
      provider,
      eventType,
      payload: payload || {},
    });

    res.json(event);
  }));

  app.get("/api/integrations/:subAccountId/events", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const limit = parseInt(req.query.limit as string) || 50;
    const events = await storage.getIntegrationEvents(subAccountId, Math.min(limit, 200));
    res.json(events);
  }));

  // ---- Integration Health Check ----

  app.get("/api/integrations/:subAccountId/health", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connections = await storage.getIntegrationConnections(subAccountId);
    const oauthConnections = connections.filter(c => c.connectionType === "oauth" && c.status === "connected");

    const healthResults: Record<string, { healthy: boolean; error?: string }> = {};

    for (const conn of oauthConnections) {
      healthResults[conn.provider] = await checkTokenHealth(subAccountId, conn.provider);
    }

    res.json(healthResults);
  }));

  // ---- Shopify Webhook Endpoints ----
  app.post("/api/shopify/webhooks/:subAccountId", express.raw({ type: "application/json" }), asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    const topic = req.headers["x-shopify-topic"] as string;
    const shopDomain = req.headers["x-shopify-shop-domain"] as string;
    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;

    if (!topic) return res.status(400).json({ error: "Missing x-shopify-topic header" });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    let payload: any;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(rawBody.toString("utf8")) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.status(404).json({ error: "Shopify not connected for this account" });
    }

    const config = connection.config as Record<string, string>;

    if (config?.webhookSecret) {
      if (!hmacHeader) {
        return res.status(401).json({ error: "Missing webhook signature" });
      }
      const hash = crypto.createHmac("sha256", config.webhookSecret).update(rawBody).digest("base64");
      if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader))) {
        console.warn("[SHOPIFY] Webhook HMAC verification failed");
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    }
    const eventType = topic.replace(/\//g, "_");

    const shopifyEvent = await storage.createShopifyEvent({
      subAccountId,
      eventType,
      shopifyId: String(payload.id || ""),
      storeName: shopDomain || config?.storeDomain || null,
      payload,
      processed: false,
    });

    console.log(`[SHOPIFY] Received ${topic} event for account ${subAccountId}, event ID: ${shopifyEvent.id}`);

    if (topic === "checkouts/create" || topic === "checkouts/update") {
      const checkout = payload;
      if (checkout.email || checkout.phone) {
        try {
          await storage.createContact({
            subAccountId,
            firstName: checkout.billing_address?.first_name || checkout.shipping_address?.first_name || "Shopify Customer",
            lastName: checkout.billing_address?.last_name || checkout.shipping_address?.last_name || null,
            email: checkout.email || null,
            phone: checkout.phone || checkout.billing_address?.phone || null,
            source: "shopify",
            tags: ["shopify", "abandoned-cart"],
          });
        } catch (e) {
          console.log("[SHOPIFY] Contact creation skipped (may already exist):", (e as any).message);
        }
      }

      if (checkout.abandoned_checkout_url) {
        import("./v1").then(({ fireAutomationTriggerGlobal }) =>
          fireAutomationTriggerGlobal("shopify_abandoned_cart", subAccountId, {
            leadName: checkout.billing_address?.first_name || "Customer",
            leadEmail: checkout.email || "",
            leadPhone: checkout.phone || "",
            cartTotal: checkout.total_price || "0",
            cartUrl: checkout.abandoned_checkout_url || "",
            storeName: shopDomain || "",
            source: "shopify",
          })
        ).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", (e as any).message));
      }

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    if (topic === "orders/create") {
      const order = payload;
      if (order.email || order.phone) {
        try {
          await storage.createContact({
            subAccountId,
            firstName: order.billing_address?.first_name || order.customer?.first_name || "Shopify Customer",
            lastName: order.billing_address?.last_name || order.customer?.last_name || null,
            email: order.email || order.customer?.email || null,
            phone: order.phone || order.billing_address?.phone || order.customer?.phone || null,
            source: "shopify",
            tags: ["shopify", "customer", "order"],
          });
        } catch (e) {
          console.log("[SHOPIFY] Contact creation skipped (may already exist):", (e as any).message);
        }
      }

      import("./v1").then(({ fireAutomationTriggerGlobal }) =>
        fireAutomationTriggerGlobal("shopify_order_created", subAccountId, {
          leadName: order.customer?.first_name || order.billing_address?.first_name || "Customer",
          leadEmail: order.email || "",
          leadPhone: order.phone || "",
          orderNumber: order.order_number || order.name || "",
          orderTotal: order.total_price || "0",
          storeName: shopDomain || "",
          source: "shopify",
        })
      ).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", (e as any).message));

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    if (topic === "orders/fulfilled") {
      const order = payload;

      import("./v1").then(({ fireAutomationTriggerGlobal }) =>
        fireAutomationTriggerGlobal("shopify_order_fulfilled", subAccountId, {
          leadName: order.customer?.first_name || order.billing_address?.first_name || "Customer",
          leadEmail: order.email || "",
          leadPhone: order.phone || "",
          orderNumber: order.order_number || order.name || "",
          orderTotal: order.total_price || "0",
          storeName: shopDomain || "",
          source: "shopify",
        })
      ).catch((e) => console.warn("[SHOPIFY] Automation trigger error:", (e as any).message));

      await storage.updateShopifyEvent(shopifyEvent.id, { processed: true });
    }

    res.status(200).json({ received: true, eventId: shopifyEvent.id });
  }));

  app.get("/api/shopify/events/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const events = await storage.getShopifyEvents(subAccountId);
    res.json(events);
  }));

  app.post("/api/shopify/register-webhooks/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.status(400).json({ error: "Shopify is not connected" });
    }

    const config = connection.config as Record<string, string>;
    const domain = (config.storeDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const accessToken = config.accessToken;

    if (!domain || !accessToken) {
      return res.status(400).json({ error: "Missing Shopify store domain or access token" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const callbackUrl = `${baseUrl}/api/shopify/webhooks/${subAccountId}`;

    const topics = [
      "checkouts/create",
      "checkouts/update",
      "orders/create",
      "orders/fulfilled",
    ];

    const results: { topic: string; status: string; error?: string }[] = [];

    for (const topic of topics) {
      try {
        const webhookRes = await fetch(`https://${domain}/admin/api/2024-01/webhooks.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhook: {
              topic,
              address: callbackUrl,
              format: "json",
            },
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (webhookRes.ok) {
          results.push({ topic, status: "registered" });
        } else {
          const errData = await webhookRes.json().catch(() => ({})) as any;
          const errMsg = errData?.errors ? JSON.stringify(errData.errors) : `HTTP ${webhookRes.status}`;
          results.push({ topic, status: "failed", error: errMsg });
        }
      } catch (err: any) {
        results.push({ topic, status: "failed", error: err.message });
      }
    }

    res.json({ webhooks: results, callbackUrl });
  }));

  app.get("/api/shopify/status/:subAccountId", asyncHandler(async (req, res) => {
    const subAccountId = parseIntParam(req.params.subAccountId, "subAccountId");
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

    const connection = await storage.getIntegrationConnection(subAccountId, "shopify");
    if (!connection || connection.status !== "connected") {
      return res.json({ connected: false, storeName: null });
    }

    const config = connection.config as Record<string, string>;
    const domain = (config.storeDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    let storeName = domain;

    try {
      const shopRes = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
        headers: { "X-Shopify-Access-Token": config.accessToken },
        signal: AbortSignal.timeout(5000),
      });
      if (shopRes.ok) {
        const shopData = await shopRes.json() as any;
        storeName = shopData.shop?.name || domain;
      }
    } catch (err: any) {
      console.error("[INTEGRATIONS] Shopify store name fetch failed:", err.message);
    }

    const events = await storage.getShopifyEvents(subAccountId);

    res.json({
      connected: true,
      storeName,
      domain,
      connectedAt: connection.connectedAt,
      eventCount: events.length,
    });
  }));

  app.get("/api/service-status", asyncHandler(async (req, res) => {
    const services = [
      {
        name: "Twilio",
        provider: "twilio",
        description: "SMS & Voice",
        configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
      },
      {
        name: "Stripe",
        provider: "stripe",
        configured: !!(process.env.STRIPE_API_SECRET || process.env.STRIPE_SECRET_KEY),
        description: "Payments & Billing",
        envVars: ["STRIPE_API_SECRET"],
      },
      {
        name: "Meta / Facebook",
        provider: "meta",
        description: "Ads, DMs, Instagram (per-account)",
        configured: true,
        envVars: ["metaPageId", "metaAccessToken", "metaAppSecret"],
      },
      {
        name: "Vapi",
        provider: "vapi",
        description: "Voice AI Agents",
        configured: vapiConfig.isConfigured,
        envVars: ["VAPI_PRIVATE_KEY", "VAPI_PUBLIC_KEY"],
      },
      {
        name: "ElevenLabs",
        provider: "elevenlabs",
        description: "AI Voice Synthesis & TTS",
        configured: !!process.env.ELEVENLABS_API_KEY,
        envVars: ["ELEVENLABS_API_KEY"],
      },
      {
        name: "AI Provider (OpenAI / Gemini)",
        provider: "ai",
        description: "AI Chat, Site Generation, Bot Training (OpenAI primary, Gemini fallback)",
        configured: isAIConfigured(),
        envVars: ["OPENAI_APEX_INT_KEY", "Gemini_API_Key_saas"],
      },
      {
        name: "Mailchimp",
        provider: "mailchimp",
        description: "Email Campaigns",
        configured: !!process.env.MAILCHIMP_API_KEY,
        envVars: ["MAILCHIMP_API_KEY"],
      },
      {
        name: "Google Maps",
        provider: "google-maps",
        description: "Location Services",
        configured: !!process.env.GOOGLE_API_KEY,
        envVars: ["GOOGLE_API_KEY"],
      },
    ];

    const allSubAccounts = await storage.getSubAccounts();
    const providerConnections = new Map<string, string>();
    for (const account of allSubAccounts) {
      const conns = await storage.getIntegrationConnections(account.id);
      for (const conn of conns) {
        if (conn.status === "connected" && !providerConnections.has(conn.provider)) {
          providerConnections.set(conn.provider, "connected");
        }
      }
    }

    const result: Record<string, { status: string; label: string; description: string }> = {};
    for (const s of services) {
      const hasConnection = providerConnections.has(s.provider);
      let status: string;
      if (s.configured && hasConnection) {
        status = "connected_verified";
      } else if (hasConnection) {
        status = "stored_unverified";
      } else if (s.configured) {
        status = "configured";
      } else {
        status = "not_configured";
      }
      result[s.provider] = {
        status,
        label: s.name,
        description: s.description,
      };
    }
    res.json(result);
  }));

  app.post("/api/admin/twilio-migration", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const { isUserAdmin } = await import("./helpers");
    if (!isUserAdmin(user)) return res.status(403).json({ error: "Admin access required" });

    const { subAccountId } = req.body;
    const { migrateAllSubAccounts, migrateSingleSubAccount } = await import("../twilioMigration");
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    if (subAccountId) {
      const parsed = parseInt(subAccountId);
      if (isNaN(parsed)) return res.status(400).json({ error: "Invalid subAccountId" });
      const result = await migrateSingleSubAccount(parsed, baseUrl);
      return res.json(result);
    }

    const results = await migrateAllSubAccounts(baseUrl);
    res.json({ migrated: results });
  }));
}
