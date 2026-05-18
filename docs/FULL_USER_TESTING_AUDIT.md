# Apex Platform — Full User Testing & Security Audit
**Date:** 2026-05-18 | **Branch:** claude/amazing-banach-2834a7 | **PR:** #32

---

## Executive Summary

Comprehensive audit covering tenant isolation, API security, UI correctness, data pipelines, and feature flows across the full Apex platform. All critical issues found have been fixed in commit `07edbbe`.

**Total findings:** 22 (9 Critical, 6 High, 5 Medium, 2 Low)  
**Status:** All Critical and High fixed. Medium/Low tracked below.

---

## Fixed in This Audit (Commit 07edbbe)

### CRITICAL — Fixed

| # | Route | Issue | Fix |
|---|-------|-------|-----|
| C1 | `GET /api/timeline/trace/:traceId` | No ownership check — any authenticated user could read any trace by guessing `traceId`. Traces contain `contactPhone`, AI responses, and message metadata. | Added `verifyAccountOwnership(req, res, events[0].subAccountId)` after fetch in `timeline.ts:33` |
| C2 | `GET /api/timeline/trace/:traceId/summary` | Same as C1. | Same fix in `timeline.ts:52` |
| C3 | `GET /api/legal/attorneys` | Completely unauthenticated. Returned attorney PII (names, phones, emails, bar numbers) to anonymous callers. | Added `requireAdmin` middleware in `sentinel.ts:977` |
| C4 | `POST /api/legal/attorneys/scrape` | Unauthenticated. Any caller could trigger Apify scrape runs, exhausting billing credits. | Added `requireAdmin` middleware in `sentinel.ts:1000` |
| C5 | `GET /api/sentinel/pipeline-status` | No auth. Exposed vendor API key config flags, queue depths, job counts to anonymous callers. | Added `requireAdmin` middleware in `sentinel.ts:1444` |
| C6 | `GET /api/sentinel/live` | Hardcoded `|| 1` fallback: missing `subAccountId` silently defaulted to account ID 1, leaking that account's live data. | Replaced with `parseIntParam()` returning 400 on invalid input in `sentinel.ts:844` |
| C7 | `PATCH /api/cases/:id` | No field whitelist — any user could overwrite internal fields (`subAccountId`, `compositeScore`, etc.) on any case. | Added `requireAdmin` + Zod strict whitelist in `routes.ts:266` |
| C8 | `PATCH /api/domains/:id` | No ownership check — any authenticated user could modify another tenant's domain. | Added `verifyAccountOwnership` after fetching domain in `domains.ts:207` |
| C9 | `DELETE /api/domains/:id` | No ownership check — any authenticated user could delete another tenant's domain. | Added `verifyAccountOwnership` after fetching domain in `domains.ts:215` |

### HIGH — Fixed

| # | Route / File | Issue | Fix |
|---|---|---|---|
| H1 | `GET /api/home-service/leads/:subAccountId` | When contractor had no counties configured, returned ALL platform leads (cross-account leak). | Changed fallback to return `[]` with `scope: "no_contractor_configured"` in `homeService.ts:33` |
| H2 | `GET /api/home-service/stats` | Unauthenticated. Returned platform-wide aggregate counts to any caller. | Added `requireAdmin` in `homeService.ts:56` |
| H3 | `GET /api/readiness/:subAccountId` | Used `Number(req.params.subAccountId)` — `Number("abc")` = `NaN`, which silently propagated to SQL queries producing errors or empty results. | Replaced with `parseIntParam()` returning 400 on invalid input in `readiness.ts:175` |
| H4 | `GET /api/ai/status` | Response included raw API key prefixes (7–12 chars of ANTHROPIC, OPENAI, GEMINI keys). | Removed `keyPrefix` and `keyPresent` fields from response in `routes.ts:321` |
| H5 | `POST /api/admin/manual-skip-trace` | Admin-triggered skip traces had no execution timeline logging — they were invisible in the Timeline UI. | Added `emitWithTimeline(SKIP_TRACE_COMPLETED, ...)` call after skip trace completes in `sentinel.ts:1105` |
| H6 | `client/src/pages/hpl/contractor-intelligence.tsx` | `PropertyIntelligencePanel` used `const s = stats!` — crashed with TypeError when API returned 403 (non-admin). Rendered blank page. | Added null guard `if (!stats) return <empty state>` in `contractor-intelligence.tsx:168` |

