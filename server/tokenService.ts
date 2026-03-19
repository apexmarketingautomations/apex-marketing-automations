import { storage } from "./storage";
import type { OAuthToken } from "@shared/schema";

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
}

interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function getValidToken(subAccountId: number, provider: string): Promise<OAuthToken | null> {
  const token = await storage.getOAuthToken(subAccountId, provider);
  if (!token) return null;

  if (token.tokenExpiry && new Date(token.tokenExpiry).getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS) {
    try {
      const refreshed = await refreshToken(token);
      return refreshed;
    } catch (err) {
      console.error(`[TOKEN_SERVICE] Failed to refresh ${provider} token for subAccount ${subAccountId}:`, err);
      return null;
    }
  }

  return token;
}

async function refreshToken(token: OAuthToken): Promise<OAuthToken> {
  if (token.provider === "google") {
    return refreshGoogleToken(token);
  } else if (token.provider === "meta") {
    return refreshMetaToken(token);
  }
  throw new Error(`Unsupported provider for token refresh: ${token.provider}`);
}

async function refreshGoogleToken(token: OAuthToken): Promise<OAuthToken> {
  if (!token.refreshToken) {
    throw new Error("No refresh token available for Google");
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google token refresh failed: ${error}`);
  }

  const data = await response.json() as GoogleTokenResponse;
  const expiresIn = data.expires_in || 3600;

  const updated = await storage.upsertOAuthToken({
    provider: "google",
    subAccountId: token.subAccountId,
    accessToken: data.access_token,
    refreshToken: token.refreshToken,
    tokenExpiry: new Date(Date.now() + expiresIn * 1000),
    scopes: token.scopes,
    providerAccountId: token.providerAccountId,
    providerEmail: token.providerEmail,
    connectionType: "oauth",
  });

  console.log(`[TOKEN_SERVICE] Refreshed Google token for subAccount ${token.subAccountId}`);
  return updated;
}

async function refreshMetaToken(token: OAuthToken): Promise<OAuthToken> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Meta OAuth credentials not configured");
  }

  const response = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token.accessToken,
    }),
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Meta token refresh failed: ${error}`);
  }

  const data = await response.json() as MetaTokenResponse;
  const expiresIn = data.expires_in || 5184000;

  const updated = await storage.upsertOAuthToken({
    provider: "meta",
    subAccountId: token.subAccountId,
    accessToken: data.access_token,
    refreshToken: null,
    tokenExpiry: new Date(Date.now() + expiresIn * 1000),
    scopes: token.scopes,
    providerAccountId: token.providerAccountId,
    providerEmail: token.providerEmail,
    connectionType: "oauth",
  });

  console.log(`[TOKEN_SERVICE] Refreshed Meta token for subAccount ${token.subAccountId}`);
  return updated;
}

export async function revokeToken(subAccountId: number, provider: string): Promise<boolean> {
  const token = await storage.getOAuthToken(subAccountId, provider);
  if (!token) return false;

  try {
    if (provider === "google" && token.accessToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token.accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10000),
      });
    } else if (provider === "meta" && token.accessToken) {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      if (appId && appSecret) {
        await fetch(
          `https://graph.facebook.com/v19.0/me/permissions?access_token=${token.accessToken}`,
          { method: "DELETE", signal: AbortSignal.timeout(10000) }
        );
      }
    }
  } catch (err) {
    console.warn(`[TOKEN_SERVICE] Failed to revoke ${provider} token (continuing with local deletion):`, err);
  }

  await storage.deleteOAuthToken(subAccountId, provider);
  console.log(`[TOKEN_SERVICE] Revoked and deleted ${provider} token for subAccount ${subAccountId}`);
  return true;
}

export async function checkTokenHealth(subAccountId: number, provider: string): Promise<{ healthy: boolean; error?: string }> {
  const token = await getValidToken(subAccountId, provider);
  if (!token) {
    return { healthy: false, error: "No token found or token refresh failed" };
  }

  try {
    if (provider === "google") {
      const response = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + token.accessToken, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { healthy: false, error: "Google token is invalid" };
      }
      return { healthy: true };
    } else if (provider === "meta") {
      const response = await fetch("https://graph.facebook.com/v19.0/me", {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { healthy: false, error: "Meta token is invalid" };
      }
      return { healthy: true };
    }
    return { healthy: false, error: `Unknown provider: ${provider}` };
  } catch (err: any) {
    return { healthy: false, error: `Health check failed: ${err.message}` };
  }
}
