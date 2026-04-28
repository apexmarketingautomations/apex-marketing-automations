import type { Express, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { subAccounts, subscriptions } from "@shared/schema";

const SECRET_FROM_ENV = process.env.STUDIO_WEBHOOK_SECRET;

const LAUREN_USER_ID = "usr_OFebQ2zd2fT3VPtP";
const LAUREN_EMAIL = "baemarie0891@icloud.com";
const LAUREN_FIRST_NAME = "Lauren";
const LAUREN_PASSWORD = "BigMomma360";
const LAUREN_WORKSPACE_NAME = "Lauren's Workspace";

export function registerBootstrapLauren(app: Express): void {
  app.post(
    "/webhook/bootstrap-lauren",
    express.json({ limit: "16kb" }),
    async (req: Request, res: Response) => {
      try {
        if (!SECRET_FROM_ENV) {
          return res.status(503).json({ error: "secret not configured" });
        }
        const provided = req.header("x-webhook-secret") || "";
        const expectedBuf = Buffer.from(SECRET_FROM_ENV);
        const providedBuf = Buffer.from(provided);
        if (
          providedBuf.length !== expectedBuf.length ||
          !crypto.timingSafeEqual(providedBuf, expectedBuf)
        ) {
          return res
            .status(401)
            .json({ error: "invalid or missing x-webhook-secret" });
        }

        const passwordHash = await bcrypt.hash(LAUREN_PASSWORD, 12);

        await db
          .insert(users)
          .values({
            id: LAUREN_USER_ID,
            email: LAUREN_EMAIL,
            firstName: LAUREN_FIRST_NAME,
            passwordHash,
            authProvider: "email",
            isAdmin: "false",
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              email: LAUREN_EMAIL,
              firstName: LAUREN_FIRST_NAME,
              passwordHash,
              authProvider: "email",
              updatedAt: sql`now()`,
            },
          });

        const existingSub = await db
          .select({ id: subAccounts.id })
          .from(subAccounts)
          .where(eq(subAccounts.ownerUserId, LAUREN_USER_ID))
          .limit(1);

        let subAccountId: number;
        if (existingSub.length === 0) {
          const [created] = await db
            .insert(subAccounts)
            .values({
              name: LAUREN_WORKSPACE_NAME,
              twilioNumber: "PENDING_PROVISION",
              ownerUserId: LAUREN_USER_ID,
              plan: "enterprise",
              billingExempt: true,
              isInternal: false,
              isProtected: false,
              isDeletable: true,
              role: "owner",
              twilioStatus: "legacy",
              language: "en",
              vibeTheme: "cyber-glass",
            })
            .returning({ id: subAccounts.id });
          subAccountId = created.id;
        } else {
          subAccountId = existingSub[0].id;
          await db
            .update(subAccounts)
            .set({
              name: LAUREN_WORKSPACE_NAME,
              plan: "enterprise",
              billingExempt: true,
            })
            .where(eq(subAccounts.id, subAccountId));
        }

        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 6);

        const existingSubscription = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.userId, LAUREN_USER_ID))
          .limit(1);

        if (existingSubscription.length === 0) {
          await db.insert(subscriptions).values({
            userId: LAUREN_USER_ID,
            planTier: "enterprise",
            status: "active",
            currentPeriodEnd: periodEnd,
            aiCredits: 999999,
            isGrandfathered: true,
            billingInterval: "cash_6mo",
            paymentStatus: "paid_cash",
          });
        } else {
          await db
            .update(subscriptions)
            .set({
              planTier: "enterprise",
              status: "active",
              currentPeriodEnd: periodEnd,
              aiCredits: 999999,
              isGrandfathered: true,
              billingInterval: "cash_6mo",
              paymentStatus: "paid_cash",
              updatedAt: sql`now()`,
            })
            .where(eq(subscriptions.userId, LAUREN_USER_ID));
        }

        return res.json({
          ok: true,
          userId: LAUREN_USER_ID,
          subAccountId,
          plan: "enterprise",
          email: LAUREN_EMAIL,
        });
      } catch (err: any) {
        console.error("[BOOTSTRAP-LAUREN] error:", err?.message || err);
        return res
          .status(500)
          .json({ error: "internal error", message: err?.message });
      }
    }
  );
}
