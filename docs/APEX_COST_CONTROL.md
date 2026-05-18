# APEX Cost Control Policy
**Last Updated:** 2026-05-18

---

## Guiding Principles

1. **Never make paid external calls on page load** — all data fetching on load must use cached data or free-tier APIs
2. **Never run BatchData/Apify/Nimble without a quota check** — these cost real money per call
3. **Prefer local → free → cached → paid** — exhaust free options before hitting paid APIs
4. **Never log API keys** — enforced by code review, not runtime checks
5. **Simple transforms are never paid AI calls** — color changes, motion settings, darkness are local patches

---

## LLM Routing Priority (Phase 17 Target)

```
Priority 1: Client-side keyword patching (ZERO cost)
  → applyLocalPromptPatch() on client
  → Handles: color, motion, darkness, glow, particles, speed

Priority 2: Cached response
  → In-memory response cache with TTL
  → Key: hash(prompt + schema fingerprint)

Priority 3: Groq free tier
  → llama-3.1-8b-instant: simple responses, < 1024 tokens
  → llama-3.3-70b-versatile: medium complexity
  → Rate limits: 30 req/min (free tier)

Priority 4: Gemini (low-cost)
  → gemini-2.5-flash: complex prompts, vision tasks
  → Free tier: generous daily quota

Priority 5: OpenAI (paid, only when needed)
  → gpt-4o-mini: tool calling, structured output
  → Fallback when Groq/Gemini fail

Priority 6: Anthropic (highest quality, admin tasks only)
  → claude-sonnet-4-6: operator brain, complex legal analysis
  → NEVER used for: color patches, basic classification, schema cleanup
```

---

## Current vs Target Routing

| Task | Current | Target | Cost Saving |
|---|---|---|---|
| "Make it darker" patch | Anthropic ($$$) | Local patch engine ($0) | 100% |
| "Reduce motion" patch | Anthropic ($$$) | Local patch engine ($0) | 100% |
| "Add glow to CTA" patch | Anthropic ($$$) | Local patch engine ($0) | 100% |
| Dynamic page generation (complex) | Anthropic ($$$) | Groq 70b (free) | ~95% |
| Review AI response | Anthropic ($$$) | Groq 8b (free) | ~95% |
| Bot chat | Anthropic ($$$) | Groq 8b (free) | ~95% |
| Operator brain reasoning | Anthropic ($$$) | Anthropic ($$$) | 0% — intended |
| Legal signal classification | N/A | N/A | — |

---

## DO NOT Call Anthropic/OpenAI For

These patterns should be caught by `applyLocalPromptPatch()` or a server-side pre-filter before any AI provider is invoked:

```typescript
// Simple color/style patches — handle locally
const LOCAL_PATCH_PATTERNS = [
  /make it (darker|lighter|brighter)/i,
  /reduce (motion|animation|movement)/i,
  /add (glow|glow effect) (to|on)/i,
  /change (color|colors|theme|palette)/i,
  /make (it )?(more|less) (dark|bright|colorful)/i,
  /speed up|slow down|faster|slower/i,
  /(add|remove) particles/i,
  /make (it )?mobile friendly/i,
];
```

---

## Paid API Quota Controls

### BatchData (skip-trace)
- **Guard:** `if (contact.phone) return false` in `retroSkipTrace.ts` — enforced
- **Guard:** `skipTraceStatus === "source_matched"` — blocks BatchData on govt-sourced contacts
- **Recommended:** Add daily per-account limit of 100 BatchData calls

### Nimble (FLHSMV/DHSMV proxy)
- **Guard:** Only triggered from `crashReportWorker.ts` on crash records
- **Recommended:** Add quota tracking per subAccountId

### Apify
- **Guard:** Only triggered by admin endpoints
- **No user-facing quota needed**

### RDAP Domain Search
- **Risk:** 30+ parallel HTTP calls per domain search query
- **Fix:** Add 5s rate limit per IP/session on domain search endpoint

---

## Response Caching (Phase 17 Implementation Target)

```typescript
// server/services/aiResponseCache.ts (TODO: implement)
interface AICacheEntry {
  text: string;
  provider: string;
  createdAt: number;
  ttlMs: number;
}

const cache = new Map<string, AICacheEntry>();

function getCacheKey(messages: ChatMessage[], subAccountId?: number): string {
  const content = messages.map(m => m.content).join("|");
  return crypto.createHash("sha256").update(content).digest("hex");
}

// TTL policy:
// - Static schema generation: 1 hour (same prompt = same schema)
// - Incremental patches: 5 minutes
// - Chat responses: no cache (personalized)
```

---

## Daily Usage Meters (Phase 17 Implementation Target)

Add to `server/ai/` registry:

```typescript
// Per-account daily meter
interface DailyMeter {
  subAccountId: number;
  date: string; // YYYY-MM-DD
  anthropicTokens: number;
  groqTokens: number;
  geminiTokens: number;
  totalCostUSD: number;
}

// Hard limits (default, overridable per account):
const DEFAULT_DAILY_AI_BUDGET_USD = 5.00;
const DEFAULT_DAILY_GROQ_TOKENS = 500_000;
```

---

## Circuit Breaker Summary (Current)

| Provider | Threshold | Window | Cooldown | Status |
|---|---|---|---|---|
| OpenAI | 5 failures | 3 minutes | 2 minutes | ACTIVE |
| Anthropic | quota failure | — | 5 minutes | ACTIVE |
| Groq | none | — | — | No CB yet |
| Gemini | none | — | — | No CB (final fallback) |
