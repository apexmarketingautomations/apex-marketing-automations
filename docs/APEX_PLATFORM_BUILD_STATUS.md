# Apex Marketing OS — Platform Build Status

**Last updated:** 2026-05-16  
**Branch:** `phase-4b-architecture`

---

## Phase Completion Matrix

| # | Phase | Status | Completion |
|---|-------|--------|-----------|
| 1 | Core Platform Stabilization & Infrastructure Hardening | **Production** | ~90% |
| 2 | Contact System Normalization & Account Isolation | **Hardened** | ~80% |
| 3 | Signal Engine Reliability & Real-Time Pipeline Recovery | **Complete** | ~85% |
| 4 | Case Intelligence & Cross-Signal Correlation Engine | **Complete** | ~80% |
| 5 | Distribution / Routing / Automation Orchestration Layer | **Complete** | ~75% |
| 6 | AI Provider Stability + Agent Execution Framework | **Production** | ~70% |
| 7 | Home Services / Contractor Vertical Expansion (HPL) | **Hardened** | ~65% |
| 8 | Insurance Intelligence & Policy Opportunity Engine | **Built** | ~55% |
| 9 | Service Industry Operating System | **Built** | ~45% |
| 10 | Communications Layer (Voice / SMS / AI Receptionist) | **Complete** | ~70% |
| 11 | Analytics, Reporting, Billing & Enterprise Administration | **Complete** | ~65% |
| 12 | Scale Architecture / Compliance Layer | **Built** | ~50% |

---

## Phase 1 — Core Platform

### What's Built
- **BullMQ queue backbone** — 12 queues + DLQ (`apex-dead-letters`) via Upstash Redis (`server/queues/queueFactory.ts`)
- **Sentry error tracking** — full Node.js integration with `captureWorkerError()` (`server/instrument.ts`)
- **Axiom structured logging** — SDK-based log shipping to `apex-logs` dataset (`server/logger.ts`)
- **Database boot validator** — runs 3 integrity checks at startup, caches for `/api/admin/db-health` (`server/db/bootValidator.ts`)
- **Migration verifier** — checks `_data_migrations` table + 6 required pg_indexes (`server/db/migrationVerifier.ts`)
- **Orphan detector** — 15 FK anti-join checks (`server/db/orphanDetector.ts`)
- **Tenant integrity auditor** — 14-table null/invalid sub_account_id scan (`server/db/tenantIntegrity.ts`)
- **Reconciliation engine** — 7 concurrent scans (`server/db/reconciliationEngine.ts`)
- **Quarantine coordinator** — non-destructive `_data_quarantine` table (`server/db/quarantineCoordinator.ts`)
- **Performance auditor** — slow queries, bloat, unused indexes, cache hit (`server/db/performanceAuditor.ts`)
- **Sequence inspector** — read-only drift report (`server/db/sequenceInspector.ts`)
- **GitHub Actions CI** — typecheck + security audit (`.github/workflows/ci.yml`)
- **BatchData circuit breaker** + `BATCHDATA_DISABLED` kill switch
- **Admin endpoints** — 15 endpoints under `/api/admin/*`

### Remaining
- Multi-region deployment strategy
- Database partitioning for `contacts` + `legal_signals`

---

## Phase 2 — Contact System Normalization & Account Isolation

### What's Built
- **`verifyAccountOwnership()`** wired into all sentinel, messaging, analytics, meta, and home-service routes
- **`homeService.ts` hardened** — all 6 endpoints now call `verifyAccountOwnership()`, `?? 13` fallbacks removed
- **Cross-tenant enrichment leak sealed** — `crashReportWorker.ts` + `retroFLHSMVEnrich.ts` use SQL-level `sub_account_id` filters
- **Dedup merge worker** — `server/workers/dedupWorker.ts`
  - Merges contacts by normalized_phone within tenant
  - Keeps richest record (completeness score), quarantines losers
  - `runDedupScan(subAccountId)` for full-account sweeps
  - BullMQ jobs: `dedup_merge` + `dedup_scan` on `apex-maintenance`

### Remaining
- Full route audit of 51 remaining tenant-touching route files (analytics, arrests, etc.)
- Bulk validation run on existing contacts with null `sub_account_id`

