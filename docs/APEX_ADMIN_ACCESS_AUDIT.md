# APEX ADMIN ACCESS AUDIT
**Phase 9 of 11 — Authentication, Authorization, and Access Control**
Generated: 2026-05-14
Status: AUDIT DOCUMENT — No changes executed

---

## Executive Summary

The current access control system has **four critical vulnerabilities** that must be resolved before any multi-tenant production hardening can be considered complete:

| # | Vulnerability | Severity | Fix Complexity |
|---|---------------|----------|----------------|
| 1 | `APEX_PARENT_ACCOUNT_ID = 13` (should be 3) | CRITICAL | Low (1 line) |
| 2 | `is_admin` stored as varchar, not boolean | HIGH | Medium (migration) |
| 3 | No API key system — auth is session-only | HIGH | Medium (new table) |
| 4 | Firebase + Passport dual-auth with no canonical path | MEDIUM | High (refactor) |

---

## Current Auth Stack

```
Request arrives
    │
    ├─ Has session cookie?
    │   └─ Yes → Passport.js deserializes user from session → req.user set
    │
    ├─ Has Firebase JWT in Authorization header?
    │   └─ Yes → Firebase Admin SDK verifies → user looked up in DB → req.user set
    │
    ├─ Has Google OAuth token? (OAuth2 flow)
    │   └─ Yes → passport-google-oauth20 → user upserted → session created
    │
    └─ None → req.user = undefined
         │
         └─ Tenant middleware runs: DEFAULT_ACCOUNT_ID = 13 (BROKEN)
```

---

## Vulnerability 1: APEX_PARENT_ACCOUNT_ID = 13

**File:** `server/middleware/tenant.ts`

**Impact:**
- `isApexParent()` checks if the current account's `ownerUserId` matches account 13's `ownerUserId`
- Account 13 does not exist — `ownerUserId` is null
- The account 3 owner is never recognized as the Apex parent/admin
- Every unauthenticated request (health checks, webhooks, cron callbacks) is resolved to account 13
- Any route that falls through to `DEFAULT_ACCOUNT_ID` is operating on a phantom account

**Fix:**
```typescript
// server/middleware/tenant.ts
const APEX_PARENT_ACCOUNT_ID = 3;  // was 13 — account 13 does not exist
```

**Verification after fix:**
```sql
-- Confirm account 3 exists and has an owner:
SELECT id, name, owner_user_id FROM sub_accounts WHERE id = 3;
-- Expected: 1 row with non-null owner_user_id

-- Confirm account 13 does not exist:
SELECT id FROM sub_accounts WHERE id = 13;
-- Expected: 0 rows
```

---

## Vulnerability 2: `is_admin` as VARCHAR

**File:** `shared/models/auth.ts` → `shared/schema.ts` (users table)

**Impact:**
- `user.is_admin` is the string `"true"` or `"false"` — not a boolean
- Any code doing `if (user.is_admin)` evaluates `"false"` as truthy (non-empty string = true in JS)
- Any code doing `if (user.is_admin === true)` evaluates false for all users (string ≠ boolean)
- The correct check is `user.is_admin === 'true'` — but this is scattered inconsistently across 129 pages

**Current access checks found in the codebase:**
- `user?.is_admin === 'true'` — correct string comparison
- `user?.isAdmin === true` — camelCase, wrong type (Drizzle inference returns string)
- `user.role === 'admin'` — depends on the new `role` column being present

**Fix: Two-step migration**

Step 1 (add column, safe to deploy immediately):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'member';
UPDATE users SET role = 'admin' WHERE is_admin = 'true';
UPDATE users SET role = 'member' WHERE is_admin != 'true' OR is_admin IS NULL;
```

Step 2 (update all code to use `role`):
- All admin checks should use: `user.role === 'admin' || user.role === 'owner'`
- Keep `is_admin` column — do not drop it (backward compat for any external integrations)
- Add to `schema.ts`: `role: varchar("role").default("member")`

**Standardized admin check function (add to `server/lib/auth-helpers.ts`):**
```typescript
export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'owner' || user.is_admin === 'true';
}

