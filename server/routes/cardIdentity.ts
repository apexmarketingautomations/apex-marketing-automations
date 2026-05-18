/**
 * server/routes/cardIdentity.ts
 *
 * AI Identity DNA routes for both platform digital cards and standalone cards.
 *
 * POST /api/card-identity/generate     — generate DNA from prompt
 * POST /api/card-identity/patch        — patch existing DNA from prompt
 * PATCH /api/card-identity/:cardId/apply       — save DNA to digital_cards
 * PATCH /api/standalone-identity/:cardId/apply — save DNA to standalone_cards
 * POST /api/card-analytics/interaction — track rich interaction events
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { digitalCards, standaloneCards, cardAnalyticsSessions } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { generateIdentityDNA, patchIdentityDNA, generateCardContent } from "../services/aiPromptToIdentityDNA";
import type { IdentityVisualDNA } from "../../client/src/lib/card-identity/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizePrompt(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").slice(0, 1000).trim();
}

function getSession(req: Request): { userId?: number; subAccountId?: number } {
  const session = (req as any).session ?? {};
  return { userId: session.userId, subAccountId: session.subAccountId };
}

// ── Intent Score Logic ────────────────────────────────────────────────────────

const INTERACTION_SCORES: Record<string, number> = {
  hero_dwell: 10,       // +10 for dwelling on WebGL hero > 5s
  cta_hover: 15,        // +15 for hovering CTA > 3s
  revisit: 25,          // +25 for return visit
  save_contact: 40,     // +40 for saving contact
  share_intent: 20,     // +20 for opening share sheet
  interaction_depth: 5, // +5 for scene interaction
};

function calcIntentScore(existing: number, event: string, metadata?: Record<string, unknown>): number {
  let delta = INTERACTION_SCORES[event] ?? 0;

  // Conditional scoring
  if (event === "hero_dwell" && typeof metadata?.durationMs === "number" && metadata.durationMs < 5000) delta = 0;
  if (event === "cta_hover" && typeof metadata?.durationMs === "number" && metadata.durationMs < 3000) delta = 0;

  return Math.min(100, existing + delta);
}

function getTier(score: number): "cold" | "warm" | "hot" | "buyer_intent" {
  if (score >= 76) return "buyer_intent";
  if (score >= 51) return "hot";
  if (score >= 21) return "warm";
  return "cold";
}

// ── Route Registration ────────────────────────────────────────────────────────

export function registerCardIdentityRoutes(app: Express): void {
  // POST /api/card-identity/generate
  app.post("/api/card-identity/generate", async (req: Request, res: Response) => {
    try {
      const { prompt, profileContext, cardId, subAccountId } = req.body ?? {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      const clean = sanitizePrompt(prompt);
      console.log(`[IDENTITY] Generate request: "${clean.slice(0, 80)}" cardId=${cardId ?? "none"}`);

      const dna = await generateIdentityDNA(clean, profileContext ?? undefined);
      return res.json({ dna });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[IDENTITY] Generate error:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  // POST /api/card-identity/patch
  app.post("/api/card-identity/patch", async (req: Request, res: Response) => {
    try {
      const { prompt, existingDna } = req.body ?? {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      if (!existingDna || typeof existingDna !== "object") {
        return res.status(400).json({ error: "existingDna is required" });
      }
      const clean = sanitizePrompt(prompt);
      console.log(`[IDENTITY] Patch request: "${clean.slice(0, 80)}"`);

      const dna = await patchIdentityDNA(existingDna as IdentityVisualDNA, clean);
      return res.json({ dna });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[IDENTITY] Patch error:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  // PATCH /api/card-identity/:cardId/apply — save DNA to digital_cards
  app.patch("/api/card-identity/:cardId/apply", async (req: Request, res: Response) => {
    try {
      const cardId = parseInt(String(req.params.cardId), 10);
      const { dna, subAccountId } = req.body ?? {};

      if (isNaN(cardId)) return res.status(400).json({ error: "Invalid cardId" });
      if (!dna || typeof dna !== "object") return res.status(400).json({ error: "dna is required" });

      // Validate ownership — must match subAccountId in session or body
      const session = getSession(req);
      const acctId = subAccountId ?? session.subAccountId;
      if (!acctId) return res.status(401).json({ error: "Unauthorized" });

      const [card] = await db.select().from(digitalCards).where(eq(digitalCards.id, cardId));
      if (!card) return res.status(404).json({ error: "Card not found" });
      if (card.subAccountId !== Number(acctId)) return res.status(403).json({ error: "Forbidden" });

      await db.update(digitalCards)
        .set({ identityDna: dna, updatedAt: new Date() })
        .where(eq(digitalCards.id, cardId));

      console.log(`[DIGITAL-CARD] [IDENTITY] Applied DNA to card ${cardId} style=${dna.identityStyle}`);
      return res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[IDENTITY] Apply error:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  // PATCH /api/standalone-identity/:cardId/apply — save DNA to standalone_cards
  app.patch("/api/standalone-identity/:cardId/apply", async (req: Request, res: Response) => {
    try {
      const cardId = parseInt(String(req.params.cardId), 10);
      const { dna } = req.body ?? {};

      if (isNaN(cardId)) return res.status(400).json({ error: "Invalid cardId" });
      if (!dna || typeof dna !== "object") return res.status(400).json({ error: "dna is required" });

      const [card] = await db.select().from(standaloneCards).where(eq(standaloneCards.id, cardId));
      if (!card) return res.status(404).json({ error: "Card not found" });

      await db.update(standaloneCards)
        .set({ identityDna: dna, updatedAt: new Date() })
        .where(eq(standaloneCards.id, cardId));

      console.log(`[IDENTITY] Applied DNA to standalone card ${cardId} style=${dna.identityStyle}`);
      return res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[IDENTITY] Standalone apply error:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  // POST /api/card-identity/generate-content — generate card bio/tagline/services/testimonial from prompt
  app.post("/api/card-identity/generate-content", async (req: Request, res: Response) => {
    try {
      const { prompt, name, title, company, niche, imageUrl } = req.body ?? {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      const clean = sanitizePrompt(prompt);
      const content = await generateCardContent(clean, { name, title, company, niche, imageUrl });
      return res.json({ content });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[IDENTITY] generate-content error:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  // POST /api/card-analytics/interaction — track rich interaction events
  app.post("/api/card-analytics/interaction", async (req: Request, res: Response) => {
    try {
      const { cardId, sessionId, eventType, metadata } = req.body ?? {};
      if (!cardId || !sessionId || !eventType) {
        return res.status(400).json({ error: "cardId, sessionId, eventType required" });
      }

      console.log(`[LEAD-SCORE] Interaction cardId=${cardId} session=${sessionId} event=${eventType}`);

      // Look up existing session
      const [session] = await db.select()
        .from(cardAnalyticsSessions)
        .where(eq(cardAnalyticsSessions.sessionId, sessionId));

      if (session) {
        const newScore = calcIntentScore(session.intentScore, eventType, metadata);
        const newTier = getTier(newScore);
        await db.update(cardAnalyticsSessions)
          .set({ intentScore: newScore, leadTier: newTier, lastSeenAt: new Date() })
          .where(eq(cardAnalyticsSessions.sessionId, sessionId));

        console.log(`[LEAD-SCORE] [CTA] session=${sessionId} event=${eventType} score=${session.intentScore}→${newScore} tier=${newTier}`);
        return res.json({ ok: true, intentScore: newScore, leadTier: newTier });
      }

      return res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[LEAD-SCORE] Interaction error:", msg);
      return res.status(500).json({ error: msg });
    }
  });
}
