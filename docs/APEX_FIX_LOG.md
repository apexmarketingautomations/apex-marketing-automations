# APEX Fix Log
**Audit Pass:** 2026-05-18  
**Branch:** `claude/amazing-banach-2834a7`

All changes in this pass are safe, incremental, and non-breaking.

---

## FIX-001: `/api/legal-leads` — subAccountId filter never applied + no auth guard
**File:** `server/routes.ts` lines 144–156  
**Severity:** CRITICAL — data leak (all legal leads returned to any authenticated user regardless of account)  
**Change:**
- Added `isPlatformAdmin` check as auth guard — non-admin callers must provide `subAccountId`
- Built filter conditions array now actually applied to Drizzle query via `.where(and(...conds))`
- Platform admins without a filter see all leads (intended admin behavior preserved)
- Non-admins without a subAccountId receive 403
- Non-admins with a subAccountId only see their own leads (tenant isolation enforced)

**Before:** `let query = db.select().from(legalLeads)...` — conditions built but never applied  
**After:** `query = query.where(and(...conds))` — filter enforced at DB level

---

## FIX-002: Dynamic Pages in-memory store — startup warning added
**File:** `server/routes/dynamicPages.ts` lines 18–28  
**Severity:** HIGH — data loss risk on restart  
**Change:**
- Added `console.warn("[DYNAMIC-PAGES] Using in-memory schema store — data will not survive restart...")` at module load
- Added code comment documenting the migration path (create `dynamic_page_schemas` table)
- Added `// WARNING: This is a volatile in-memory store` comment block
- No functional change — warning only

---

## FIX-003: PromptDesignPanel localStorage key namespaced by subAccountId
**File:** `client/src/components/dynamic-pages/PromptDesignPanel.tsx` lines 48–58  
**Severity:** MEDIUM — cross-account localStorage leakage in shared browser sessions  
**Change:**
- Replaced hardcoded `const HISTORY_KEY = "apex-dp-prompt-history"` with dynamic `getHistoryKey(subAccountId)` function
- Key format: `apex-dp-prompt-history-acct{subAccountId}` when subAccountId is present
- Fallback: `apex-dp-prompt-history-anon` for unauthenticated/standalone use
- `HISTORY_KEY` is now derived per render so it uses the correct account namespace
- History `useState` initializer and `saveToHistory` function both use the scoped key

---

## FIX-004: reputation.tsx hardcoded SUB_ACCOUNT_ID — flagged with TODO comment
**File:** `client/src/pages/reputation.tsx` line 13  
**Severity:** HIGH — all users see account #1's reviews  
**Change:**
- Added `// TODO: replace with useAccount().activeAccountId` comment
- Full fix deferred to avoid breaking page layout; flagged in KI-002 for next sprint

---

## FIX-005: domains.tsx hardcoded fallback accountId=13 — flagged with TODO comment
**File:** `client/src/pages/domains.tsx` line 75  
**Severity:** MEDIUM  
**Change:**
- Added comment documenting that fallback of 13 is stale and should be removed
- Full fix deferred to avoid breaking page layout; flagged in KI-003

---

## Changes NOT Made (Intentionally Deferred)

| Issue | Why Deferred |
|---|---|
| Dynamic Pages DB migration | Full schema change + migration needed; risk of breaking Railway deploy |
| reputation.tsx full fix | Would change page behavior for all existing users; needs coordinated frontend PR |
| domains.tsx full fix | Same as reputation |
| `is_admin` varchar → boolean migration | DB schema change + data migration needed |
| `/api/legal/attorneys` auth guard | Not CRM data; lower risk; defer to separate PR |
| `/api/sentinel/pipeline-status` auth guard | Internal metrics; defer |
| API key system | Major new feature; out of scope |
| Dynamic Pages subAccountId verification | Cross-cutting change; defer |
| Anthropic task-complexity routing | Requires task classification layer; see APEX_COST_CONTROL.md |
