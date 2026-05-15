# APEX PRODUCTION HARDENING REPORT
**Phase 10 of 11 — Security, Reliability, and Observability**
Generated: 2026-05-14
Status: ASSESSMENT DOCUMENT — Findings with remediation steps

---

## Hardening Score (Current State)

| Domain | Score | Status |
|--------|-------|--------|
| Authentication | 3/10 | Critical gaps |
| Authorization | 4/10 | APEX_PARENT_ACCOUNT_ID bug |
| Data isolation | 6/10 | Mostly correct, gap in dedup |
| Input validation | 5/10 | Zod on some routes, missing on others |
| Error handling | 3/10 | 24 silent catches, inconsistent format |
| Rate limiting | 5/10 | Global only, no per-account |
| Logging & observability | 2/10 | Minimal structured logging |
| Secrets management | 6/10 | Env vars correct, no rotation policy |
| Database security | 7/10 | SSL, connection pooling, no raw SQL injection found |
| Webhook security | 6/10 | Stripe signed, Twilio unverified |
| **Overall** | **4.7/10** | Not production-hardened |

---

## Critical Issues (Must Fix Before Any Production Traffic Increase)

### C1: Broken Admin Identity

**Finding:** `APEX_PARENT_ACCOUNT_ID = 13` in `server/middleware/tenant.ts`. Account 13 does not exist. The real admin is account 3. Every unauthenticated request resolves to a phantom account.

**Risk:** Admin functions silently fail. Cron jobs, webhooks, and internal routes operate on account 13 data that does not exist.

**Remediation:** Change constant to `3`. One line. Deploy immediately.

**Test:** After fix, log in as account 3 owner → verify `/api/admin/accounts` returns all accounts.

---

### C2: 24 Silent Catch Blocks

**Finding:** PR #15 annotated 24 `catch` blocks that silently swallow errors. These hide failures in production — pipelines appear healthy while actually failing.

**Risk:** Data pipeline failures are invisible. Legal lead routing failures, sentinel incident processing errors, enrichment failures — all silently dropped.

**Remediation:** Audit each of the 24 blocks. Each must either:
- `console.error(...)` with structured context (route, operation, error), or
- Re-throw if the caller is responsible for error handling, or
- Write to `agent_outcome_log` with `outcome_type = 'failure'`

**Locate all 24:**
```bash
grep -rn "ANNOTATED: silent" server/ --include="*.ts"
```

---

### C3: Missing Webhook Signature Verification (Twilio)

**Finding:** Stripe webhooks are verified with signature header (correct). Twilio callbacks (`/api/twilio/*`) have no signature verification.

**Risk:** Anyone who discovers the Twilio callback URL can forge incoming messages, call status updates, or recording notifications.

**Remediation:**
```typescript
import twilio from 'twilio';

function verifyTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const signature = req.headers['x-twilio-signature'] as string;
  const url = `${process.env.PUBLIC_URL}${req.originalUrl}`;
  
  const isValid = twilio.validateRequest(authToken, signature, url, req.body);
  if (!isValid) return res.status(403).json({ error: true, message: 'Invalid Twilio signature' });
  next();
}
```

Apply to all `app.post('/api/twilio/*', ...)` routes.

---

### C4: `is_admin` Stored as VARCHAR String

Documented in `APEX_ADMIN_ACCESS_AUDIT.md` — see Vulnerability 2 for full remediation. Critical because any `if (user.is_admin)` check evaluates `"false"` as truthy.

---

## High Priority Issues

### H1: No Request Tracing

**Finding:** No request ID is generated or propagated. Cannot correlate a frontend error report with a server log entry.

**Impact:** When a user reports "the legal leads page broke," there is no way to find the relevant server logs.

**Remediation:** Add request ID middleware (defined in `APEX_API_RESTRUCTURE_PLAN.md` — Fix 2).

---

### H2: No Structured Logging

**Finding:** Logging is `console.log()` with free-text strings. No JSON structure, no consistent fields.

**Impact:** Logs cannot be queried or alerted on. Cannot build dashboards from log data.

**Remediation:** Replace `console.log/error` with a structured logger:

```typescript
// server/lib/logger.ts
export const logger = {
  info: (msg: string, meta: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({ level: 'info', msg, ts: new Date().toISOString(), ...meta }));
  },
  error: (msg: string, meta: Record<string, unknown> = {}) => {
    console.error(JSON.stringify({ level: 'error', msg, ts: new Date().toISOString(), ...meta }));
  },
  warn: (msg: string, meta: Record<string, unknown> = {}) => {
    console.warn(JSON.stringify({ level: 'warn', msg, ts: new Date().toISOString(), ...meta }));
  }
};
```

Key fields to include in every log entry: `requestId`, `accountId`, `userId`, `route`, `durationMs`.

---

### H3: Subscription Table Is Empty

**Finding:** `SELECT COUNT(*) FROM subscriptions` returns 0. All accounts are on enterprise plan per `sub_accounts.plan_type` but no subscription records exist.

**Impact:** Billing enforcement is completely disabled. `featureGate` middleware reads `feature_flags` table (correct), but there is no subscription lifecycle check. Accounts cannot be downgraded, suspended, or have their card declined automatically.

**Remediation:**
1. Pull subscription data from Stripe Dashboard
2. Backfill `subscriptions` table with current Stripe subscription IDs
3. Add Stripe webhook handler for `customer.subscription.updated` to sync changes

