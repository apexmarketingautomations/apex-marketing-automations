/**
 * Apify Transport + Admin BatchData Routes
 *
 * POST /api/admin/transport/pull        — run Apify transport scraper (admin only)
 * GET  /api/admin/transport/pull-status — view repull log (admin only)
 * POST /api/admin/batch-skip-trace      — trigger BatchData skip-trace (APEX MARKETING ACCOUNT ONLY)
 */

import type { Express, Request, Response, NextFunction } from "express";
import { asyncHandler } from "./helpers";

// Apex Marketing Automations account ID — the only account allowed to trigger
// BatchData skip-trace via the admin button.
const APEX_MARKETING_ACCOUNT_ID = 3;

// ── Auth helper ───────────────────────────────────────────────────────────────

function isAdminRequest(req: Request): boolean {
  const user = (req as any).user;
  if (!user) return false;
  if (user.isAdmin === "true" || user.role === "DEV_ADMIN") return true;
  const adminId = (process.env.ADMIN_USER_ID || "").trim();
  return !!adminId && user.id === adminId;
}

function requireAdminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isAdminRequest(req)) { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerApifyTransportRoutes(app: Express): void {

  // ── Apify transport pull ────────────────────────────────────────────────────
  app.post(
    "/api/admin/transport/pull",
    requireAdminMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const { query, forceRepull = false } = req.body as {
        query?:       Record<string, unknown>;
        forceRepull?: boolean;
      };

      if (!query || typeof query !== "object") {
        return res.status(400).json({ error: "body.query (object) is required" });
      }

      const { runTransportScraper } = await import("../apifyTransportScraper");
      const result = await runTransportScraper(query as any, { forceRepull: !!forceRepull });

      return res.status(result.ok ? 200 : (result.error?.includes("blocked") ? 429 : 502)).json({
        ok:          result.ok,
        queryHash:   result.queryHash,
        actor:       result.actor,
        queryType:   result.queryType,
        resultCount: result.resultCount,
        results:     result.results,
        error:       result.error,
      });
    })
  );

  // ── Pull log status ─────────────────────────────────────────────────────────
  app.get(
    "/api/admin/transport/pull-status",
    requireAdminMiddleware,
    asyncHandler(async (_req: any, res: any) => {
      const { getPullLog } = await import("../apifyTransportScraper");
      const entries = [...getPullLog().entries()].map(([hash, v]) => ({
        queryHash:   hash,
        actor:       v.actor,
        queryType:   v.queryType,
        pulledAt:    v.pulledAt.toISOString(),
        status:      v.status,
        resultCount: v.resultCount,
        ageMinutes:  Math.round((Date.now() - v.pulledAt.getTime()) / 60_000),
      }));
      return res.json({ total: entries.length, entries });
    })
  );

  // ── Admin BatchData skip-trace button (APEX MARKETING ONLY) ────────────────
  //
  // Only the platform owner can trigger this.
  // Only works for sub-account ID = APEX_MARKETING_ACCOUNT_ID (3).
  // Runs in background — returns immediately.
  app.post(
    "/api/admin/batch-skip-trace",
    requireAdminMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const { subAccountId = APEX_MARKETING_ACCOUNT_ID } = req.body as { subAccountId?: number };

      if (Number(subAccountId) !== APEX_MARKETING_ACCOUNT_ID) {
        return res.status(403).json({
          error: `BatchData skip-trace via admin button is only available for account ${APEX_MARKETING_ACCOUNT_ID} (Apex Marketing).`,
          hint:  `Requested: ${subAccountId}`,
        });
      }

      const apiKey = process.env.BATCH_DATA || process.env.BATCHDATA_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "BATCH_DATA env var not configured" });
      }

      const { runRetroSkipTrace } = await import("../retroSkipTrace");
      // Run in background — don't await. Caller gets immediate confirmation.
      runRetroSkipTrace(Number(subAccountId)).then(stats => {
        console.log(`[ADMIN-BATCH-SKIP-TRACE] Account ${subAccountId} complete:`, stats);
      }).catch((err: Error) => {
        console.error(`[ADMIN-BATCH-SKIP-TRACE] Account ${subAccountId} failed:`, err.message);
      });

      return res.json({
        ok:         true,
        message:    `BatchData skip-trace started for account ${subAccountId} (Apex Marketing). Check logs for progress.`,
        subAccountId,
      });
    })
  );

  // ── Crash contacts export (admin, CSV) ──────────────────────────────────────
  app.get(
    "/api/admin/crash-contacts/export",
    requireAdminMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const { db }       = await import("../db");
      const { contacts } = await import("@shared/schema");
      const { sql }      = await import("drizzle-orm");

      // Pull all crash contacts across all accounts
      const rows: any[] = await db.execute(sql`
        SELECT
          c.id,
          c.first_name,
          c.last_name,
          c.phone,
          c.email,
          c.address,
          c.city,
          c.tags,
          c.source,
          c.created_at,
          c.sub_account_id,
          c.notes
        FROM contacts c
        WHERE
          (c.tags @> ARRAY['crash-lead']::text[]
           OR c.tags @> ARRAY['sentinel-auto']::text[]
           OR c.source = 'sentinel_crash')
        ORDER BY c.created_at DESC
        LIMIT 5000
      `);

      const lines = [
        ["ID", "First", "Last", "Phone", "Email", "Address", "County", "Status", "Account", "Date"].join(","),
        ...rows.map((r: any) => {
          const tags       = Array.isArray(r.tags) ? r.tags : [];
          const status     = tags.includes("skip-traced")
            ? (r.phone ? "Enriched" : "Skip-traced (no match)")
            : (r.phone ? "Has Phone" : "Pending skip-trace");
          return [
            r.id,
            `"${(r.first_name || "").replace(/"/g, '""')}"`,
            `"${(r.last_name  || "").replace(/"/g, '""')}"`,
            `"${r.phone  || ""}"`,
            `"${r.email  || ""}"`,
            `"${(r.address || "").replace(/"/g, '""')}"`,
            `"${(r.city   || "").replace(/"/g, '""')}"`,
            `"${status}"`,
            r.sub_account_id,
            `"${r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}"`,
          ].join(",");
        }),
      ];

      const csv = lines.join("\n");
      const filename = `crash-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    })
  );
}
