# APEX Next Steps — Prioritized Roadmap
**Date:** 2026-05-18

---

## P0 — Launch Blockers (must fix before prod launch)

### 1. Dynamic Pages DB Persistence (KI-001)
**PR:** Create `dynamic_page_schemas` Drizzle table + migrate `schemaStore` to DB  
**Files:** `shared/schema.ts`, `server/routes/dynamicPages.ts`, `server/storage.ts`  
**Effort:** 2-3 hours  
**Risk:** Low if done carefully with Drizzle migration

### 2. reputation.tsx use real account ID (KI-002)
**PR:** Replace `const SUB_ACCOUNT_ID = 1` with `useAccount().activeAccountId`  
**Files:** `client/src/pages/reputation.tsx`  
**Effort:** 30 min

### 3. domains.tsx remove hardcoded fallback (KI-003)
**PR:** Remove `|| 13` fallback, add empty state when no account selected  
**Files:** `client/src/pages/domains.tsx`  
**Effort:** 30 min

---

## P1 — Security Hardening (fix before public beta)

### 4. Dynamic Pages subAccountId ownership verification (KI-010)
Add `verifyAccountOwnership` to generate/patch/save/publish endpoints  
**Files:** `server/routes/dynamicPages.ts`  
**Effort:** 1 hour

### 5. Remove STANDALONE_ADMIN_SECRET hardcoded fallback (KI-005)
Fail loudly if env var not set rather than defaulting to a known value  
**Files:** `server/routes/sentinel.ts`  
**Effort:** 30 min

### 6. Auth-guard `/api/legal/attorneys` (KI-006)
Add session check or isPlatformAdmin guard  
**Files:** `server/routes/sentinel.ts`  
**Effort:** 15 min

### 7. Auth-guard `/api/sentinel/pipeline-status` (KI-007)
Add admin-secret guard  
**Files:** `server/routes/sentinel.ts`  
**Effort:** 15 min

### 8. Auth-guard `/api/cases` and `/api/legal-signals/stats` (KI-011)
Add session checks  
**Files:** `server/routes.ts`  
**Effort:** 30 min

### 9. `is_admin` varchar → boolean migration (KI-004)
DB column migration + update all comparison code  
**Files:** `shared/models/auth.ts`, `server/auth/authorization.ts`, all callers  
**Effort:** 2 hours

---

## P2 — Cost Control & AI Routing

### 10. Task-complexity-based AI routing (KI-009 / APEX_COST_CONTROL.md)
Route simple prompts → Groq, complex → Anthropic  
**Files:** `server/aiGateway.ts`, `server/services/aiPromptToPageSchema.ts`  
**Design:** See APEX_COST_CONTROL.md for routing rules

### 11. Per-account daily AI quota enforcement
Track daily token usage per subAccountId, enforce budget caps  
**Files:** `server/ai/` registry + new quota table

### 12. Local prompt patch engine on server
Replicate `applyLocalPromptPatch` logic server-side to avoid AI calls for simple edits  
**Files:** `server/services/localPromptPatcher.ts` (new)

---

## P3 — Feature Completion

### 13. API key authentication system (KI-008)
New `api_keys` table + auth middleware for programmatic access  
**Files:** `shared/schema.ts`, `server/middleware/apiKeyAuth.ts` (new)

### 14. Enable TypeScript on @ts-nocheck route files (KI-013)
Incrementally fix types in reviews.ts, cards.ts, sentinel.ts  
**Files:** Multiple route files

### 15. Email campaigns template system
Complete the template builder and campaign scheduling  
**Files:** `client/src/pages/email-campaigns.tsx`, `server/routes/messagingEmail.ts`

### 16. Google Ads integration
Currently stubbed. Wire up Google Ads API  
**Files:** New route + client page

### 17. BullMQ Redis persistence (KI-014)
Verify or add Redis connection for durable job queues  
**Files:** `server/jobQueue.ts`

---

## Recommended PR Sequence

```
PR #33: Fix reputation.tsx + domains.tsx hardcoded IDs (P0, 1 hour)
PR #34: Dynamic Pages DB persistence (P0, 3 hours)
PR #35: Security hardening — auth guards (P1 items 4-8, 2 hours)
PR #36: is_admin boolean migration (P1 item 9, 2 hours)
PR #37: AI cost control routing (P2 items 10-12, 4 hours)
PR #38: API key authentication system (P3 item 13, 6 hours)
```
