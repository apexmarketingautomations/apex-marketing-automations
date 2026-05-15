# APEX LEGAL SIGNAL INTELLIGENCE
**Recall, Liability, and Filing Intelligence for Attorney Distribution**
Version: 1.0 | Generated: 2026-05-15
Phase: 5 (Planned)

---

## Purpose

Legal Signal Intelligence converts structured legal events — CPSC product recalls, OSHA violations, court filings, and judgment records — into outreach-ready Case Intel with attorney summaries, heat scores, and distribution-ready contact lists.

It is NOT a court scraper. It is an intelligence layer that reads legal signals, identifies affected persons, and routes actionable opportunities to attorneys who handle those case types.

---

## Legal Signal Types

| Signal Type | Source | `signal_type` | Actionability |
|-------------|--------|--------------|--------------|
| Product recall | CPSC api.cpsc.gov | `recall` | Mass tort / product liability |
| OSHA violation | OSHA data portal | `osha_violation` | Workplace injury representation |
| PI filing | CourtListener | `pi_filing` | Personal injury litigation |
| Judgment | Hillsborough, CourtListener | `judgment` | Debt / asset collection |
| Class action | CourtListener / PACER | `class_action` | Mass plaintiff representation |
| Workers comp | State filing feeds | `workers_comp` | WC attorney match |
| Medical malpractice | State filing feeds | `med_mal` | Specialty PI |
| Wrongful death | CourtListener | `wrongful_death` | Estate / survivor representation |

---

## Current State

**`legal_signals`** (3,153 rows) — structured legal event signals from CourtListener and Hillsborough.

**`legal_leads`** (20,128 rows) — raw legal lead records, partially enriched.

**Problems with current state:**
1. No severity / heat scoring — all signals look equally important
2. No case type classification pipeline
3. No attorney distribution routing
4. `legal_leads` contains a mix of attorneys and potential claimants
5. No `signal_fingerprint` — same filing can appear as duplicate rows
6. `legal_case_ai_summary` table exists (Stage 3, schema live, 0 rows)

---

## Legal Signal Requirements

### 1. Signal Fingerprint

```sql
ALTER TABLE legal_signals
  ADD COLUMN IF NOT EXISTS signal_fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fingerprint_version INTEGER DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_signals_fingerprint
  ON legal_signals(signal_fingerprint)
  WHERE signal_fingerprint IS NOT NULL;
```

**Fingerprint algorithm:**
```
SHA256(court_id + "|" + case_number + "|" + signal_type)
```

For CPSC recalls:
```
SHA256("cpsc" + "|" + recall_number + "|" + "recall")
```

### 2. Legal Heat Scoring

Every legal signal receives a heat score (0.000–1.000) that drives distribution priority:

| Factor | Weight | Notes |
|--------|--------|-------|
| Claimant count | 30% | CPSC recall: units recalled; PI: parties affected |
| Injury severity | 25% | Death > serious injury > moderate > property damage |
| Filing recency | 20% | Decay: 100% within 14 days, 0% at 90 days |
| Jurisdiction density | 15% | Florida filings in active attorney territories |
| Settlement probability | 10% | Based on case type historical settlement rates |

**Score output:**
```typescript
{
  heat_score: 0.82,
  case_type: "product_liability",
  claimant_estimate: 1200,
  fatality_flag: false,
  recommended_action: "Distribute to product liability attorneys — urgent",
  jurisdiction: "Middle District of Florida"
}
```

### 3. Legal Case AI Summary

**`legal_case_ai_summary`** is populated for high-scoring signals (heat_score >= 0.60):

