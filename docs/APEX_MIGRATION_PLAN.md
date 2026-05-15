# APEX MIGRATION PLAN
**Phase 4 of 11 — Zero-Destruction Migration Strategy**
Generated: 2026-05-14
Status: PLAN DOCUMENT — No changes executed

---

## Governing Rules

1. **No table drops.** Every existing table survives unless explicitly marked for archive after a 90-day holdover period.
2. **No data destruction.** All migrations are additive (ADD COLUMN, CREATE TABLE) or non-destructive updates (backfills on nullable columns with IF NOT EXISTS guards).
3. **No flag day.** Every migration is independently deployable. Code changes ship with feature flags gated OFF, columns are added before code reads them.
4. **Production data is the ground truth.** Schema.ts may say one thing; the live Neon DB is the authoritative state. All migrations run against live DB via `drizzle-kit push` or direct SQL.
5. **Rollback is defined before execution.** Every migration step in this document has a corresponding rollback SQL.

---

## Current State Summary

| Area | State |
|------|-------|
| Neon Postgres | PG17, `patient-surf-58659251`, aws-us-east-1, 193MB |
| Schema management | Drizzle ORM, `shared/schema.ts` (3,468 lines) |
| Live tables | ~150 in `public` schema + full `stripe.*` schema |
| Pending columns | 14 on `contacts` table (in schema.ts, not in DB) |
| Critical code bug | `APEX_PARENT_ACCOUNT_ID = 13` (should be 3) |
| Broken data | `legal_attorneys` = 0 rows, `subscriptions` = 0 rows |
| Duplicated data | 395 contacts across 3 accounts (no dedup key) |
| Stuck data | 7,085 sentinel incidents at 'pending' |

---

## Migration Stages

```
Stage 1: Schema Drift Fix (contacts columns)
Stage 2: Auth & Admin Extensions
Stage 3: Code Bug Fix (APEX_PARENT_ACCOUNT_ID)
Stage 4: New Operational Tables
Stage 5: AI/Intelligence Tables
Stage 6: Data Backfills
Stage 7: Legacy Cleanup (90-day holdover)
```

---

## Stage 1 — Schema Drift Fix

**Purpose:** Deploy 14 columns that exist in `schema.ts` but not in the live DB. Any code reading these columns currently crashes silently.

**Risk:** Zero. All columns are nullable with no default. Existing rows are unaffected.

**Execute via Drizzle:**
```bash
npm run db:push
```

This is the correct method — it reads `shared/schema.ts` and generates the diff. The 14 columns will be added automatically.

**Manual SQL equivalent (for verification):**
```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS identity_status           varchar(50),
  ADD COLUMN IF NOT EXISTS skip_trace_status         varchar(50),
  ADD COLUMN IF NOT EXISTS enrichment_provider       varchar(100),
  ADD COLUMN IF NOT EXISTS enrichment_attempted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_confidence     numeric(5,2),
  ADD COLUMN IF NOT EXISTS source_external_id        varchar(255),
  ADD COLUMN IF NOT EXISTS raw_source_type           varchar(100),
  ADD COLUMN IF NOT EXISTS lead_vertical             varchar(100),
  ADD COLUMN IF NOT EXISTS lead_subtype              varchar(100),
  ADD COLUMN IF NOT EXISTS normalized_phone          varchar(20),
  ADD COLUMN IF NOT EXISTS normalized_email          varchar(255),
  ADD COLUMN IF NOT EXISTS county                    varchar(100),
  ADD COLUMN IF NOT EXISTS contact_quality_score     numeric(5,2);
```

**Rollback:**
```sql
ALTER TABLE contacts
  DROP COLUMN IF EXISTS identity_status,
  DROP COLUMN IF EXISTS skip_trace_status,
  DROP COLUMN IF EXISTS enrichment_provider,
  DROP COLUMN IF EXISTS enrichment_attempted_at,
  DROP COLUMN IF EXISTS enrichment_completed_at,
  DROP COLUMN IF EXISTS enrichment_confidence,
  DROP COLUMN IF EXISTS source_external_id,
  DROP COLUMN IF EXISTS raw_source_type,
  DROP COLUMN IF EXISTS lead_vertical,
  DROP COLUMN IF EXISTS lead_subtype,
  DROP COLUMN IF EXISTS normalized_phone,
  DROP COLUMN IF EXISTS normalized_email,
  DROP COLUMN IF EXISTS county,
  DROP COLUMN IF EXISTS contact_quality_score;
```

**Verification:**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'contacts' 
AND column_name IN ('identity_status', 'skip_trace_status', 'enrichment_provider', 'county')
ORDER BY column_name;
-- Expected: 4 rows
```

**Dedup columns (additive, same stage):**
```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS global_dedup_hash varchar(64),
  ADD COLUMN IF NOT EXISTS canonical_contact_id integer REFERENCES contacts(id);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_dedup_hash_account_idx
  ON contacts (global_dedup_hash, account_id)
  WHERE global_dedup_hash IS NOT NULL;
