import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { hasFeature } from "@shared/schema";

export type AsyncHandler<Req extends Request = Request, Res extends Response = Response> =
  (req: Req, res: Res, next: NextFunction) => Promise<any>;

function isStripeError(err: any): boolean {
  if (err?.type === 'StripeAuthenticationError' || err?.statusCode === 401 || err?.code === 'authentication_error') {
    return true;
  }
  if (typeof err?.name === 'string' && err.name.startsWith('Stripe')) {
    return true;
  }
  if (typeof err?.message === 'string' && /stripe/i.test(err.message)) {
    return true;
  }
  return false;
}

export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: AsyncHandler<Req, Res>,
) {
  if (typeof fn !== 'function') {
    throw new TypeError('asyncHandler requires a function argument');
  }
  const wrapper = (req: Req, res: Res, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (isStripeError(err)) {
        import("../stripeClient")
          .then((mod: { handleStripeError?: (err: unknown) => void; recover?: () => Promise<unknown> | unknown }) => {
            if (typeof mod.handleStripeError === 'function') {
              mod.handleStripeError(err);
            }
            if (typeof mod.recover === 'function') {
              Promise.resolve(mod.recover()).catch((err) => console.warn("[HELPERS] promise rejected:", err instanceof Error ? err.message : err));
            }
          })
          .catch((e) =>
            console.error("[HELPERS] Stripe error handler failed:", e instanceof Error ? e.message : e),
          );
      }
      next(err);
    });
  };
  return Object.assign(wrapper, fn) as typeof wrapper;
}

export function parseIntParam(value: string | string[] | undefined, name: string): number {
  const str = Array.isArray(value) ? value[0] : value;
  if (str === undefined || str === null || str === "") {
    throw Object.assign(new Error(`Missing required parameter: ${name}`), { status: 400, statusCode: 400 });
  }
  if (!/^-?\d+$/.test(str)) {
    throw Object.assign(new Error(`Parameter '${name}' must be an integer, received: ${str}`), { status: 400, statusCode: 400 });
  }
  const parsed = parseInt(str, 10);
  if (isNaN(parsed)) {
    throw Object.assign(new Error(`Failed to parse '${name}' as integer`), { status: 400, statusCode: 400 });
  }
  if (parsed < 1) {
    throw Object.assign(new Error(`Parameter '${name}' must be a positive integer (>= 1)`), { status: 400, statusCode: 400 });
  }
  return parsed;
}

export function getUserId(user: any): string {
  return user.claims?.sub || user.id;
}

// Accounts with full admin override — can access any sub-account
const APEX_ADMIN_ACCOUNT_IDS = [13, 21]; // Apex Marketing + Officer Layla
const APEX_PARENT_ACCOUNT_ID = 13;

let _parentOwnerCache: { userId: string; ts: number } | null = null;
const PARENT_CACHE_TTL = 60_000;

export async function isApexParentUser(userId: string): Promise<boolean> {
  if (_parentOwnerCache && _parentOwnerCache.userId === userId && Date.now() - _parentOwnerCache.ts < PARENT_CACHE_TTL) {
    return true;
  }
  // Check all admin accounts (Apex Marketing + Layla)
  for (const accountId of APEX_ADMIN_ACCOUNT_IDS) {
    const account = await storage.getSubAccount(accountId);
    if (account && account.ownerUserId === userId) {
      _parentOwnerCache = { userId, ts: Date.now() };
      return true;
    }
  }
  return false;
}

export async function verifyAccountOwnership(req: Request, res: Response, subAccountId: number): Promise<boolean> {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const userId = getUserId(user);
  const adminUserId = process.env.ADMIN_USER_ID;
  if (adminUserId && userId === adminUserId) {
    return true;
  }
  const account = await storage.getSubAccount(subAccountId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return false;
  }
  if (account.ownerUserId === userId) {
    return true;
  }
  if (await isApexParentUser(userId)) {
    return true;
  }
  res.status(403).json({ error: "Access denied" });
  return false;
}

