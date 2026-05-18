import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the AI provider chain so importing the engine does not pull in the DB.
// All composeLayout calls below use deterministicOnly:true — no AI call is made.
vi.mock("../../gemini", () => ({
  geminiChat:          vi.fn(),
  geminiChatStream:    vi.fn(),
  geminiGenerateImage: vi.fn(),
  isGeminiAvailable:   vi.fn(() => false),
  isGeminiConfigured:  vi.fn(() => false),
}));
vi.mock("../../ai/index", () => ({
  recordProviderSuccess: vi.fn(),
  recordProviderFailure: vi.fn(),
  logRegistryStartup:    vi.fn(),
  getBudgetReport:       vi.fn(() => ({})),
  getProcessMetrics:     vi.fn(() => ({})),
  isEmergencyShutdownActive: vi.fn(() => false),
  buildPlan: vi.fn(), withFallback: vi.fn(), withFallbackSafe: vi.fn(),
  parseStructuredOutput: vi.fn(), parseJSON: vi.fn(), requiresKeys: vi.fn(),
  getAllProviderHealth: vi.fn(() => ({})), setEmergencyShutdown: vi.fn(),
}));

import { parsePromptIntent } from "../visualPromptParser";
import { generateDesignSystem } from "../designSystemGenerator";
import { composeLayout, resolveArchetype } from "../layoutCompositionEngine";
import { validateComposition, clearCompositionHistory, registerComposition } from "../compositionValidator";
import { countNodes, layoutDepth, layoutVocabulary } from "../../../client/src/lib/dynamic-pages/layoutTree";

// ── Design system ─────────────────────────────────────────────────────────────

describe("generateDesignSystem", () => {
  it("produces a complete design system from intent", () => {
    const ds = generateDesignSystem(parsePromptIntent("Barber shop with a spinning 3D razor, dark masculine aesthetic"));
    expect(ds.spacing.length).toBe(13);
    expect(ds.elevation.length).toBe(5);
    expect(ds.typography.roles.display).toBeDefined();
    expect(ds.colors.gradient).toMatch(/gradient/);
  });

  it("gives different styles different visual personalities", () => {
    const luxury = generateDesignSystem(parsePromptIntent("Luxury jewelry boutique, gold accents, editorial"));
    const tech = generateDesignSystem(parsePromptIntent("AI SaaS platform dashboard, sleek tech aesthetic"));
    // Luxury uses a serif heading face; tech does not.
    expect(luxury.typography.headingFamily).not.toBe(tech.typography.headingFamily);
  });
});

// ── Archetype resolution ──────────────────────────────────────────────────────

describe("resolveArchetype", () => {
  const cases: Array<[string, string]> = [
    ["Barber shop with a spinning razor, dark aesthetic", "cinematic_immersive"],
    ["Roofing company, storm damage repair, free estimate", "industrial_trust"],
    ["Italian restaurant with wood-fired pizza and wine", "menu_first"],
    ["Personal injury law firm, dark professional theme", "clinical_precision"],
    ["CrossFit gym with transformation programs", "energetic_conversion"],
  ];
  for (const [prompt, expected] of cases) {
    it(`"${prompt.slice(0, 32)}…" → ${expected}`, () => {
      expect(resolveArchetype(parsePromptIntent(prompt))).toBe(expected);
    });
  }
});

// ── Composition ───────────────────────────────────────────────────────────────

describe("composeLayout (deterministic) — produces real freeform layouts", () => {
  beforeEach(() => clearCompositionHistory());

  it("builds a deep, rich layout tree — not a flat block stack", async () => {
    const intent = parsePromptIntent("Barber shop with a spinning 3D razor, dark masculine aesthetic");
    const layout = await composeLayout("Barber shop with a spinning 3D razor", intent, { deterministicOnly: true });

    expect(layout.engine).toBe("stitch-layout-v1");
    expect(countNodes(layout.root)).toBeGreaterThan(20);
    expect(layoutDepth(layout.root)).toBeGreaterThanOrEqual(3);
  });

  it("uses real compositional primitives, not just containers/text", async () => {
    const intent = parsePromptIntent("Roofing company, storm damage, free estimate CTA");
    const layout = await composeLayout("Roofing company storm damage", intent, { deterministicOnly: true });
    const vocab = layoutVocabulary(layout.root);
    const primitives = ["split_layout", "glass_panel", "grid", "scene", "stat", "motion_cluster"];
    const used = primitives.filter(p => vocab.includes(p as any));
    expect(used.length).toBeGreaterThanOrEqual(3);
  });

  it("different prompts produce different compositions (different signatures)", async () => {
    const barber = await composeLayout("Barber shop", parsePromptIntent("Barber shop, dark"), { deterministicOnly: true });
    const restaurant = await composeLayout("Italian restaurant", parsePromptIntent("Italian restaurant with wine"), { deterministicOnly: true });
    expect(barber.archetype).not.toBe(restaurant.archetype);
    expect(barber.compositionSignature).not.toBe(restaurant.compositionSignature);
  });

  it("same-niche different prompts still vary structurally", async () => {
    const a = await composeLayout("Classic barber shop downtown", parsePromptIntent("Classic barber shop downtown"), { deterministicOnly: true });
    const b = await composeLayout("Modern hipster barber lounge", parsePromptIntent("Modern hipster barber lounge"), { deterministicOnly: true });
    // Same archetype, but prompt-seeded variance gives distinct signatures.
    expect(a.compositionSignature).not.toBe(b.compositionSignature);
  });
});

// ── Composition validation ────────────────────────────────────────────────────

describe("validateComposition", () => {
  beforeEach(() => clearCompositionHistory());

  it("passes a real composed layout", async () => {
    const intent = parsePromptIntent("Barber shop with a spinning 3D razor, dark masculine aesthetic");
    const layout = await composeLayout("Barber shop with a spinning 3D razor", intent, { deterministicOnly: true });
    const report = validateComposition(layout, intent);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it("flags a structurally identical layout as a duplicate", async () => {
    const intent = parsePromptIntent("Dental clinic, clean minimal look");
    const layout = await composeLayout("Dental clinic clean minimal", intent, { deterministicOnly: true });
    // Register its signature, then re-validate — should now collide.
    registerComposition(layout.compositionSignature);
    const report = validateComposition(layout, intent);
    expect(report.passed).toBe(false);
    expect(report.issues.some(i => i.code === "DUPLICATE_COMPOSITION")).toBe(true);
  });

  it("rejects a generic block-stack tree", () => {
    const intent = parsePromptIntent("Barber shop");
    const genericLayout = {
      engine: "stitch-layout-v1" as const,
      archetype: "freeform" as const,
      designSystem: generateDesignSystem(intent),
      compositionSignature: "deadbeef",
      root: {
        id: "root", type: "container" as const,
        children: [
          { id: "z1", type: "zone" as const, children: [{ id: "h1", type: "heading" as const, content: { text: "Hi" } }] },
          { id: "z2", type: "zone" as const, children: [{ id: "t1", type: "text" as const, content: { text: "Barber shop here" } }] },
        ],
      },
    };
    const report = validateComposition(genericLayout, intent);
    expect(report.passed).toBe(false);
    expect(report.issues.some(i => i.code === "GENERIC_BLOCK_STACK" || i.code === "LOW_VISUAL_VARIANCE" || i.code === "TREE_TOO_SMALL")).toBe(true);
  });
});
