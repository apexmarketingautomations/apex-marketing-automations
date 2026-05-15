# APEX DISTRIBUTION INTELLIGENCE
**Intelligent Routing, SLA Management, and Conversion Tracking**
Version: 1.0 | Generated: 2026-05-15
Phase: 4D (Partial — routing rules live, 12 rules)

---

## Purpose

Distribution Intelligence is the routing and delivery layer that moves scored, enriched contacts and cases to the correct attorneys, operators, or downstream systems at the right time — with full SLA accountability, duplicate prevention, and conversion outcome tracking.

**Current state:** 12 routing rules live in `contact_routing_rules`. Rules match by pipeline and lead type. No territory awareness, no SLA tracking, no conversion feedback loop.

---

## Distribution Model

```
Enriched Contact (export_eligible = true)
  → Routing Engine
      → Match routing rules (pipeline × lead_type × county × territory)
      → Select target sub-account by priority
      → Check SLA window (is the attorney accepting right now?)
      → Check distribution cap (max leads/day for this sub-account)
      → Deliver: assign target_sub_account_id to contact
      → Log to contact_routing_audit
      → Notify sub-account (webhook / email / SMS — future)
      → Start SLA timer (response expected within X hours)
  → SLA Monitor
      → If no response in SLA window: escalate or re-route
  → Outcome Tracker
      → When contact is retained/declined: log outcome
      → Feed outcome data back to routing score model
```

---

## Routing Rules (Live)

The `contact_routing_rules` table has 12 active rules as of 2026-05-15.

### Rule Matching Fields

| Column | Description |
|--------|-------------|
| `match_source_pipeline` | crash_ingest, legal_signal, arrest_ingest, etc. |
| `match_lead_type` | individual, recall_entity, etc. |
| `match_lead_vertical` | pi_attorney, roofing, home_service |
| `match_county` | Orange, Hillsborough, etc. |
| `match_niche` | crash, pedestrian, bicycle, recall |
| `priority` | 1 = highest, 10 = lowest; lower wins |
| `target_sub_account_id` | The sub-account to route to |

### Enhanced Routing Fields (Phase 4D)

```sql
ALTER TABLE contact_routing_rules
  ADD COLUMN IF NOT EXISTS match_territory_id INTEGER REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS match_state VARCHAR(5),
  ADD COLUMN IF NOT EXISTS match_zip TEXT[],
  ADD COLUMN IF NOT EXISTS match_min_quality_grade VARCHAR(5),  -- only route A+ and A
  ADD COLUMN IF NOT EXISTS match_min_severity_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 24,        -- response SLA in hours
  ADD COLUMN IF NOT EXISTS max_daily_leads INTEGER DEFAULT 50,  -- distribution cap
  ADD COLUMN IF NOT EXISTS distribution_method VARCHAR(50) DEFAULT 'direct';
                                                                -- 'direct', 'exclusive', 'shared'
```

---

## Distribution Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `direct` | Contact assigned exclusively to one sub-account | Single-attorney territory |
| `exclusive` | Contact offered to one attorney at a time; re-routes if declined | Competitive PI market |
| `shared` | Contact distributed to multiple sub-accounts simultaneously | Mass tort recall lists |

**Exclusive routing flow:**
```
Contact → Attorney A (SLA: 4 hours)
  → If accepted within 4h: locked exclusively
  → If declined or no response: route to Attorney B (SLA: 4 hours)
  → If B declines: route to Attorney C or archive after 3 attempts
```

---

## SLA Management

Every distributed contact has a response SLA tracked in the audit log:

```sql
ALTER TABLE contact_routing_audit
  ADD COLUMN IF NOT EXISTS sla_hours INTEGER,
  ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_met BOOLEAN,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
```

**SLA breach handling:**

```typescript
// Run every 15 minutes via cron
async function checkSlaBreaches(): Promise<void> {
  const breaches = await db
    .select()
    .from(contactRoutingAudit)
    .where(and(
      eq(contactRoutingAudit.status, 'routed'),
      isNull(contactRoutingAudit.respondedAt),
      lt(contactRoutingAudit.slaDeadline, new Date())
    ));

  for (const breach of breaches) {
    await escalateOrReroute(breach);
    await logSlaBreachEvent(breach);
  }
}
```

---

## Distribution Caps

Sub-accounts have per-day lead distribution caps to prevent volume overload:

```sql
CREATE TABLE distribution_daily_caps (
  id BIGSERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  cap_date DATE NOT NULL DEFAULT CURRENT_DATE,
  leads_distributed INTEGER DEFAULT 0,
  leads_cap INTEGER NOT NULL,
  cap_reached_at TIMESTAMPTZ,
  UNIQUE(sub_account_id, cap_date)
);
```

