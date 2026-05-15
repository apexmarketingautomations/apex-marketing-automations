# APEX INTELLIGENCE OPERATING SYSTEM — MASTER PLAN
**Apex Marketing Automations**
Version: 1.0 | Generated: 2026-05-15
Status: ARCHITECTURE APPROVED — Stage 4 execution pending observation window clearance

---

## Mission

Apex is not a CRM. Apex is not a lead scraper. Apex is an **Intelligence Operating System** — a coordinated platform that collects operational signals from the real world, resolves them into structured entities, enriches them into actionable intelligence, and routes them to the right operators at the right moment.

The platform serves attorneys, contractors, home service operators, and business development professionals who need to act on real-world events — accidents, legal filings, permits, weather, licensing changes — before their competitors do.

---

## The Core Problem With the Current State

The platform currently treats every record the same way:

```
Signal arrives → stored as Contact row → dumped into CRM list
```

This creates:
- Crash placeholders mixed with skip-traced PI victims
- Recall entities (OSHA, product liability) appearing as client-ready leads
- Attorney profiles listed alongside injury victims
- No separation between "signal received" and "contact ready"
- No actionability signal — every row looks equally important

**The fix is not a UI tweak. It is an architectural lift.**

---

## Correct Lifecycle

```
SIGNAL
  Raw event from external source
  (crash report, legal filing, permit, DBPR, jail booking, weather)
    │
    ▼
INCIDENT
  Grouped, deduplicated, severity-scored operational event
  (incident_fingerprint, geo-cluster, evidence grouping)
    │
    ▼
ENRICHMENT
  Entity resolution + data append
  (skip trace, phone/email, property ownership, business profile)
    │
    ▼
ENTITY RESOLUTION
  Verified human or business with confidence score
  (normalized identity, duplicate detection, relationship graph)
    │
    ▼
CONTACT
  Actionable CRM entity with lifecycle status
  (export_eligible=true, lead_type=individual, has phone/email)
    │
    ▼
OPPORTUNITY
  Scored and routed to operator or attorney
  (ai_quality_score, territory match, practice area match)
    │
    ▼
WORKFLOW
  Outreach sequence, follow-up, case assignment
    │
    ▼
OUTCOME
  Retained, converted, or dead
    │
    ▼
INTELLIGENCE MEMORY
  Feeds AI scoring, territory models, and conversion optimization
```

**Nothing should skip steps. A signal is not a contact. A contact is not an opportunity.**

---

## Platform Systems Map

| System | Purpose | Phase | Status |
|--------|---------|-------|--------|
| **Signal Engine** | Collect and normalize raw signals | Foundation | Partial — crash, legal, jail, home service active |
| **Incident Intelligence** | Convert signals → structured incidents | 4A | Planned |
| **Entity Resolution Engine** | Separate signals from real entities | 4A | Partial — lead_type + export_eligible live |
| **CRM Intelligence** | Actionable-only contacts with lifecycle | 4C | Partial — routing live, UI pending |
| **AI Quality Scoring** | Grade every contact A+→D | 4B | Planned |
| **Territory Intelligence** | Geo-aware routing and grouping | 4D | Planned |
| **Legal Signal Intelligence** | Recall/liability enrichment engine | Phase 5 | Planned |
| **Business Intelligence** | Niche vertical opportunity scoring | Phase 6 | Planned |
| **Semantic Retrieval** | pgvector similarity search (read-only first) | Phase 7 | Infrastructure ready |
| **Case Intel** | Aggregated operational intelligence hub | Phase 5+ | Partial — intelligence_cases live |
| **Distribution Intelligence** | Intelligent routing to buyers/attorneys | Phase 4D | Partial — routing rules live |
| **Platform Ops** | Full observability stack | Ongoing | Partial — observability tables live |

---

## Current Infrastructure State (2026-05-15)

### What Is Live

| Layer | Component | Status |
|-------|-----------|--------|
| DB | Neon Postgres 17.8 + pgvector 0.8.0 | ✅ Live |
| Vector | `embedding_store` + HNSW (cosine, m=16, ef=64) | ✅ Live |
| AI profiles | `contact_ai_profiles`, `legal_case_ai_summary` | ✅ Schema live, 0 rows |
| Observability | `agent_outcome_log`, `enrichment_provider_log` | ✅ Live |
| Skip trace obs | `skip_trace_requests`, `contact_enrichment_events` | ✅ Live |
| Routing | `contact_routing_rules` (12 rules), `contact_routing_audit` | ✅ Live |
| Contact fields | `source_pipeline`, `lead_type`, `export_eligible` | ✅ Live, backfilled |
| Export guard | `/api/reports/export` enforces `export_eligible=true` | ✅ Live |
| Skip trace API | `POST /api/contacts/:id/skip-trace` with full audit | ✅ Live |
| Auth | Role-based, `internalOnly` middleware, admin audit | ✅ Live |

### What Is NOT Active
- No embedding workers running
- No semantic search endpoints
- No AI memory orchestration
- No RAG pipelines
- No autonomous retrieval
- Stage 4 PAUSED (observation window)

### Key Data Volumes (2026-05-15)

| Entity | Count |
|--------|-------|
| Contacts | 9,562 |
| Export-eligible contacts | 990 (10.4%) |
| Sentinel incidents | 7,449 |
| Legal leads | 20,128 |
| Legal signals | 3,153 |
| Intelligence cases | 1,251 |
| Crash reports | 3,092 |
| Ingestion rate | ~960 crash events/day |

---

## Execution Phases

### Phase 4A — Incident vs Contact Split (NEXT)

**Goal:** Stop treating signals as contacts. Create a clean `Incidents` view separate from `Contacts`.

