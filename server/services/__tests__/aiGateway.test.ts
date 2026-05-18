/**
 * server/services/__tests__/aiGateway.test.ts
 *
 * Verifies the AI gateway fallback chain:
 * - Anthropic → OpenAI → Gemini priority order
 * - Gemini 403 → isGeminiBlocked() becomes true → fallback fires
 * - ok:false result always has text === "" (never raw JSON)
 * - Local deterministic fallback when all providers fail
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock external dependencies before importing aiGateway ────────────────────

vi.mock("../../gemini", () => ({
  geminiChat:          vi.fn(),
  geminiChatStream:    vi.fn(),
  geminiGenerateImage: vi.fn().mockResolvedValue(null),
  isGeminiAvailable:   vi.fn(() => false),
  isGeminiConfigured:  vi.fn(() => false),
}));

vi.mock("../../ai/index", () => ({
  recordProviderSuccess:  vi.fn(),
  recordProviderFailure:  vi.fn(),
  logRegistryStartup:     vi.fn(),
  getBudgetReport:        vi.fn(() => ({})),
  getProcessMetrics:      vi.fn(() => ({})),
  isEmergencyShutdownActive: vi.fn(() => false),
  buildPlan:              vi.fn(),
  withFallback:           vi.fn(),
  withFallbackSafe:       vi.fn(),
  parseStructuredOutput:  vi.fn(),
  parseJSON:              vi.fn(),
  requiresKeys:           vi.fn(),
  getAllProviderHealth:    vi.fn(() => ({})),
  setEmergencyShutdown:   vi.fn(),
}));

import {
  isGeminiBlocked,
  getAIProviderStatus,
  aiChat,
  _testOnly,
} from "../../aiGateway";
import { isGeminiConfigured, isGeminiAvailable, geminiChat } from "../../gemini";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_PROVIDERS_ENV = {
  ANTHROPIC_API_KEY:               "",
  AI_INTEGRATIONS_ANTHROPIC_API_KEY: "",
  OPENAI_APEX_INT_KEY:             "",
  AI_INTEGRATIONS_OPENAI_API_KEY:  "",
  GROQ_API_KEY:                    "",
};

function stubNoProviders() {
  for (const [k, v] of Object.entries(NO_PROVIDERS_ENV)) vi.stubEnv(k, v);
  vi.mocked(isGeminiConfigured).mockReturnValue(false);
  vi.mocked(isGeminiAvailable).mockReturnValue(false);
}

function makeAnthropicFetchMock(opts: { ok: boolean; status?: number; text?: string; body?: object }) {
  return vi.fn().mockResolvedValue({
    ok:   opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    text: async () => opts.text ?? "",
    json: async () => opts.body ?? {},
  });
}

// ── Suite 1: Gemini blocked-state management ─────────────────────────────────

describe("isGeminiBlocked — state management", () => {
  beforeEach(() => {
    _testOnly.resetGeminiBlocked();
  });

  it("starts as false (not blocked)", () => {
    expect(isGeminiBlocked()).toBe(false);
  });

  it("becomes true after markGeminiBlocked()", () => {
    _testOnly.markGeminiBlocked("unit test");
    expect(isGeminiBlocked()).toBe(true);
  });

  it("auto-resets to false after 10-minute cooldown", () => {
    vi.useFakeTimers();
    _testOnly.markGeminiBlocked("unit test");
    expect(isGeminiBlocked()).toBe(true);

    vi.advanceTimersByTime(600_001); // 10 min + 1 ms
    expect(isGeminiBlocked()).toBe(false);

    vi.useRealTimers();
  });

  it("resetGeminiBlocked() clears the block immediately", () => {
    _testOnly.markGeminiBlocked("unit test");
    expect(isGeminiBlocked()).toBe(true);
    _testOnly.resetGeminiBlocked();
    expect(isGeminiBlocked()).toBe(false);
  });
});

// ── Suite 2: Gemini 403 triggers block + fallback ────────────────────────────

describe("Gemini 403 → block + fallback", () => {
  beforeEach(() => {
    stubNoProviders();
    _testOnly.resetGeminiBlocked();
    _testOnly.resetAnthropicQuota();
    _testOnly.resetCircuitBreaker();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _testOnly.resetGeminiBlocked();
  });

  it("sets isGeminiBlocked() to true when geminiChat throws 403", async () => {
    vi.mocked(isGeminiConfigured).mockReturnValue(true);
    vi.mocked(isGeminiAvailable).mockReturnValue(true);
    vi.mocked(geminiChat).mockRejectedValue(
      Object.assign(new Error("403 API_KEY_SERVICE_BLOCKED"), { status: 403 })
    );

    await aiChat([{ role: "user", content: "hello" }]);

    expect(isGeminiBlocked()).toBe(true);
  });

  it("returns ok:false after Gemini 403 with no other providers", async () => {
    vi.mocked(isGeminiConfigured).mockReturnValue(true);
    vi.mocked(isGeminiAvailable).mockReturnValue(true);
    vi.mocked(geminiChat).mockRejectedValue(
      Object.assign(new Error("403 forbidden"), { status: 403 })
    );

    const result = await aiChat([{ role: "user", content: "hello" }]);

    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
  });

  it("text is always empty string when ok is false (never raw JSON)", async () => {
    // All providers unconfigured → localDeterministicFallback
    const result = await aiChat([{ role: "user", content: "hello" }]);

    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
    // text must not look like JSON or an error message
    expect(result.text).not.toMatch(/^\{/);
    expect(result.text).not.toMatch(/\[AI Error/);
  });

  it("blocked Gemini is skipped when Anthropic is available and succeeds", async () => {
    // Pre-block Gemini
    _testOnly.markGeminiBlocked("pre-blocked");
    vi.mocked(isGeminiConfigured).mockReturnValue(true);
    vi.mocked(isGeminiAvailable).mockReturnValue(true);

    // Anthropic is configured and succeeds
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-long-enough-1234567890");
    vi.stubGlobal("fetch", makeAnthropicFetchMock({
      ok:   true,
      body: { content: [{ text: "Anthropic wins" }], usage: { input_tokens: 5, output_tokens: 5 } },
    }));

    const result = await aiChat([{ role: "user", content: "hello" }]);

    // Gemini should never have been called — Anthropic served it
    expect(vi.mocked(geminiChat).mock.calls.length).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("anthropic");
  });
});

// ── Suite 3: No providers → local deterministic fallback ─────────────────────

describe("local deterministic fallback — all providers down", () => {
  beforeEach(() => {
    stubNoProviders();
    _testOnly.resetGeminiBlocked();
    _testOnly.resetAnthropicQuota();
    _testOnly.resetCircuitBreaker();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns ok:false with an errorMessage", async () => {
    const result = await aiChat([{ role: "user", content: "generate something" }]);
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(typeof result.errorMessage).toBe("string");
    expect(result.errorMessage!.length).toBeGreaterThan(5);
  });

  it("text is exactly empty string — callers cannot accidentally show it", async () => {
    const result = await aiChat([{ role: "user", content: "anything" }]);
    expect(result.text).toBe("");
  });

  it("errorMessage is user-friendly (no raw stack traces or JSON blobs)", async () => {
    const result = await aiChat([{ role: "user", content: "anything" }]);
    expect(result.errorMessage).not.toMatch(/Error:/);
    expect(result.errorMessage).not.toMatch(/^\{/);
    expect(result.errorMessage).not.toMatch(/at\s+\w+\s+\(/); // no stack frames
  });
});

// ── Suite 4: Anthropic → Gemini fallback ─────────────────────────────────────

describe("Anthropic → Gemini fallback", () => {
  const FAKE_ANTHROPIC_KEY = "sk-ant-test-key-long-enough-1234567890";

  beforeEach(() => {
    stubNoProviders();
    _testOnly.resetGeminiBlocked();
    _testOnly.resetAnthropicQuota();
    _testOnly.resetCircuitBreaker();
    vi.stubEnv("ANTHROPIC_API_KEY", FAKE_ANTHROPIC_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    _testOnly.resetGeminiBlocked();
    _testOnly.resetAnthropicQuota();
  });

  it("uses Anthropic when it succeeds", async () => {
    vi.stubGlobal("fetch", makeAnthropicFetchMock({
      ok:   true,
      body: { content: [{ text: "Anthropic response" }], usage: { input_tokens: 5, output_tokens: 10 } },
    }));

    const result = await aiChat([{ role: "user", content: "hello" }]);

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Anthropic response");
    expect(result.provider).toBe("anthropic");
  });

  it("falls back to Gemini when Anthropic returns 429", async () => {
    vi.mocked(isGeminiConfigured).mockReturnValue(true);
    vi.mocked(isGeminiAvailable).mockReturnValue(true);
    vi.mocked(geminiChat).mockResolvedValue("Gemini fallback response");

    vi.stubGlobal("fetch", makeAnthropicFetchMock({
      ok:     false,
      status: 429,
      text:   "Rate limited",
    }));

    const result = await aiChat([{ role: "user", content: "hello" }]);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("gemini");
    expect(result.text).toBe("Gemini fallback response");
  });

  it("returns ok:false after Anthropic 429 with no Gemini available", async () => {
    vi.stubGlobal("fetch", makeAnthropicFetchMock({
      ok:     false,
      status: 429,
      text:   "Rate limited",
    }));

    const result = await aiChat([{ role: "user", content: "hello" }]);

    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
  });
});

// ── Suite 5: Provider priority status ────────────────────────────────────────

describe("getAIProviderStatus — provider priority", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("shows anthropic as active when ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-long-enough-1234567890");
    vi.mocked(isGeminiConfigured).mockReturnValue(false);

    const status = getAIProviderStatus();

    expect(status.anthropicConfigured).toBe(true);
    expect(status.activeProvider).toBe("anthropic");
  });

  it("shows gemini as active when only Gemini is configured", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_APEX_INT_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "");
    vi.mocked(isGeminiConfigured).mockReturnValue(true);

    const status = getAIProviderStatus();

    expect(status.geminiConfigured).toBe(true);
    expect(status.activeProvider).toBe("gemini");
  });

  it("shows none when no providers are configured", () => {
    for (const [k, v] of Object.entries(NO_PROVIDERS_ENV)) vi.stubEnv(k, v);
    vi.mocked(isGeminiConfigured).mockReturnValue(false);

    const status = getAIProviderStatus();

    expect(status.activeProvider).toBe("none");
  });
});
