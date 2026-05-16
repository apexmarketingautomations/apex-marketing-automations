# Stage 5 — Unified AI Orchestration Layer

> **Status**: ✅ Deployed — commit `500ec3b`
> **Location**: `server/ai/`
> **Public API**: `server/aiGateway.ts` (backward-compatible, unchanged import paths)

---

## Overview

Stage 5 replaces scattered, provider-specific AI calls with a centralized orchestration layer.
Every AI request flows through a standardized pipeline:

```
Application code
     │
     ▼
aiGateway.ts  (backward-compat public API)
     │
     ▼
aiTaskRouter  ── builds routing plan (provider/model candidates)
     │
     ▼
aiFallbackEngine  ── tries candidates in order; catches & classifies errors
     ├── providerRegistry  ── health signals, circuit breaker, quota backoff
     ├── aiBudgetManager   ── spend tracking, hard/soft caps, emergency shutdown
     └── aiObservability   ── structured logs → Axiom, Sentry error capture
```

---

## Module Map

| File | Purpose |
|------|---------|
| `server/ai/types.ts` | Shared types: `AITaskType`, `ProviderName`, `ModelProfile`, `ProviderHealth`, `BudgetContext`, `StructuredOutputResult`, etc. |
| `server/ai/providerRegistry.ts` | Model catalogue, health tracking, circuit breaker, EWMA latency |
| `server/ai/aiObservability.ts` | Per-call structured logging → Axiom drain, Sentry errors, process metrics |
| `server/ai/aiBudgetManager.ts` | 24h rolling spend, soft/hard caps, per-account limits, emergency shutdown |
| `server/ai/modelCapabilities.ts` | Task type → capability → provider preference → model override mappings |
| `server/ai/aiTaskRouter.ts` | Builds `RoutingPlan` respecting health, config, and budget |
| `server/ai/aiFallbackEngine.ts` | `withFallback()` / `withFallbackSafe()` — ordered candidate chain |
| `server/ai/aiStructuredOutput.ts` | JSON extraction, schema validation, confidence scoring, auto-retry |
| `server/ai/index.ts` | Public re-export surface |

---

## Task Types

```typescript
type AITaskType =
  | "reasoning"          // Claude Sonnet → GPT-4o → Gemini
  | "extraction"         // Claude Sonnet → GPT-4o-mini → Gemini
  | "ocr-assist"         // Gemini (1M ctx, multimodal) → Claude
  | "embeddings"         // OpenAI text-embedding → Gemini → Ollama
  | "classification"     // Claude Haiku → GPT-4o-mini (cheap, fast)
  | "scoring"            // Claude Haiku → GPT-4o-mini
  | "summarization"      // Claude Haiku → GPT-4o-mini → Gemini
  | "workflow-analysis"  // Claude Sonnet (long-ctx) → GPT-4o → Gemini
  | "semantic-retrieval" // Any (reranking is local)
  | "image-generation"   // DALL-E 3 → Gemini 2.0 Flash
  | "chat"               // Claude Sonnet → GPT-4o-mini → Gemini
  | "code"               // Claude Sonnet → GPT-4o
  | "reranking";         // Ollama local → Claude Haiku
```

---

## Provider Registry

### Model Catalogue

| Model | Provider | Context | Tier | Input $/1k | Output $/1k |
|-------|----------|---------|------|-----------|------------|
| claude-sonnet-4-6 | anthropic | 200k | 1 | $0.003 | $0.015 |
| claude-3-5-haiku-20241022 | anthropic | 200k | 2 | $0.0008 | $0.004 |
| claude-opus-4-5 | anthropic | 200k | 1 | $0.015 | $0.075 |
| gpt-4o | openai | 128k | 1 | $0.0025 | $0.010 |
| gpt-4o-mini | openai | 128k | 2 | $0.00015 | $0.0006 |
| text-embedding-3-small | openai | 8k | 3 | $0.00002 | — |
| text-embedding-3-large | openai | 8k | 2 | $0.00013 | — |
| dall-e-3 | openai | — | 1 | — | — |
| gemini-2.5-flash | gemini | 1M | 2 | $0.000075 | $0.0003 |
| gemini-2.0-flash-exp | gemini | 1M | 2 | $0.0001 | $0.0004 |
| llama3.2:3b | ollama | 128k | 3 | $0 | $0 |
| nomic-embed-text | ollama | 8k | 3 | $0 | $0 |

### Health Tracking

```typescript
interface ProviderHealth {
  status: "healthy" | "degraded" | "unavailable" | "quota-exhausted";
  consecutiveFailures: number;
  circuitTrippedAt: Date | null;   // circuit breaker trip time
  quotaResetAt: Date | null;       // quota backoff expiry
  errorRatePct: number;            // rolling error rate (last 100 calls)
  observedP50Ms: number;           // EWMA latency (α=0.1)
}
```

**Circuit breaker**: trips at 5 failures in 3-minute window → 2-minute cooldown → auto-reset.

**Quota backoff**: 402/billing errors → 5-minute backoff → auto-restore.

---

## Fallback Engine

