# APEX Known Issues
**Last Updated:** 2026-05-18

---

## CRITICAL (Data / Security)

### KI-001: Dynamic Pages schema store is volatile
- **File:** `server/routes/dynamicPages.ts`
- **Description:** All saved/published dynamic page schemas live in a `Map<number, StoredSchema[]>` in process memory. Every server restart, Railway redeploy, or crash drops all pages. Users cannot reliably save or publish pages.
- **Fix Required:** Create `dynamic_page_schemas` table in `shared/schema.ts`, move `saveSchemaForAccount` and `getSchemasForAccount` to DB queries.
- **Workaround added:** Startup warning log now emitted: `[DYNAMIC-PAGES] Using in-memory schema store — data will not survive restart`
- **Severity:** CRITICAL for production use of Dynamic Pages

### KI-002: reputation.tsx hardcodes SUB_ACCOUNT_ID = 1
- **File:** `client/src/pages/reputation.tsx` line 13
- **Description:** All users navigating to the Reputation page see account #1's reviews. This is a data isolation failure in multi-tenant context.
- **Fix Required:** Replace with `useAccount().activeAccountId`
- **Severity:** HIGH — data leak in multi-tenant deployment

### KI-003: domains.tsx fallback to hardcoded accountId = 13
- **File:** `client/src/pages/domains.tsx` line 75
- **Description:** When `activeAccountId` is null/undefined, the Domains page falls back to account #13 (a legacy account ID). Should show empty state instead.
- **Fix Required:** Remove hardcoded fallback, add proper empty state / account selector
- **Severity:** MEDIUM

### KI-004: `is_admin` stored as varchar "true"/"false"
- **File:** `shared/models/auth.ts` (users table), `server/auth/authorization.ts`
- **Description:** Admin flag is a text column compared as `user.isAdmin === "true"`. Any case variation or whitespace would bypass the check. Should be `boolean`.
- **Fix Required:** Migration to `boolean` type + update comparisons
- **Severity:** HIGH

### KI-005: STANDALONE_ADMIN_SECRET has hardcoded fallback
- **File:** `server/routes/sentinel.ts` lines 1155, 1183
- **Description:** `(process.env.STANDALONE_ADMIN_SECRET || "201120062017")` — if the env var is not set, the hardcoded value becomes the active admin secret. Should throw/warn loudly.
- **Fix Required:** Remove hardcoded fallback, fail loudly if env var missing
- **Severity:** HIGH

---

## HIGH

### KI-006: `/api/legal/attorneys` is unauthenticated
- **File:** `server/routes/sentinel.ts` ~line 976
- **Description:** Returns the full attorney directory (scraped PII including names, phones, verticals, scores) with no auth check.
- **Fix Required:** Add `isPlatformAdmin` or session check
- **Severity:** HIGH — exposes scraped professional data

### KI-007: `/api/sentinel/pipeline-status` is unauthenticated
- **File:** `server/routes/sentinel.ts` ~line 1438
- **Description:** Exposes internal pipeline metrics without auth.
- **Fix Required:** Add admin-secret or session guard
- **Severity:** MEDIUM

### KI-008: No API key authentication system
- **Description:** All auth is session-based (Firebase + Passport). There is no API key system for programmatic access. Automation tools must use session cookies.
- **Fix Required:** Implement API key table + middleware (out of scope for this PR)
- **Severity:** HIGH for B2B use cases

---

## MEDIUM

### KI-009: Anthropic is primary for all requests regardless of task complexity
- **File:** `server/aiGateway.ts` — `selectProvider()`
- **Description:** When `ANTHROPIC_API_KEY` is set, ALL AI requests route to Anthropic first. Simple patch commands ("make it darker", "reduce motion") that could be handled by local patch engine or Groq still hit Anthropic.
- **Fix Required:** Task-complexity routing: simple/deterministic → local → Groq; complex → Anthropic
- **Severity:** MEDIUM — cost inefficiency, not a bug

### KI-010: Dynamic Pages subAccountId not verified against session
- **File:** `server/routes/dynamicPages.ts`
- **Description:** The `generate`, `patch`, and `save` endpoints accept `subAccountId` from the request body and pass it to the store, but do not call `verifyAccountOwnership`. Any authenticated user can save schemas for any account ID.
- **Fix Required:** Add `verifyAccountOwnership(req, res, subAccountId)` calls
- **Severity:** MEDIUM

### KI-011: `/api/cases` and `/api/legal-signals/stats` are unauthenticated
- **File:** `server/routes.ts` lines 158-194
- **Description:** Case intelligence and legal pipeline stats endpoints have no auth guard.
- **Severity:** MEDIUM

---

## LOW

### KI-012: PromptDesignPanel HISTORY_KEY was global (FIXED)
- **File:** `client/src/components/dynamic-pages/PromptDesignPanel.tsx`
- **Status:** FIXED 2026-05-18 — key now namespaced as `apex-dp-prompt-history-acct{subAccountId}`
- **Description was:** Single global localStorage key meant all users on shared browsers saw each other's prompt history

### KI-013: `@ts-nocheck` on multiple route files
- **Files:** `server/routes/reviews.ts`, `server/routes/cards.ts`, `server/routes/sentinel.ts`
- **Description:** TypeScript checking is disabled on core route files, meaning type errors are not caught at compile time.
- **Fix Required:** Enable `@ts-check` incrementally, fix type errors
- **Severity:** LOW for now, HIGH for long-term maintainability

### KI-014: BullMQ queue has no Redis backend
- **File:** `server/jobQueue.ts`
- **Description:** BullMQ typically requires Redis for persistence. Current implementation may use in-memory mode. Queue jobs may be lost on restart.
- **Fix Required:** Verify Redis connection or document that jobs are ephemeral
- **Severity:** LOW (depends on implementation)
