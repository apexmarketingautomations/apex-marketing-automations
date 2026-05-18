# APEX Platform Audit — Executive Summary
**Audit Date:** 2026-05-18  
**Auditor:** Claude Code (Sonnet 4.6)  
**Branch:** `claude/amazing-banach-2834a7`

---

## Overall Assessment

The Apex platform is a sophisticated 8-layer legal/property intelligence system with strong core architecture. The crash ingestion pipeline, enrichment stages, AI gateway, and billing subsystems are production-ready. Several critical security gaps were identified and fixed in this pass. Multiple UI pages have hardcoded account IDs and do not use the `useAccount()` hook, creating data isolation risk for multi-tenant deployments.

---

## What WORKS (Production-Ready)

| System | Status | Notes |
|---|---|---|
| AI Gateway (`server/aiGateway.ts`) | WORKING | Anthropic → OpenAI → Groq → Gemini fallback chain complete |
| Groq provider | WORKING | Free-tier llama-3.1-8b/70b, registered as fallback after OpenAI |
| Circuit breaker (OpenAI) | WORKING | 5 failures / 3min window → 2min cooldown |
| Anthropic quota tracking | WORKING | 5-min cooldown on 429/402 before retry |
| Crash ingestion pipeline | WORKING | FHP → crash_reports → FLHSMV → contacts |
| Contact upsert dedup | WORKING | Dual-key: sourceExternalId + incidentFingerprint |
| Phone confidence hierarchy | WORKING | 0.95 (govt verified) down to 0.30 (unknown) |
| Address confidence hierarchy | WORKING | Victim-centric, looksLikeHighwayAddress() guard |
| Sentinel route auth | WORKING | verifyAccountOwnership on all user-facing endpoints |
| Domain manager (server) | WORKING | RDAP availability, DNS verification, TXT token flow |
| Digital card analytics | WORKING | Sessions, events, vCard export |
| BullMQ queue system | WORKING | Via server/jobQueue.ts |
| Postgres migrations | WORKING | dataMigrations.ts runs at boot |
| Railway deployment | WORKING | Preview → main → production auto-deploy |
| Operator brain | WORKING | server/operator/ — real agent with memory/goals |
| Subscription guard | WORKING | requireActiveSubscription() on sensitive routes |
| Tenant middleware | WORKING | APEX_PARENT_ACCOUNT_ID=3, 60s cache |

---

## What PARTIALLY WORKS

| System | Status | Issue |
|---|---|---|
| Dynamic Pages schema store | PARTIAL | In-memory only — data lost on restart. No DB persistence yet. |
| Reputation page | PARTIAL | Hardcoded `SUB_ACCOUNT_ID = 1` — all users see account #1's data |
| Domains page | PARTIAL | Fallback to hardcoded accountId=13 when no active account |
| Digital Card builder | PARTIAL | Stripe integration for one-time purchase works; edit flow needs session token verification |
| Meta/Ads integration | PARTIAL | OAuth flow present; real ad creation requires Meta App Review approval |
| Email campaigns | PARTIAL | SendGrid verified sender flow works; template system partially implemented |
| Chaturbate integration | PARTIAL | Routes exist; not verified as working in production |
| AI image generation | PARTIAL | Gemini fallback works; DALL-E 3 only when OpenAI key is valid sk- format |

---

## What is BROKEN / PLACEHOLDER

| System | Status | Issue |
|---|---|---|
| `/api/legal-leads` (FIXED) | WAS BROKEN | subAccountId filter built but never applied to query — returned ALL leads cross-tenant |
| PromptDesignPanel localStorage (FIXED) | WAS BROKEN | Single global key for prompt history — cross-account leakage in shared sessions |
| Dynamic Pages startup log (FIXED) | WAS MISSING | No warning about volatile in-memory store |
| `client/src/pages/reputation.tsx` | RISK | `const SUB_ACCOUNT_ID = 1` hardcoded — flagged but not fully fixed |

---

## What is RISKY

| Risk | Severity | Description |
|---|---|---|
| `is_admin` stored as varchar "true"/"false" | HIGH | String comparison `user.isAdmin === "true"` is fragile — could be bypassed with "TRUE" or " true" |
| `/api/legal/attorneys` unauthenticated | MEDIUM | Returns attorney directory without auth — data is not CRM/private but is scraped PII |
| `STANDALONE_ADMIN_SECRET` default value | HIGH | Falls back to hardcoded "201120062017" if env var not set — should fail loudly not fallback |
| No API key auth system | HIGH | All auth is session-based (Firebase + Passport). No programmatic API keys for automation. |
| Dynamic Pages schema store | HIGH | Server restart loses all saved pages — production data loss risk |
| Anthropic primary provider | MEDIUM | When ANTHROPIC_API_KEY is set, ALL requests go to paid Anthropic first. Simple patches (color, motion) should use Groq/local instead. |
| `forceProvider` not validated | LOW | Any caller can set `forceProvider: "anthropic"` to bypass cost routing |
