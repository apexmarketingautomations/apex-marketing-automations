# APEX CRM INTELLIGENCE
**Actionable Contact Lifecycle Management**
Version: 1.0 | Generated: 2026-05-15
Phase: 4C (Planned) | Routing: Live

---

## Purpose

The CRM Intelligence layer is the operator-facing view of resolved, enriched entities. It is NOT a signal dump. It is NOT a raw incident list. It shows only contacts that have passed entity resolution and are actionable by operators.

**The CRM is the output layer. Every record in the CRM represents a real person with a verified identity and a reachable contact method.**

---

## Current State Problems

| Problem | Impact | Fix |
|---------|--------|-----|
| Crash placeholders mixed with export-ready contacts | Operator confusion, wasted calls | `export_eligible=true` filter enforced on all exports |
| Attorneys and businesses in the same list as injury victims | Wrong outreach targets | `lead_type` filter separates entity classes |
| No actionability signal — all rows look equal | Operators don't know where to start | AI quality scoring (Phase 4B) |
| Chronological dump with no county grouping | Territory work is impossible | County grouping + filter bar (Phase 4C) |
| No lifecycle status — retained contacts look same as dead | Conversion tracking broken | Lifecycle column (Phase 4C) |

---

## Correct CRM Model

### Who Belongs in the CRM

```
✅ lead_type = 'individual'
✅ export_eligible = true
✅ Has phone OR email
✅ Not a placeholder name
✅ Not an attorney / business / recall / OSHA entity
```

### Who Belongs Elsewhere

```
Signals → Incidents view (APEX_INCIDENT_INTELLIGENCE.md)
Placeholders → Internal signal store (not operator-visible)
Attorneys → Legal Intel view (future Phase 5)
Businesses → Business Intel view (future Phase 6)
```

---

## CRM Lifecycle States

Every contact has a `lifecycle_status` that tracks their progression through the sales pipeline:

```
new              → just created, uncontacted
review_pending   → flagged for manual identity review
enriching        → skip trace in progress
enriched         → phone/email appended, ready for outreach
contacted        → first contact attempt made
engaged          → responded to outreach
pitched          → case / service pitched
retained         → signed / agreed to service
declined         → explicitly said no
dead             → uncontactable, bounced, or stale > 60 days
archived         → closed, no further action
```

### Lifecycle Transition Rules

| From | To | Trigger |
|------|-----|---------|
| `new` | `enriching` | Skip trace queued |
| `enriching` | `enriched` | Phone/email appended |
| `enriched` | `contacted` | First outreach logged |
| `contacted` | `engaged` | Response received |
| `engaged` | `pitched` | Attorney or service presented |
| `pitched` | `retained` | Signed / accepted |
| `pitched` | `declined` | Rejected outreach |
| Any | `dead` | 60 days with no response |
| Any | `archived` | Manual close by operator |

---

## CRM Filter Architecture (Phase 4C)

### Filter Bar

The contacts list must support the following filters, all combinable:

| Filter | Type | Field | Example |
|--------|------|-------|---------|
| Lead Type | Multi-select | `lead_type` | individual, placeholder |
| County | Multi-select | `county` | Orange, Hillsborough |
| Lifecycle Status | Multi-select | `lifecycle_status` | new, enriched, contacted |
| Has Phone | Boolean | `phone IS NOT NULL` | Yes/No |
| Has Email | Boolean | `email IS NOT NULL` | Yes/No |
| Pipeline | Multi-select | `source_pipeline` | crash_ingest, legal_signal |
| Quality Grade | Multi-select | `ai_quality_grade` | A+, A, B, C, D |
| Date Range | Date picker | `created_at` | Last 7 days, custom |
| Export Eligible | Boolean | `export_eligible` | Yes/No |

### Quick Filter Chips

Pre-built one-click filters for the most common operator workflows:

| Chip | Filter Logic |
|------|-------------|
| **Hot Leads** | quality_grade IN ('A+', 'A') AND export_eligible = true |
| **Needs Skip Trace** | phone IS NULL AND email IS NULL AND lead_type = 'individual' |
| **New Today** | created_at >= CURRENT_DATE AND lead_type = 'individual' |
| **Ready for Dialing** | lifecycle_status = 'enriched' AND phone IS NOT NULL |
| **Crash Victims** | source_pipeline = 'crash_ingest' AND export_eligible = true |
| **Needs Review** | lifecycle_status = 'review_pending' |

