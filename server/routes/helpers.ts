import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { hasFeature } from "@shared/schema";

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err?.type === 'StripeAuthenticationError' || err?.statusCode === 401 || err?.code === 'authentication_error') {
        import("../stripeClient").then(({ handleStripeError }) => handleStripeError(err)).catch(() => {});
      }
      next(err);
    });
  };
}

export function parseIntParam(value: string | string[] | undefined, name: string): number {
  const str = Array.isArray(value) ? value[0] : value;
  const parsed = parseInt(str || "", 10);
  if (isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`Invalid ${name}`), { status: 400 });
  }
  return parsed;
}

export function getUserId(user: any): string {
  return user.claims?.sub || user.id;
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
  if (account.ownerUserId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return false;
  }
  return true;
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

export async function logUsageInternal(subAccountId: number | null, type: string, amount: number, description: string) {
  const MARKUP_RATES_INT: Record<string, number> = {
    SMS_SEGMENT: 2.0, VOICE_MINUTE: 1.5, AI_IMAGE_GEN: 0.25, AI_CHAT: 0.03, AI_STREAM: 0.03, DOMAIN_PURCHASE: 0,
  };
  const rate = MARKUP_RATES_INT[type] ?? 0;
  const cost = (type === "AI_IMAGE_GEN" || type === "AI_CHAT" || type === "AI_STREAM") ? rate : amount * rate;
  try {
    await storage.createUsageLog({
      subAccountId: subAccountId ?? 1,
      type,
      amount,
      cost,
      description: description || null,
    });
  } catch (e) {
    console.log("[USAGE] Log failed:", (e as any).message);
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

export function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const Twilio = require("twilio");
  return Twilio(sid, token);
}

export const vapiConfig = {
  get privateKey(): string | null {
    return process.env.VAPI_PRIVATE_KEY || process.env.apex_private_vapi || null;
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
