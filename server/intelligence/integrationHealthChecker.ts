/**
 * INTEGRATION HEALTH CHECKER — Hardened, honest, proactive.
 *
 * Per-provider adapter that performs a CHEAP, READ-ONLY API call to verify
 * that credentials still work, then persists the result via the existing
 * trackIntegrationSuccess / trackIntegrationFailure helpers (which write to
 * `integration_health_state`).
 *
 * Design principles:
 *  - Honest: a missing credential is reported as `disconnected`, NOT `healthy`.
 *  - Source-level: we use the same credential resolution paths the runtime
 *    code uses (getMetaConfig, etc), so health reflects what real jobs see.
 *  - Bounded cost: each adapter caps at 1 cheap GET; total per-account run
 *    is O(providers configured), not O(N).
 *  - Failure-tolerant: an exception in one adapter does not abort the run.
 */
import { db } from "../db";
import { subAccounts, integrationConnections } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  trackIntegrationSuccess,
  trackIntegrationFailure,
  trackIntegrationDisconnected,
} from "./integrationHealth";

const HTTP_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = HTTP_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-provider adapters
// ─────────────────────────────────────────────────────────────────────────────

async function checkMeta(accountId: number, account: { metaPageId: string | null; metaAccessToken: string | null }): Promise<void> {
  const integrationType = "meta";
  const integrationKey = account.metaPageId || `account_${accountId}`;
  if (!account.metaPageId || !account.metaAccessToken) {
    await trackIntegrationDisconnected(accountId, integrationType, integrationKey, "missing_meta_credentials");
    return;
  }
  try {
    // Use Authorization header (NOT query string) so the access token never
    // ends up in upstream proxy / fetch / DNS logs.
    const res = await fetchWithTimeout("https://graph.facebook.com/v21.0/me", {
      headers: { Authorization: `Bearer ${account.metaAccessToken}` },
    });
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      await trackIntegrationSuccess(accountId, integrationType, integrationKey, { name: data?.name, id: data?.id });
    } else {
      const body = await res.text().catch(() => "");
      await trackIntegrationFailure(accountId, integrationType, integrationKey, `meta_graph_${res.status}`, {
        status: res.status,
        snippet: body.substring(0, 200),
      });
    }
  } catch (err: any) {
    await trackIntegrationFailure(accountId, integrationType, integrationKey, `meta_graph_throw: ${err?.message?.substring(0, 200)}`);
  }
}

async function checkTwilio(accountId: number, account: { twilioSubaccountSid: string | null; twilioSubaccountAuthToken: string | null }): Promise<void> {
  const integrationType = "twilio";
  const sid = account.twilioSubaccountSid || process.env.TWILIO_ACCOUNT_SID || null;
  const token = account.twilioSubaccountAuthToken || process.env.TWILIO_AUTH_TOKEN || null;
  const integrationKey = sid || `account_${accountId}`;
  if (!sid || !token) {
    await trackIntegrationDisconnected(accountId, integrationType, integrationKey, "missing_twilio_credentials");
    return;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    });
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      await trackIntegrationSuccess(accountId, integrationType, integrationKey, { status: data?.status, friendly_name: data?.friendly_name });
    } else {
      await trackIntegrationFailure(accountId, integrationType, integrationKey, `twilio_${res.status}`, { status: res.status });
    }
  } catch (err: any) {
    await trackIntegrationFailure(accountId, integrationType, integrationKey, `twilio_throw: ${err?.message?.substring(0, 200)}`);
  }
}

async function checkOpenAi(accountId: number): Promise<void> {
  // OpenAI is a system-level integration, not per-account. We attribute it to
  // every account so each tenant sees the truth: if our LLM is down, theirs is too.
  const integrationType = "openai";
  const integrationKey = "system";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await trackIntegrationDisconnected(accountId, integrationType, integrationKey, "missing_openai_api_key");
    return;
  }
  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      await trackIntegrationSuccess(accountId, integrationType, integrationKey);
    } else {
      await trackIntegrationFailure(accountId, integrationType, integrationKey, `openai_${res.status}`, { status: res.status });
    }
  } catch (err: any) {
    await trackIntegrationFailure(accountId, integrationType, integrationKey, `openai_throw: ${err?.message?.substring(0, 200)}`);
  }
}

