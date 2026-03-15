import type { Express, Request, Response } from "express";
import { notifications } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";
import { asyncHandler, verifyAccountOwnership } from "./helpers";

export function registerNotificationsRoutes(app: Express) {
  // ---- Notifications ----

  app.get("/api/notifications/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const notifs = await storage.getNotifications(Number(req.params.subAccountId));
    res.json(notifs);
  }));

  app.get("/api/notifications/:subAccountId/unread-count", asyncHandler(async (req: Request, res: Response) => {
    const count = await storage.getUnreadNotificationCount(Number(req.params.subAccountId));
    res.json({ count });
  }));

  app.post("/api/notifications/:id/read", asyncHandler(async (req: Request, res: Response) => {
    const notif = await storage.markNotificationRead(Number(req.params.id));
    if (!notif) return res.status(404).json({ error: "Notification not found" });
    res.json(notif);
  }));

  app.post("/api/notifications/:subAccountId/read-all", asyncHandler(async (req: Request, res: Response) => {
    await storage.markAllNotificationsRead(Number(req.params.subAccountId));
    res.json({ success: true });
  }));

  // ---- Push Subscriptions ----

  app.post("/api/push-subscriptions", asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId, endpoint, p256dh, auth } = req.body;
    if (!subAccountId || !endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const sub = await storage.createPushSubscription({ subAccountId, endpoint, p256dh, auth });
    res.json(sub);
  }));

  app.delete("/api/push-subscriptions", asyncHandler(async (req: Request, res: Response) => {
    const { subAccountId, endpoint } = req.body;
    if (!subAccountId || !endpoint) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const deleted = await storage.deletePushSubscription(endpoint, subAccountId);
    res.json({ success: deleted });
  }));

  app.get("/api/push-config", asyncHandler(async (_req: Request, res: Response) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    res.json({ publicKey });
  }));

  // ---- Notification Preferences ----

  app.get("/api/notification-preferences/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const prefs = await storage.getNotificationPreferences(subAccountId);
    if (!prefs) {
      return res.json({
        subAccountId,
        newLeadPush: true, newLeadSms: false,
        missedCallPush: true, missedCallSms: true,
        paymentFailedPush: true, paymentFailedSms: true,
        incidentPush: true, incidentSms: true,
        nudgeHighPush: true, nudgeHighSms: false,
        agentUrgentPush: true, agentUrgentSms: true,
        campaignAlertPush: true, campaignAlertSms: false,
        systemAlertPush: true, systemAlertSms: false,
        smsAlertPhone: null,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      });
    }
    res.json(prefs);
  }));

  const notificationPrefsSchema = z.object({
    newLeadPush: z.boolean().optional(),
    newLeadSms: z.boolean().optional(),
    missedCallPush: z.boolean().optional(),
    missedCallSms: z.boolean().optional(),
    paymentFailedPush: z.boolean().optional(),
    paymentFailedSms: z.boolean().optional(),
    incidentPush: z.boolean().optional(),
    incidentSms: z.boolean().optional(),
    nudgeHighPush: z.boolean().optional(),
    nudgeHighSms: z.boolean().optional(),
    agentUrgentPush: z.boolean().optional(),
    agentUrgentSms: z.boolean().optional(),
    campaignAlertPush: z.boolean().optional(),
    campaignAlertSms: z.boolean().optional(),
    systemAlertPush: z.boolean().optional(),
    systemAlertSms: z.boolean().optional(),
    smsAlertPhone: z.string().nullable().optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  });

  app.put("/api/notification-preferences/:subAccountId", asyncHandler(async (req: Request, res: Response) => {
    const subAccountId = Number(req.params.subAccountId);
    if (!(await verifyAccountOwnership(req, res, subAccountId))) return;
    const parsed = notificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid preference data", details: parsed.error.flatten() });
    }
    const prefs = await storage.upsertNotificationPreferences({ ...parsed.data, subAccountId });
    res.json(prefs);
  }));
}