**Cap enforcement:**
```typescript
async function isDistributionCapReached(subAccountId: number, dailyCap: number): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const [row] = await db
    .select({ distributed: distributionDailyCaps.leadsDistributed })
    .from(distributionDailyCaps)
    .where(and(
      eq(distributionDailyCaps.subAccountId, subAccountId),
      eq(distributionDailyCaps.capDate, today)
    ));
  return (row?.distributed ?? 0) >= dailyCap;
}
```

---

## Routing Audit (Live)

The `contact_routing_audit` table tracks every routing decision:

```sql
-- Already live in production
-- Columns: contact_id, rule_id, target_sub_account_id, route_reason, created_at
-- Enhanced with: sla_hours, sla_deadline, responded_at, sla_met (Phase 4D)
```

**Routing audit events:**
```
route_matched    → a routing rule was matched
route_applied    → contact assigned to sub-account
route_skipped    → rule matched but cap reached, skipping
route_failed     → no matching rule, no assignment
sla_breached     → attorney did not respond within SLA window
sla_met          → attorney responded before deadline
escalated        → re-routed after SLA breach
cap_reached      → sub-account daily cap hit
```

---

## Conversion Tracking

When an attorney retains a contact (lifecycle_status → 'retained'), the outcome must be fed back:

```sql
CREATE TABLE distribution_outcomes (
  id BIGSERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  routing_audit_id BIGINT REFERENCES contact_routing_audit(id),
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  outcome VARCHAR(50) NOT NULL,          -- 'retained', 'declined', 'unresponsive', 'converted'
  outcome_value BIGINT,                  -- settlement or contract value in cents (if known)
  days_to_outcome INTEGER,              -- days from distribution to outcome
  outcome_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_distribution_outcomes_sub ON distribution_outcomes(sub_account_id, outcome, created_at DESC);
```

**Outcome feedback loop (Phase 8+):**
- Routing rules that produce `retained` outcomes get a conversion_score boost
- Rules that produce `declined` outcomes are deprioritized
- Sub-accounts with high decline rates are flagged for review

---

## Distribution Intelligence API

```
GET /api/routing-rules                      — list all rules for sub-account
POST /api/routing-rules                     — create new rule (admin)
PATCH /api/routing-rules/:id                — update rule (admin)
DELETE /api/routing-rules/:id               — deactivate rule (admin)

GET /api/routing-audit?subAccountId=X       — routing decisions for sub-account
GET /api/routing-audit/sla-breaches         — all active SLA breaches
GET /api/routing-audit/conversion-report    — outcome summary by rule

GET /api/distribution/caps                  — daily cap status for all sub-accounts
GET /api/distribution/queue                 — contacts queued for distribution
POST /api/distribution/manual-route/:contactId — override-route a contact (admin)
```

---

## Distribution Observability

Every routing event must flow through `universal_events`:

```sql
INSERT INTO universal_events (event_type, entity_type, entity_id, metadata, created_at)
VALUES
  ('contact_routed', 'contact', $contactId, 
   '{"rule_id": 5, "target_sub_account_id": 12, "priority": 2}', NOW());
```

Monitoring queries:
```sql
-- Routes per hour by sub-account
SELECT target_sub_account_id, DATE_TRUNC('hour', created_at) AS hour, COUNT(*) AS routes
FROM contact_routing_audit
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2 ORDER BY 2, 3 DESC;

-- SLA compliance rate by sub-account
SELECT sub_account_id,
  COUNT(*) FILTER (WHERE sla_met = true) AS met,
  COUNT(*) FILTER (WHERE sla_met = false) AS breached,
  ROUND(COUNT(*) FILTER (WHERE sla_met = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS compliance_pct
FROM contact_routing_audit
WHERE sla_deadline IS NOT NULL
GROUP BY 1;
```

---

## Phase 4D Deliverables (Distribution Intelligence)

- [ ] `match_territory_id`, `sla_hours`, `max_daily_leads`, `distribution_method` on routing rules
- [ ] `sla_deadline`, `responded_at`, `sla_met`, `escalated_at` on `contact_routing_audit`
- [ ] `distribution_daily_caps` table + enforcement in routing engine
- [ ] `distribution_outcomes` table + lifecycle status webhook handler
- [ ] SLA breach checker cron (every 15 minutes)
- [ ] Exclusive routing flow (offer → timeout → re-route)
- [ ] `GET /api/routing-audit/sla-breaches`
- [ ] `GET /api/routing-audit/conversion-report`
- [ ] Admin UI: routing rule configuration with SLA and cap settings
- [ ] Distribution dashboard: routes/day, SLA compliance %, conversion rate