async function checkTelegram(accountId: number, account: { telegramBotToken: string | null }): Promise<void> {
  const integrationType = "telegram";
  const integrationKey = account.telegramBotToken ? `bot_${accountId}` : `account_${accountId}`;
  if (!account.telegramBotToken) {
    // Telegram is opt-in per account — absence is not a failure, so we skip
    // (no row written) rather than report "disconnected" noise.
    return;
  }
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${account.telegramBotToken}/getMe`);
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      if (data?.ok === true) {
        await trackIntegrationSuccess(accountId, integrationType, integrationKey, { username: data.result?.username });
      } else {
        await trackIntegrationFailure(accountId, integrationType, integrationKey, "telegram_api_ok_false");
      }
    } else {
      await trackIntegrationFailure(accountId, integrationType, integrationKey, `telegram_${res.status}`);
    }
  } catch (err: any) {
    await trackIntegrationFailure(accountId, integrationType, integrationKey, `telegram_throw: ${err?.message?.substring(0, 200)}`);
  }
}

async function checkGoogleCalendar(accountId: number): Promise<void> {
  const integrationType = "google-calendar";
  const integrationKey = "replit-connector";
  // Only check if the sub-account has opted in (config.googleCalendarSync.enabled = true)
  const [row] = await db.select({ config: subAccounts.config })
    .from(subAccounts).where(eq(subAccounts.id, accountId)).limit(1);
  const enabled = (row?.config as any)?.googleCalendarSync?.enabled === true;
  if (!enabled) return; // not opted in — no row, no noise

  try {
    const { listCalendars } = await import("../googleCalendarSync");
    const list = await listCalendars();
    if (Array.isArray(list)) {
      await trackIntegrationSuccess(accountId, integrationType, integrationKey, { calendars: list.length });
    } else {
      await trackIntegrationFailure(accountId, integrationType, integrationKey, "gcal_listCalendars_unexpected");
    }
  } catch (err: any) {
    await trackIntegrationFailure(accountId, integrationType, integrationKey, `gcal_throw: ${err?.message?.substring(0, 200)}`);
  }
}

async function checkStripeConnections(accountId: number): Promise<void> {
  // Stripe is configured via integration_connections rows, not subAccounts columns.
  // We read each row, attempt a cheap GET /v1/balance with the stored secret,
  // and report per-row health.
  const rows = await db.select().from(integrationConnections)
    .where(eq(integrationConnections.subAccountId, accountId));
  for (const row of rows) {
    if (row.provider !== "stripe") continue;
    const cfg = (row.config as any) || {};
    const secretKey = cfg.secretKey || cfg.apiKey || cfg.sk;
    const integrationType = "stripe";
    const integrationKey = `conn_${row.id}`;
    if (!secretKey) {
      await trackIntegrationDisconnected(accountId, integrationType, integrationKey, "missing_stripe_secret_key");
      continue;
    }
    try {
      const res = await fetchWithTimeout("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (res.ok) {
        await trackIntegrationSuccess(accountId, integrationType, integrationKey);
      } else {
        await trackIntegrationFailure(accountId, integrationType, integrationKey, `stripe_${res.status}`, { status: res.status });
      }
    } catch (err: any) {
      await trackIntegrationFailure(accountId, integrationType, integrationKey, `stripe_throw: ${err?.message?.substring(0, 200)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runHealthCheckForAccountReal(accountId: number): Promise<{
  checked: string[];
  errors: Array<{ provider: string; error: string }>;
}> {
  const checked: string[] = [];
  const errors: Array<{ provider: string; error: string }> = [];

  const [account] = await db.select().from(subAccounts).where(eq(subAccounts.id, accountId)).limit(1);
  if (!account) {
    return { checked, errors: [{ provider: "lookup", error: `sub_account_not_found: ${accountId}` }] };
  }

  const adapters: Array<[string, () => Promise<void>]> = [
    ["meta", () => checkMeta(accountId, account)],
    ["twilio", () => checkTwilio(accountId, account)],
    ["openai", () => checkOpenAi(accountId)],
    ["telegram", () => checkTelegram(accountId, account)],
    ["google-calendar", () => checkGoogleCalendar(accountId)],
    ["stripe", () => checkStripeConnections(accountId)],
  ];

  for (const [provider, fn] of adapters) {
    try {
      await fn();
      checked.push(provider);
    } catch (err: any) {
      // Adapter-level guard — should never fire because each adapter handles
      // its own errors, but if it does, we record it without aborting.
      errors.push({ provider, error: err?.message?.substring(0, 200) || String(err) });
    }
  }

  return { checked, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Background scheduler
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function runHealthCheckForAllAccounts(): Promise<void> {
  let accounts: Array<{ id: number; name: string }>;
  try {
    accounts = await db.select({ id: subAccounts.id, name: subAccounts.name }).from(subAccounts);
  } catch (err: any) {
    console.warn(`[INTEG-HEALTH] Failed to fetch accounts: ${err?.message}`);
    return;
  }
  if (accounts.length === 0) return;

  console.log(`[INTEG-HEALTH] Running health check across ${accounts.length} sub-account(s)`);
  let totalChecked = 0;
  let totalErrors = 0;
  for (const acc of accounts) {
    try {
      const result = await runHealthCheckForAccountReal(acc.id);
      totalChecked += result.checked.length;
      totalErrors += result.errors.length;
      if (result.errors.length > 0) {
        console.warn(`[INTEG-HEALTH] Account ${acc.id} (${acc.name}): adapter errors:`, result.errors);
      }
    } catch (err: any) {
      console.warn(`[INTEG-HEALTH] Account ${acc.id}: top-level fail: ${err?.message}`);
    }
  }
  console.log(`[INTEG-HEALTH] Cycle complete — ${totalChecked} adapter runs, ${totalErrors} adapter errors`);
}

export function startIntegrationHealthChecker(): void {
  if (healthCheckTimer) return;
  console.log(`[INTEG-HEALTH] Background populator started — every ${HEALTH_CHECK_INTERVAL_MS / 60000} min`);
  // Stagger first run so it doesn't pile on top of startup work.
  setTimeout(() => { runHealthCheckForAllAccounts().catch(() => {}); }, 60_000);
  healthCheckTimer = setInterval(() => {
    runHealthCheckForAllAccounts().catch(() => {});
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function stopIntegrationHealthChecker(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log("[INTEG-HEALTH] Background populator stopped");
  }
}