---

### H4: Legal Attorney Table Is Empty

**Finding:** `SELECT COUNT(*) FROM legal_attorneys` returns 0. 19,312 legal leads have been generated with nowhere to route them.

**Impact:** The entire legal lead monetization loop is broken. Leads are generated and scored but never sold.

**Remediation:** This is a data/business problem, not just a code problem. Requires:
1. Onboarding real attorney buyers into the system
2. Configuring pricing per lead type per attorney
3. Setting up delivery webhooks or email notifications per attorney

---

### H5: 7,085 Sentinel Incidents Stuck at 'pending'

**Finding:** 99.9% of sentinel incidents never advance past 'pending' status. The ingest pipeline works (incidents are created) but the delivery/action pipeline is not connected.

**Impact:** Sentinel monitoring is producing alerts that no one sees. The value prop of Sentinel (automated monitoring) is effectively broken.

**Remediation:**
1. Identify the worker/cron responsible for processing pending incidents
2. If the worker exists but is disabled, re-enable it
3. If the worker doesn't exist, build the delivery pipeline: `pending → triage → notify → resolved/dismissed`
4. Implement `sentinel_actions` table to record delivery attempts

---

## Medium Priority Issues

### M1: Vapi and Twilio Accounts in Legacy Mode

**Finding:** Twilio accounts are not A2P 10DLC registered. Twilio is enforcing A2P requirements — unregistered SMS campaigns are being filtered or blocked.

**Impact:** SMS delivery rates may be severely degraded. High-volume outreach campaigns will fail.

**Remediation:**
1. Register brand with Twilio's Campaign Registry
2. Register use cases (legal notifications, appointment reminders, marketing)
3. Update `twilio_account_registry` with registration status

---

### M2: No Database Connection Pool Monitoring

**Finding:** `server/db.ts` uses `pg.Pool` with default settings. No monitoring of pool exhaustion.

**Impact:** Under load, all connections may be used — new requests will queue or fail with timeout errors.

**Remediation:**
```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,           // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  logger.error('Unexpected pool error', { err: err.message });
});
```

---

### M3: No Health Check Endpoint

**Finding:** No `/health` or `/api/health` endpoint exists. Load balancers and monitoring tools cannot verify the service is up.

**Remediation:**
```typescript
app.get('/health', async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});
```

---

### M4: Content Security Policy Not Configured

**Finding:** `helmet` is installed and used but CSP headers may not be configured for the app's specific CDN/font/analytics sources.

**Impact:** XSS vectors remain open if any third-party script injection occurs.

**Remediation:** Audit current helmet config in `server/index.ts` and add explicit CSP directives for all known sources (Google Fonts, Firebase, Stripe, Vapi, Meta Pixel).

---

## Environment Variable Audit

| Variable | Required | Status | Risk if Missing |
|----------|----------|--------|-----------------|
| `DATABASE_URL` | Yes | Set | Fatal — app won't start |
| `SESSION_SECRET` | Yes | Set | Fatal — sessions broken |
| `STRIPE_SECRET_KEY` | Yes | Set | Billing broken |
| `STRIPE_WEBHOOK_SECRET` | Yes | Check | Webhook forgery possible |
| `TWILIO_AUTH_TOKEN` | Yes | Set | Webhook forgery, SMS broken |
| `TWILIO_ACCOUNT_SID` | Yes | Set | SMS broken |
| `VAPI_API_KEY` | Yes | Set | Voice agents broken |
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Set | Firebase auth broken |
| `SENDGRID_API_KEY` | Yes | Set | Email broken |
| `OPENAI_API_KEY` | Yes | Set | AI features broken |
| `GOOGLE_CLIENT_ID` | Yes | Set | Google OAuth broken |
| `GOOGLE_CLIENT_SECRET` | Yes | Set | Google OAuth broken |
| `META_APP_ID` | Conditional | Check | Ads integration broken |
| `APEX_MCP_API_KEY` | No (new) | Missing | MCP tool layer blocked |

**Secrets rotation policy:** No policy exists. Recommend 90-day rotation for all API keys and a 1-year rotation for signing secrets.

---

## Hardening Roadmap

### Week 1 (Critical)
- [ ] Fix `APEX_PARENT_ACCOUNT_ID = 13` → `3`
- [ ] Fix all 24 silent catch blocks
- [ ] Add Twilio webhook signature verification
- [ ] Add `/health` endpoint
- [ ] Fix session cookie config (httpOnly, secure, sameSite)

### Week 2 (High)
- [ ] Add request ID middleware
- [ ] Add structured JSON logging
- [ ] Add `role` column to users, backfill, update all admin checks
- [ ] Backfill `subscriptions` table from Stripe

### Week 3 (Medium)
- [ ] Configure DB connection pool limits and error monitoring
- [ ] Audit and configure Content Security Policy
- [ ] Add per-account rate limiting
- [ ] Create `api_keys` table and middleware

### Month 2 (Ongoing)
- [ ] Establish secrets rotation policy and schedule
- [ ] Register Twilio A2P brand and campaigns
- [ ] Implement Sentinel delivery pipeline (close the 7,085 pending incidents)
- [ ] Seed `legal_attorneys` table and test lead routing end-to-end

---

*Document complete. Next: `docs/APEX_ROLLBACK_PLAN.md`*
