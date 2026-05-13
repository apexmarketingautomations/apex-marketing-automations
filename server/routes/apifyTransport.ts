/**
 * Apify Transport + Admin BatchData Routes
 *
 * POST /api/admin/transport/pull        — run Apify transport scraper (admin only)
 * GET  /api/admin/transport/pull-status — view repull log (admin only)
 * POST /api/admin/batch-skip-trace      — trigger BatchData skip-trace for crash accounts
 * GET  /api/admin/vendor-health         — live vendor configuration + job status
 */

import type { Express, Request, Response, NextFunction } from "express";
import { asyncHandler } from "./helpers";
import {
  resolveBatchDataKey,
  resolveApifyToken,
  recordBatchDataRun,
  recordApifyRun,
  getVendorRunState,
  CRASH_LEAD_ACCOUNT_IDS,
} from "../vendorConfig";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function isAdminRequest(req: Request): Promise<boolean> {
  const user = (req as any).user;
  if (!user) return false;
  const userId: string = user.claims?.sub || user.id;
  if (!userId) return false;

  const adminId = (process.env.ADMIN_USER_ID || "").trim();
  if (adminId && userId === adminId) return true;

  // Passport session user never carries isAdmin/role — check DB directly
  const { authStorage } = await import("../replit_integrations/auth/storage");
  const dbUser = await authStorage.getUser(userId);
  return dbUser?.isAdmin === "true";
}

function requireAdminMiddleware(req: Request, res: Response, next: NextFunction): void {
  isAdminRequest(req).then((ok) => {
    if (ok) { next(); return; }
    res.status(403).json({ error: "Admin access required" });
  // allow-silent-catch: auth guard — always return 403 without leaking internal error details
  }).catch(() => res.status(403).json({ error: "Admin access required" }));
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
      console.log("[APIFY-TRANSPORT] Admin-triggered pull — query:", JSON.stringify(query));
      const result = await runTransportScraper(query as any, { forceRepull: !!forceRepull });
      recordApifyRun(result.resultCount, result.error || null);

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

  // ── Admin BatchData skip-trace button ──────────────────────────────────────
  //
  // Runs BatchData retro skip-trace for a crash lead account.  Allowed accounts:
  //   3 (Apex Marketing), 13 (Apex Main), 14 (Giovanni).
  // Runs in background — returns immediately with a confirmation.
  // Pass subAccountId in the request body, or omit to run ALL crash accounts.
  app.post(
    "/api/admin/batch-skip-trace",
    requireAdminMiddleware,
    asyncHandler(async (req: any, res: any) => {
      const { subAccountId } = req.body as { subAccountId?: number };

      // Validate — if an explicit account is requested, it must be a crash account
      if (subAccountId !== undefined && !CRASH_LEAD_ACCOUNT_IDS.has(Number(subAccountId))) {
        return res.status(403).json({
          error: `BatchData skip-trace via admin button is only available for crash lead accounts (${[...CRASH_LEAD_ACCOUNT_IDS].join(", ")}).`,
          hint:  `Requested: ${subAccountId}`,
        });
      }

      const apiKey = resolveBatchDataKey();
      if (!apiKey) {
        return res.status(503).json({
          error:  "BatchData not configured — set BATCHDATA_API_KEY in Railway env vars",
          detail: "No value found for BATCHDATA_API_KEY or BATCH_DATA",
        });
      }

      const { runRetroSkipTrace } = await import("../retroSkipTrace");

      const targetAccounts = subAccountId !== undefined
        ? [Number(subAccountId)]
        : [...CRASH_LEAD_ACCOUNT_IDS];

      console.log(`[BATCHDATA] Admin-triggered skip-trace for accounts: ${targetAccounts.join(", ")}`);

      // Run in background — don't await
      (async () => {
        for (const accountId of targetAccounts) {
          try {
            console.log(`[BATCHDATA] Starting retro skip-trace for account ${accountId}`);
            const stats = await runRetroSkipTrace(accountId, { crashOnly: true });
            console.log(
              `[BATCHDATA] Account ${accountId} complete — ` +
              `processed=${stats.processed} found=${stats.found} notFound=${stats.notFound} ` +
              `failed=${stats.failed} skipped=${stats.skipped}`
            );
            recordBatchDataRun(stats.processed, stats.failed > 0 ? `${stats.failed} contacts failed` : null);
          } catch (err: any) {
            console.error(`[BATCHDATA] Account ${accountId} skip-trace failed:`, err.message);
            recordBatchDataRun(0, err.message);
          }
        }
      })();

      return res.json({
        ok:            true,
        message:       `BatchData skip-trace started for account(s): ${targetAccounts.join(", ")}. Monitor Railway logs for [BATCHDATA] / [RETRO-SKIP-TRACE] output.`,
        targetAccounts,
      });
    })
  );

  // ── Vendor health check (admin only) ─────────────────────────────────────────
  //
  // Reports live vendor credential status and last-run stats.
  // Never logs or returns API key values.
  app.get(
    "/api/admin/vendor-health",
    requireAdminMiddleware,
    asyncHandler(async (_req: any, res: any) => {
      // Use the same canonical resolvers the runtime code uses — vendor-health
      // can never diverge from runtime behaviour this way.
      const batchDataConfigured = !!resolveBatchDataKey();
      const apifyConfigured     = !!resolveApifyToken();

      // Pending BatchData jobs (crash contacts with no phone and not yet skip-traced)
      let pendingBatchDataJobs = 0;
      try {
        const { pool } = await import("../db");
        const r = await pool.query(`
          SELECT COUNT(*) AS cnt FROM contacts
          WHERE
            (tags @> ARRAY['crash-lead']::text[] OR tags @> ARRAY['sentinel-auto']::text[] OR source = 'sentinel_crash')
            AND (phone IS NULL OR phone = '')
            AND NOT (tags @> ARRAY['skip-traced']::text[])
        `);
        pendingBatchDataJobs = parseInt(r.rows[0]?.cnt ?? "0", 10);
      } catch (_e) { /* allow-silent-catch: vendor-health is best-effort */ }

      // Pending Apify jobs (crash reports in AWAITING/PENDING status)
      let pendingApifyJobs = 0;
      try {
        const { pool } = await import("../db");
        const r = await pool.query(`
          SELECT COUNT(*) AS cnt FROM crash_reports
          WHERE status IN ('AWAITING', 'PENDING') AND source = 'sentinel_auto'
        `);
        pendingApifyJobs = parseInt(r.rows[0]?.cnt ?? "0", 10);
      } catch (_e) { /* allow-silent-catch: vendor-health is best-effort */ }

      const { batchData: bd, apify: ap } = getVendorRunState();

      return res.json({
        batchDataConfigured,
        apifyConfigured,
        pendingBatchDataJobs,
        pendingApifyJobs,
        lastBatchDataRunAt:    bd?.ranAt?.toISOString() ?? null,
        lastBatchDataCount:    bd?.count ?? null,
        lastBatchDataSource:   bd?.source ?? null,
        lastBatchDataError:    bd?.error ?? null,
        lastApifyRunAt:        ap?.ranAt?.toISOString() ?? null,
        lastApifyCount:        ap?.count ?? null,
        lastApifySource:       ap?.source ?? null,
        lastApifyError:        ap?.error ?? null,
        crashLeadAccountIds:   [...CRASH_LEAD_ACCOUNT_IDS],
        envVarsPresent: {
          BATCHDATA_API_KEY: !!process.env.BATCHDATA_API_KEY,
          BATCH_DATA:        !!process.env.BATCH_DATA,
          APIFY_API_KEY:     !!process.env.APIFY_API_KEY,
        },
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