```sql
CREATE TABLE IF NOT EXISTS legal_case_ai_summary (
  id BIGSERIAL PRIMARY KEY,
  legal_signal_id INTEGER REFERENCES legal_signals(id),
  case_summary TEXT NOT NULL,             -- LLM-generated or template-filled
  key_facts JSONB,                        -- structured facts extracted
  affected_products TEXT[],
  affected_jurisdiction VARCHAR(200),
  estimated_claimants INTEGER,
  settlement_range_low BIGINT,            -- in cents
  settlement_range_high BIGINT,
  attorney_notes TEXT,                    -- routing guidance for attorneys
  heat_score NUMERIC(4,3),
  generated_by VARCHAR(100),             -- 'deterministic', 'gpt-4o', 'claude-3-5-sonnet'
  generation_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Generation pipeline:**
1. Signal scored >= 0.60 → queue for summarization
2. Extract structured facts from `raw_data` JSONB (deterministic)
3. If feature flag `legal_ai_summaries_enabled` = true → call LLM for narrative summary
4. If flag = false → use template-filled summary (no LLM cost)
5. Write to `legal_case_ai_summary`
6. Emit `legal_case_summarized` event

### 4. CPSC Recall Pipeline (Phase 5 Priority)

CPSC is the highest-volume, highest-value legal signal source:

**Connector spec:**
```
Source: https://www.cpsc.gov/Recalls (API + feed)
Endpoint: api.cpsc.gov/recalls
Poll frequency: Every 6 hours
Signal type: recall
Lead type: recall_entity
```

**CPSC recall data model:**
```typescript
interface CpscRecall {
  recall_number: string;      // fingerprint seed
  title: string;
  product_name: string;
  hazard: string;
  units_sold: number;         // claimant estimate
  date_issued: string;
  products: CpscProduct[];
  injuries_reported: number;
  deaths_reported: number;
  remedy: string;             // refund, repair, replace
}
```

**Recall to legal signal promotion:**
```
CpscRecall received
  → compute signal_fingerprint
  → check dedup: if fingerprint exists, update; else insert into legal_signals
  → compute heat_score (units_sold * injury_rate * recency)
  → if heat_score >= 0.60: queue for case summary generation
  → if heat_score >= 0.75: trigger attorney distribution routing
  → emit signal_received event to universal_events
```

### 5. Outreach Target Generation

For high-heat legal signals, the platform must identify potential claimants for outreach:

**Target sources:**
- Existing `contacts` who match product category / zip code / injury type
- `legal_leads` who are plaintiffs (not attorneys) in related case types
- Public court records that name affected consumers

**Target output:**
```sql
INSERT INTO legal_signal_targets (
  legal_signal_id,
  contact_id,
  match_reason,        -- 'product_match', 'geography_match', 'injury_type_match'
  match_confidence,
  outreach_eligible,
  created_at
) VALUES (...);
```

---

## Attorney Distribution Compatibility

Legal signals must be routed to attorneys who handle the relevant case type:

```sql
CREATE TABLE attorney_case_preferences (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  case_types TEXT[],           -- ['product_liability', 'pi', 'workers_comp']
  min_claimants INTEGER,       -- minimum size for distribution interest
  min_heat_score NUMERIC(4,3),
  counties TEXT[],             -- geographic restriction
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Routing logic:
```
LegalSignal(heat_score = 0.82, case_type = 'product_liability', counties = ['Orange'])
  → Match attorney_case_preferences WHERE
      'product_liability' ∈ case_types
      AND heat_score >= min_heat_score
      AND ('Orange' ∈ counties OR counties IS NULL)
  → Sort by priority (matching sub-account routing rules)
  → Distribute
```

---

## Legal Signal Lifecycle States

```
received      → signal in legal_signals table, fingerprint computed
scoring       → heat score being computed
scored        → heat score written
summarizing   → legal_case_ai_summary generation in progress
summarized    → summary written
distributing  → routing to attorney sub-accounts
distributed   → routing complete, attorney notified
expired       → signal too old to act on (> 90 days)
archived      → no actionable attorneys matched
```

---

## Phase 5 Deliverables (Legal Signal Intelligence)

- [ ] `signal_fingerprint` column on `legal_signals`
- [ ] CPSC recall connector (polling, normalization, fingerprint)
- [ ] Legal heat scoring job (deterministic, 5-factor weighted)
- [ ] `legal_case_ai_summary` population — template-first, LLM optional
- [ ] `attorney_case_preferences` table
- [ ] Attorney distribution routing — legal signal → attorney sub-account
- [ ] `GET /api/legal-signals` — operator-facing list with heat score
- [ ] `GET /api/legal-signals/:id` — detail view with case summary
- [ ] `GET /api/legal-signals/:id/targets` — outreach-ready contacts
- [ ] Legal signal observability in `signal_source_health`
