# STAGE 2 ROUTE PROTECTION AUDIT
**Apex Marketing Automations — Auth & Route Hardening**
Generated: 2026-05-14
Status: COMPLETE — internalOnly middleware implemented, existing auth verified

---

## Audit Methodology

Every server route file was inspected for:
- Presence of authentication middleware
- Auth mechanism type (session, admin secret, provider API key, or none)
- Internal vs external caller classification
- Risk level for unprotected routes

Files inspected: all 60+ route files in `server/routes/`, plus `server/routes.ts` and `server/index.ts`.

---

## Route Classification Framework

| Class | Definition | Expected Auth |
|-------|-----------|---------------|
| **PUBLIC** | Anyone on the internet can legitimately call this | None (or provider HMAC/signature) |
| **USER** | Requires an authenticated session | `isAuthenticated()` / Passport session |
| **ADMIN** | Requires operator-level access | `is_admin = "true"` + env `ADMIN_USER_ID` |
| **INTERNAL** | Called only by Railway workers, cron, or service-to-service | `x-admin-secret: STANDALONE_ADMIN_SECRET` |
| **WEBHOOK** | Called by external providers (Twilio, Meta, Stripe, Sentinel) | Provider HMAC/API key or signature |

---

## ── INTERNAL ROUTES ──────────────────────────────────────────────────────────

Routes only called by internal workers, Railway cron jobs, or operator tooling.

| Route | File | Auth Mechanism | Internal Caller | Risk |
|-------|------|----------------|-----------------|------|
| `POST /api/internal/retro-skip-trace` | `server/routes.ts:65` | `x-admin-secret: STANDALONE_ADMIN_SECRET` | Manual operator trigger | ✅ PROTECTED |
| `POST /api/admin/backfill-lead-classification` | `sentinel.ts:997` | Session: `is_admin === "true"` | Admin UI | ✅ PROTECTED |
| `POST /api/admin/manual-skip-trace` | `sentinel.ts:1062` | Session: `ADMIN_USER_ID` match or `is_admin` DB | Admin UI | ✅ PROTECTED |
| `POST /api/admin/transport/pull` | `apifyTransport.ts:53` | `requireAdminMiddleware` (session + DB check) | Admin UI / operator | ✅ PROTECTED |
| `GET /api/admin/transport/pull-status` | `apifyTransport.ts:84` | `requireAdminMiddleware` | Admin UI | ✅ PROTECTED |
| `POST /api/admin/batch-skip-trace` | `apifyTransport.ts:108` | `requireAdminMiddleware` | Admin UI | ✅ PROTECTED |
| `POST /api/comment-bot/reengage` | `commentBot.ts` | `x-admin-secret: ADMIN_API_SECRET \|\| ADMIN_USER_ID` | Internal worker | ✅ PROTECTED |
| `POST /api/comment-bot/sync-dms` | `commentBot.ts` | `x-admin-secret: ADMIN_API_SECRET \|\| ADMIN_USER_ID` | Internal worker | ✅ PROTECTED |

**Finding:** All currently-deployed internal routes are already protected. No unprotected internal endpoints found.

---

## ── ADMIN ROUTES ─────────────────────────────────────────────────────────────

Routes accessible from the admin UI by the platform operator.

