# Apex Platform — Session Bootstrap

**READ `ARCHITECTURE.md` BEFORE DOING ANYTHING ELSE IN THIS REPO.**

That file is the single source of truth for how this platform works.
Every session — new or continued — must load it first.

## What Apex Is

Apex is an AI-first legal and property intelligence platform. It observes
the physical world (crashes, arrests, permits, court filings, property
activity), enriches signals into verified contacts using government records
and skip-trace vendors, and autonomously routes high-value opportunities to
attorneys and service firms via an operator brain with episodic memory and
goal tracking.

The 8-layer model:
```
Signal → Incident → Enrichment → Contact → Opportunity
→ Workflow → Document Intelligence → Semantic Memory
```

## Critical Rules

- **Never skip the architecture doc.** The platform has 9 active signal
  pipelines, 4 enrichment providers, a BullMQ queue system, a Postgres-backed
  crash worker, an operator brain, and pgvector semantic memory. You cannot
  reason about it correctly without reading the doc first.

- **Contact dedup keys (two levels):**
  - Per sub-account: `crash:{sentinelReportNumber}:acct{accountId}` (sourceExternalId)
  - Cross-account: `incidentFingerprint = SHA256("crash:{reportNumber}")` — all fan-out contacts share this
  Never overwrite a real phone with null. Never replace a real name with
  a placeholder. All contact writes go through `contactUpsertService.ts`.

- **Two report number types exist:**
  - `reportNumber` — synthetic SHA-256 hash (internal dedup key, never shown to users)
  - `officialReportNumber` — real FL government number (shown in UI, used for FLHSMV lookups)

- **Enrichment is async and multi-stage.** A contact starts as
  "Unidentified Crash Incident" and gains a name, address, plate, registered
  owner, and phone number across 5 separate enrichment stages. Never assume
  a contact is "complete" just because it exists.

- **VICTIM-CENTRIC ADDRESS ARCHITECTURE (v2, 2026-05-16) — MANDATORY RULES:**
  1. `contacts.address` holds RESIDENTIAL intelligence only — never a highway/intersection string.
  2. Crash scene locations are stored in `contacts.incidentLocation` (separate field).
  3. `addressConfidence` (0.0–0.95) gates scoring, exports, and skip-trace targeting.
  4. `looksLikeHighwayAddress()` in `contactUpsertService.ts` must be called before writing any address.
  5. Skip-trace targets: `probableResidence` > `registrationAddress` > `address` (never `incidentLocation`).
  6. Address upgrades only — `mergeContact()` never writes lower-confidence address over higher-confidence.
  7. `isPlaceholder=true` blocks all exports regardless of score.
  8. Export eligibility: real name + (phone OR email) + `addressConfidence > 0.15` or phone present.
  9. DHSMV registration address (0.90) beats FLHSMV driver license address (0.85).
  10. `verifiedResidence` is set only when Google Geocoding confirms a residential location.

- **Address confidence scale:** 0.95 (geocode verified) → 0.90 (DHSMV) → 0.85 (FLHSMV) →
  0.72 (BatchData) → 0.61 (probable) → 0.15 (incident scene) → 0.00 (unknown)

- **The operator brain is real.** `server/operator/` contains a persistent
  AI agent with memory, goals, planning, and autonomy. Don't treat it as
  dead code — it runs in production.

## Active Branch

Development branch: `claude/load-all-tools-m5zoo`
Always push to this branch. Always create a PR for review.
Never push directly to main.

## Key Files to Know

| File | What it does |
|---|---|
| `server/crashIngestPipeline.ts` | Ingests FHP signals into crash_reports |
| `server/crashReportWorker.ts` | Processes crash_reports → FLHSMV → contacts |
| `server/dhsmvRegistrationLookup.ts` | Nimble → DHSMV plate → registered owner |
| `server/nimbleClient.ts` | Nimble Pipeline API + residential proxy wrapper |
| `server/retroFLHSMVEnrich.ts` | Batch recover names on placeholder contacts |
| `server/retroSkipTrace.ts` | Batch recover phones on enriched contacts |
| `server/services/contactUpsertService.ts` | Single dedup entry point for all contact writes |
| `server/dataMigrations.ts` | Boot-time idempotent schema migrations |
| `server/vendorConfig.ts` | All vendor key resolution + CRASH_LEAD_ACCOUNT_IDS |
| `server/operator/agentBrain.ts` | Operator brain core reasoning loop |
| `server/operator/goalEngine.ts` | Goal tracking and progress management |
| `server/routing/resolver.ts` | Routes opportunities to attorney accounts |
| `shared/schema.ts` | Single source of truth for all DB table schemas |
| `ARCHITECTURE.md` | **Full 8-layer system documentation — read first** |

## Deployment

- Platform: Railway
- Env vars: set in Railway dashboard (never hardcode)
- Migrations: run automatically at boot via `dataMigrations.ts`
- Branch → PR → Railway preview → merge to main → production auto-deploys
- Admin retro jobs: POST `/api/internal/retro-flhsmv-enrich` and `/api/internal/retro-skip-trace`