```

---

## Stage 2 — Auth & Admin Extensions

**Purpose:** Add `role` column to `users`. Add `legacy_aliases` to `plans`. Both are additive.

**Execute:**
```sql
-- users.role
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'member';

-- Backfill from is_admin (safe: is_admin stays, role is derived)
UPDATE users SET role = 'admin' WHERE is_admin = 'true';
UPDATE users SET role = 'owner' 
  WHERE id IN (SELECT owner_user_id FROM sub_accounts WHERE id = 3);
UPDATE users SET role = 'member' WHERE role IS NULL OR role = '';

-- plans.legacy_aliases
ALTER TABLE plans ADD COLUMN IF NOT EXISTS legacy_aliases text[] DEFAULT '{}';
UPDATE plans SET legacy_aliases = ARRAY['agency_pro'] WHERE name = 'pro';
UPDATE plans SET legacy_aliases = ARRAY['god_mode'] WHERE name = 'enterprise';
```

**Verification:**
```sql
SELECT id, email, is_admin, role FROM users ORDER BY created_at;
SELECT name, legacy_aliases FROM plans WHERE legacy_aliases != '{}';
```

**Rollback:**
```sql
ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE plans DROP COLUMN IF EXISTS legacy_aliases;
```

---

## Stage 3 — Critical Code Bug Fix

**Purpose:** Fix `APEX_PARENT_ACCOUNT_ID = 13` → `3` in `server/middleware/tenant.ts`.

This is a code change, not a DB migration. It is Stage 3 because Stages 1 and 2 must be deployed first (the role backfill in Stage 2 requires knowing which account is the parent).

**File to change:**
```
server/middleware/tenant.ts
```

**Change:**
```typescript
// BEFORE (broken):
const APEX_PARENT_ACCOUNT_ID = 13;

// AFTER (correct):
const APEX_PARENT_ACCOUNT_ID = 3;
```

**Verification after deploy:**
1. Log in as the account 3 owner
2. Confirm `isApexParent()` returns true
3. Confirm admin routes are accessible
4. Confirm unauthenticated requests do not resolve to a dead account

**Rollback:** Revert the constant to 13 (restores previous broken behavior — but doesn't make things worse than current state).

---

## Stage 4 — New Operational Tables

**Purpose:** Create the 22 new tables defined in `APEX_POSTGRES_BRAIN_SCHEMA.md`. All are additive — no existing tables are touched.

**Order of execution (dependency-sorted):**

```sql
-- Group A: No foreign keys to new tables
CREATE TABLE IF NOT EXISTS admin_audit_log (...);           -- Auth/Admin
CREATE TABLE IF NOT EXISTS api_keys (...);                  -- Auth/Admin
CREATE TABLE IF NOT EXISTS account_tier_history (...);      -- Core SaaS
CREATE TABLE IF NOT EXISTS agent_outcome_log (...);         -- Platform Ops
CREATE TABLE IF NOT EXISTS enrichment_provider_log (...);   -- Enrichment
CREATE TABLE IF NOT EXISTS twilio_account_registry (...);   -- Messaging

-- Group B: Reference existing tables
CREATE TABLE IF NOT EXISTS contact_ai_profiles (...);       -- CRM
CREATE TABLE IF NOT EXISTS contact_merge_log (...);         -- CRM
CREATE TABLE IF NOT EXISTS message_delivery_log (...);      -- Messaging
CREATE TABLE IF NOT EXISTS workflow_ai_suggestions (...);   -- Workflows
CREATE TABLE IF NOT EXISTS agent_performance_metrics (...); -- AI Agents
CREATE TABLE IF NOT EXISTS funnel_analytics (...);          -- Websites
CREATE TABLE IF NOT EXISTS ad_performance_ai_insights (...);-- Ads
CREATE TABLE IF NOT EXISTS sentinel_actions (...);          -- Sentinel
CREATE TABLE IF NOT EXISTS sentinel_incident_ai_triage (...);-- Sentinel
CREATE TABLE IF NOT EXISTS home_service_signal_scores (...);-- Home Service
CREATE TABLE IF NOT EXISTS distribution_performance (...);  -- Distribution
CREATE TABLE IF NOT EXISTS brain_learning_feedback (...);   -- Brain
CREATE TABLE IF NOT EXISTS legal_lead_delivery_log (...);   -- Legal

-- Group C: Require pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS embedding_store (...);           -- Brain
CREATE TABLE IF NOT EXISTS legal_case_ai_summary (...);     -- Legal

