# STAGE 2 AUTH VALIDATION REPORT
**Apex Marketing Automations — Post-Deploy Auth Health Check**
Generated: 2026-05-14
Status: PRE-DEPLOY (fill in post-deploy results after Railway confirms green)

---

## Auth System Inventory (Pre-Deploy Snapshot)

### Current Auth Mechanisms in Production

| Mechanism | Implementation | Status |
|-----------|---------------|--------|
| Session auth (Passport.js) | `replitAuth.ts` — `isAuthenticated` middleware | UNCHANGED |
| Google OAuth | `replitAuth.ts:100` | UNCHANGED |
| Email/password login | `auth.ts` | UNCHANGED |
| Admin env-var check | `ADMIN_USER_ID` === session user ID | UNCHANGED |
| Admin DB flag check | `users.is_admin === "true"` | UNCHANGED |
| Internal service auth | `x-admin-secret: STANDALONE_ADMIN_SECRET` | UNCHANGED |
| Tenant resolution | `middleware/tenant.ts` | UNCHANGED (Stage 1 bug fix still active) |

### Admin User State (Pre-Deploy)
| User | Email | is_admin | role | Admin Access |
|------|-------|----------|------|-------------|
| `google_11253...` | apexmarketingautomations@gmail.com | `"true"` | `member` | ✅ Full admin |
| `apex_1778...` | nfarage@yopmail.com | `"false"` | `member` | ❌ Standard user |

### What Stage 2 Changed for Auth
| Component | Before | After |
|-----------|--------|-------|
| `users` table | 10 columns | 11 columns (`role` added) |
| `users.role` | Not present | `VARCHAR(20) DEFAULT 'member'` |
| Admin detection logic | `is_admin + ADMIN_USER_ID + x-admin-secret` | **Unchanged — same logic** |
| Session structure | Passport session | **Unchanged** |
| `internalOnly` middleware | Not present | Created, NOT applied to existing routes |

---

## Validation Checklist

Run these checks immediately after Railway deploy confirms green on the Stage 2 commit.

### 1. Login Validation

```
[ ] Google OAuth login succeeds
    → Navigate to /auth/google → redirected → lands on dashboard → session cookie set
[ ] Email/password login succeeds (nfarage@yopmail.com)
    → POST /api/auth/login → 200 → session cookie set → contacts page loads
[ ] Login with invalid credentials returns 401 (not 500)
[ ] Login page still renders (not blank, not 500)
```

### 2. Session Validation

```
[ ] Session persists across page refresh (session cookie not cleared by deploy)
[ ] GET /api/auth/user returns current user with role field present
[ ] Session expiry works correctly (test with expired cookie)
[ ] No "session missing" in Railway logs after deploy
```

### 3. Admin Access Validation

```
[ ] Admin user (apexmarketingautomations@gmail.com) can access admin-only routes
    → GET /api/accounts → returns all 5 sub-accounts
    → GET /api/apex-intelligence/* → 200 (not 403)
[ ] Non-admin user (nfarage@yopmail.com) is blocked from admin routes
    → GET /api/accounts → returns only their own accounts
[ ] x-admin-secret header still grants internal access
    → POST /api/internal/retro-skip-trace with correct secret → 200
    → POST /api/internal/retro-skip-trace without secret → 401
```

### 4. Account Switching Validation

```
[ ] Admin user can switch between sub-accounts via X-Sub-Account-Id header
[ ] Non-admin user cannot access accounts they don't own
[ ] Default account fallback works when no header provided
[ ] APEX_PARENT_ACCOUNT_ID=3 fix still active (account 3 admin access works)
```

### 5. Sub-Account Visibility Validation

```
[ ] Admin sees all 5 sub-accounts
[ ] nfarage@yopmail.com sees only their assigned account
[ ] Tenant middleware correctly resolves sub-account from session
[ ] No tenant isolation regressions (account data from wrong tenant)
```

### 6. Pipeline Validation

```
[ ] Sentinel ingestion running
    → universal_events: crash_ingested events within last 30 min
[ ] Apex Intelligence brain running
    → universal_events: score_updated events within last 30 min
[ ] Apify integrations operational
    → GET /api/admin/transport/pull-status → 200 (not 500)
[ ] BatchData enrichment operational
    → New crash contacts still getting enrichment_provider: batchdata
[ ] Workflow scheduler running
    → universal_events: agent_task_completed events within last 30 min
```

### 7. Protected Internal Route Validation

