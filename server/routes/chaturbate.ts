// @ts-nocheck
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { subAccounts, contacts, cbSessions, cbCommandsFired } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { addSSEClient, broadcastToAccount } from "../sse";
import { createFreshSession, buildRoomContext, type SessionState } from "../services/roomOS/contextBuilder";
import { getRoomCoachingSuggestion } from "../services/roomOS/aiCoach";
import { publishEvent } from "../eventBus";
import crypto from "crypto";

const activeSessions: Map<number, SessionState> = new Map();

function getGlobalSecret(): string {
  return process.env.ROOMOS_WEBHOOK_SECRET || "";
}

function generateWebhookToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function registerChaturbateRoutes(app: Express) {
  app.options("/api/chaturbate/webhook", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-roomos-token");
    res.sendStatus(204);
  });

  app.post("/api/chaturbate/webhook", async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-roomos-token");
    try {
      const raw = req.body;
      const event = raw.event || raw.type;
      const username = raw.username || raw.cbUsername;
      const data = raw.data || {};
      const user = raw.user || data.username;
      const amount = raw.amount || data.tokens;
      const viewers = raw.viewers || data.viewers;
      if (!event || !username) {
        console.log("[ROOMOS] Webhook rejected: missing event or username", { event, username });
        return res.sendStatus(400);
      }

      const headerToken = req.headers["x-roomos-token"] as string;
      if (!headerToken) {
        console.log("[ROOMOS] Webhook rejected: no x-roomos-token header");
        return res.sendStatus(401);
      }

      const globalSecret = getGlobalSecret();

      let [account] = await db.select().from(subAccounts)
        .where(eq(subAccounts.cbUsername, username));

      if (!account) {
        if (!globalSecret || headerToken !== globalSecret) {
          return res.sendStatus(403);
        }
        const token = generateWebhookToken();
        const [newAccount] = await db.insert(subAccounts).values({
          name: `${username} (RoomOS)`,
          twilioNumber: "none",
          cbUsername: username,
          cbGoalTokens: 500,
          cbProMode: false,
          cbWebhookToken: token,
          plan: "starter",
        }).returning();
        account = newAccount;
        console.log(`[ROOMOS] Auto-provisioned account ${account.id}`);
      }

      const accountToken = account.cbWebhookToken;
      if (headerToken !== globalSecret && headerToken !== accountToken) {
        console.log("[ROOMOS] Webhook rejected: token mismatch for", username);
        return res.sendStatus(403);
      }

      console.log("[ROOMOS] Webhook OK:", event, username);
      res.sendStatus(200);

      const subAccountId = account.id;
      const goalTokens = account.cbGoalTokens || 500;

      if (event === "broadcast_start") {
        const overrideGoal = data.goalTokens ? parseInt(data.goalTokens) : null;
        const effectiveGoal = overrideGoal || goalTokens;
        const session = createFreshSession(subAccountId, effectiveGoal);
        activeSessions.set(subAccountId, session);
        broadcastToAccount(subAccountId, "roomos:broadcast_start", { session });
        publishEvent("cb.session.started", { subAccountId, username }, "roomos");
        console.log(`[ROOMOS] Broadcast started for ${username} (account ${subAccountId})`);
        return;
      }

      if (event === "broadcast_end") {
        const session = activeSessions.get(subAccountId);
        if (session) {
          const topCommand = Object.entries(session.commandCounts)
            .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

          await db.insert(cbSessions).values({
            subAccountId,
            totalTokens: session.totalTokens,
            goalCount: session.goalCount,
            tipCount: session.tipCount,
            topTipper: session.topTipper,
            topTipAmount: session.topTipAmount,
            durationMs: Date.now() - session.startedAt,
            peakViewers: session.peakViewers,
            commandsFired: session.commandsFired,
            topCommand,
          });
          activeSessions.delete(subAccountId);
          broadcastToAccount(subAccountId, "roomos:broadcast_end", {
            totalTokens: session.totalTokens,
            tipCount: session.tipCount,
            durationMs: Date.now() - session.startedAt,
          });
          publishEvent("cb.session.ended", {
            subAccountId, username,
            totalTokens: session.totalTokens,
            tipCount: session.tipCount,
          }, "roomos");
        }
        console.log(`[ROOMOS] Broadcast ended for ${username}`);
        return;
      }

      if (event === "tip" && user && amount) {
        let session = activeSessions.get(subAccountId);
        if (!session) {
          session = createFreshSession(subAccountId, goalTokens);
          activeSessions.set(subAccountId, session);
        }

        const tipAmount = parseInt(amount) || 0;
        session.totalTokens += tipAmount;
        session.tipCount++;
        session.lastTipAt = Date.now();
        session.lastTipAmount = tipAmount;
        session.lastTipUser = user;
        session.tips.push({ user, amount: tipAmount, at: Date.now() });

        if (tipAmount > session.topTipAmount) {
          session.topTipAmount = tipAmount;
          session.topTipper = user;
        }

        const prevGoals = session.goalCount;
        session.goalCount = Math.floor(session.totalTokens / goalTokens);
        const goalJustHit = session.goalCount > prevGoals;

        const existing = await db.select({ id: contacts.id }).from(contacts)
          .where(and(
            eq(contacts.subAccountId, subAccountId),
            eq(contacts.source, "chaturbate"),
            eq(contacts.firstName, user),
          )).limit(1);

        if (existing.length === 0) {
          await db.insert(contacts).values({
            subAccountId,
            firstName: user,
            source: "chaturbate",
            channel: "chaturbate",
            notes: `CB tipper — lifetime: ${tipAmount} tokens`,
          });
        } else {
          const tipNote = `CB tipper — last tip: ${tipAmount} tokens at ${new Date().toISOString()}`;
          await db.update(contacts).set({
            notes: tipNote,
          }).where(eq(contacts.id, existing[0].id));
        }

        broadcastToAccount(subAccountId, "roomos:tip", {
          user, amount: tipAmount,
          totalTokens: session.totalTokens,
          goalProgress: goalTokens > 0 ? Math.round((session.totalTokens / goalTokens) * 100) : 0,
          topTipper: session.topTipper,
          topTipAmount: session.topTipAmount,
          tipCount: session.tipCount,
          goalCount: session.goalCount,
        });

        publishEvent("cb.tip.received", {
          subAccountId, username, tipperUsername: user, amount: tipAmount,
        }, "roomos");

        if (goalJustHit) {
          broadcastToAccount(subAccountId, "roomos:goal_complete", {
            goalNumber: session.goalCount,
            totalTokens: session.totalTokens,
          });
          publishEvent("cb.goal.completed", {
            subAccountId, username, goalNumber: session.goalCount,
            totalTokens: session.totalTokens,
          }, "roomos");
        }

        const context = buildRoomContext(session, { type: "tip", user, amount: tipAmount }, goalTokens);
        const suggestion = await getRoomCoachingSuggestion(context, account);
        if (suggestion) {
          broadcastToAccount(subAccountId, "roomos:suggestion", { text: suggestion });
        }
        return;
      }

      if (event === "enter" && user) {
        if (viewers) {
          const session = activeSessions.get(subAccountId);
          if (session) {
            const v = parseInt(viewers) || 0;
            if (v > session.peakViewers) session.peakViewers = v;
          }
        }

        const [contact] = await db.select().from(contacts)
          .where(and(
            eq(contacts.subAccountId, subAccountId),
            eq(contacts.source, "chaturbate"),
            eq(contacts.firstName, user),
          )).limit(1);

        if (contact) {
          broadcastToAccount(subAccountId, "roomos:whale_alert", {
            user,
            notes: contact.notes,
          });
          publishEvent("cb.whale.entered", {
            subAccountId, username, whaleUsername: user,
          }, "roomos");
        }

        const session = activeSessions.get(subAccountId);
        if (session) {
          const context = buildRoomContext(session, { type: "enter", user }, goalTokens);
          if (context.roomEnergy !== "hot") {
            const suggestion = await getRoomCoachingSuggestion(context, account);
            if (suggestion) {
              broadcastToAccount(subAccountId, "roomos:suggestion", { text: suggestion });
            }
          }
        }
        return;
      }
    } catch (err: any) {
      console.error("[ROOMOS] Webhook processing error:", err.message);
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  app.get("/api/chaturbate/stream", (req: Request, res: Response) => {
    const subAccountId = parseInt(req.query.subAccountId as string);
    if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

    addSSEClient(req, res, subAccountId);

    const session = activeSessions.get(subAccountId);
    if (session) {
      const payload = {
        type: "roomos:session_state",
        totalTokens: session.totalTokens,
        goalTokens: session.goalTokens,
        goalProgress: session.goalTokens > 0 ? Math.round((session.totalTokens / session.goalTokens) * 100) : 0,
        tipCount: session.tipCount,
        topTipper: session.topTipper,
        topTipAmount: session.topTipAmount,
        goalCount: session.goalCount,
        commandsFired: session.commandsFired,
        isLive: true,
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: "roomos:session_state", isLive: false })}\n\n`);
    }
  });

  app.get("/api/chaturbate/sessions/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = parseInt(req.params.subAccountId);
      if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

      const sessions = await db.select().from(cbSessions)
        .where(eq(cbSessions.subAccountId, subAccountId))
        .orderBy(desc(cbSessions.sessionDate))
        .limit(30);

      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/chaturbate/whales/:subAccountId", async (req: Request, res: Response) => {
    try {
      const subAccountId = parseInt(req.params.subAccountId);
      if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

      const whales = await db.select().from(contacts)
        .where(and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.source, "chaturbate"),
        ))
        .orderBy(desc(contacts.createdAt))
        .limit(20);

      res.json(whales);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/chaturbate/command", async (req: Request, res: Response) => {
    try {
      const { subAccountId, category, messageText } = req.body;
      if (!subAccountId || !category) {
        return res.status(400).json({ error: "subAccountId and category required" });
      }

      const session = activeSessions.get(subAccountId);
      const sessionId = null;

      if (session) {
        session.commandsFired++;
        session.commandCounts[category] = (session.commandCounts[category] || 0) + 1;
      }

      const [cmd] = await db.insert(cbCommandsFired).values({
        subAccountId,
        sessionId,
        category,
        messageText,
      }).returning();

      if (session) {
        setTimeout(async () => {
          try {
            const currentSession = activeSessions.get(subAccountId);
            const tokensNow = currentSession?.totalTokens || 0;
            const tipsInWindow = currentSession?.tips.filter(
              t => t.at > Date.now() - 60000
            ).length || 0;

            await db.update(cbCommandsFired).set({
              tokensAfter: tokensNow,
              wasEffective: tipsInWindow > 0,
            }).where(eq(cbCommandsFired.id, cmd.id));
          } catch (e: any) {
            console.error("[ROOMOS] Command effectiveness check failed:", e.message);
          }
        }, 60000);
      }

      res.json(cmd);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/chaturbate/token/:subAccountId", async (req: Request, res: Response) => {
    try {
      const headerToken = req.headers["x-roomos-token"] as string;
      if (!headerToken || headerToken !== getGlobalSecret()) {
        return res.status(403).json({ error: "Forbidden — admin token required" });
      }

      const subAccountId = parseInt(req.params.subAccountId);
      if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

      const [account] = await db.select({
        cbWebhookToken: subAccounts.cbWebhookToken,
        cbUsername: subAccounts.cbUsername,
      }).from(subAccounts).where(eq(subAccounts.id, subAccountId));

      if (!account) return res.status(404).json({ error: "Account not found" });

      if (!account.cbWebhookToken) {
        const token = generateWebhookToken();
        await db.update(subAccounts).set({ cbWebhookToken: token })
          .where(eq(subAccounts.id, subAccountId));
        return res.json({ cbWebhookToken: token, cbUsername: account.cbUsername });
      }

      res.json({ cbWebhookToken: account.cbWebhookToken, cbUsername: account.cbUsername });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/chaturbate/account/:subAccountId", async (req: Request, res: Response) => {
    try {
      const headerToken = req.headers["x-roomos-token"] as string;
      if (!headerToken || headerToken !== getGlobalSecret()) {
        return res.status(403).json({ error: "Forbidden — global admin token required" });
      }

      const subAccountId = parseInt(req.params.subAccountId);
      if (isNaN(subAccountId)) return res.status(400).json({ error: "Invalid subAccountId" });

      const [account] = await db.select({ id: subAccounts.id, name: subAccounts.name })
        .from(subAccounts).where(eq(subAccounts.id, subAccountId));
      if (!account) return res.status(404).json({ error: "Account not found" });

      const sessionsDeleted = await db.delete(cbSessions)
        .where(eq(cbSessions.subAccountId, subAccountId)).returning({ id: cbSessions.id });

      const commandsDeleted = await db.delete(cbCommandsFired)
        .where(eq(cbCommandsFired.subAccountId, subAccountId)).returning({ id: cbCommandsFired.id });

      const contactsDeleted = await db.delete(contacts)
        .where(and(
          eq(contacts.subAccountId, subAccountId),
          eq(contacts.source, "chaturbate"),
        )).returning({ id: contacts.id });

      await db.update(subAccounts).set({
        cbUsername: null,
        cbWebhookToken: null,
        cbProMode: null,
      }).where(eq(subAccounts.id, subAccountId));

      activeSessions.delete(subAccountId);

      const summary = {
        subAccountId,
        accountName: account.name,
        deleted: {
          sessions: sessionsDeleted.length,
          commands: commandsDeleted.length,
          contacts: contactsDeleted.length,
        },
        fieldsReset: ["cb_username", "cb_webhook_token", "cb_pro_mode"],
      };

      console.log(`[ROOMOS] Account ${subAccountId} wiped:`, JSON.stringify(summary));
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/roomos/claim-trial", async (req: Request, res: Response) => {
    try {
      const { cbUsername } = req.body;
      if (!cbUsername || typeof cbUsername !== "string" || cbUsername.trim().length < 2) {
        return res.status(400).json({ message: "Please enter a valid CB username." });
      }

      const username = cbUsername.trim().toLowerCase();

      const [existing] = await db.select().from(subAccounts)
        .where(eq(subAccounts.cbUsername, username));

      if (existing) {
        return res.json({
          accountId: existing.id,
          message: "Account already exists — welcome back!",
          dashboardUrl: `/roomos?account=${existing.id}`,
        });
      }

      const token = generateWebhookToken();
      const [newAccount] = await db.insert(subAccounts).values({
        name: `${username} (RoomOS trial)`,
        twilioNumber: "none",
        cbUsername: username,
        cbGoalTokens: 500,
        cbProMode: false,
        cbWebhookToken: token,
        plan: "starter",
      }).returning();

      console.log(`[ROOMOS] Trial claimed: account ${newAccount.id} for cb_username=${username}`);

      res.json({
        accountId: newAccount.id,
        message: "Trial activated! Your webhook token has been generated — copy it from your dashboard.",
        dashboardUrl: `/roomos?account=${newAccount.id}`,
        webhookToken: token,
      });
    } catch (err: any) {
      console.error("[ROOMOS] Trial claim error:", err.message);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
}
