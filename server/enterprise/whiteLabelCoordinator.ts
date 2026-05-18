/**
 * White-Label Coordinator — Phase 11
 *
 * Manages custom branding, domains, and agency reseller configuration.
 * Each enterprise or org node can have its own white-label config that
 * overrides the default Apex branding for their tenant.
 *
 * Features:
 *  - getWhiteLabelConfig()  — resolve config for a sub-account (walks hierarchy)
 *  - upsertWhiteLabelConfig() — create/update config
 *  - applyWhiteLabelHeaders()  — Express middleware to inject brand headers
 *  - validateCustomDomain() — check domain ownership via DNS TXT record
 */

import { db } from "../db";
import { enterpriseWhiteLabelConfigs } from "@shared/schema";
import { eq, or, isNull } from "drizzle-orm";
import type { EnterpriseWhiteLabelConfig } from "@shared/schema";
import { logEnterpriseAudit } from "./operationalAuditService";

export const DEFAULT_BRAND: Partial<EnterpriseWhiteLabelConfig> = {
  agencyName:       "Apex Marketing OS",
  brandColor:       "#00d4ff",
  senderName:       "Apex",
  supportEmail:     "support@apexmarketingos.com",
  footerText:       "Powered by Apex Marketing OS",
  hideApexBranding: false,
};

/** Resolve white-label config for a sub-account.
 *  Resolution order: subAccountId match → nodeId match → platform default. */
export async function getWhiteLabelConfig(
  subAccountId?: number,
  nodeId?:        number,
): Promise<Partial<EnterpriseWhiteLabelConfig>> {
  // Try sub-account specific first
  if (subAccountId) {
    const [row] = await db
      .select()
      .from(enterpriseWhiteLabelConfigs)
      .where(eq(enterpriseWhiteLabelConfigs.subAccountId, subAccountId))
      .limit(1);
    if (row) return { ...DEFAULT_BRAND, ...stripNulls(row) };
  }

  // Try node-level
  if (nodeId) {
    const [row] = await db
      .select()
      .from(enterpriseWhiteLabelConfigs)
      .where(eq(enterpriseWhiteLabelConfigs.nodeId, nodeId))
      .limit(1);
    if (row) return { ...DEFAULT_BRAND, ...stripNulls(row) };
  }

  return { ...DEFAULT_BRAND };
}

/** Create or update white-label config. */
export async function upsertWhiteLabelConfig(
  params: {
    subAccountId?: number;
    nodeId?:       number;
    agencyName?:   string;
    customDomain?: string;
    brandColor?:   string;
    logoUrl?:      string;
    faviconUrl?:   string;
    senderName?:   string;
    supportEmail?: string;
    footerText?:   string;
    hideApexBranding?: boolean;
    customCss?:    string;
    config?:       Record<string, unknown>;
  },
  actorUserId = "system",
): Promise<EnterpriseWhiteLabelConfig> {
  // Check for existing row to update
  let existing: EnterpriseWhiteLabelConfig | null = null;

  if (params.subAccountId) {
    const [row] = await db.select().from(enterpriseWhiteLabelConfigs)
      .where(eq(enterpriseWhiteLabelConfigs.subAccountId, params.subAccountId)).limit(1);
    existing = row || null;
  } else if (params.nodeId) {
    const [row] = await db.select().from(enterpriseWhiteLabelConfigs)
      .where(eq(enterpriseWhiteLabelConfigs.nodeId, params.nodeId)).limit(1);
    existing = row || null;
  }

  const values: any = {
    subAccountId:     params.subAccountId || null,
    nodeId:           params.nodeId       || null,
    agencyName:       params.agencyName   || null,
    customDomain:     params.customDomain || null,
    brandColor:       params.brandColor   || null,
    logoUrl:          params.logoUrl      || null,
    faviconUrl:       params.faviconUrl   || null,
    senderName:       params.senderName   || null,
    supportEmail:     params.supportEmail || null,
    footerText:       params.footerText   || null,
    hideApexBranding: params.hideApexBranding ?? false,
    customCss:        params.customCss    || null,
    config:           params.config       || null,
    updatedAt:        new Date(),
  };

  let result: EnterpriseWhiteLabelConfig;

  if (existing) {
    const [updated] = await db
      .update(enterpriseWhiteLabelConfigs)
      .set(values)
      .where(eq(enterpriseWhiteLabelConfigs.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(enterpriseWhiteLabelConfigs)
      .values(values)
      .returning();
    result = created;
  }

  await logEnterpriseAudit({
    eventType:    "white_label.config_updated",
    actor:        actorUserId,
    subAccountId: params.subAccountId,
    payload:      { agencyName: params.agencyName, customDomain: params.customDomain },
  }).catch(() => {}); // allow-silent-catch: fire-and-forget

  return result;
}

/** List all white-label configs (platform admin view). */
export async function listWhiteLabelConfigs(): Promise<EnterpriseWhiteLabelConfig[]> {
  return db.select().from(enterpriseWhiteLabelConfigs);
}

/** Express middleware: inject white-label response headers. */
export function applyWhiteLabelHeaders() {
  return async (req: any, res: any, next: any) => {
    try {
      const subAccountId = parseInt(req.query?.subAccountId || req.body?.subAccountId || "0");
      if (subAccountId > 0) {
        const config = await getWhiteLabelConfig(subAccountId);
        if (config.agencyName)  res.setHeader("X-Brand-Name",  config.agencyName);
        if (config.brandColor)  res.setHeader("X-Brand-Color", config.brandColor);
        if (config.customDomain) res.setHeader("X-Brand-Domain", config.customDomain);
      }
    } catch (err: any) { // allow-silent-catch: white-label header injection is non-fatal — never block a request for branding
      void err;
    }
    next();
  };
}

/** Validate custom domain ownership (DNS TXT check). */
export async function validateCustomDomain(
  domain: string,
  subAccountId: number,
): Promise<{ valid: boolean; message: string }> {
  const expectedTxt = `apex-verify=${subAccountId}`;

  try {
    const dns = await import("dns/promises");
    const records = await dns.resolveTxt(domain);
    const flat = records.flat();
    const found = flat.some(r => r === expectedTxt);

    return {
      valid:   found,
      message: found
        ? "Domain verified successfully"
        : `Add TXT record: "${expectedTxt}" to verify ownership`,
    };
  } catch (err: any) {
    return {
      valid:   false,
      message: `DNS lookup failed: ${err?.message}. Add TXT record: "${expectedTxt}"`,
    };
  }
}

function stripNulls(obj: any): Partial<EnterpriseWhiteLabelConfig> {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
