import type { Express, Request, Response } from "express";
import { metaAdCampaigns, metaLeads } from "@shared/schema";
import { storage } from "../storage";
import dns from "dns";
import { asyncHandler, verifyAccountOwnership } from "./helpers";

export function registerDashboardRoutes(app: Express) {
  // ---- Dashboard Metrics ----

  app.get("/api/dashboard/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const [msgs, contactsList, dealsList, appointmentsList, campaigns, metaCampaignsList, metaLeadsList, igConvs, unreadNotifs] = await Promise.all([
      storage.getMessages(subAccountId),
      storage.getContacts(subAccountId),
      storage.getDeals(subAccountId),
      storage.getAppointments(subAccountId),
      storage.getEmailCampaigns(subAccountId),
      storage.getMetaAdCampaigns(subAccountId),
      storage.getMetaLeads(subAccountId),
      storage.getInstagramConversations(subAccountId),
      storage.getUnreadNotificationCount(subAccountId),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMsgs = msgs.filter(m => new Date(m.createdAt) >= today);
    const totalDealValue = dealsList.reduce((s, d) => s + (d.value || 0), 0);
    const upcomingAppts = appointmentsList.filter(a => new Date(a.startTime) > new Date());
    const totalAdSpend = metaCampaignsList.reduce((s, c) => s + (c.totalSpend || 0), 0);
    const totalAdLeads = metaCampaignsList.reduce((s, c) => s + (c.leads || 0), 0);
    const unreadIgMsgs = igConvs.reduce((s, c) => s + (c.unreadCount || 0), 0);

    res.json({
      totalMessages: msgs.length,
      todayMessages: todayMsgs.length,
      totalContacts: contactsList.length,
      totalDeals: dealsList.length,
      totalDealValue,
      upcomingAppointments: upcomingAppts.length,
      totalCampaigns: campaigns.length,
      metaAdCampaigns: metaCampaignsList.length,
      metaLeads: metaLeadsList.length,
      totalAdSpend,
      totalAdLeads,
      igConversations: igConvs.length,
      unreadIgMessages: unreadIgMsgs,
      unreadNotifications: unreadNotifs,
      recentMessages: todayMsgs.slice(0, 5),
      recentLeads: metaLeadsList.slice(0, 5),
    });
  }));

  // ---- Sitemap ----

  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const base = `${req.protocol}://${req.get("host")}`;
    const pages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/demo", priority: "0.9", changefreq: "weekly" },
      { loc: "/pricing", priority: "0.8", changefreq: "weekly" },
      { loc: "/gym", priority: "0.7", changefreq: "monthly" },
      { loc: "/luxe", priority: "0.7", changefreq: "monthly" },
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${pages.map(p => `  <url>
    <loc>${base}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
  </urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.send(xml);
  });

  // ---- Email Validation Helper ----

  app.post("/api/validate-email", asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.json({ valid: false, reason: "No email provided" });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.json({ valid: false, reason: "Invalid format" });

    const domain = email.split("@")[1];
    try {
      const mxRecords = await new Promise<dns.MxRecord[]>((resolve, reject) => {
        dns.resolveMx(domain, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
      res.json({ valid: mxRecords.length > 0, reason: mxRecords.length > 0 ? "Valid MX records" : "No MX records" });
    } catch (err) {
      console.warn("[DASHBOARD] caught:", err instanceof Error ? err.message : err);
      res.json({ valid: false, reason: "Domain DNS lookup failed" });
    }
  }));

  // ---- Tracking Config ----

  app.get("/api/tracking-config", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      gaId: process.env.GA_MEASUREMENT_ID || "",
      metaPixelId: process.env.META_PIXEL_ID || "",
    });
  }));
}