export function isOwner(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'owner';
}
```

---

## Vulnerability 3: No API Key System

**Impact:**
- Webhooks (Stripe, Twilio, Vapi) authenticate via shared secrets in env vars — no per-account isolation
- Cron jobs run with no auth — any server process can call internal routes
- No way to grant third-party tools (Claude MCP, Zapier) scoped access without sharing session cookies
- Cannot revoke access to a specific integration without rotating all secrets

**Fix:** Create the `api_keys` table (defined in APEX_POSTGRES_BRAIN_SCHEMA.md) and add an API key middleware:

```typescript
// server/middleware/apiKey.ts
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-api-key'] as string | undefined;
  if (!header) return next(); // fall through to session/JWT auth
  
  const prefix = header.substring(0, 8);
  const hash = crypto.createHash('sha256').update(header).digest('hex');
  
  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyPrefix, prefix),
      eq(apiKeys.keyHash, hash),
      isNull(apiKeys.revokedAt),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
    )
  });
  
  if (!key) return res.status(401).json({ error: true, message: 'Invalid API key' });
  
  // Update last used
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  
  // Resolve user and account
  req.apiKeyId = key.id;
  req.user = await db.query.users.findFirst({ where: eq(users.id, key.userId!) });
  req.accountId = key.accountId;
  next();
}
```

---

## Vulnerability 4: Firebase + Passport Dual-Auth

**Impact:**
- Two different user identity systems — Firebase UID vs Passport session user ID
- No canonical path for "is this request authenticated" — middleware checks multiple paths
- Firebase token expiry is not handled consistently (expired tokens may still pass if session is valid)
- Google OAuth via Passport creates a different session than Google sign-in via Firebase

**Current flow complexity:**
```
Mobile app → Firebase JWT → server verifies → looks up user by firebase_uid
Web app → Google OAuth via Passport → session cookie → user by session
API client → Session cookie → user by session
Twilio webhook → No auth (relies on URL secrecy)
Stripe webhook → Stripe signature header (correct)
```

**Target (consolidate to one canonical check):**
```typescript
// Canonical auth resolution order:
// 1. x-api-key header → API key auth
// 2. Authorization: Bearer → Firebase JWT
// 3. Session cookie → Passport session
// 4. None → anonymous (account defaults to APEX_PARENT_ACCOUNT_ID = 3)
```

**Fix timeline:** This is a HIGH effort refactor. Do NOT do this before the other 3 fixes. Address in Phase 2 of hardening after the platform is stable.

---

## Admin Route Inventory

All routes that require admin access (currently enforced inconsistently):

| Route | File | Current Guard | Required Guard |
|-------|------|--------------|----------------|
| `GET /api/admin/accounts` | `admin.ts` | `is_admin = 'true'` | isAdmin() + isApexParent() |
| `GET /api/admin/users` | `admin.ts` | `is_admin = 'true'` | isAdmin() + isApexParent() |
| `POST /api/feature-flags` | `feature-flags.ts` | `is_admin = 'true'` | isAdmin() |
| `GET /api/admin/pipelines` | `pipelines.ts` | missing | isAdmin() + isApexParent() |
| `DELETE /api/contacts/:id` | `contacts.ts` | account ownership | account ownership OR isAdmin() |
| `POST /api/internal/retro-skip-trace` | `routes.ts` | none (internal path) | IP allowlist + API key |

**Immediate hardening for internal routes:**

```typescript
// server/middleware/internalOnly.ts
const ALLOWED_INTERNAL_IPS = ['127.0.0.1', '::1'];

export function internalOnly(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!ALLOWED_INTERNAL_IPS.includes(ip)) {
    return res.status(403).json({ error: true, message: 'Forbidden' });
  }
  next();
}
```

Apply to:
- `POST /api/internal/retro-skip-trace`
- Any other `/api/internal/*` routes

---

## Session Security Audit

**Current session config:**
- Store: `connect-pg-simple` (sessions in `sessions` table) — correct
- Secret: from `SESSION_SECRET` env var — correct
- Cookie: need to verify `httpOnly`, `secure`, `sameSite` settings

**Required cookie config for production:**
```typescript
app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  store: pgStore,
  cookie: {
    httpOnly: true,        // prevent JS access
    secure: true,          // HTTPS only
    sameSite: 'lax',       // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
}));
```

**Check current config in `server/index.ts` against these values.**

---

## Multi-Tenant Data Isolation Audit

**Confirmed isolation mechanisms:**
- Every DB query includes `WHERE account_id = req.accountId` (via Drizzle)
- `server/middleware/tenant.ts` sets `req.accountId` from auth
- `server/middleware/protectedAccount.ts` prevents cross-account access on protected sub-accounts

**Known isolation gaps:**
- Account 13 bug means unauthenticated requests may resolve to wrong account
- Internal routes (`/api/internal/*`) have no account context — they operate globally
- Shared `contacts` records that appear in multiple accounts (dedup gap) can leak if `account_id` filter is skipped

**Audit query (run periodically):**
```sql
-- Check for contacts with multiple account associations:
SELECT global_dedup_hash, COUNT(DISTINCT account_id) as account_count
FROM contacts
WHERE global_dedup_hash IS NOT NULL
GROUP BY global_dedup_hash
HAVING COUNT(DISTINCT account_id) > 1;
```

---

## Access Control Priority Roadmap

| Priority | Action | Owner | Timeline |
|----------|--------|-------|----------|
| P0 | Fix APEX_PARENT_ACCOUNT_ID = 13 → 3 | Dev | Day 1 |
| P0 | Add `role` column to users, backfill | Dev | Day 1 |
| P1 | Replace all `is_admin === 'true'` checks with `isAdmin()` helper | Dev | Week 1 |
| P1 | Add `internalOnly` middleware to internal routes | Dev | Week 1 |
| P2 | Create `api_keys` table and middleware | Dev | Week 2 |
| P2 | Fix session cookie config (`secure: true`, `sameSite: 'lax'`) | Dev | Week 1 |
| P3 | Consolidate Firebase + Passport auth into single path | Dev | Month 2 |
| P3 | Implement API key rotation UI in admin settings | Dev | Month 2 |

---

*Document complete. Next: `docs/APEX_PRODUCTION_HARDENING_REPORT.md` (Phase 10)*
