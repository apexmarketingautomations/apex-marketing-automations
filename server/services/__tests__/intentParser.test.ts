import { describe, it, expect } from "vitest";
import { parsePromptIntent } from "../visualPromptParser";

// ── Barber prompt ────────────────────────────────────────────────────────────

describe("parsePromptIntent — barber shop prompt", () => {
  const BARBER_PROMPT = "Barber shop with a spinning 3D razor, dark masculine aesthetic";
  const intent = parsePromptIntent(BARBER_PROMPT);

  it("resolves to barbershop niche and businessType", () => {
    expect(intent.niche).toBe("beauty");
    expect(intent.businessType).toBe("barbershop");
    expect(intent.businessLabel).toBe("Barber Shop");
  });

  it("extracts razor as a semantic scene object", () => {
    const razorObj = intent.semanticObjects.find(
      o => o.label.toLowerCase().includes("razor") || o.semanticType.includes("razor"),
    );
    expect(razorObj).toBeDefined();
  });

  it("gives the razor a spinning animation", () => {
    const razorObj = intent.semanticObjects.find(
      o => o.semanticType.includes("razor"),
    );
    expect(razorObj?.animation).toBe("spin");
  });

  it("sets a metallic material for the razor", () => {
    const razorObj = intent.semanticObjects.find(
      o => o.semanticType.includes("razor"),
    );
    expect(razorObj?.material).toBe("metallic");
  });

  it("selects a booking-related CTA", () => {
    expect(intent.ctaText).toMatch(/book|appointment|cut|schedule/i);
    expect(intent.ctaIntent).toBe("booking");
  });

  it("assigns a barbershop-specific CRM tag", () => {
    expect(intent.crmTag).toMatch(/barber/i);
    expect(intent.crmTag).not.toBe("new-lead");
    expect(intent.crmTag).not.toBe("ecommerce-lead");
  });

  it("chooses a dark/masculine style", () => {
    expect(intent.style).toBe("dark");
  });

  it("does not default to generic ecommerce/AI output", () => {
    expect(intent.businessType).not.toBe("ecommerce");
    expect(intent.businessType).not.toBe("business");
    expect(intent.niche).not.toBe("general");
    expect(intent.ctaText).not.toMatch(/shop now|buy now|add to cart/i);
    expect(intent.crmTag).not.toMatch(/ecommerce/i);
  });

  it("includes form fields appropriate for a barbershop", () => {
    const hasServiceField = intent.formFields.some(f => f === "service" || f === "service_type" || f === "preferred_date");
    expect(hasServiceField).toBe(true);
  });
});

// ── Unknown niche — object and aesthetic preservation ────────────────────────

describe("parsePromptIntent — unknown niche / novel object prompt", () => {
  const UNKNOWN_PROMPT = "Artisan sword forge featuring a glowing molten blade, medieval dark fantasy aesthetic";
  const intent = parsePromptIntent(UNKNOWN_PROMPT);

  it("does not collapse to generic ecommerce or business", () => {
    expect(intent.businessType).not.toBe("ecommerce");
    expect(intent.niche).not.toBe("ecommerce");
    expect(intent.ctaText).not.toMatch(/shop now|buy now/i);
    expect(intent.crmTag).not.toMatch(/ecommerce/i);
  });

  it("preserves the requested glowing/molten blade object via fallback extraction", () => {
    // The prompt has "featuring a glowing molten blade"
    // OBJECT_MAP has no entry for "molten blade", so extractFallbackObjects should capture it
    const hasGlowingObject = intent.semanticObjects.some(
      o => o.label.toLowerCase().includes("molten") ||
           o.label.toLowerCase().includes("blade") ||
           o.label.toLowerCase().includes("glowing"),
    );
    expect(hasGlowingObject).toBe(true);
  });

  it("does not return an empty semanticObjects array", () => {
    expect(intent.semanticObjects.length).toBeGreaterThan(0);
  });

  it("picks a dark/fantasy style, not corporate or warm", () => {
    expect(intent.style).toBe("dark");
    expect(intent.style).not.toBe("corporate");
    expect(intent.style).not.toBe("warm");
  });

  it("does not flag the prompt as a patch", () => {
    expect(intent.isPatch).toBe(false);
  });
});

// ── Patch detection ──────────────────────────────────────────────────────────

describe("parsePromptIntent — patch detection", () => {
  it("detects incremental edit phrases", () => {
    const intent = parsePromptIntent("Make it more cinematic and darker");
    expect(intent.isPatch).toBe(true);
    expect(intent.patchTargets).toContain("motion");
  });

  it("does not flag a fresh generation as a patch", () => {
    const intent = parsePromptIntent("Dental clinic with a clean minimal look");
    expect(intent.isPatch).toBe(false);
  });
});

// ── Niche variety smoke test ──────────────────────────────────────────────────

describe("parsePromptIntent — niche smoke tests", () => {
  const cases: Array<[string, string, string]> = [
    ["Personal injury law firm, dark blue professional theme", "legal", "personal_injury_law"],
    ["Yoga studio with zen garden aesthetic, morning light", "fitness", "yoga_studio"],
    ["Luxury auto detailing, black gloss ceramic coating", "automotive", "auto_detailing"],
    ["Med spa with rose gold accents, facial treatments", "health", "med_spa"],
    ["Roofing company, storm damage, free estimate CTA", "home_services", "roofing"],
    ["Restaurant with warm lighting and fine dining experience", "food", "restaurant"],
  ];

  for (const [prompt, expectedNiche, expectedBusinessType] of cases) {
    it(`resolves "${prompt.slice(0, 40)}…" → ${expectedBusinessType}`, () => {
      const intent = parsePromptIntent(prompt);
      expect(intent.niche).toBe(expectedNiche);
      expect(intent.businessType).toBe(expectedBusinessType);
    });
  }
});