---

## Phase 3 — Signal Engine Reliability & Pipeline Recovery

### What's Built
- **Signal reconciliation auto-repair worker** — `server/workers/signalReconciliationWorker.ts`
  - Auto-repairs: stale enrichment (reset + re-enqueue), stuck crash reports (reset to PENDING)
  - Quarantines: contacts without tenant, orphaned case signals
  - Enqueues: dedup_scan jobs for duplicate contacts
  - POST `/api/admin/reconciliation/repair` with `dryRun` support
- **DLQ replay engine** — `server/workers/dlqReplayEngine.ts`
  - `inspectDLQ()` — read jobs with failure context
  - `replayJob(jobId)` — single job replay to origin queue
  - `replayAll(filter)` — batch replay by queue/name/age
  - `purgeDLQ(jobIds)` — remove after operator review
  - `getDLQStats()` — breakdown by origin queue + error type
  - Admin endpoints: `GET /api/admin/dlq`, `POST /api/admin/dlq/replay`, `POST /api/admin/dlq/purge`

### Remaining
- Universal 12-stage pipeline standard document
- Automated DLQ alert when threshold exceeded

---

## Phase 4 — Case Intelligence & Cross-Signal Correlation Engine

### What's Built
- **Correlation worker** — `server/intelligence/correlationWorker.ts`
  - `correlateSignal(signal)` — upserts entity + case + case_signal link in one call
  - Entity key normalization by type (company/person/property) + county
  - Case composite score = weighted average of 7 dimension scores
  - `backfillCorrelation(limit)` — backfills existing legal_signals without case links
  - Admin endpoint: `POST /api/admin/correlation/backfill`
- Entity deduplication via `normalizedKey` unique index
- Case score recalculation on each new signal (GREATEST wins)

### Remaining
- LLM-generated case AI summaries (toggle via feature flag)
- Case evidence document ingestion pipeline
- Attorney match from case → sub-account routing

---

## Phase 5 — Distribution / Routing / Automation

### What's Built
- **Multi-vertical webhook delivery engine** — `server/routing/webhookDelivery.ts`
  - Supports all verticals: `home_services | legal | insurance | crash | service_industry | generic`
  - HMAC-SHA256 payload signing (X-Apex-Signature header)
  - Exponential backoff retry (0s → 30s → 5min)
  - `webhook_delivery_log` audit table with latency, HTTP status, response snippet
  - `webhook_endpoints` registry table (tenant + vertical scoped)
  - Delivery idempotency via X-Delivery-Id header
  - Admin endpoint: `POST /api/admin/webhooks/endpoints` to register targets
- BullMQ worker on `apex-routing` queue for async delivery

### Remaining
- Endpoint health monitoring (automatic disable on repeated failures)
- Multi-endpoint fan-out per lead (deliver to multiple contractors simultaneously)

---

## Phase 6 — AI Provider Stability + Agent Execution

### What's Built
- `server/ai/` — providerRegistry, taskRouter, fallbackEngine, budgetManager, observability
- `server/operator/` — full 24-file agent execution framework
- `server/autonomy/` — orchestrator, safety policy, plan executor

### Remaining
- Per-tenant LLM cost attribution
- Fine-tune pipeline integration
- Agent tool sandboxing

---

## Phase 7 — Home Services / HPL

### What's Built
- Signal pipeline, scorer, delivery fully operational
- `homeService.ts` hardened with ownership checks on all endpoints

### Remaining
- Contractor capacity management
- Storm event auto-trigger pipeline

---

## Phase 8 — Insurance Intelligence & Policy Opportunity Engine

### What's Built
- **Insurance intelligence pipeline** — `server/insuranceIntelligencePipeline.ts`
  - `ensureInsuranceSchema()` — creates `insurance_opportunities` table
  - `processCrashInsuranceSignals(limit)` — scores crash reports for PIP/BI/fatal
  - Multi-factor scoring: fatality (+60), multi-injury (+45), multi-vehicle (+15), contact info (+20), recency (+10)
  - Auto-correlates high-score opportunities into intelligence cases
  - `getInsuranceOpportunities(params)` — filterable by score/status/type
  - Admin endpoints: `GET /api/admin/insurance-opportunities`, `POST /api/admin/insurance-opportunities/process`

