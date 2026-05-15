# APEX ROLLBACK PLAN
**Phase 11 of 11 — Rollback and Recovery Procedures**
Generated: 2026-05-14
Status: OPERATIONS DOCUMENT — Reference before every deployment

---

## Philosophy

**Every change that ships must have a rollback defined before it deploys.**

A rollback is not a failure — it is the normal path when a deployment reveals unexpected behavior. The goal is to define rollback procedures in advance so that when something goes wrong (and it will), the recovery takes minutes, not hours.

**Rollback tiers:**
1. **Code rollback** — revert the git commit, redeploy previous build
2. **Database rollback** — reverse the migration SQL (for additive changes: DROP COLUMN, DROP TABLE)
3. **Feature flag rollback** — toggle a flag OFF without redeploying code
4. **Data rollback** — restore from Neon branch/backup for data corruption events
5. **Full service rollback** — restore previous container/build from deployment history

---

## Rollback Decision Tree

```
Deployment complete
       │
       ├── Error rate increased? ──────────────────┐
       │                                            │
       ├── Admin functions broken?  ─────────────── │
       │                                            │
       ├── DB query errors in logs? ─────────────── │
       │                                            ▼
       │                              Is the feature flag-gated?
       │                                   │         │
       │                                  Yes        No
       │                                   │         │
       │                            Toggle flag    Code rollback
       │                            OFF (≤1 min)   (≤5 min)
       │
       └── All checks pass → Monitor for 30 min → Close deployment

Data integrity issue detected:
       │
       ├── Schema change? ──────────────────────────────────────────┐
       │                                                             │
       ├── Backfill corrupted data? ─────────────────────────────── │
       │                                                             ▼
       │                                              Rollback SQL (if additive)
       │                                              OR
       │                                              Neon branch restore (if destructive)
       │
       └── All data verified correct → Close incident
```

---

## Per-Migration Rollback SQL

### Stage 1: Schema Drift Fix (contacts columns)

**Forward:**
```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS identity_status varchar(50), ...;
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

ALTER TABLE contacts
  DROP COLUMN IF EXISTS global_dedup_hash,
  DROP COLUMN IF EXISTS canonical_contact_id;

DROP INDEX IF EXISTS contacts_dedup_hash_account_idx;
```

**Safe to rollback if:** No code has been deployed that reads these columns yet.
**Not safe to rollback if:** Enrichment jobs have populated data into these columns (data loss).

---

### Stage 2: Auth & Admin Extensions

**Forward:**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'member';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS legacy_aliases text[] DEFAULT '{}';
```

**Rollback:**
```sql
ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE plans DROP COLUMN IF EXISTS legacy_aliases;
```

**Safe to rollback if:** No code is deployed that reads `users.role` yet.
**Not safe to rollback if:** The admin access system has been updated to use `role` — rolling back the column will break admin access.

---

### Stage 3: Code Bug Fix (APEX_PARENT_ACCOUNT_ID)

**Forward:** Change `const APEX_PARENT_ACCOUNT_ID = 13` → `3`

**Rollback:** Revert to `13` (restores the broken but "previous" behavior)

**Important:** Rolling back Stage 3 means the admin detection bug returns. Only roll back if the fix itself causes unexpected side effects. If account 3 admin functions stop working after this change (which would be very unusual), the investigation should be on the auth stack, not the constant value.

---

### Stage 4: New Operational Tables

**Forward:** 22 `CREATE TABLE IF NOT EXISTS ...` statements

**Rollback (drop all new tables in reverse dependency order):**
```sql
-- Group C (vector tables first)
DROP TABLE IF EXISTS embedding_store CASCADE;
DROP TABLE IF EXISTS legal_case_ai_summary CASCADE;

-- Group B (domain tables)
DROP TABLE IF EXISTS brain_learning_feedback CASCADE;
DROP TABLE IF EXISTS distribution_performance CASCADE;
DROP TABLE IF EXISTS legal_lead_delivery_log CASCADE;
DROP TABLE IF EXISTS home_service_signal_scores CASCADE;
DROP TABLE IF EXISTS sentinel_incident_ai_triage CASCADE;
DROP TABLE IF EXISTS sentinel_actions CASCADE;
DROP TABLE IF EXISTS ad_performance_ai_insights CASCADE;
DROP TABLE IF EXISTS funnel_analytics CASCADE;
DROP TABLE IF EXISTS agent_performance_metrics CASCADE;
DROP TABLE IF EXISTS workflow_ai_suggestions CASCADE;
DROP TABLE IF EXISTS message_delivery_log CASCADE;
DROP TABLE IF EXISTS contact_merge_log CASCADE;
DROP TABLE IF EXISTS contact_ai_profiles CASCADE;

