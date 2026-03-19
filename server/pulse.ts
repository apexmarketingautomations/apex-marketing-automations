import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ServiceStatus {
  configured: boolean;
  authenticated: boolean;
  reachable: boolean;
  lastSuccessAt: string | null;
  degraded: boolean;
  detail: string;
}

export interface PulseReport {
  status: "healthy" | "degraded" | "down";
  services: {
    database: ServiceStatus;
    openai: ServiceStatus;
    gemini: ServiceStatus;
    twilio: ServiceStatus;
    vapi: ServiceStatus;
  };
  timestamp: string;
}

const lastSuccess: Record<string, number | null> = {
  database: null,
  openai: null,
  gemini: null,
  twilio: null,
  vapi: null,
};

export function recordSuccess(service: keyof typeof lastSuccess): void {
  lastSuccess[service] = Date.now();
}

function ts(service: string): string | null {
  const t = lastSuccess[service];
  return t != null ? new Date(t).toISOString() : null;
}

async function checkDatabase(): Promise<ServiceStatus> {
  const configured = !!process.env.DATABASE_URL;
  if (!configured) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "DATABASE_URL not set" };
  }
  try {
    await db.execute(sql`SELECT 1`);
    lastSuccess.database = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("database"), degraded: false, detail: "Connected" };
  } catch (e: any) {
    return { configured: true, authenticated: false, reachable: false, lastSuccessAt: ts("database"), degraded: false, detail: e?.message || "Query failed" };
  }
}

async function checkOpenAI(): Promise<ServiceStatus> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "AI_INTEGRATIONS_OPENAI_API_KEY not set" };
  }
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    await client.models.list();
    lastSuccess.openai = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("openai"), degraded: false, detail: "Authenticated and reachable" };
  } catch (e: any) {
    const status = e?.status ?? e?.statusCode ?? 0;
    const authenticated = status !== 401 && status !== 403;
    const reachable = status !== 0 && status !== 503 && !String(e?.message ?? "").toLowerCase().includes("enotfound") && !String(e?.message ?? "").toLowerCase().includes("timeout");
    return {
      configured: true,
      authenticated,
      reachable,
      lastSuccessAt: ts("openai"),
      degraded: true,
      detail: e?.message || "Verification failed",
    };
  }
}

async function checkGemini(): Promise<ServiceStatus> {
  const apiKey = process.env.Gemini_API_Key_saas;
  if (!apiKey) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "Gemini_API_Key_saas not set" };
  }
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const geminiClient = new GoogleGenAI({ apiKey });
    const models = await geminiClient.models.list();
    const modelList = [];
    for await (const m of models) {
      modelList.push(m);
      if (modelList.length >= 1) break;
    }
    lastSuccess.gemini = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("gemini"), degraded: false, detail: "Authenticated and reachable" };
  } catch (e: any) {
    const msg = String(e?.message ?? "").toLowerCase();
    const status = e?.status ?? e?.statusCode ?? 0;
    const authenticated = status !== 401 && status !== 403 && !msg.includes("api_key") && !msg.includes("permission denied");
    const reachable = !msg.includes("enotfound") && !msg.includes("timeout") && !msg.includes("econnrefused");
    return {
      configured: true,
      authenticated,
      reachable,
      lastSuccessAt: ts("gemini"),
      degraded: true,
      detail: e?.message || "Verification failed",
    };
  }
}

async function checkTwilio(): Promise<ServiceStatus> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: !sid ? "TWILIO_ACCOUNT_SID not set" : "TWILIO_AUTH_TOKEN not set" };
  }
  try {
    const twilio = await import("twilio");
    const Twilio = (twilio as any).default || twilio;
    const client = Twilio(sid, token);
    await client.api.accounts(sid).fetch();
    lastSuccess.twilio = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("twilio"), degraded: false, detail: "Account verified" };
  } catch (e: any) {
    const status = e?.status ?? e?.statusCode ?? 0;
    const authenticated = status !== 401 && status !== 403 && status !== 20003;
    const reachable = status !== 0 && !String(e?.message ?? "").toLowerCase().includes("enotfound") && !String(e?.message ?? "").toLowerCase().includes("timeout");
    return {
      configured: true,
      authenticated,
      reachable,
      lastSuccessAt: ts("twilio"),
      degraded: true,
      detail: e?.message || "Verification failed",
    };
  }
}

async function checkVapi(): Promise<ServiceStatus> {
  const privateKey = process.env.VAPI_PRIVATE_KEY_APEX || process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi;
  if (!privateKey) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "VAPI_PRIVATE_KEY not set" };
  }
  try {
    const response = await fetch("https://api.vapi.ai/assistant?limit=1", {
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok || response.status === 200) {
      lastSuccess.vapi = Date.now();
      return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("vapi"), degraded: false, detail: "API key verified" };
    }
    const authenticated = response.status !== 401 && response.status !== 403;
    return {
      configured: true,
      authenticated,
      reachable: true,
      lastSuccessAt: ts("vapi"),
      degraded: true,
      detail: `HTTP ${response.status}`,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? "").toLowerCase();
    const reachable = !msg.includes("enotfound") && !msg.includes("timeout") && !msg.includes("abort") && !msg.includes("econnrefused");
    return {
      configured: true,
      authenticated: false,
      reachable,
      lastSuccessAt: ts("vapi"),
      degraded: true,
      detail: e?.message || "Verification failed",
    };
  }
}

export async function runPulseCheck(): Promise<PulseReport> {
  const [database, openai, gemini, twilio, vapi] = await Promise.all([
    checkDatabase(),
    checkOpenAI(),
    checkGemini(),
    checkTwilio(),
    checkVapi(),
  ]);

  const allServices = [database, openai, gemini, twilio, vapi];
  const criticalDown = !database.reachable || (!openai.reachable && !gemini.reachable);
  const anyDown = allServices.some((s) => s.configured && (!s.reachable || !s.authenticated));
  const allHealthy = allServices.every((s) => !s.configured || (s.reachable && s.authenticated && !s.degraded));

  let overallStatus: "healthy" | "degraded" | "down";
  if (criticalDown) {
    overallStatus = "down";
  } else if (anyDown || !allHealthy) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  return {
    status: overallStatus,
    services: { database, openai, gemini, twilio, vapi },
    timestamp: new Date().toISOString(),
  };
}