### Remaining
- Legal signal → insurance opportunity pipeline (bad faith, coverage disputes)
- Home service → homeowner insurance pipeline (storm/fire damage)
- Arrest → SR-22 high-risk driver pipeline
- Carrier integration layer

---

## Phase 9 — Service Industry Operating System

### What's Built
- **Service industry pipeline** — `server/serviceIndustryPipeline.ts`
  - Verticals: `barbershop | salon | nail_salon | massage | spa | tattoo | esthetics | generic_service`
  - Signal types: `negative_review | license_expiry | no_show | rebooking_opportunity | competitor_opening | health_violation | permit_issue | staff_turnover`
  - `ensureServiceIndustrySchema()` — creates `service_industry_signals` + `service_businesses` tables
  - `ingestServiceSignal(params)` — scores + stores + correlates high-score signals
  - Scoring: license expiry <7 days = 95, health violation = 85, negative review ≤2 stars = 80
  - `getServiceSignals(params)` — filterable query

### Remaining
- Google Business Profile webhook integration
- Booking system integrations (Square, Vagaro, Fresha)
- Cosmetology license expiry monitor (state board data)

---

## Phase 10 — Communications Layer

### What's Built
- **AI Receptionist full loop** — `server/messaging/aiReceptionist.ts`
  - `handleInbound(msg)` — unified entry point for SMS/email/voice/chat
  - Intent detection: opt_out, book_appointment, escalate_agent, complaint, pricing_inquiry, general_question
  - TCPA gate: fires `checkTCPA()` before any auto-reply
  - Opt-out auto-handling: records DNC + responds immediately
  - `unified_conversations` table for multi-channel threading
  - `getConversationThread(subAccountId, contactId)` — cross-channel history
- **TCPA wired into SMS send path** — `server/messaging/sendSms.ts` now calls `checkTCPA()` as step 0
- Twilio SMS/voice, VAPI AI voice, Layla persona pipeline all operational

### Remaining
- iMessage integration
- VAPI call recording + transcription pipeline
- Escalation → live agent handoff notification

---

## Phase 11 — Analytics, Reporting, Billing & Enterprise Administration

### What's Built
- **System Health Center** — `client/src/pages/admin/system-health.tsx`
  - 6-panel React dashboard: DB boot, pipeline queues, DLQ, performance, reconciliation, sequences
  - One-click auto-repair for reconciliation issues
  - DLQ batch replay button
  - Auto-refreshes: queues every 15s, health every 30s, performance every 60s
  - Status badges (green/yellow/red) for all metrics
- 15 admin API endpoints covering all health + integrity surfaces

### Remaining
- Per-sub-account billing dashboards
- Revenue attribution reporting
- Enterprise audit log UI

---

## Phase 12 — Scale Architecture / Compliance Layer

### What's Built
- **TCPA compliance guard** — `server/compliance/tcpaGuard.ts`
  - `ensureComplianceTables()` — creates: `dnc_numbers`, `tcpa_consent_records`, `litigation_risk_numbers`, `tcpa_violation_log`, `data_retention_policies`
  - `checkTCPA(input)` — 5-rule gate: opt-out, DNC, quiet hours (8am–9pm), frequency cap, litigation risk
  - `recordConsent()` — document express/implied consent with IP + text
  - `recordOptOut()` — writes to `dnc_numbers` + updates `contacts.opt_out`
  - `getViolationLog()` — tenant violation history
  - **TCPA wired into `sendSms()`** as step 0 — blocks before Twilio even sees the call
  - Admin endpoints: `GET /api/admin/compliance/violations`, `POST /api/admin/compliance/opt-out`
- **Data retention policy engine** — `server/compliance/dataRetention.ts`
  - Default windows: webhook logs 90d, contacts 3yr, crash reports 2yr, legal signals 5yr
  - Strategies: `hard_delete`, `soft_delete` (sets `deleted_at`), `quarantine` (delegated to reconciliation worker)
  - Capped at 10k hard deletes / 5k soft deletes per run to prevent long-running transactions
  - Admin endpoint: `POST /api/admin/retention/run`

