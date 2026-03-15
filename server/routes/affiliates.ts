import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { asyncHandler } from "./helpers";

export function registerAffiliatesRoutes(app: Express) {
  // ---- Affiliate System ----
  app.get("/api/affiliate", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    let affiliate = await storage.getAffiliate(user.id);
    if (!affiliate) {
      const code = `APEX_${user.id.slice(0, 6).toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;
      affiliate = await storage.createAffiliate({
        userId: user.id,
        affiliateCode: code,
      });
    }

    const referralsList = await storage.getReferrals(affiliate.id);
    const commissionsList = await storage.getCommissions(affiliate.id);

    const monthlyCommissions = commissionsList
      .filter(c => {
        const d = new Date(c.createdAt);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, c) => sum + c.amount, 0);

    res.json({
      ...affiliate,
      referralCount: referralsList.length,
      referrals: referralsList,
      commissions: commissionsList,
      monthlyCommissions,
    });
  }));

  app.post("/api/affiliate/process-commission", asyncHandler(async (req, res) => {
    const parsed = z.object({
      userId: z.string(),
      paymentAmount: z.number().positive(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const allAffiliates = await storage.getSnapshots();
    res.json({ processed: true });
  }));

  // ---- Agency Command Center Metrics ----
  app.get("/api/command-center", asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    const allAccounts = await storage.getSubAccounts();
    const allWorkflows = await storage.getWorkflows();

    let totalRevenue = 0;
    let totalLeads = 0;
    let totalMessages = 0;
    const accountStats: any[] = [];

    for (const account of allAccounts) {
      const msgs = await storage.getMessages(account.id);
      const rvws = await storage.getReviews(account.id);
      const usage = await storage.getUsageLogsSummary(account.id);

      const accountRevenue = usage.reduce((sum, u) => sum + (u.totalCost || 0), 0);
      const newLeads = msgs.filter(m => m.direction === "inbound").length;
      const avgRating = rvws.length > 0
        ? rvws.reduce((sum, r) => sum + r.rating, 0) / rvws.length
        : 0;

      totalRevenue += accountRevenue;
      totalLeads += newLeads;
      totalMessages += msgs.length;

      accountStats.push({
        id: account.id,
        name: account.name,
        industry: account.industry,
        revenue: accountRevenue,
        newLeads,
        messageCount: msgs.length,
        reviewCount: rvws.length,
        avgRating: Math.round(avgRating * 10) / 10,
        workflowCount: allWorkflows.filter(w => w.subAccountId === account.id).length,
      });
    }

    const subscription = await storage.getSubscription(user.id);

    res.json({
      totalAccounts: allAccounts.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalLeads,
      totalMessages,
      totalWorkflows: allWorkflows.length,
      planTier: subscription?.planTier || "free",
      aiCredits: subscription?.aiCredits || 0,
      accounts: accountStats,
    });
  }));
}