```typescript
// Usage — application code
import { buildPlan, withFallback } from "../ai";

const plan = buildPlan("reasoning", { subAccountId: 42, route: "case:score" });
const result = await withFallback(
  plan,
  async (candidate) => {
    const text = await callMyProvider(candidate.provider, candidate.modelId, messages);
    return { value: text, usage: { promptTokens: 100, completionTokens: 200 } };
  },
  "reasoning",
  { subAccountId: 42, route: "case:score" },
);
// result.value is the response text
// result.trace has full observability metadata
```

**Error classification**:

| HTTP Status / Message | Classification | Action |
|---|---|---|
| 401, 403 | auth-error | Mark unavailable, skip all remaining calls to this provider |
| 402, billing message | quota-exhausted | Quota backoff (5 min), try next provider |
| 429 rate limit | rate-limited | Try next provider |
| 500, 503, 529 | transient-error | Try next provider |
| timeout / ECONNRESET | timeout | Try next provider |

---

## Budget Manager

### Configuration (env vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_BUDGET_HARD_LIMIT_USD` | 10.00 | Global 24h hard cap — blocks requests when exceeded |
| `AI_BUDGET_SOFT_LIMIT_USD` | 7.00 | Global 24h soft cap — logs warning when exceeded |
| `AI_BUDGET_PER_ACCOUNT_USD` | 2.00 | Per sub-account 24h hard cap |
| `AI_BUDGET_EMERGENCY_SHUTDOWN` | false | Set to "true" to immediately block all AI calls |

### Budget report endpoint

```
GET /api/internal/ai-health
X-Admin-Secret: <STANDALONE_ADMIN_SECRET>
```

Returns:
```json
{
  "timestamp": "...",
  "providers": { "anthropic": {...health...}, "openai": {...}, "gemini": {...} },
  "budget": {
    "globalSpendUsd": 1.24,
    "globalHardLimitUsd": 10.00,
    "globalUtilizationPct": 12,
    "byProvider": { "anthropic": 1.10, "openai": 0.14 },
    "byTaskType": { "reasoning": 0.80, "extraction": 0.44 },
    "topAccounts": [...]
  },
  "metrics": {
    "totalCalls": 847,
    "totalSuccesses": 844,
    "totalFallbacks": 12,
    "estimatedCostUsd": 1.24
  }
}
```

---

## Observability

Every AI call emits a structured JSON log line (type `ai_call`) picked up by the Axiom drain:

```json
{
  "_time": "2026-05-16T...",
  "type": "ai_call",
  "request_id": "a1b2c3d4e5f6a7b8",
  "task_type": "reasoning",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "latency_ms": 1240,
  "success": true,
  "fallback_triggered": false,
  "fallback_chain": "",
  "prompt_tokens": 512,
  "completion_tokens": 384,
  "estimated_cost_usd": 0.00729,
  "route": "case:score",
  "sub_account_id": 42
}
```

**Axiom APL query** (Apex-logs dataset):

```apl
['apex-logs']
| where type == "ai_call"
| summarize count(), avg(latency_ms), sum(estimated_cost_usd) by provider, task_type
| sort by sum_estimated_cost_usd desc
```

---

## Structured Output

```typescript
import { parseStructuredOutput, requiresKeys } from "../ai";

interface ScoreResult { score: number; reason: string; }
const isScoreResult = requiresKeys<ScoreResult>(["score", "reason"]);

const result = await parseStructuredOutput<ScoreResult>(
  rawModelText,
  isScoreResult,
  async (errorPrompt) => {
    // retry with error prompt
    const res = await aiChat([{ role: "user", content: errorPrompt }]);
    return res.text;
  },
  2,           // maxRetries
  '{"score": number, "reason": string}'  // schema hint for retry prompt
);

if (result.valid) {
  console.log(result.data!.score);     // typed, validated
  console.log(result.confidence);      // from model's _confidence field if present
} else {
  console.warn(result.parseError);
}
```

---

## Backward Compatibility

All 37 files importing from `server/aiGateway.ts` are **unchanged**.

`aiGateway.ts` now re-exports Stage 5 utilities alongside its own API:

```typescript
// Existing API — unchanged
export { aiChat, aiChatStream, aiChatWithTools, aiGenerateImage }
export { isAIConfigured, isAnthropicConfigured, getAIProviderStatus }

// New Stage 5 utilities — available from aiGateway.ts
export { getBudgetReport, getProcessMetrics, isEmergencyShutdownActive }
export { buildAIRoutingPlan, withAIFallback, withAIFallbackSafe }
export { parseStructuredOutput, parseAIJSON, requiresKeys }
export { getAllProviderHealth, setEmergencyShutdown }
```

---

## Next Steps (Stage 5 continuation)

- [ ] Wire `withFallback` into `aiChat` / `aiChatWithTools` in aiGateway.ts (replaces current manual fallback)
- [ ] Add embedding queue orchestration (`server/ai/embeddingQueue.ts`)
- [ ] Add OCR routing (`server/ai/ocrRouter.ts`) — Google Document AI, Gemini, Claude, Textract
- [ ] Migrate existing scattered AI calls to task-typed requests (case intel, scoring, summaries)
- [ ] Ollama local model interface (`server/ai/ollamaClient.ts`)
- [ ] Persistent budget tracking in DB (current: in-memory, resets on restart)