### Remaining
- CCPA/CPRA data subject request handling
- Automated DNC list daily refresh (National DNC Registry API)
- SOC2 audit trail completeness certification
- Multi-region data residency enforcement

---

## File Index — New Files Added This Session

```
server/
├── compliance/
│   ├── tcpaGuard.ts              — TCPA compliance gate (Phase 12)
│   └── dataRetention.ts          — Data retention policy engine (Phase 12)
├── db/
│   ├── bootValidator.ts           — Boot-time integrity validation (Phase 1A)
│   ├── migrationVerifier.ts       — Migration + schema drift check (Phase 1A)
│   ├── orphanDetector.ts          — 15 FK orphan scans (Phase 1A)
│   ├── quarantineCoordinator.ts   — Non-destructive record isolation (Phase 1A)
│   ├── reconciliationEngine.ts    — 7 reconciliation scans (Phase 1A)
│   ├── tenantIntegrity.ts         — 14-table tenant scan (Phase 1A)
│   ├── performanceAuditor.ts      — Slow queries, bloat, cache hit (Phase 1A)
│   └── sequenceInspector.ts       — Read-only sequence drift (Phase 1A)
├── intelligence/
│   └── correlationWorker.ts       — Cross-signal correlation (Phase 4)
├── messaging/
│   └── aiReceptionist.ts          — AI receptionist full loop (Phase 10)
├── routing/
│   └── webhookDelivery.ts         — Multi-vertical webhook delivery (Phase 5)
├── workers/
│   ├── dedupWorker.ts             — Contact dedup merge (Phase 2)
│   ├── dlqReplayEngine.ts         — DLQ inspection + replay (Phase 3)
│   └── signalReconciliationWorker.ts — Auto-repair worker (Phase 3)
├── insuranceIntelligencePipeline.ts — Insurance opportunity engine (Phase 8)
├── serviceIndustryPipeline.ts     — Service industry OS (Phase 9)
└── routes/
    ├── homeService.ts             — Hardened with ownership checks (Phase 2)
    ├── admin.ts                   — 15 endpoints added (Phases 1A, 3, 4, 5, 8, 12)
    └── ...

client/src/pages/admin/
└── system-health.tsx              — System Health Center dashboard (Phase 11)

docs/
└── APEX_PLATFORM_BUILD_STATUS.md  — This file
```

---

## Admin Endpoint Reference

| Method | Path | Phase | Description |
|--------|------|-------|-------------|
| GET | `/api/admin/db-health` | 1A | Cached boot validation result |
| GET | `/api/admin/schema-audit` | 1A | Migration verify + schema drift |
| GET | `/api/admin/orphan-scan` | 1A | 15 FK orphan checks |
| GET | `/api/admin/tenant-integrity` | 1A | 14-table tenant scan |
| GET | `/api/admin/reconciliation-report` | 1A | 7 reconciliation scans |
| GET | `/api/admin/quarantine-status` | 1A | Quarantine log |
| POST | `/api/admin/run-integrity-repair` | 1A | 4 repair actions |
| GET | `/api/admin/sequence-audit` | 1A | Sequence drift report |
| GET | `/api/admin/db-performance` | 1A | Perf audit |
| GET | `/api/admin/pipeline-metrics` | Ops | Queue depths + DLQ |
| GET | `/api/admin/dlq` | 3 | DLQ inspection |
| POST | `/api/admin/dlq/replay` | 3 | Replay jobs |
| POST | `/api/admin/dlq/purge` | 3 | Purge jobs |
| POST | `/api/admin/reconciliation/repair` | 3 | Auto-repair with dryRun |
| POST | `/api/admin/correlation/backfill` | 4 | Backfill signal correlation |
| POST | `/api/admin/webhooks/endpoints` | 5 | Register webhook endpoint |
| GET | `/api/admin/insurance-opportunities` | 8 | Insurance opportunity list |
| POST | `/api/admin/insurance-opportunities/process` | 8 | Process crash signals |
| GET | `/api/admin/compliance/violations` | 12 | TCPA violation log |
| POST | `/api/admin/compliance/opt-out` | 12 | Manual DNC add |
| POST | `/api/admin/retention/run` | 12 | Run data retention |