```
[ ] POST /api/internal/retro-skip-trace
    → With correct x-admin-secret → 200
    → Without header → 401
    → With wrong secret → 401
[ ] POST /api/comment-bot/reengage
    → With correct ADMIN_API_SECRET or ADMIN_USER_ID → 200
    → Without header → 403
[ ] POST /api/admin/transport/pull
    → With admin session → 200
    → Without session → 403
```

### 8. Public Route Validation

```
[ ] GET /health → 200 (no auth required)
[ ] GET /api/auth/google → redirects (no auth required)
[ ] POST /api/public/forms/* → 200 (no auth required)
[ ] Analytics tracking pixel → 200 (no auth required)
```

### 9. Role Field Validation

```
[ ] GET /api/auth/user returns user object with role: "member"
[ ] No 500 errors caused by missing role field on join queries
[ ] No TypeScript runtime errors from undefined role field
[ ] DB: SELECT id, email, is_admin, role FROM users → shows role column
```

### 10. Log Pattern Search

Search Railway logs (both services) for these patterns immediately post-deploy:

```
Search: "unauthorized"              → Expected: 0 new occurrences beyond normal
Search: "forbidden"                 → Expected: 0 new occurrences
Search: "session missing"           → Expected: 0
Search: "role undefined"            → Expected: 0 (role column has NOT NULL default)
Search: "tenant mismatch"           → Expected: 0
Search: "blocked internal route"    → Expected: 0 (internalOnly not applied to existing routes)
Search: "auth serialization"        → Expected: 0
Search: "middleware recursion"      → Expected: 0
Search: "INTERNAL-ONLY] Denied"     → Expected: 0 in normal operation
```

---

## Post-Deploy DB Validation Queries

Run these via Neon MCP after Railway deploy completes:

```sql
-- Confirm role column exists with correct type
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'role';
-- Expected: role | character varying | 20 | NO | 'member'::character varying

-- Confirm all users have role populated
SELECT COUNT(*) FROM users WHERE role IS NULL;
-- Expected: 0

-- Confirm migration tracking row exists
SELECT name, applied_at FROM _data_migrations WHERE name = '2026-05-14-users-role-column';
-- Expected: 1 row

-- Confirm user state unchanged
SELECT id, email, is_admin, role FROM users ORDER BY id;
-- Expected: 2 rows, both role='member', admin user still is_admin='true'

-- Confirm universal_events pipeline health (last 30 min)
SELECT event_type, COUNT(*), MAX(created_at) as latest
FROM universal_events
WHERE created_at > NOW() - INTERVAL '30 minutes'
GROUP BY event_type
ORDER BY latest DESC;
-- Expected: score_updated, crash_ingested, agent.outcome visible
```

---

## Known Auth Limitations (Not Fixed in Stage 2)

| Limitation | Severity | Stage |
|-----------|----------|-------|
| `is_admin` stored as varchar "true"/"false" instead of boolean | LOW | Stage 3+ |
| No API key system for external service access | MEDIUM | Stage 4 |
| Dual-auth complexity (env var + DB flag + header + ownership) | MEDIUM | Stage 4 |
| 4 unprotected external webhook receivers | LOW | Stage 3 |
| No rate limiting on auth endpoints | MEDIUM | Stage 3+ |

---

## Rollback Decision Criteria

Rollback Stage 2 if ANY of these are true within 30 minutes of deploy:

| Trigger | Action |
|---------|--------|
| Admin cannot log in | Immediate rollback |
| Sessions not persisting after deploy | Immediate rollback |
| `universal_events` pipeline events stop | Investigate; rollback if confirmed Stage 2 caused it |
| 401/403 spike (>10 new occurrences in 10 min) | Investigate log context; rollback if caused by `role` field |
| `role undefined` errors in logs | Rollback |

**Rollback SQL:**
```sql
ALTER TABLE users DROP COLUMN IF EXISTS role;
DELETE FROM _data_migrations WHERE name = '2026-05-14-users-role-column';
```

---

## Stage 3 Readiness Gate

Stage 3 is OPEN when all of the following are true:

```
[ ] Railway deploy confirmed green on Stage 2 commit
[ ] All 10 validation checklists above pass
[ ] No auth-related errors in 30 min post-deploy observation window
[ ] DB validation queries return expected results
[ ] Sentinel ingestion confirmed running
[ ] Admin access confirmed working
[ ] Explicit approval from lead architect
```

**DO NOT PROCEED TO STAGE 3 AUTOMATICALLY.**