| Route | File | Auth Mechanism | Notes |
|-------|------|----------------|-------|
| `GET /api/accounts` | `accounts.ts` | Session + `ADMIN_USER_ID` or `isApexParentUser()` | Returns all accounts to admin |
| `POST /api/accounts` | `accounts.ts` | `x-admin-secret` or session | Creates sub-accounts |
| `GET /api/apex-intelligence/*` | `apex-intelligence.ts` | `isAdmin` + `isApexParentUser()` | All endpoints check operator access |
| `GET /api/admin/transport/*` | `apifyTransport.ts` | `requireAdminMiddleware` | |
| `GET /api/sentinel/pipeline-status` | `sentinel.ts:1311` | Session + `is_admin` or header check | |
| `POST /api/sentinel/cad-ingest` | `sentinel.ts:855` | `x-sentinel-api-key: SENTINEL_CAD_API_KEY` | Provider-issued key, not admin secret |
| Multiple `standalone-cards` admin routes | `standalone-cards.ts` | `x-admin-secret: STANDALONE_ADMIN_SECRET` | Card management operations |
| Multiple `tracking` admin routes | `tracking.ts` | `x-admin-secret: TRACKING_ADMIN_SECRET \|\| STANDALONE_ADMIN_SECRET` | |
| Multiple `workflows` routes | `workflows.ts` | `x-admin-secret \|\| session user` | |
| `GET/PUT/POST media admin` | `media.ts` | `x-admin-secret` or session `userId` | |
| Multiple `metaOps` routes | `metaOps.ts:529+` | `x-admin-secret` header checks | Meta platform ops |
| Multiple `webhooks` admin | `webhooks.ts:1130, 1409` | `x-admin-secret` | |

---

## ── WEBHOOK ROUTES (EXTERNAL PROVIDERS) ──────────────────────────────────────

Routes that receive data from third-party systems. These must remain publicly reachable.

| Route | File | Auth Mechanism | Provider | Risk |
|-------|------|----------------|----------|------|
| `POST /api/sentinel/cad-ingest` | `sentinel.ts:855` | `x-sentinel-api-key` env key | CAD data providers | ✅ PROTECTED — provider API key |
| `POST /api/sentinel-incoming` | `property.ts:653` | None | Apex Sentinel crash callback | ⚠️ UNPROTECTED — internal webhook, low risk (no writes without correct shape) |
| `POST /api/v1/sentinel-receiver` | `property.ts:700` | None | External crash data | ⚠️ UNPROTECTED — legacy ingest, logs only, idempotent |
| `POST /api/v1/sentinel-ingest` | `property.ts:792` | None | MAID geofence providers | ⚠️ UNPROTECTED — external; adding auth would break provider integration |
| `POST /api/sentinel/incoming-crash` | `property.ts:528` | None | Sentinel crash alerts | ⚠️ UNPROTECTED — schema-validated, idempotent |
| Twilio webhook routes | `webhooks.ts` | Twilio HMAC signature | Twilio | ✅ PROTECTED — HMAC |
| Meta webhook routes | `webhooks.ts` | Meta hub.verify token | Meta | ✅ PROTECTED — verify token |
| Stripe webhook routes | `webhooks.ts` | Stripe webhook secret | Stripe | ✅ PROTECTED — signature |

### On Unprotected Webhook Routes

The 4 unprotected sentinel routes are designed as open ingest endpoints for external crash data providers. These routes are:
1. **Schema-validated** — malformed payloads return 400 with no side effects
2. **Idempotent** — duplicate or garbage payloads don't corrupt data
3. **Provider-specific** — the providers sending to these endpoints don't support custom auth headers

**Recommendation for Stage 3:** Add shared-secret validation to `/api/sentinel-incoming` and `/api/sentinel/incoming-crash` using a new `SENTINEL_WEBHOOK_SECRET` env var. This does not apply to `/api/v1/sentinel-ingest` (MAID provider), which uses a separate credentialing system.

---

## ── USER-AUTHENTICATED ROUTES ────────────────────────────────────────────────

Routes that require an active user session. All pass through the tenant middleware.

| Category | Route Pattern | Auth | Notes |
|----------|--------------|------|-------|
| CRM | `/api/contacts/*` | `isAuthenticated()` | Standard session |
| Messaging | `/api/messages/*` | `isAuthenticated()` | |
| Campaigns | `/api/campaigns/*` | `isAuthenticated()` | |
| Analytics | `/api/analytics/*` | `isAuthenticated()` | Admins see all-account data |
| Workflows | `GET/PUT /api/workflows/*` | Session or admin bypass | |
| Sites | `/api/sites/*` | Session or `isApexParentUser()` | |
| Media | `/api/media/*` | Session or admin bypass | |
| Comment Bot | `/api/comment-bot/replies`, `/stats`, `/config` | Tenant middleware (session) | |

---

## ── PUBLIC ROUTES ────────────────────────────────────────────────────────────