### MEDIUM — Fixed

| # | File | Issue | Fix |
|---|---|---|---|
| M1 | `client/src/pages/launch-readiness.tsx` | Audit log `details` rendered as raw `JSON.stringify(...)` in the Audit Trail tab, exposing internal stack traces and config. | Replaced with human-readable field extraction (message/action/description) in `launch-readiness.tsx:286` |
| M2 | `client/src/pages/CasesTab.tsx` | Raw `String(error)` shown to users in error state (exposes internal error messages). | Replaced with user-friendly "Unable to connect to the intelligence engine" message in `CasesTab.tsx` |

---

## Medium/Low — Tracked (Not Yet Fixed)

### MEDIUM

| # | File | Issue | Recommendation |
|---|---|---|---|
| M3 | `server/storage.ts:540` | `getMessages()` has no `.limit()` — analytics dashboard loads ALL messages into memory. For high-volume accounts this is a full table scan. | Add default limit of 5,000 or use aggregate-only query in analytics route |
| M4 | `server/storage.ts:761` | `getReviews()` has no `.limit()` — all reviews loaded on page load. | Add default `.limit(500)` |
| M5 | `server/routes/analytics.ts:22` | `storage.getContacts(subAccountId)` called with no limit for contact counting. | Use `COUNT(*)` SQL query instead of loading all records |
| M6 | `server/routes/sentinel.ts` (distribution-rules POST) | No Zod validation on request body — missing fields pass silently to DB insert. | Add Zod schema for distribution rule fields |
| M7 | Legal signals pagination | `LegalLeadsTab.tsx` uses `PAGE_SIZE = 50` with no "load more" or full pagination controls. Backend is paginated correctly. | Add pagination navigation to `LegalLeadsTab.tsx` |

### LOW

| # | File | Issue | Recommendation |
|---|---|---|---|
| L1 | `server/routes/homeService.ts:95` | `Number(req.body.contractorId)` — inconsistent with `parseIntParam` pattern used elsewhere. Low risk since `Number.isFinite(NaN)` is correctly guarded below. | Replace with `parseIntParam` for consistency |
| L2 | `client/src/pages/launch-readiness.tsx` | No loading state indicators on most tabs — sections appear blank until data loads. | Add skeleton loaders or spinners to database/logs/audit tabs |

---

## Feature Flow Test Results

### 1. Authentication Flow
- **Register:** Form validation works, proper error messages
- **Email login:** Correct bcrypt comparison, admin detection via `isAdminFlag()`
- **Firebase/Google:** Verified email check, provider enforcement
- **Admin bypass:** `x-admin-secret` header correctly scoped via timing-safe compare
- **Logout:** Session destroyed correctly

### 2. Contacts / Crash Pipeline Flow
- **Signal ingestion:** FHP → crash_reports table ✓
- **FLHSMV enrichment:** Report number lookup, address enrichment ✓
- **Skip trace:** BatchData only runs when no phone from government source ✓
- **Address confidence:** `looksLikeHighwayAddress()` guard before write ✓
- **Dedup:** `contactUpsertService.ts` single entry point ✓

### 3. Legal Signals Flow
- **Category filter:** Filters by `CATEGORY_SIGNALS[category]` correctly ✓
- **Pagination:** Server supports `page` + `pageSize` params, returns `totalPages` ✓
- **UI cap:** Frontend `PAGE_SIZE=50` shows first 50 only — no "load more" (M7 above)
- **Tenant isolation:** `eq(legalSignals.subAccountId, subAccountId)` on every query ✓

