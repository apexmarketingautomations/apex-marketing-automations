# APEX CASE INTEL
**Aggregated Operational Intelligence Hub**
Version: 1.0 | Generated: 2026-05-15
Phase: 5+ (Partial — intelligence_cases live, 1,251 rows)

---

## Purpose

Case Intel is the aggregation layer that groups related signals, incidents, contacts, and legal events into a single **case record** — a comprehensive operational intelligence hub that attorneys and operators can use to assess, track, and act on an opportunity.

A case is NOT a contact. A case is NOT a raw signal. A case is the synthesis of all available intelligence about a specific real-world event and the people involved in it.

**Primary consumers:**
- Personal injury attorneys evaluating crash victims
- Legal teams managing mass tort and recall exposure
- Operators tracking multi-contact opportunities (multi-vehicle crashes, building fires)

---

## Current State

**`intelligence_cases`** — 1,251 rows, live in production.

Current schema gaps:
1. No link to `sentinel_incidents` (no `incident_id` FK)
2. No link to `legal_signals` (no `legal_signal_id` FK)
3. No `case_score` — all cases look equal
4. No `ai_summary` population (table exists, 0 rows)
5. No lifecycle state — no way to track case progression

---

## Case Definition

An intelligence case is a curated record that represents:

| Dimension | Description |
|-----------|-------------|
| **Source event** | The incident or signal that originated the case |
| **Affected parties** | All contacts linked via `incident_contacts` or legal parties |
| **Evidence** | All signals, reports, and documents aggregated for this case |
| **Case score** | Composite quality + urgency + completeness score |
| **AI summary** | LLM-generated or template-filled synopsis for attorney review |
| **Lifecycle** | Current state from `open` to `closed` |
| **Distribution** | Which attorneys or operators have been assigned |

---

## Case Schema (Enhanced)

```sql
-- intelligence_cases already exists — add missing columns
ALTER TABLE intelligence_cases
  ADD COLUMN IF NOT EXISTS incident_id INTEGER REFERENCES sentinel_incidents(id),
  ADD COLUMN IF NOT EXISTS legal_signal_id INTEGER REFERENCES legal_signals(id),
  ADD COLUMN IF NOT EXISTS case_score NUMERIC(4,3) DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS case_type VARCHAR(100),  -- 'crash_pi', 'recall', 'workers_comp'
  ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(50) DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS attorney_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(200);

CREATE INDEX idx_intelligence_cases_incident ON intelligence_cases(incident_id);
CREATE INDEX idx_intelligence_cases_score ON intelligence_cases(case_score DESC, lifecycle_status, created_at DESC);
CREATE INDEX idx_intelligence_cases_territory ON intelligence_cases(territory_id, lifecycle_status, case_score DESC);
```

---

## Case Score Computation

Every case receives a composite score (0.000–1.000):

| Factor | Weight | Source |
|--------|--------|--------|
| Incident severity score | 30% | `sentinel_incident_ai_triage.severity_score` |
| Contact completeness | 25% | % of linked contacts that are export_eligible |
| AI summary quality | 15% | `legal_case_ai_summary.heat_score` (if legal) |
| Recency | 20% | Days since source incident (decay) |
| Evidence count | 10% | Number of signals and documents aggregated |

```typescript
function computeCaseScore(params: {
  severityScore: number;       // 0–1
  contactCompleteness: number; // 0–1, fraction of contacts that are export_eligible
  aiSummaryScore: number;      // 0–1, or 0.5 if no AI summary
  recencyScore: number;        // 0–1, decays over 90 days
  evidenceCount: number;       // raw count
}): number {
  const evidenceNorm = Math.min(params.evidenceCount / 10, 1.0); // cap at 10 evidence items
  return (
    params.severityScore * 0.30 +
    params.contactCompleteness * 0.25 +
    params.aiSummaryScore * 0.15 +
    params.recencyScore * 0.20 +
    evidenceNorm * 0.10
  );
}
```

---

## Case AI Summary (`legal_case_ai_summary`)

The `legal_case_ai_summary` table (Stage 3, schema live, 0 rows) is populated for cases with `case_score >= 0.60`:

### Template-First Summary (No LLM, Always Available)