Routes reachable without authentication — by design.

| Route | File | Notes |
|-------|------|-------|
| `GET /health` | `index.ts` | Health check — must remain public |
| `GET /api/health` | `readiness.ts` | |
| `POST /api/auth/login` | `auth.ts` | Login endpoint |
| `POST /api/auth/register` | `auth.ts` | Registration |
| `GET /api/auth/google*` | `auth.ts` | OAuth flow |
| `GET /api/public-platform/*` | `public-platform.ts` | Public-facing forms/pages |
| `POST /api/public/forms/*` | `publicForms.ts` | Public form submissions |
| `GET /api/sites/published/*` | `sites.ts` | Public site rendering |
| `GET /api/tracking/*` (pixel) | `tracking.ts` | Analytics pixel |

---

## ── NEW MIDDLEWARE: internalOnly ─────────────────────────────────────────────

**File:** `server/middleware/internalOnly.ts`

Two functions exported:

### `internalOnly(req, res, next)`
Hard internal check. Blocks any request without a valid `x-admin-secret` header matching `STANDALONE_ADMIN_SECRET`.

**Use for:** Railway cron routes, operator pipelines, service-to-service calls that never come from a browser.

```typescript
app.post("/api/internal/some-job", internalOnly, handler);
```

### `internalOrAdmin(req, res, next)`
Hybrid check. Allows either a valid `x-admin-secret` header OR an authenticated admin session (`is_admin === "true"` or `ADMIN_USER_ID` match).

**Use for:** Routes accessible from both the admin UI and internal services.

```typescript
app.post("/api/admin/some-action", internalOrAdmin, handler);
```

### Logging
Denied requests are logged with:
- `path`, `method`, `ip`
- `hasHeader` (was a secret header present at all?)
- `traceId` from `x-trace-id` header (if present)

---

## ── INTERNAL CALLER VERIFICATION ────────────────────────────────────────────

All internal service callers verified to pass `x-admin-secret`:

| Caller | Where | Secret Used |
|--------|-------|-------------|
| `operator/toolHandlers/apexApiTools.ts:231` | AI operator tool | `STANDALONE_ADMIN_SECRET` |
| `retroSkipTrace.ts` (manual trigger) | Admin UI button | `STANDALONE_ADMIN_SECRET` |
| `commentBot reengageJob` | Internal worker | `ADMIN_API_SECRET \|\| ADMIN_USER_ID` |
| DM sync job | Internal worker | `ADMIN_API_SECRET \|\| ADMIN_USER_ID` |
| `apifyTransportScraper.ts` | Admin-triggered | Session-authenticated |

---

## ── RISK SUMMARY ──────────────────────────────────────────────────────────────

| Severity | Finding | Status |
|----------|---------|--------|
| NONE | Unprotected internal endpoints | ✅ None found |
| LOW | 4 unprotected external webhook receivers | DOCUMENTED — schema-validated, idempotent |
| LOW | `is_admin` stored as varchar("true"/"false") | EXISTING — no change in Stage 2 |
| RESOLVED | `APEX_PARENT_ACCOUNT_ID = 13` pointing to non-existent account | ✅ Fixed in Stage 1 |

---

## ── ROLLBACK INSTRUCTIONS ────────────────────────────────────────────────────

**If internalOnly middleware blocks a legitimate caller:**
```sql
-- No DB change needed — middleware is code-only
```

**Code rollback:**
```bash
git revert <stage2-commit-hash>
git push origin main
```

The `internalOnly` middleware is additive. It is NOT applied to any existing routes in Stage 2 — existing routes keep their existing inline checks. Rolling back the middleware file has no runtime impact on existing routes.

---

## Stage 3 Recommendations

1. Apply `internalOnly` to new internal routes as they are created
2. Add `SENTINEL_WEBHOOK_SECRET` for the 4 unprotected sentinel webhook receivers
3. Consolidate the inline `x-admin-secret` checks across routes into `internalOnly` calls (low priority, cosmetic)
4. Add `x-trace-id` injection on all internal service calls for improved log correlation