**Deliverables:**
- `view_class` column on contacts (`signal` | `incident` | `contact`)
- `incident_fingerprint` deduplication on sentinel_incidents
- UI: Incidents tab (raw/unenriched), Contacts tab (export_eligible only)
- Incident severity scoring (`sentinel_incident_ai_triage` population)
- Enrichment queue: incidents waiting for skip trace

**Success criteria:** A PI attorney sees zero placeholders in the Contacts view.

---

### Phase 4B — AI Quality Scoring

**Goal:** Every contact has an A+/A/B/C/D quality badge based on deterministic + AI scoring.

**Deliverables:**
- `contact_ai_profiles.intent_confidence` → drive quality badge
- Scoring function: severity + enrichment + recency + territory + completeness
- Background job: score contacts in batches, 100 at a time, throttled
- API: `GET /api/contacts/:id/ai-profile`
- UI: quality badge on contact cards

**Success criteria:** Top 10% of contacts visible at a glance by any operator.

---

### Phase 4C — CRM Filter Architecture

**Goal:** Replace chronological dump with actionability-organized views.

**Deliverables:**
- Filter bar: Lead Type, County, Status, Has Phone, Has Email, Pipeline, Date Range
- Quick filter chips: Hot Leads, Needs Skip Trace, New Today, Ready for Dialing
- County grouping with rolled-up counts
- Lifecycle status column (NEW → RETAINED → DEAD)
- Saved views (user-level filter presets)

---

### Phase 4D — Territory Intelligence

**Goal:** Operators work within territories, not global contact dumps.

**Deliverables:**
- Territory definitions (county, ZIP, radius, DMA)
- Territory assignment on every contact, incident, and opportunity
- `GET /api/territory/:id/summary` — counts by entity type, quality tier, pipeline
- Sub-account territory configuration in admin
- Routing rules: territory-aware distribution

---

### Phase 5 — Legal Signal Intelligence

**Goal:** Convert CPSC recalls, product liability signals, and legal filings into outreach-ready Case Intel with attorney summaries.

**Deliverables:**
- Legal signal enrichment pipeline
- `legal_case_ai_summary` population (LLM summarization)
- Legal heat scoring
- Outreach target generation from legal signals
- Attorney distribution compatibility

---

### Phase 6 — Niche Business Intelligence

**Goal:** DBPR, permits, inspections, and review signals converted into vertical-specific opportunities.

**Deliverables:**
- DBPR ingestion connector
- Permit clustering by territory
- Business opportunity scoring (roofers, contractors, salons, etc.)
- ICP matching per client vertical
- Outreach readiness scoring

---

### Phase 7 — Semantic Retrieval Rollout

**Goal:** Use the Stage 3 pgvector infrastructure for read-only similarity search and memory recall.

**Deliverables:**
- Embedding population worker (contacts first, then incidents, legal leads)
- `GET /api/contacts/search?q=:text` — text-to-contact semantic search
- `GET /api/contacts/:id/similar` — contact similarity lookup
- Brain memory recall integration (context-aware retrieval for AI copilots)
- Vector observability dashboard

---

### Phase 8 — Workflow Intelligence

**Goal:** Outreach sequences are AI-assisted and territory-aware.

### Phase 9 — AI Copilots

**Goal:** Operator-facing AI assistant that explains, recommends, and drafts.

### Phase 10 — Autonomous Optimization

**Goal:** Closed-loop learning from outcomes feeds scoring and routing models.

---

## Architectural Constraints

### What Apex Must Never Do

| Constraint | Reason |
|-----------|--------|
| Fabricate contact data | Legal liability, trust destruction |
| Hallucinate buyers or victims | Data integrity |
| Create recursive uncontrolled AI loops | Railway OOM, cost explosion |
| Overwrite verified identity with weaker data | Enrichment regression |
| Globally bypass auth | Security |
| Promote raw signals directly into CRM contacts | The core architectural mistake to fix |
| Run N+1 query patterns | Railway CPU |
| Full-table vector scans without HNSW | Query latency |

### Fallback Hierarchy for Every AI Decision

```
1. Deterministic logic (rule-based, verified data)
2. AI augmentation (scored, explainable, bounded)
3. Explainable uncertainty (confidence < threshold → flag for human review)
```

---

## Document Index

| Document | Contents |
|---------|---------|
| `APEX_SIGNAL_ENGINE.md` | Signal collection, normalization, source health |
| `APEX_INCIDENT_INTELLIGENCE.md` | Incident grouping, fingerprinting, severity scoring |
| `APEX_ENTITY_RESOLUTION.md` | Identity resolution, confidence scoring, deduplication |
| `APEX_CRM_INTELLIGENCE.md` | CRM lifecycle, filter architecture, operational views |
| `APEX_TERRITORY_INTELLIGENCE.md` | Geo-aware routing, territory definitions, heatmaps |
| `APEX_LEGAL_SIGNAL_INTELLIGENCE.md` | Recall/liability enrichment, attorney summaries |
| `APEX_BUSINESS_INTELLIGENCE.md` | Niche vertical opportunity scoring |
| `APEX_SEMANTIC_RETRIEVAL.md` | pgvector search, embedding strategy, throttling |
| `APEX_CASE_INTEL.md` | Case aggregation, scoring, outreach integration |
| `APEX_DISTRIBUTION_INTELLIGENCE.md` | Routing, SLA, conversion tracking |
| `APEX_PLATFORM_OPS.md` | Observability, logging, queue health, SLA metrics |

---

## Guiding Principle

> Every feature, every table, every endpoint must answer one question:
> **Does this make an operator more effective at acting on real-world events?**

If the answer is no — it does not ship.
