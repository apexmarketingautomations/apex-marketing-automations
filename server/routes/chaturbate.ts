import type { Express, Request, Response } from "express";
import { db } from "../db";
import { subAccounts, contacts, cbSessions, cbCommandsFired } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { addSSEClient, broadcastToAccount } from "../sse";
import { createFreshSession, buildRoomContext, type SessionState } from "../services/roomOS/contextBuilder";
import { getRoomCoachingSuggestion } from "../services/roomOS/aiCoach";
import { publishEvent } from "../eventBus";

const activeSessions: Map<number, SessionState> = new Map();

function getSecret(): string {
  return process.env.ROOMOS_WEBHOOK_SECRET || "";
}

export function registerChaturbateRoutes(app: Express) {

  app.post("/api/chaturbate/webhook", async (req: Request, res: Response) => {
    res.sendStatus(200);

    try {
      const token = req.headers["x-roomos-token"] as string;
      if (!token || token !== getSecret()) {
        console.error("[ROOMOS] Invalid webhook token");
        return;
      }

      const { event, username, user, amount, viewers } = req.body;
      if (!event || !username) return;

      const [account] = await db.select().from(subAccounts)
        .where(eq(subAccounts.cbUsername, username));
      if (!account) {
        console.error(`[ROOMOS] No account found for cb_username=${username}`);
        return;
      }

      const subAccountId = account.id;
      const goalTokens = account.cbGoalTokens || 500;

      if (event === "broadcast_start") {
        const session = createFreshSession(subAccountId, goalTokens);
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
          await db.update(contacts).set({
            notes: sql`'CB tipper — last tip: ' || ${tipAmount} || ' tokens at ' || now()::text`,
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
}
