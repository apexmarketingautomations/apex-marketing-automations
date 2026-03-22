import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { insertSubAccountSchema, PLAN_TIERS, subAccounts } from "@shared/schema";
import { asyncHandler, parseIntParam, getUserId, verifyAccountOwnership, SUPPORTED_LANGUAGES } from "./helpers";

export function registerAccountRoutes(app: Express) {
  app.get("/api/accounts", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    const allAccounts = await storage.getSubAccounts();
    const activeAccounts = allAccounts.filter((a: any) => a.ownerUserId !== "_archived");
    const userAccounts = isAdmin
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
    res.status(201).json(account);
  }));

  app.get("/api/plan-tiers", (_req, res) => {
    res.json(PLAN_TIERS);
  });

  app.patch("/api/accounts/:id/plan", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const id = parseIntParam(req.params.id, "id");
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    if (!isAdmin && account.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to change this account's plan" });
    }
    const parsed = z.object({ plan: z.enum(['starter', 'pro', 'enterprise']) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await db.update(subAccounts).set({ plan: parsed.data.plan }).where(sql`${subAccounts.id} = ${id}`).returning();
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
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    if (!isAdmin && account.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized" });
    }
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
    const account = await storage.getSubAccount(id);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const userId = getUserId(user);
    const adminUserId = process.env.ADMIN_USER_ID;
    const isAdmin = adminUserId && userId === adminUserId;
    if (!isAdmin && account.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized" });
    }
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
    res.json({
      formLinks: updatedConfig.formLinks,
      offerUrls: updatedConfig.offerUrls,
      servicePageUrls: updatedConfig.servicePageUrls,
      brandVoice: updatedConfig.brandVoice,
      escalationInfo: updatedConfig.escalationInfo,
      bookingLink: updatedConfig.bookingLink,
    });
  }));
}