```typescript
function buildTempleCaseSummary(case: IntelligenceCase, incident: SentinelIncident | null): string {
  if (incident) {
    return [
      `${incident.severity.toUpperCase()} CRASH — ${incident.county} County, FL`,
      `Date: ${incident.incidentDate?.toLocaleDateString()}`,
      `Type: ${incident.incidentType}`,
      `Location: ${incident.location}`,
      `Contacts identified: ${case.contactCount}`,
      `Export-eligible contacts: [computed from incident_contacts]`,
      `Case score: ${(case.caseScore * 100).toFixed(0)}/100`,
    ].join("\n");
  }
  return `Case #${case.id} — ${case.caseType} — Score: ${case.caseScore}`;
}
```

### LLM Summary (Optional, Feature-Flagged)

When `case_ai_summaries_enabled` feature flag is true:
- Pass template summary + incident raw_data + linked contact anonymized profile to LLM
- Generate attorney-facing narrative: "On [date], a [severity] crash occurred at [location]..."
- Write to `legal_case_ai_summary.case_summary`
- Track tokens used in `agent_outcome_log`

---

## Case Evidence Table

Every piece of evidence aggregated to a case must be tracked:

```sql
CREATE TABLE case_evidence (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
  evidence_type VARCHAR(100) NOT NULL,    -- 'crash_report', 'police_report', 'court_filing',
                                          -- 'news_article', 'contact_record', 'skip_trace_result'
  source VARCHAR(200),                    -- source system or URL
  entity_id BIGINT,                       -- ID in the source table
  entity_type VARCHAR(100),              -- 'sentinel_incident', 'legal_signal', 'contact'
  title TEXT,
  notes TEXT,
  file_url TEXT,                         -- if document stored externally
  confidence NUMERIC(4,3),
  added_by VARCHAR(100),                 -- 'system', user_id, 'attorney_upload'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_case_evidence_case ON case_evidence(case_id, evidence_type);
```

---

## Case Lifecycle States

```
open           → case created, intelligence gathering active
in_review      → attorney or operator reviewing the case
enriching      → contacts being skip-traced
enriched       → all linked contacts have phone/email
pitched        → attorney reviewing for case acceptance
retained       → attorney accepted, case opened
settled        → case resolved with settlement
dismissed      → case dismissed or no merit
archived       → closed with no action
```

### Case Assignment

When a case is assigned to an attorney or operator:

```sql
CREATE TABLE case_assignments (
  id BIGSERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES intelligence_cases(id),
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  assigned_by VARCHAR(100),              -- 'system' or user_id
  assignment_reason TEXT,               -- routing rule that triggered this
  status VARCHAR(50) DEFAULT 'active',  -- active, accepted, declined, expired
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  expires_at TIMESTAMPTZ,              -- SLA window for response
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Case Intel API

### Existing / Needed Endpoints

```
GET /api/cases                          — list all cases for sub-account
GET /api/cases/:id                      — case detail with contacts + evidence + timeline
GET /api/cases/:id/contacts             — all contacts linked to this case
GET /api/cases/:id/evidence             — all evidence items
GET /api/cases/:id/summary              — AI summary (template or LLM)
POST /api/cases/:id/evidence            — add evidence to case
PATCH /api/cases/:id/lifecycle-status   — update case state
POST /api/cases                         — manually create a case (attorney workflow)
GET /api/cases?groupBy=county           — cases by county
GET /api/cases?min_score=0.70           — high-quality cases only
```

---

## Case Intel UI (Phase 5+)

### Cases List View

- Columns: Score Badge | Case Type | County | Contacts | Status | Date | Actions
- Default sort: case_score DESC, created_at DESC
- Quick filters: High Score, Assigned to Me, Open, Needs Enrichment, New This Week
- Score badges: color-coded A/B/C/D bands

### Case Detail View

- Header: case type, county, score badge, lifecycle status
- AI summary card (template or LLM-generated)
- Linked contacts list with export_eligible badges
- Evidence timeline (crash reports, legal filings, skip trace results)
- Assignment history
- Actions: Assign to Attorney, Add Evidence, Update Status, Export Contacts

---

## Phase 5+ Deliverables (Case Intel)

- [ ] `incident_id` FK on `intelligence_cases`
- [ ] `legal_signal_id` FK on `intelligence_cases`
- [ ] `case_score` column + computation job
- [ ] `case_type` classification (deterministic)
- [ ] `lifecycle_status` on cases
- [ ] `case_evidence` table
- [ ] `case_assignments` table + assignment routing
- [ ] `legal_case_ai_summary` population (template-first)
- [ ] Case score badge in UI
- [ ] `GET /api/cases` + `GET /api/cases/:id`
- [ ] Case detail view with evidence timeline
- [ ] Attorney assignment workflow
