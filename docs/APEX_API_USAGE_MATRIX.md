# APEX API Usage Matrix
**Last Updated:** 2026-05-18

---

## AI Provider Usage by Route

| Route/Feature | Current Provider | Ideal Provider | Cost Level | Notes |
|---|---|---|---|---|
| Dynamic page generation | Anthropic→OpenAI→Groq→Gemini | Groq (llama-70b) or Gemini | PAID → FREE | Complex template generation — Groq 70b is sufficient |
| Dynamic page patch — color/motion | Anthropic→OpenAI→Groq→Gemini | **Local patch engine** | PAID → ZERO | `applyLocalPromptPatch()` handles these already client-side |
| Dynamic page patch — complex | Anthropic→OpenAI→Groq→Gemini | Groq (llama-70b) | PAID → FREE | |
| Bot chat (Sentinel) | Anthropic→OpenAI→Groq→Gemini | Groq (fast, FAST tier) | PAID → FREE | |
| Operator brain reasoning | Anthropic | Anthropic | HIGH | Must stay Anthropic — complex reasoning |
| Review AI response | Anthropic→OpenAI→Groq→Gemini | Groq or Gemini | PAID → FREE | Simple template fill |
| Content planner | Anthropic→OpenAI→Groq→Gemini | Groq or Gemini | PAID → FREE | |
| Skip-trace enrichment classification | N/A (rule-based) | N/A | ZERO | Not using AI |
| Attorney scraping classification | N/A | N/A | ZERO | Apify handles |
| Image generation | DALL-E 3 → Gemini | Gemini (free) | PAID → NEAR-FREE | Gemini 2.0 flash exp |

---

## External API Usage by Provider

### Twilio
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| SMS outbound | Manual send, workflow trigger, alert | $0.0079/segment | No explicit quota |
| SMS inbound | Twilio webhook | Free to receive | N/A |
| Number provisioning | Account setup | $1/month | No |

### Vapi
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| Voice call | User-initiated or AI-triggered | $1.50/min (marked up) | No |
| Call transcription | Per call | Included in Vapi rate | N/A |

### FLHSMV (via Nimble)
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| Driver license lookup | Per crash report processing | Nimble credit | No explicit check |
| Plate lookup | Per crash report | Nimble credit | No explicit check |

### BatchData
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| Skip-trace | When contact has no phone | $0.XX/lookup | Phone guard exists (source intelligence) |

### Apify
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| Attorney scrape | Manual admin trigger | Apify credits | No quota check |
| Transport scraper | Signal pipeline | Apify credits | No quota check |

### RDAP (Domain availability)
| Operation | Trigger | Cost | Quota Check? |
|---|---|---|---|
| Single domain check | User domain check | Free | No (rate limit risk) |
| Multi-TLD search (30+ calls) | Domain search | Free | No (30+ parallel calls per search) |

---

## Cost Control Status

| Control | Implemented? | Notes |
|---|---|---|
| Per-account daily AI budget | NO | KI-009 / P2 roadmap item |
| Task-complexity routing | PARTIAL | `forceProvider` exists; no automatic routing |
| Local patch engine (client) | YES | `applyLocalPromptPatch()` handles simple prompts |
| Local patch engine (server) | NO | Should pre-filter before hitting any AI provider |
| Groq as free fallback | YES | In fallback chain after OpenAI |
| Anthropic quota tracking | YES | 5-min cooldown on quota exhaustion |
| OpenAI circuit breaker | YES | 5 failures / 3min → 2min cooldown |
| BatchData source guard | YES | Won't run if contact already has phone |
| Retro enrichment quota | YES | Configurable `limit` param on admin endpoints |

---

## Free vs Paid Calls Today

When `ANTHROPIC_API_KEY` is set (current production):
- **100% of AI calls hit Anthropic first** → paid at Anthropic rates
- Groq is only used as fallback after all paid providers fail
- Local patch engine only runs client-side (pre-API call), not server-side

**Target state after P2 fixes:**
- Simple prompts: 0% paid (local engine)
- Medium prompts: Groq free tier (~70-80% of requests)
- Complex prompts (operator, reasoning): Anthropic (remaining 20-30%)