-- Group D: Drizzle schema.ts update required
-- After all tables exist, update shared/schema.ts to register them
-- Then run: npm run check (TypeScript validation)
```

**Rollback:** Each table is independently droppable with `DROP TABLE IF EXISTS <name> CASCADE`.

---

## Stage 5 — AI/Intelligence Tables

**Purpose:** Enable pgvector and create embedding infrastructure.

**Prerequisite:** Confirm Neon PG17 has pgvector available.
```sql
-- Check if pgvector is available:
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```

**If available:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Then create embedding_store as defined in APEX_POSTGRES_BRAIN_SCHEMA.md.**

**Rollback:** `DROP EXTENSION vector CASCADE` removes the extension and all vector columns/indexes.

---

## Stage 6 — Data Backfills

These are data operations, not schema changes. They must be gated behind verification steps.

### 6A — Subscription Backfill

**Prerequisite:** Verify Stripe customer IDs for all 5 accounts.

```sql
-- CHECK FIRST — do not run backfill without verification:
SELECT sa.id, sa.name, sa.plan_type 
FROM sub_accounts sa 
LEFT JOIN subscriptions s ON s.account_id = sa.id
WHERE s.id IS NULL;
-- If this returns rows, those accounts have no subscription record.
```

**After Stripe verification, run per-account with correct stripe_subscription_id:**
```sql
INSERT INTO subscriptions 
  (account_id, plan_id, stripe_subscription_id, status, current_period_start, current_period_end)
VALUES
  (3, <enterprise_plan_id>, '<stripe_sub_id_from_dashboard>', 'active', now(), now() + interval '1 month')
ON CONFLICT (account_id) DO NOTHING;
-- Repeat for each account
```

### 6B — Legal Attorney Seed

**Prerequisite:** Obtain real attorney data (name, bar number, jurisdiction, contact info, practice areas, bid price per lead).

```sql
-- Schema exists, table is empty. Seed with real data:
INSERT INTO legal_attorneys (account_id, name, bar_number, jurisdictions, email, phone, lead_types, max_monthly_leads, price_per_lead_cents)
VALUES (...);
-- Then verify:
SELECT COUNT(*) FROM legal_attorneys;  -- must be > 0 before routing goes live
```

### 6C — Contact Deduplication

**Warning:** Do not run without reviewing the output first. This identifies duplicates; the merge is a separate manual step.

```sql
-- Step 1: Generate dedup hashes for contacts that have both phone and email
UPDATE contacts 
SET global_dedup_hash = encode(
  sha256((COALESCE(normalized_phone, phone, '') || '::' || COALESCE(normalized_email, email, ''))::bytea),
  'hex'
)
WHERE (phone IS NOT NULL OR email IS NOT NULL)
AND global_dedup_hash IS NULL;

-- Step 2: Find duplicate groups
SELECT global_dedup_hash, COUNT(*), ARRAY_AGG(id ORDER BY created_at) as ids
FROM contacts 
WHERE global_dedup_hash IS NOT NULL
GROUP BY global_dedup_hash
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 100;
-- Review output before any merge
```

### 6D — Sentinel Incident Triage

The 7,085 stuck incidents need investigation before bulk-closing:

```sql
-- Review stuck incidents before bulk-action:
SELECT 
  status,
  incident_type,
  COUNT(*),
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM sentinel_incidents
WHERE status = 'pending'
GROUP BY status, incident_type
ORDER BY COUNT(*) DESC;
```

**Do not bulk-update these to 'closed' without first checking if the delivery pipeline can be repaired.** The root cause is a missing worker connection, not bad data.

---

## Stage 7 — Legacy Cleanup (90-Day Holdover)

No tables are dropped at this time. After 90 days of running the new schema in production without issue, the following review is warranted:

| Table | Review Action |
|-------|---------------|
| `crash_reports` | Review if superseded by `agent_outcome_log` |
| Hillsborough duplicate contact rows | Merge into canonical records and archive losers |
| Old `workflows` with null `account_id` | Investigate ownership and reassign or archive |

**Policy:** No table is dropped without a migration file committed to version control, a 7-day review window, and explicit user sign-off.

---

## Migration Execution Checklist

Run this checklist before executing any stage in production:

```
[ ] Neon DB manual backup created (Settings → Branching → New Branch from production)
[ ] DATABASE_URL confirmed pointing to correct project (patient-surf-58659251)
[ ] npm run check passes (TypeScript validation clean)
[ ] Feature flag created for any new code path (set OFF before deploy)
[ ] Stage SQL reviewed for IF NOT EXISTS / IF EXISTS guards
[ ] Rollback SQL documented and tested on branch
[ ] At least one other person has reviewed the migration (or self-review delay of 24h)
```

---

## Neon Branch Strategy for Safe Migrations

Use Neon branching for all Stage 4+ work:

```
main branch (production) → create branch "migration-stage-4" → run migrations → validate → merge
```

```bash
# Via Neon CLI or MCP:
# 1. Create branch from production
# 2. Get branch connection string
# 3. Run migrations against branch
# 4. Verify data integrity
# 5. Run same migrations against production
# 6. Delete branch
```

This ensures every migration is tested against real production data before touching production.

---

*Document complete. Next: `docs/APEX_UI_RESTRUCTURE_PLAN.md` (Phase 5)*