### County Grouping

Contacts should be groupable by county with rolled-up counts:

```typescript
// GET /api/contacts?groupBy=county
[
  { county: "Orange", total: 342, exportEligible: 89, hotLeads: 12 },
  { county: "Hillsborough", total: 289, exportEligible: 71, hotLeads: 9 },
  ...
]
```

---

## Quality Grade (Phase 4B)

Every contact receives a letter grade based on a deterministic composite score:

| Grade | Score Range | Meaning |
|-------|------------|---------|
| A+ | 0.90–1.00 | Skip trace confirmed, recent crash, high severity, has phone |
| A | 0.80–0.89 | Strong identity, has phone or email, moderate severity |
| B | 0.65–0.79 | Partial identity, phone or email present, not recent |
| C | 0.45–0.64 | Weak identity, no direct contact method, enrichment pending |
| D | 0.00–0.44 | Near-placeholder, stale signal, low confidence |

### Scoring Inputs

| Factor | Weight | Source |
|--------|--------|--------|
| Identity confidence | 30% | `contact_ai_profiles.intent_confidence` |
| Incident severity | 25% | `sentinel_incidents.severity` → severity score |
| Recency | 20% | Days since incident_date (decay function) |
| Contact completeness | 15% | Has phone + email + address |
| Territory match | 10% | In an active attorney / operator territory |

**Recency decay formula:**
```
recency_score = MAX(0, 1 - (days_since_incident / 90))
```
A contact from a crash 7 days ago scores 0.92 on recency. A crash from 90+ days ago scores 0.

---

## CRM API Requirements

### Existing (Live)

```
GET /api/contacts?subAccountId=X          — all contacts for sub-account
GET /api/reports/export?subAccountId=X    — CSV export (export_eligible=true enforced)
POST /api/contacts/:id/skip-trace         — trigger skip trace with full audit trail
GET /api/contacts/:id/enrichment-history  — enrichment timeline
```

### Required (Phase 4B/4C)

```
GET /api/contacts?filter=hot_leads                   — quick filter
GET /api/contacts?groupBy=county                     — county summary
GET /api/contacts/:id/ai-profile                     — quality grade + confidence
GET /api/contacts/quality-summary?subAccountId=X     — count by grade
PATCH /api/contacts/:id/lifecycle-status             — update lifecycle
POST /api/contacts/saved-views                        — save filter preset
GET /api/contacts/saved-views                         — list saved views
```

---

## Saved Views (Phase 4C)

Operators can save filter presets for their most common workflows:

```sql
CREATE TABLE contact_saved_views (
  id BIGSERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  created_by INTEGER REFERENCES users(id),
  view_name VARCHAR(200) NOT NULL,
  filters JSONB NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Example saved view:
```json
{
  "view_name": "Orange County Hot Leads",
  "filters": {
    "county": ["Orange"],
    "quality_grade": ["A+", "A"],
    "export_eligible": true,
    "source_pipeline": ["crash_ingest"],
    "lifecycle_status": ["enriched", "new"]
  }
}
```

---

## CRM UI Requirements (Phase 4C)

### Contact List View

- **Table columns:** County | Lead Type | Quality Grade | Name | Phone | Status | Pipeline | Created | Actions
- **Default sort:** quality_grade DESC, created_at DESC
- **Pagination:** 50 per page
- **Bulk actions:** Export selected, Skip trace selected, Archive selected
- **Export gate:** Export button only activates when `export_eligible=true` contacts are selected

### Contact Detail View

- Identity: name, phone, email, address, DOB (if available)
- Signal source: incident date, county, severity, crash type
- Enrichment timeline: all `contact_enrichment_events` records
- Skip trace history: all `skip_trace_requests` records with status badges
- Quality score breakdown: per-factor scores visible
- Lifecycle status: current + history of transitions
- Related incident: link to incident record in Incidents view
- Actions: Skip trace, Update lifecycle, Add note, Export, Archive

---

## Phase 4C Deliverables

- [ ] Filter bar with all filter types above
- [ ] Quick filter chips (6 pre-built)
- [ ] County grouping endpoint + UI
- [ ] `lifecycle_status` column on contacts + transition UI
- [ ] Saved views (create, list, apply, set default)
- [ ] Bulk actions (export, skip trace, archive)
- [ ] Contact detail view enrichment timeline
- [ ] Contact detail view quality score breakdown (Phase 4B dependency)
