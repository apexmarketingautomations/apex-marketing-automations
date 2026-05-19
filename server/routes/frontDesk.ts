import type { Express, Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { frontDeskTickets } from "@shared/schema";

function requireAuthed(req: Request, res: Response): boolean {
  const isAuthed = typeof (req as any).isAuthenticated === "function" && (req as any).isAuthenticated();
  if (!isAuthed) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function getTenantSubAccountId(req: Request): number {
  const tenant = (req as any).tenant;
  const subAccountId = Number(tenant?.subAccountId);
  if (!subAccountId || Number.isNaN(subAccountId)) throw new Error("Missing tenant subAccountId");
  return subAccountId;
}

export function registerFrontDeskRoutes(app: Express) {
  app.get("/api/frontdesk/tickets", async (req, res) => {
    if (!requireAuthed(req, res)) return;
    const subAccountId = getTenantSubAccountId(req);
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);

    const rows = await db
      .select()
      .from(frontDeskTickets)
      .where(eq(frontDeskTickets.subAccountId, subAccountId))
      .orderBy(desc(frontDeskTickets.createdAt))
      .limit(limit);

    res.json(rows);
  });

  app.post("/api/frontdesk/tickets", async (req, res) => {
    if (!requireAuthed(req, res)) return;
    const subAccountId = getTenantSubAccountId(req);
    const body = (req.body || {}) as any;

    const type = String(body.type || "").trim();
    if (!type) return res.status(400).json({ error: "type is required" });

    const status = String(body.status || "open").trim() || "open";
    const priority = String(body.priority || "normal").trim() || "normal";
    const source = String(body.source || "kiosk").trim() || "kiosk";

    const guestName = body.guestName ? String(body.guestName).trim() : null;
    const guestPhone = body.guestPhone ? String(body.guestPhone).trim() : null;
    const guestEmail = body.guestEmail ? String(body.guestEmail).trim() : null;
    const payload = (body.payload && typeof body.payload === "object") ? body.payload : {};

    const [created] = await db
      .insert(frontDeskTickets)
      .values({
        subAccountId,
        type,
        status,
        priority,
        source,
        guestName,
        guestPhone,
        guestEmail,
        payload,
      })
      .returning();

    res.json({ ok: true, ticket: created });
  });

  app.patch("/api/frontdesk/tickets/:id", async (req, res) => {
    if (!requireAuthed(req, res)) return;
    const subAccountId = getTenantSubAccountId(req);
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

    const body = (req.body || {}) as any;
    const status = body.status != null ? String(body.status).trim() : undefined;
    const priority = body.priority != null ? String(body.priority).trim() : undefined;

    if (!status && !priority) {
      return res.status(400).json({ error: "Provide status and/or priority" });
    }

    const patch: any = { updatedAt: new Date() };
    if (status) patch.status = status;
    if (priority) patch.priority = priority;

    const [updated] = await db
      .update(frontDeskTickets)
      .set(patch)
      .where(and(eq(frontDeskTickets.id, id), eq(frontDeskTickets.subAccountId, subAccountId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, ticket: updated });
  });
}