export function isUserAdmin(user: any): boolean {
  if (!user) return false;
  const userId = getUserId(user);
  const adminUserId = process.env.ADMIN_USER_ID;
  return !!(adminUserId && userId === adminUserId);
}

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (!isUserAdmin(user)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

const AI_USAGE_COSTS: Record<string, number> = {
  AI_IMAGE_GEN: 0.25, AI_CHAT: 0.03, AI_STREAM: 0.03, DOMAIN_PURCHASE: 0,
};

export async function logUsageInternal(subAccountId: number | null, type: string, amount: number, description: string) {
  if (!AI_USAGE_COSTS.hasOwnProperty(type)) {
    console.log(`[USAGE] Type '${type}' is not a supported non-messaging usage type. Skipping.`);
    return;
  }
  if (subAccountId == null) {
    return;
  }
  try {
    const account = await storage.getSubAccount(subAccountId);
    if (!account) {
      return;
    }
  } catch (err) {
    console.warn("[HELPERS] caught:", err instanceof Error ? err.message : err);
    return;
  }
  const rate = AI_USAGE_COSTS[type];
  const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT" || type === "AI_STREAM") ? rate : amount * rate;
  try {
    await storage.createUsageLog({
      subAccountId,
      type,
      amount,
      cost,
      description: description || null,
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.log("[USAGE] Log failed:", errMsg);
  }
}

export async function requirePlanFeature(subAccountId: number, feature: string): Promise<{ allowed: boolean; plan: string }> {
  const account = await storage.getSubAccount(subAccountId);
  if (!account) return { allowed: false, plan: 'none' };
  const plan = (account as any).plan || 'starter';
  return { allowed: hasFeature(plan, feature), plan };
}

export const INDUSTRY_PROMPTS: Record<string, { tone: string; vocabulary: string[]; focus: string }> = {
  "personal-injury": {
    tone: "empathetic, authoritative, and compassionate",
    vocabulary: ["consultation", "case evaluation", "settlement", "negligence", "liability", "damages", "injury claim"],
    focus: "Build trust, emphasize free consultation, highlight track record of settlements"
  },
  "dental": {
    tone: "warm, reassuring, and professional",
    vocabulary: ["appointment", "treatment plan", "oral health", "dental care", "cleaning", "cosmetic dentistry"],
    focus: "Reduce dental anxiety, emphasize comfort, promote preventive care"
  },
  "medspa": {
    tone: "luxurious, confident, and welcoming",
    vocabulary: ["treatment", "rejuvenation", "aesthetic", "consultation", "results", "non-invasive", "enhancement"],
    focus: "Emphasize transformation results, safety, and premium experience"
  },
  "gym": {
    tone: "energetic, motivating, and supportive",
    vocabulary: ["membership", "fitness goals", "training", "classes", "transformation", "wellness"],
    focus: "Motivate action, emphasize community, promote trial offers"
  },
  "real-estate": {
    tone: "professional, knowledgeable, and trustworthy",
    vocabulary: ["property", "listing", "market analysis", "closing", "investment", "valuation"],
    focus: "Demonstrate market expertise, emphasize local knowledge, build confidence"
  },
  "roofing": {
    tone: "reliable, straightforward, and expert",
    vocabulary: ["inspection", "estimate", "repair", "replacement", "warranty", "storm damage"],
    focus: "Emphasize reliability, free inspections, insurance claim assistance"
  },
  "hvac": {
    tone: "helpful, dependable, and knowledgeable",
    vocabulary: ["maintenance", "repair", "installation", "energy efficiency", "comfort", "emergency service"],
    focus: "Highlight emergency availability, energy savings, seasonal tune-ups"
  },
  "plumbing": {
    tone: "responsive, honest, and skilled",
    vocabulary: ["repair", "emergency", "installation", "drain", "water heater", "leak detection"],
    focus: "Emphasize fast response times, upfront pricing, licensed technicians"
  },
};

export function getIndustryContext(industry: string | null | undefined): string {
  if (!industry) return "";
  const config = INDUSTRY_PROMPTS[industry.toLowerCase()];
  if (!config) return "";
  return `\n\nIndustry context: This is a ${industry} business. Use a ${config.tone} tone. Key terms to naturally incorporate: ${config.vocabulary.join(", ")}. Focus on: ${config.focus}.`;
}

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  it: "Italian (Italiano)",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  ar: "Arabic (العربية)",
  hi: "Hindi (हिन्दी)",
  ru: "Russian (Русский)",
};

export function getLanguageInstruction(language: string | null | undefined): string {
  if (!language || language === "en") return "";
  const langName = SUPPORTED_LANGUAGES[language] || language;
  return `\n\nIMPORTANT: Respond in ${langName}. All your responses must be in ${langName}, not English.`;
}

export async function getTwilioClient(subAccountId?: number) {
  const { getTwilioClientForAccount, getMasterTwilioClient } = await import("../twilioClientFactory");
  if (subAccountId) {
    const result = await getTwilioClientForAccount(subAccountId);
    return result?.client || null;
  }
  console.warn("[TWILIO-DEPRECATION] getTwilioClient() called without subAccountId — using master client. Migrate caller to pass subAccountId.");
  return getMasterTwilioClient();
}

export const vapiConfig = {
  get privateKey(): string | null {
    return process.env.VAPI_PRIVATE_KEY_APEX || process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi || null;
  },
  get publicKey(): string | null {
    return process.env.VAPI_PUBLIC_KEY || process.env.apex_public_vapi || null;
  },
  get orgId(): string | null {
    return process.env.VAPI_ORG_ID || null;
  },
  get phoneNumberId(): string | null {
    return process.env.VAPI_PHONE_NUMBER_ID || null;
  },
  get isConfigured(): boolean {
    return !!this.privateKey;
  },
  privateHeaders() {
    return {
      Authorization: `Bearer ${this.privateKey}`,
      "Content-Type": "application/json",
    };
  },
};
