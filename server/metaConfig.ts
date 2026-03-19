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

export function buildMetaUrl(pageId: string, appsecretProof: string): string {
  return `https://graph.facebook.com/v19.0/${pageId}/messages${appsecretProof ? `?appsecret_proof=${appsecretProof}` : ""}`;
}

export async function resolveSubAccountByPageId(pageId: string): Promise<number> {
  if (!pageId) throw new Error("[META-CONFIG] Missing pageId for routing");

  const allAccounts = await storage.getSubAccounts();
  const match = allAccounts.find(a => a.metaPageId === pageId);

  if (match) return match.id;

  throw new Error(`[META-CONFIG] No sub-account mapped to Facebook pageId=${pageId}. Register this page in a sub-account's Meta settings.`);
}

export async function validateMetaConfigForAccount(subAccountId: number): Promise<{ valid: boolean; pageName?: string; error?: string }> {
  try {
    const config = await getMetaConfig(subAccountId);
    const res = await fetch(`https://graph.facebook.com/v19.0/${config.pageId}?fields=id,name&access_token=${config.accessToken}${config.appsecretProof ? `&appsecret_proof=${config.appsecretProof}` : ""}`);
    const data = await res.json() as any;
    if (data.name) {
      return { valid: true, pageName: data.name };
    }
    return { valid: false, error: data.error?.message || "Could not validate page" };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
