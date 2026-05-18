import { describe, it, expect } from "vitest";
import { validateGeneratedSchema, type ValidationReport } from "../qualityValidator";
import { parsePromptIntent } from "../visualPromptParser";
import { createBlankSchema } from "../../../client/src/lib/dynamic-pages/schema";
import type { DynamicPageSchema } from "../../../client/src/lib/dynamic-pages/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function barbershopSchema(): DynamicPageSchema {
  const s = createBlankSchema();
  s.meta.niche = "beauty";
  s.meta.businessType = "barbershop";
  s.copy.headline = "Fresh Cuts, Sharp Style";
  s.copy.subheadline = "Premium barber services in your neighborhood";
  s.copy.body = "Our master barbers craft the perfect cut every time.";
  s.cta.primaryText = "Book a Cut";
  s.crm.automationTag = "barbershop-lead";
  s.scene.objects = [
    {
      id: "straight_razor-1",
      label: "straight razor",
      type: "box",
      style: "cinematic_3d",
      props: ["straight_razor"],
      position: [0, 0, -2],
      scale: [1, 1, 1],
      animation: "spin",
      color: "#c0c0c0",
      material: "metallic",
      opacity: 0.95,
    },
  ];
  return s;
}

function genericSchema(): DynamicPageSchema {
  // Simulates what the old AI used to produce — ecommerce/AI defaults for a barber prompt
  const s = createBlankSchema();
  s.meta.niche = "general";
  s.meta.businessType = "business";
  s.copy.headline = "Automate. Convert. Grow.";
  s.copy.subheadline = "AI-powered solutions tailored to your needs";
  s.copy.body = "We help businesses grow with cutting-edge technology and proven strategies.";
  s.cta.primaryText = "Shop Now";
  s.crm.automationTag = "ecommerce-lead";
  // Only orb + torus — no razor
  s.scene.objects = [
    { id: "orb-1", label: "orb", type: "orb", style: "cinematic_3d", props: [], position: [-3.5, 1, -2], scale: [1, 1, 1], animation: "slow_float", color: "#6366f1", material: "distort" },
    { id: "torus-1", label: "torus", type: "torus", style: "metallic", props: [], position: [-2, -2, 0], scale: [1, 1, 1], animation: "slow_float", color: "#a855f7", material: "wobble" },
  ];
  return s;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("validateGeneratedSchema — barber prompt with correct schema", () => {
  const BARBER_PROMPT = "Barber shop with a spinning 3D razor, dark masculine aesthetic";
  const intent = parsePromptIntent(BARBER_PROMPT);
  const schema = barbershopSchema();
  let report: ValidationReport;

  it("runs without throwing", () => {
    expect(() => {
      report = validateGeneratedSchema(schema, BARBER_PROMPT, intent);
    }).not.toThrow();
    // assign for subsequent tests
    report = validateGeneratedSchema(schema, BARBER_PROMPT, intent);
  });

  it("passes validation (no errors)", () => {
    expect(report.passed).toBe(true);
    const errors = report.issues.filter(i => i.severity === "error");
    expect(errors.length).toBe(0);
  });

  it("scores 80 or above", () => {
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it("does not need auto-fix", () => {
    expect(report.autoFixed).toBe(false);
  });
});

describe("validateGeneratedSchema — generic AI schema for barber prompt (regression test)", () => {
  const BARBER_PROMPT = "Barber shop with a spinning 3D razor, dark masculine aesthetic";
  const intent = parsePromptIntent(BARBER_PROMPT);
  const schema = genericSchema();
  let report: ValidationReport;

  beforeEach(() => {
    report = validateGeneratedSchema(schema, BARBER_PROMPT, intent);
  });

  it("detects generic copy as an error", () => {
    const copyError = report.issues.find(i => i.field === "copy" && i.severity === "error");
    expect(copyError).toBeDefined();
    expect(copyError?.issue).toMatch(/generic/i);
  });

  it("detects ecommerce CRM tag mismatch", () => {
    const crmError = report.issues.find(i => i.field === "crm.automationTag");
    expect(crmError).toBeDefined();
    expect(crmError?.issue).toMatch(/ecommerce/i);
  });

  it("detects ecommerce CTA for non-ecommerce business", () => {
    const ctaError = report.issues.find(i => i.field === "cta.primaryText" && i.severity === "error");
    expect(ctaError).toBeDefined();
  });

  it("detects niche collapse (general/business)", () => {
    const nicheError = report.issues.find(i => i.field === "meta.niche");
    expect(nicheError).toBeDefined();
    expect(nicheError?.issue).toMatch(/collapsed/i);
  });

  it("detects missing razor scene object", () => {
    const sceneError = report.issues.find(i => i.field === "scene.objects" && i.issue.includes("razor"));
    expect(sceneError).toBeDefined();
  });

  it("detects orb-only scene when user requested specific objects", () => {
    const orbError = report.issues.find(i => i.field === "scene.objects" && i.issue.includes("orb"));
    expect(orbError).toBeDefined();
  });

  it("auto-fixes the errors", () => {
    expect(report.autoFixed).toBe(true);
    expect(report.fixedSchema).toBeDefined();
  });

  it("fixed schema has correct niche + businessType", () => {
    const fixed = report.fixedSchema!;
    expect(fixed.meta.niche).toBe("beauty");
    expect(fixed.meta.businessType).toBe("barbershop");
  });

  it("fixed schema has barbershop CRM tag", () => {
    const fixed = report.fixedSchema!;
    expect(fixed.crm.automationTag).toMatch(/barber/i);
    expect(fixed.crm.automationTag).not.toMatch(/ecommerce/i);
  });

  it("fixed schema has a booking CTA, not 'Shop Now'", () => {
    const fixed = report.fixedSchema!;
    expect(fixed.cta.primaryText).not.toBe("Shop Now");
    expect(fixed.cta.primaryText).toMatch(/book|appointment|cut|schedule/i);
  });

  it("fixed schema contains the razor scene object", () => {
    const fixed = report.fixedSchema!;
    const hasRazor = fixed.scene.objects.some(
      o => o.label.toLowerCase().includes("razor") ||
           (o as any).semanticType?.includes("razor"),
    );
    expect(hasRazor).toBe(true);
  });

  it("final validation score is higher than original", () => {
    const originalScore = report.score;
    // Re-validate the fixed schema — should score higher
    const recheckReport = validateGeneratedSchema(report.fixedSchema!, BARBER_PROMPT, intent);
    expect(recheckReport.score).toBeGreaterThanOrEqual(originalScore);
  });
});

describe("validateGeneratedSchema — unknown niche prompt preserves requested objects", () => {
  const UNKNOWN_PROMPT = "Artisan sword forge featuring a glowing molten blade, medieval fantasy aesthetic";
  const intent = parsePromptIntent(UNKNOWN_PROMPT);

  it("parses at least one semantic object from the prompt", () => {
    expect(intent.semanticObjects.length).toBeGreaterThan(0);
  });

  it("auto-fix injects the missing object into the scene", () => {
    // Build a schema that has only orbs (simulating generic AI output)
    const schema = createBlankSchema();
    schema.meta.niche = "general";
    schema.meta.businessType = "business";
    schema.copy.headline = "AI Automation Platform";

    const report = validateGeneratedSchema(schema, UNKNOWN_PROMPT, intent);

    // Should detect missing objects and auto-fix
    expect(report.autoFixed).toBe(true);

    const fixed = report.fixedSchema!;
    // At least one object should reflect what was in the prompt (injected via auto-fix)
    const hasPromptObject = fixed.scene.objects.some(
      o => intent.semanticObjects.some(
        so => o.label.toLowerCase().includes(so.label.toLowerCase().split(" ")[0]),
      ),
    );
    expect(hasPromptObject).toBe(true);
  });
});

describe("validateGeneratedSchema — ecommerce prompt is NOT flagged as mismatch", () => {
  it("does not flag 'Shop Now' CTA for a real ecommerce business", () => {
    const ECOM_PROMPT = "Online supplement store with protein powder products";
    const intent = parsePromptIntent(ECOM_PROMPT);
    const schema = createBlankSchema();
    schema.meta.niche = "retail";
    schema.meta.businessType = "supplement_store";
    schema.copy.headline = "Fuel Your Performance";
    schema.copy.subheadline = "Premium supplements for serious athletes";
    schema.copy.body = "High quality protein powders and pre-workouts.";
    schema.cta.primaryText = "Shop Now";
    schema.crm.automationTag = "supplement-lead";

    const report = validateGeneratedSchema(schema, ECOM_PROMPT, intent);
    const ctaErrors = report.issues.filter(
      i => i.field === "cta.primaryText" && i.issue.includes("Ecommerce CTA"),
    );
    // "Shop Now" should be fine for a supplement/retail store
    expect(ctaErrors.length).toBe(0);
  });
});

// Needed because beforeEach is used above without an import
import { beforeEach } from "vitest";
