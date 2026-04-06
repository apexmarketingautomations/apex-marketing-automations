import { storage } from "./storage";
import crypto from "crypto";

export interface MetaConfig {
  pageId: string;
  accessToken: string;
  appSecret: string | null;
  appsecretProof: string;
}

export async function getMetaConfig(subAccountId: number): Promise<MetaConfig> {
  if (!subAccountId) throw new Error("[META-CONFIG] Missing subAccountId");

  const account = await storage.getSubAccount(subAccountId);
  if (!account) throw new Error(`[META-CONFIG] Sub-account ${subAccountId} not found`);

  const pageId = account.metaPageId;
  const accessToken = account.metaAccessToken;

  if (!pageId || !accessToken) {
    throw new Error(`[META-CONFIG] Missing Meta credentials for sub-account ${subAccountId} (${account.name}). Configure metaPageId and metaAccessToken.`);
  }

  const appSecret = account.metaAppSecret || null;
  let appsecretProof = "";
  if (appSecret) {
    appsecretProof = crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
  }

  return { pageId, accessToken, appSecret, appsecretProof };
}

export function buildMetaUrl(pageId: string, appsecretProof: string, channel?: string): string {
  const endpoint = channel === "instagram" ? "me" : pageId;
  return `https://graph.facebook.com/v21.0/${endpoint}/messages${appsecretProof ? `?appsecret_proof=${appsecretProof}` : ""}`;
}

export async function resolveSubAccountByPageId(pageId: string): Promise<number> {
  if (!pageId) throw new Error("[META-CONFIG] Missing pageId for routing");

  const allAccounts = await storage.getSubAccounts();
  const match = allAccounts.find(a => a.metaPageId === pageId);

  if (match) {
    console.log(`[META-CONFIG] Resolved pageId=${pageId} -> subAccountId=${match.id} (name="${match.name}") via subAccounts table`);
    return match.id;
  }

  const igMatch = allAccounts.find(a => (a as any).metaInstagramAccountId === pageId);
  if (igMatch) {
    console.log(`[META-CONFIG] Resolved igAccountId=${pageId} -> subAccountId=${igMatch.id} (name="${igMatch.name}") via metaInstagramAccountId`);
    return igMatch.id;
  }

  try {
    const { db } = await import("./db");
    const { socialAccounts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const igMatch = await db.select({ subAccountId: socialAccounts.subAccountId })
      .from(socialAccounts)
      .where(eq(socialAccounts.platformAccountId, pageId))
      .limit(1);
    if (igMatch.length > 0) {
      console.log(`[META-CONFIG] Resolved pageId=${pageId} -> subAccountId=${igMatch[0].subAccountId} via socialAccounts table`);
      return igMatch[0].subAccountId;
    }
  } catch (socialErr: any) {
    console.warn(`[META-CONFIG] socialAccounts lookup failed for pageId=${pageId}: ${socialErr.message}`);
  }

  console.warn(`[META-CONFIG] No sub-account matched pageId=${pageId}. Checked ${allAccounts.length} accounts in subAccounts table.`);
  throw new Error(`[META-CONFIG] No sub-account mapped to Facebook pageId=${pageId}. Register this page in a sub-account's Meta settings.`);
}

export async function validateMetaConfigForAccount(subAccountId: number): Promise<{ valid: boolean; pageName?: string; error?: string }> {
  try {
    const config = await getMetaConfig(subAccountId);
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.pageId}?fields=id,name&access_token=${config.accessToken}${config.appsecretProof ? `&appsecret_proof=${config.appsecretProof}` : ""}`);
    const data = await res.json() as any;
    if (data.name) {
      return { valid: true, pageName: data.name };
    }
    return { valid: false, error: data.error?.message || "Could not validate page" };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
