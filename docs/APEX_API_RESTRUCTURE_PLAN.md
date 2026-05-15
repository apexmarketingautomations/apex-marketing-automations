# APEX API RESTRUCTURE PLAN
**Phase 6 of 11 — Server Routes, Middleware, and API Layer**
Generated: 2026-05-14
Status: PLAN DOCUMENT — No server files modified

---

## Current State

- **Framework:** Express 5 (using `app.use()` with async error handling)
- **Route files:** 64 route modules registered in `server/routes.ts`
- **Auth middleware:** Passport.js (local + Google OAuth) + Firebase JWT fallback
- **Tenant middleware:** `server/middleware/tenant.ts` — **BROKEN** (account 13 bug)
- **Feature gates:** `server/middleware/featureGate.ts` — defaults OFF on error
- **Request volume:** Unknown (no APM in place)

### Current Problems

1. **`APEX_PARENT_ACCOUNT_ID = 13` bug** — every unauthenticated request defaults to non-existent account 13. Admin detection broken for the real account 3 owner.
2. **No API versioning.** All routes are under `/api/*` with no version prefix. Breaking changes require simultaneous client deploys.
3. **No rate limiting per account.** Global rate limiting exists via `express-rate-limit` but no per-account throttle.
4. **No request ID tracing.** Cannot correlate a frontend error with a server log entry.
5. **Route registration is sequential.** 64 route files loaded synchronously in `server/routes.ts` — slow startup and hard to audit.
6. **Inconsistent error format.** Some routes return `{ error: string }`, others return `{ message: string }`, others return Express default HTML errors.
7. **No API contract.** No OpenAPI/Swagger spec exists. Client and server are coupled by convention.
8. **Silent catch blocks.** 24 annotated silent catch blocks (from lint fix PR #15) hide errors.

---

## Target API Architecture

```
Client Request
     │
     ▼
[Request ID Middleware]      — attaches x-request-id to every request
     │
     ▼
[Security Middleware]        — helmet, CORS, CSP headers
     │
     ▼
[Rate Limiter]               — global + per-account tiers
     │
     ▼
[Auth Middleware]            — Firebase JWT → Passport → anonymous
     │
     ▼
[Tenant Resolver]            — resolves account_id from auth (FIXED: uses account 3)
     │
     ▼
[Feature Gate]               — checks feature_flags for route
     │
     ▼
[Route Handler]              — business logic
     │
     ▼
[Error Handler]              — unified error format
     │
     ▼
[Response]                   — standard envelope
```

---

## Immediate Fixes (No Restructure Required)

### Fix 1: `APEX_PARENT_ACCOUNT_ID`

**File:** `server/middleware/tenant.ts`
```typescript
// Line to change:
const APEX_PARENT_ACCOUNT_ID = 13;
// → 
const APEX_PARENT_ACCOUNT_ID = 3;
```

This is the highest-priority change in the entire codebase. Deploy this first.

### Fix 2: Request ID Middleware

Add at the top of `server/index.ts` before all other middleware:

```typescript
import { randomUUID } from 'crypto';

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});
```

### Fix 3: Unified Error Format

Add a global error handler at the bottom of `server/index.ts`:

```typescript
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const requestId = req.requestId;
  
  if (status >= 500) {
    console.error({ requestId, path: req.path, err });
  }
  
  res.status(status).json({
    error: true,
    message,
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
```

### Fix 4: Silent Catch Block Audit

24 `catch` blocks were annotated in PR #15 but not fixed. Each must be changed from:
```typescript
} catch (err) {
  // ANNOTATED: silent catch
}
```
To one of:
```typescript
} catch (err) {
  console.error('[module-name] operation failed:', err);
  // or throw if the caller should handle it
}
```

---

## Route Organization Target

### Current (flat, 64 files):
```
server/routes/contacts.ts
server/routes/conversations.ts
server/routes/workflows.ts
... (61 more)
```

### Target (grouped by domain):
```
server/routes/
├── index.ts              (registers all groups)
├── core/
│   ├── auth.ts           (login, logout, OAuth)
│   ├── accounts.ts       (account CRUD)
│   └── users.ts          (user management)
├── crm/
│   ├── contacts.ts
│   ├── conversations.ts
│   └── pipeline.ts
├── signals/
│   ├── legal.ts
│   ├── home-service.ts
│   ├── sentinel.ts
│   └── arrest.ts
├── automate/
│   ├── workflows.ts
│   ├── agents.ts
│   └── automations.ts
├── grow/
│   ├── websites.ts
│   ├── funnels.ts
│   ├── forms.ts
│   ├── ads.ts
│   └── content.ts
├── deliver/
│   ├── distribution.ts
│   └── cards.ts
├── billing/
│   ├── subscriptions.ts
│   └── stripe-webhook.ts
├── ai/
│   ├── chat.ts
│   ├── intelligence.ts
│   └── recommendations.ts
└── admin/
    ├── accounts.ts
    ├── feature-flags.ts
    └── pipeline-monitor.ts
```

**Migration path:** This is a rename/move operation with no logic changes. Move files one group at a time. Update imports. Verify with `npm run check`.

---

## API Versioning Strategy

Current: `/api/contacts` (no version)
Target: `/api/v1/contacts` (versioned) with legacy redirect

```typescript
// Redirect legacy routes transparently:
app.use('/api/contacts', (req, res) => {
  res.redirect(307, `/api/v1/contacts${req.path}`);
});

// All new code under versioned prefix:
app.use('/api/v1', v1Router);
```

**Rollout:** Add `/api/v1/*` routes in parallel with existing routes. Update client to use versioned URLs. Remove legacy routes after 30-day migration window.

---

## Per-Account Rate Limiting

Current: Global rate limit only
Target: Tiered rate limits by plan

```typescript
const planLimits = {
  starter:    { windowMs: 60_000, max: 100 },
  pro:        { windowMs: 60_000, max: 500 },
  enterprise: { windowMs: 60_000, max: 2000 },
};

function accountRateLimiter(req: Request, res: Response, next: NextFunction) {
  const tier = req.account?.planTier ?? 'starter';
  const { windowMs, max } = planLimits[tier] ?? planLimits.starter;
  // Apply rate limit using account.id as key
  return rateLimit({ windowMs, max, keyGenerator: () => String(req.account?.id) })(req, res, next);
}
```

---

## Standard Response Envelope

All API routes must return this shape:

**Success:**
```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO8601"
  }
}
```

**Error:**
```json
{
  "error": true,
  "message": "Human-readable message",
  "code": "MACHINE_ERROR_CODE",
  "requestId": "uuid"
}
```

**Paginated list:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "hasMore": true
  },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" }
}
```

---

## Implementation Sequence

### Week 1 (Critical fixes, zero restructure)
1. Fix `APEX_PARENT_ACCOUNT_ID = 13` → `3`
2. Add request ID middleware
3. Add unified error handler
4. Fix 24 silent catch blocks

### Week 2 (Observability)
5. Add per-account rate limiter
6. Add structured request logging (include account_id, route, duration, status)
7. Wire `agent_outcome_log` table to pipeline workers

### Week 3 (Route grouping)
8. Create domain group directories
9. Move files one group at a time with `npm run check` after each move
10. Update `server/routes.ts` import list

### Week 4 (Versioning)
11. Add `/api/v1/` prefix to all routes
12. Add legacy redirect middleware
13. Update frontend API calls to use versioned URLs

---

*Document complete. Next: `docs/APEX_MCP_TOOL_LAYER.md` (Phase 8)*
