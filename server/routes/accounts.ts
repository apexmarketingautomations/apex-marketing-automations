import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { insertSubAccountSchema, PLAN_TIERS, subAccounts, onboardingDefaults, onboardingDefaultsPayloadSchema } from "@shared/schema";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, isApexParentUser, isUserAdmin, SUPPORTED_LANGUAGES } from "./helpers";
import { emitUniversalEvent, EVENT_TYPES } from "../intelligence/eventEmitter";
import { onboardNewSubAccount, backfillExistingSubAccounts } from "../onboarding/onboardSubAccount";
import { getEffectiveOnboardingDefaults, getInCodeDefaults } from "../onboarding/defaults";

export function registerAccountRoutes(app: Express) {
  app.get("/api/accounts", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const activeAccounts = allAccounts.filter((a: any) => a.ownerUserId !== "_archived");
    const isParent = !isAdmin && await isApexParentUser(userId);
    const userAccounts = (isAdmin || isParent)
      ? activeAccounts
      : activeAccounts.filter((a: any) => a.ownerUserId === userId);
    res.json(userAccounts);
  }));

  app.post("/api/accounts", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const parsed = insertSubAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await storage.createSubAccount({
      ...parsed.data,
      ownerUserId: getUserId(user),
    });
    emitUniversalEvent({ eventType: EVENT_TYPES.ACCOUNT_CREATED, sourceModule: "accounts", subAccountId: account.id, metadata: { name: account.name, industry: account.industry, plan: account.plan } });
    try {
      await onboardNewSubAccount(account.id);
    } catch (err: any) {
      console.error(JSON.stringify({ event: "onboarding_failed", timestamp: new Date().toISOString(), sub_account_id: account.id, error: err?.message || String(err) }));
    }
    res.status(201).json(account);
  }));

  app.get("/api/plan-tiers", (_req, res) => {
    res.json(PLAN_TIERS);
  });

  let backfillRunning = false;
  app.post("/api/admin/onboarding/backfill", asyncHandler(async (req, res) => {
    const adminSecret = process.env.STANDALONE_ADMIN_SECRET?.trim();
    const headerVal = (req.headers["x-admin-secret"] as string | undefined)?.trim();
    let authorized = false;
    if (adminSecret && headerVal && headerVal === adminSecret) {
      authorized = true;
    } else {
      const user = (req as any).user;
      if (user) {
        const userId = getUserId(user);
        const adminUserId = process.env.ADMIN_USER_ID;
        if (adminUserId && userId === adminUserId) authorized = true;
        else if (await isUserAdmin(user)) authorized = true;
      }
    }
    if (!authorized) return res.status(403).json({ error: "Forbidden" });
    if (backfillRunning) {
      return res.status(409).json({ error: "Backfill already in progress" });
    }
    backfillRunning = true;
    try {
      const result = await backfillExistingSubAccounts();
      res.json(result);
    } finally {
      backfillRunning = false;
    }
  }));

  app.patch("/api/accounts/:id/plan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const userId = getUserId(user);
    const isAdmin = isUserAdmin(user);
    const isParent = !isAdmin && await isApexParentUser(userId);

    const allowedPlans: string[] = ['starter', 'pro', 'enterprise'];

    if (isAdmin || isParent) {
      allowedPlans.push('enterprise');
    } else if (account.ownerUserId === userId) {
      const ownerAccounts = await db.select().from(subAccounts).where(sql`${subAccounts.ownerUserId} = ${userId}`);
      const ownerPrimaryAccount = ownerAccounts.find(a => a.plan === 'enterprise' || a.plan === 'god_mode');
      if (ownerPrimaryAccount && id !== ownerPrimaryAccount.id) {
        allowedPlans.push('enterprise');
      }
    }

    const parsed = z.object({ plan: z.enum(allowedPlans as [string, ...string[]]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await db.update(subAccounts).set({ plan: parsed.data.plan }).where(sql`${subAccounts.id} = ${id}`).returning();
    if (updated[0]) {
      emitUniversalEvent({ eventType: "account_plan_changed", sourceModule: "accounts", sourceTable: "sub_accounts", sourceRecordId: String(id), subAccountId: id, metadata: { oldPlan: account.plan, newPlan: parsed.data.plan, changedBy: getUserId(user) } });
    }
    res.json(updated[0]);
  }));

  app.patch("/api/accounts/:id/language", asyncHandler(async (req, res) => {
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const parsed = z.object({ language: z.string().min(1).max(10) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { language } = parsed.data;
    if (!SUPPORTED_LANGUAGES[language]) {
      return res.status(400).json({ error: `Unsupported language: ${language}. Supported: ${Object.keys(SUPPORTED_LANGUAGES).join(", ")}` });
    }
    const updated = await storage.updateSubAccount(id, { language });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json(updated);
  }));

  app.get("/api/languages", (_req, res) => {
    res.json(SUPPORTED_LANGUAGES);
  });

  const dmConfigLinkSchema = z.object({
    label: z.string().min(1).max(200),
    url: z.string().url().max(2000),
  });

  const dmAgentConfigSchema = z.object({
    formLinks: z.array(dmConfigLinkSchema).max(20).optional(),
    offerUrls: z.array(dmConfigLinkSchema).max(20).optional(),
    servicePageUrls: z.array(dmConfigLinkSchema).max(20).optional(),
    brandVoice: z.string().max(2000).optional(),
    escalationInfo: z.string().max(2000).optional(),
    bookingLink: z.string().max(2000).optional(),
  });

  app.get("/api/accounts/:id/dm-config", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const aiPromptConfig = (account.aiPromptConfig as any) || {};
    res.json({
      formLinks: aiPromptConfig.formLinks || [],
      offerUrls: aiPromptConfig.offerUrls || [],
      servicePageUrls: aiPromptConfig.servicePageUrls || [],
      brandVoice: aiPromptConfig.brandVoice || "",
      escalationInfo: aiPromptConfig.escalationInfo || "",
      bookingLink: aiPromptConfig.bookingLink || "",
    });
  }));

  app.put("/api/accounts/:id/dm-config", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    if (!(await verifyAccountOwnership(req, res, id))) return;
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const parsed = dmAgentConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const existingConfig = (account.aiPromptConfig as any) || {};
    const updatedConfig = {
      ...existingConfig,
      formLinks: parsed.data.formLinks || [],
      offerUrls: parsed.data.offerUrls || [],
      servicePageUrls: parsed.data.servicePageUrls || [],
      brandVoice: parsed.data.brandVoice || "",
      escalationInfo: parsed.data.escalationInfo || "",
      bookingLink: parsed.data.bookingLink || "",
    };

    const updated = await storage.updateSubAccount(id, { aiPromptConfig: updatedConfig });
    if (!updated) return res.status(404).json({ error: "Account not found" });
    emitUniversalEvent({ eventType: "dm_config_updated", sourceModule: "accounts", sourceTable: "sub_accounts", sourceRecordId: String(id), subAccountId: id, metadata: { updatedFields: Object.keys(parsed.data), hasBrandVoice: !!updatedConfig.brandVoice, hasBookingLink: !!updatedConfig.bookingLink } });
    res.json({
      formLinks: updatedConfig.formLinks,
      offerUrls: updatedConfig.offerUrls,
      servicePageUrls: updatedConfig.servicePageUrls,
      brandVoice: updatedConfig.brandVoice,
      escalationInfo: updatedConfig.escalationInfo,
      bookingLink: updatedConfig.bookingLink,
    });
  }));

  // Admin-only: edit the default templates seeded into newly created sub-accounts.
  // Accepts either the canonical ADMIN_USER_ID env match or the user.isAdmin DB flag,
  // which matches the client-side admin check used elsewhere in the app.
  function isOnboardingDefaultsAdmin(user: unknown): boolean {
    if (!user || typeof user !== "object") return false;
    if (isUserAdmin(user)) return true;
    const u = user as { isAdmin?: unknown; role?: unknown };
    if (u.isAdmin === "true" || u.isAdmin === true) return true;
    if (u.role === "DEV_ADMIN") return true;
    return false;
  }

  app.get("/api/admin/onboarding-defaults", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isOnboardingDefaultsAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const effective = await getEffectiveOnboardingDefaults();
    const inCode = getInCodeDefaults();
    const [row] = await db
      .select()
      .from(onboardingDefaults)
      .where(sql`${onboardingDefaults.id} = 1`);
    res.json({
      effective: {
        pipelineStages: effective.pipelineStages,
        workflows: effective.workflows.map((w) => ({
          name: w.name,
          trigger: w.trigger,
          enabled: w.enabled,
          smsBody: w.steps?.[0]?.params?.body ?? "",
        })),
        brandVoiceSystemPrompt: effective.brandVoiceSystemPrompt,
        welcomeSmsBody: effective.welcomeSmsBody,
      },
      inCodeDefaults: {
        pipelineStages: inCode.pipelineStages,
        workflows: inCode.workflows.map((w) => ({
          name: w.name,
          trigger: w.trigger,
          enabled: w.enabled,
          smsBody: w.steps?.[0]?.params?.body ?? "",
        })),
        brandVoiceSystemPrompt: inCode.brandVoiceSystemPrompt,
        welcomeSmsBody: inCode.welcomeSmsBody,
      },
      hasOverride: !!row,
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
    });
  }));

  app.put("/api/admin/onboarding-defaults", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isOnboardingDefaultsAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    const parsed = onboardingDefaultsPayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const userId = getUserId(user);
    await db
      .insert(onboardingDefaults)
      .values({
        id: 1,
        pipelineStages: parsed.data.pipelineStages,
        workflows: parsed.data.workflows,
        brandVoiceSystemPrompt: parsed.data.brandVoiceSystemPrompt,
        welcomeSmsBody: parsed.data.welcomeSmsBody,
        updatedAt: new Date(),
        updatedByUserId: userId,
      })
      .onConflictDoUpdate({
        target: onboardingDefaults.id,
        set: {
          pipelineStages: parsed.data.pipelineStages,
          workflows: parsed.data.workflows,
          brandVoiceSystemPrompt: parsed.data.brandVoiceSystemPrompt,
          welcomeSmsBody: parsed.data.welcomeSmsBody,
          updatedAt: new Date(),
          updatedByUserId: userId,
        },
      });
    res.json({ ok: true });
  }));

  app.delete("/api/admin/onboarding-defaults", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!isOnboardingDefaultsAdmin(user)) return res.status(403).json({ error: "Admin access required" });
    await db.delete(onboardingDefaults).where(sql`${onboardingDefaults.id} = 1`);
    res.json({ ok: true });
  }));
}
