import { db } from "./db";
import { sql } from "drizzle-orm";
import { getAIProviderStatus, isOpenAIConfigured } from "./aiGateway";

export type ServiceCategory = "core" | "optional";

export interface ServiceStatus {
  configured: boolean;
  authenticated: boolean;
  reachable: boolean;
  lastSuccessAt: string | null;
  degraded: boolean;
  detail: string;
  category: ServiceCategory;
  environment?: string;
}

export interface PulseReport {
  status: "healthy" | "degraded" | "down";
  statusReason: string;
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

function getEnvironment(): string {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.REPL_SLUG || process.env.REPL_ID) return "replit";
  return process.env.NODE_ENV || "development";
}

async function checkDatabase(): Promise<ServiceStatus> {
  const configured = !!process.env.DATABASE_URL;
  if (!configured) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "DATABASE_URL not set", category: "core" };
  }
  try {
    await db.execute(sql`SELECT 1`);
    lastSuccess.database = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("database"), degraded: false, detail: "Connected", category: "core" };
  } catch (e: any) {
    return { configured: true, authenticated: false, reachable: false, lastSuccessAt: ts("database"), degraded: false, detail: e?.message || "Query failed", category: "core" };
  }
}

async function checkOpenAI(): Promise<ServiceStatus> {
  const configured = isOpenAIConfigured();
  if (!configured) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "OPENAI_APEX_INT_KEY not set", category: "core" };
  }
  const gatewayStatus = getAIProviderStatus();
  const circuitOpen = gatewayStatus.circuitBreakerOpen;
  const active = gatewayStatus.activeProvider === "openai";
  const degraded = circuitOpen;
  const detail = circuitOpen
    ? `Circuit breaker open since ${gatewayStatus.circuitBreakerTrippedAt} — routing to Gemini`
    : active
    ? "Active (primary)"
    : "Configured but Gemini is active";
  return {
    configured: true,
    authenticated: true,
    reachable: !circuitOpen,
    lastSuccessAt: ts("openai"),
    degraded,
    detail,
    category: "core",
  };
}

async function checkGemini(): Promise<ServiceStatus> {
  const apiKey = process.env.Gemini_API_Key_saas;
  if (!apiKey) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: "Gemini_API_Key_saas not set", category: "core" };
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
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("gemini"), degraded: false, detail: "Authenticated and reachable", category: "core" };
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
      category: "core",
    };
  }
}

async function checkTwilio(): Promise<ServiceStatus> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return { configured: false, authenticated: false, reachable: false, lastSuccessAt: null, degraded: false, detail: !sid ? "TWILIO_ACCOUNT_SID not set" : "TWILIO_AUTH_TOKEN not set", category: "optional" };
  }
  try {
    const twilio = await import("twilio");
    const Twilio = (twilio as any).default || twilio;
    const client = Twilio(sid, token);
    await client.api.accounts(sid).fetch();
    lastSuccess.twilio = Date.now();
    return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("twilio"), degraded: false, detail: "Account verified", category: "optional" };
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
      category: "optional",
    };
  }
}

async function checkVapi(): Promise<ServiceStatus> {
  const env = getEnvironment();
  const privateKey = process.env.VAPI_PRIVATE_KEY_APEX || process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi;
  if (!privateKey) {
    return {
      configured: false,
      authenticated: false,
      reachable: false,
      lastSuccessAt: null,
      degraded: false,
      detail: `Not configured in this environment (${env}). Add VAPI_PRIVATE_KEY to enable voice AI.`,
      category: "optional",
      environment: env,
    };
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
      return { configured: true, authenticated: true, reachable: true, lastSuccessAt: ts("vapi"), degraded: false, detail: "API key verified", category: "optional", environment: env };
    }
    const authenticated = response.status !== 401 && response.status !== 403;
    return {
      configured: true,
      authenticated,
      reachable: true,
      lastSuccessAt: ts("vapi"),
      degraded: true,
      detail: `Key configured but service returned HTTP ${response.status}`,
      category: "optional",
      environment: env,
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
      detail: `Key configured but service unreachable: ${e?.message || "Verification failed"}`,
      category: "optional",
      environment: env,
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

  const allServices = { database, openai, gemini, twilio, vapi };
  const serviceList = Object.values(allServices);
  const coreServices = serviceList.filter(s => s.category === "core");
  const optionalServices = serviceList.filter(s => s.category === "optional");

  const coreDown = !database.reachable || (!openai.reachable && !gemini.reachable);
  const coreDegraded = coreServices.some(s => s.configured && (!s.reachable || !s.authenticated || s.degraded));
  const coreHealthy = coreServices.every(s => !s.configured || (s.reachable && s.authenticated && !s.degraded));

  let overallStatus: "healthy" | "degraded" | "down";
  let statusReason: string;

  if (coreDown) {
    overallStatus = "down";
    const downCoreNames = [];
    if (!database.reachable) downCoreNames.push("Database");
    if (!openai.reachable && !gemini.reachable) downCoreNames.push("AI (both OpenAI and Gemini)");
    statusReason = `Core service(s) down: ${downCoreNames.join(", ")}`;
  } else if (coreDegraded) {
    overallStatus = "degraded";
    const degradedNames = coreServices
      .filter(s => s.configured && (!s.reachable || !s.authenticated || s.degraded))
      .map(s => {
        if (s === database) return "Database";
        if (s === openai) return "OpenAI";
        if (s === gemini) return "Gemini";
        return "Unknown core service";
      });
    statusReason = `Core service(s) degraded: ${degradedNames.join(", ")}`;
  } else {
    overallStatus = "healthy";
    const optionalIssues = optionalServices.filter(s => s.configured && (!s.reachable || !s.authenticated || s.degraded));
    if (optionalIssues.length > 0) {
      statusReason = `All core services healthy. Optional service issue(s) noted but not affecting overall status.`;
    } else {
      statusReason = "All services operational";
    }
  }

  return {
    status: overallStatus,
    statusReason,
    services: allServices,
    timestamp: new Date().toISOString(),
  };
}