-- Group A (independent tables)
DROP TABLE IF EXISTS twilio_account_registry CASCADE;
DROP TABLE IF EXISTS enrichment_provider_log CASCADE;
DROP TABLE IF EXISTS agent_outcome_log CASCADE;
DROP TABLE IF EXISTS account_tier_history CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS admin_audit_log CASCADE;
```

**Safe to rollback if:** Tables are empty (no data written yet).
**Not safe to rollback if:** Any application code is actively writing to these tables.

---

### Stage 5: pgvector Extension

**Rollback:**
```sql
DROP EXTENSION IF EXISTS vector CASCADE;
```

**Warning:** `CASCADE` will drop all columns of type `vector` in any table. Only run if the embedding tables were also dropped in Stage 4 rollback.

---

### Stage 6: Data Backfills

**Subscription backfill rollback:**
```sql
DELETE FROM subscriptions WHERE created_at >= '<backfill_timestamp>';
-- Replace with actual timestamp of backfill execution
```

**Dedup hash rollback:**
```sql
UPDATE contacts SET global_dedup_hash = NULL, canonical_contact_id = NULL
WHERE global_dedup_hash IS NOT NULL;
```

**Contact merge rollback:**
- Merged contacts cannot be automatically un-merged once the merge is executed
- The `contact_merge_log` table records what was merged
- Manual restoration from Neon branch backup is required for a merge rollback
- **This is why the merge step requires explicit user sign-off before execution**

---

## Neon Branch-Based Rollback

For any data change that cannot be reversed with SQL, use Neon's branching:

### Before any risky data operation:
```bash
# Create a named backup branch:
# In Neon console: Project → Branches → New Branch → "pre-migration-YYYYMMDD"
# This creates a point-in-time copy of the entire database
```

### To restore from branch:
```bash
# Option A: Get branch connection string and verify data:
# neon connection-string --branch pre-migration-YYYYMMDD

# Option B: Promote branch to main (replaces production):
# ⚠️ DESTRUCTIVE — confirm with user before executing
# neon branches set-as-default pre-migration-YYYYMMDD
```

**Branch retention:** Keep backup branches for 30 days minimum, 90 days for major migrations.

---

## Code Rollback Procedures

### Using git:
```bash
# Find the last known-good commit:
git log --oneline -10

# Create a rollback commit (do not amend or force-push):
git revert <bad-commit-hash>
git push origin main

# Redeploy from the reverted main branch
```

### Emergency rollback (break-glass):
If a deployment is causing immediate production damage and git revert is too slow:
```bash
# Deploy the previous successful build artifact directly
# (depends on your hosting platform)
# OR temporarily redirect traffic to a known-good replica
```

---

## Feature Flag Emergency Controls

For any feature gated behind a feature flag, an instant rollback is:

```sql
-- Disable a feature flag immediately:
UPDATE feature_flags 
SET enabled = false 
WHERE flag_name = '<feature_name>'
AND (account_id = <id> OR account_id IS NULL);

-- Verify:
SELECT flag_name, enabled, account_id FROM feature_flags WHERE flag_name = '<feature_name>';
```

This works without a redeploy and takes effect within seconds (assuming the middleware caches for ≤60s).

---

## Rollback Communication Template

When executing a rollback, communicate to affected parties:

```
INCIDENT: [Brief description]
TIME: [UTC timestamp]
IMPACT: [What is broken / who is affected]
STATUS: Rollback in progress

ROLLBACK STEPS:
1. [Step 1 with ETA]
2. [Step 2 with ETA]

ETA TO RESOLUTION: [Time]
MONITORING: [How we'll verify recovery]

POST-ROLLBACK: Root cause analysis within 24 hours.
```

---

## Pre-Deployment Checklist

Run this checklist before every production deployment:

```
Database migrations:
[ ] Neon backup branch created (named: pre-<feature>-<YYYYMMDD>)
[ ] Migration SQL has been tested on branch database
[ ] Rollback SQL is written and tested on branch database
[ ] No irreversible data operations in this migration
[ ] `npm run db:push` dry-run reviewed (drizzle diff output)

Code changes:
[ ] `npm run check` passes (TypeScript clean)
[ ] No new `console.error` swallowing (all errors logged)
[ ] New feature is behind a feature flag (set OFF before deploy)
[ ] No changes to APEX_PARENT_ACCOUNT_ID without this checklist signed off
[ ] Twilio webhook routes have signature verification

Monitoring:
[ ] /health endpoint responding before and after deploy
[ ] Error rate baseline recorded pre-deploy
[ ] DB query count baseline recorded pre-deploy
[ ] Deployment timestamp recorded (for incident correlation)

Post-deploy verification (within 5 min):
[ ] /health returns 200
[ ] Admin login works (account 3 owner)
[ ] Contact list loads
[ ] At least one signal pipeline ran successfully since deploy
[ ] Error rate has not increased
```

---

## Contact Matrix for Incidents

| Incident Type | First Responder | Escalation |
|---------------|-----------------|------------|
| App down / 500 errors | Deploy engineer | +15min → platform owner |
| Data corruption | Deploy engineer + stop all writes | Immediate → platform owner |
| Auth broken (can't log in) | Deploy engineer | Immediate → platform owner |
| Billing/Stripe down | Platform owner | Stripe support |
| Twilio SMS down | Platform owner | Twilio support |
| Sentinel not alerting | Ops team | +30min → deploy engineer |

---

*All 10 deliverable documents complete.*

## Deliverable Summary

| Document | Status |
|----------|--------|
| `docs/APEX_FULL_STRUCTURE_AUDIT.md` | ✅ Complete |
| `docs/APEX_MODULE_MAP.md` | ✅ Complete |
| `docs/APEX_POSTGRES_BRAIN_SCHEMA.md` | ✅ Complete |
| `docs/APEX_MIGRATION_PLAN.md` | ✅ Complete |
| `docs/APEX_UI_RESTRUCTURE_PLAN.md` | ✅ Complete |
| `docs/APEX_API_RESTRUCTURE_PLAN.md` | ✅ Complete |
| `docs/APEX_MCP_TOOL_LAYER.md` | ✅ Complete |
| `docs/APEX_ADMIN_ACCESS_AUDIT.md` | ✅ Complete |
| `docs/APEX_PRODUCTION_HARDENING_REPORT.md` | ✅ Complete |
| `docs/APEX_ROLLBACK_PLAN.md` | ✅ Complete |