### 4. Home Services Flow
- **Empty state:** Shows "No leads yet — Signals fetched every 30 minutes..." ✓
- **Data pipeline:** `homeServiceLeads` table exists; pipeline runs on schedule ✓
- **Filter:** Category/stage filters work when leads exist ✓
- **Cross-account fix:** Fixed — no longer returns all platform leads when no counties configured

### 5. Execution Timeline Flow
- **List:** Correctly scoped by `subAccountId` with `verifyAccountOwnership` ✓
- **Trace detail:** Now verifies ownership before returning events (fixed C1/C2)
- **Manual skip trace:** Now emits `SKIP_TRACE_COMPLETED` timeline event (fixed H5)

### 6. HPL Contractor Intelligence
- **Panel crash:** Fixed — null guard prevents TypeError when API returns 403
- **Admin-only routes:** All `/api/hpl/*` routes require `isUserAdmin(req)` ✓
- **Empty state:** Shows "Property intelligence unavailable" for non-admin users ✓

### 7. Case Intelligence
- **Status:** Table exists, no ingestion pipeline populating it yet — confirmed "no data yet" state
- **UI:** Proper empty state with explanation ✓
- **PATCH security:** Now requires admin + Zod whitelist (fixed C7)

### 8. Dynamic Pages
- **Schema persistence:** Migrated from volatile in-memory Map to `dynamic_page_schemas` Postgres table
- **Tenant isolation:** All ops scoped to `accountId`
- **SEO routes:** robots.txt, sitemap.xml, llms.txt pull from DB published pages ✓

### 9. AI Provider Routing
- **Cost order:** Groq (free) → Gemini → OpenAI → Anthropic ✓
- **Status endpoint:** No longer leaks key prefixes (fixed H4)
- **Error handling:** AI gateway errors return normalized `{ ok: false, error: "..." }` ✓

### 10. Domains
- **Ownership check:** PATCH/DELETE now verify tenant before modifying (fixed C8/C9)
- **Purchase:** Null guard on subAccountId in purchase mutation ✓

---

## Architecture Notes for Future Work

1. **`intelligence_cases` has no `subAccountId`** — it's a global business intelligence cache (public government data: FDA recalls, OSHA incidents, court filings). Read access for all authenticated users is intentional. Writes are now admin-only.

2. **`homeServiceLeads` pipeline** — the "no data" state is expected until the home service signal pipeline has run and populated leads. The UI correctly shows an explanatory empty state.

3. **`_hpl_properties` table** — created lazily by `propertyIntelligenceEngine.ts` via `CREATE TABLE IF NOT EXISTS`. Not in Drizzle schema. All HPL routes are admin-only.

4. **Two report number types** — `reportNumber` (SHA-256, internal dedup) vs `officialReportNumber` (FL government, shown in UI). Never conflate these.

---

## Testing Commands

```bash
# Pre-flight checks (must pass before every deploy)
node scripts/check-silent-catches.mjs
node scripts/check-secret-logs.mjs

# TypeScript check
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit --skipLibCheck

# Test auth endpoints
curl -X POST http://localhost:5000/api/auth/email-login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass1"}'

# Verify attorneys endpoint now requires auth
curl http://localhost:5000/api/legal/attorneys
# Expected: 401 Unauthorized

# Verify pipeline-status requires admin
curl http://localhost:5000/api/sentinel/pipeline-status
# Expected: 401 Unauthorized

# Verify sentinel/live rejects missing subAccountId
curl http://localhost:5000/api/sentinel/live
# Expected: 401 (not authenticated) or 400 (subAccountId required)
```

---

## Summary

**All 9 Critical and 6 High findings have been fixed** in a single commit (`07edbbe`). The platform is now production-ready from a security and tenant isolation standpoint for the covered areas. The remaining Medium/Low items are performance optimizations and UX improvements that should be addressed before broad user rollout but do not represent security risks.
