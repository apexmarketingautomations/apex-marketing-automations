/**
 * server/services/visualDesignGenerator.ts
 *
 * Stitch-style visual design spec generator.
 *
 * Phase 1 of the Stitch-style pipeline:
 *   User prompt → Intent parser → [THIS FILE] → VisualDesignSpec
 *
 * The design spec is a structured document describing the visual composition,
 * layout, hero scene, design tokens, copy, and sections — BEFORE it becomes
 * an Apex schema. This design-first pass prevents the AI from defaulting to
 * generic output because it forces "what does this page look like?" before
 * "what JSON does it output?".
 *
 * Phase 2 (apexSchemaMapper) converts the VisualDesignSpec → DynamicPageSchema.
 */

import { aiChat } from "../aiGateway";
import type { ParsedPromptIntent, SemanticObjectHint } from "./visualPromptParser";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SceneObjectSpec {
  label: string;              // "spinning straight razor"
  semanticType: string;       // "straight_razor"
  animation: "spin" | "slow_float" | "orbit" | "bob" | "pulse" | "drift" | "wave" | "idle";
  material: string;           // "metallic", "glass", "standard", "emissive"
  color: string;              // hex
  fallbackPrimitive: string;  // Three.js primitive to render
  objectPrompt: string;       // description for future model generation
  scale?: [number, number, number];
  position?: [number, number, number];
  emissive?: string;
}

export interface SectionSpec {
  type: string;
  title: string;
  subtitle?: string;
  body?: string;
  items?: Array<{ title: string; body: string; value?: string }>;
  imagePrompt?: string;
  order: number;
}

export interface VisualDesignSpec {
  // Identity
  businessType: string;
  businessLabel: string;
  niche: string;

  // Layout
  heroComposition: string;     // "dark barbershop interior with gleaming razor center-stage"
  sectionFlow: string[];       // section types in order: ["hero", "stats", "services", "booking"]
  overallMood: string;         // "premium dark masculine grooming experience"
  layoutRationale: string;     // why this layout works for this niche

  // Design tokens
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
  };
  style: string;
  font: string;
  motion: string;

  // Scene
  scene: {
    primaryObject: SceneObjectSpec;
    supportingObjects: SceneObjectSpec[];
    environment: string;
    backgroundDescription: string;
    particleEffect: string;
    lighting: string;
    cameraWork: string;
  };

  // Copy
  copy: {
    headline: string;
    subheadline: string;
    heroBody: string;
    ctaText: string;
    seoTitle: string;
    seoDescription: string;
  };

  // Content sections
  sections: SectionSpec[];

  // Form
  form: {
    title: string;
    fields: string[];
    submitText: string;
    crmTag: string;
  };

  // Stitch metadata
  designSource: "stitch-style" | "apex-fast";
  designRationale: string;
}

// ── Niche playbooks injected into the system prompt ───────────────────────────

const NICHE_PLAYBOOKS = `
BARBERSHOP / GROOMING:
  Colors: deep black #0a0a0a bg, blood red #cc2200 accent, steel silver #c0c0c0 secondary
  Vibe: dark masculine premium, old-school craft meets modern edge
  Hero: spinning straight razor or barber pole, dramatic rim lighting
  Sections: hero → stats (cuts per week, years experience, 5-star reviews) → services (fade, shave, beard trim with prices $35–$65) → team → booking form → testimonials
  CTA: "Book a Cut" or "Reserve Your Chair"
  Headline examples: "Sharp Cuts. Sharper Style." | "Precision. Every. Time." | "The Cut You Deserve."
  Form fields: name, phone, service (select: Haircut/Fade/Beard Trim/Hot Shave), preferred date

LAW FIRM (Personal Injury):
  Colors: deep navy #1e3a5f bg, gold #b8860b accent
  Vibe: authoritative, trust-building, results-focused
  Hero: scales of justice or gavel, dramatic courtroom lighting
  Sections: hero → stats ($50M+ recovered, 2000+ cases won, 0 fee unless you win) → services → process → testimonials → CTA
  CTA: "Get a Free Case Review"
  Headline examples: "Injured? We Fight. You Win." | "Maximum Recovery. Zero Upfront Cost."

MED SPA:
  Colors: deep mauve #2d1b2e bg, rose gold #b76e79 accent
  Vibe: luxury wellness, clinical trust meets high-end aesthetic
  Hero: floating crystal or elegant orb, soft luxury lighting
  Sections: hero → treatments (botox, fillers, HydraFacial with prices) → before/after → team → pricing packages → booking
  CTA: "Book a Consultation"
  Headline examples: "Your Best Skin. Every Day." | "Luxury Aesthetics. Real Results."

GYM / FITNESS:
  Colors: black #0a0a0a bg, red #dc2626 accent, orange #f97316 secondary
  Vibe: powerful, energetic, transformation-focused
  Hero: dumbbell or pulsing orb with energy particles
  Sections: hero → stats (members, coaches, sq ft) → programs → testimonials (with lbs lost / muscle gained) → pricing → trial offer CTA
  CTA: "Start Your Free Trial"
  Headline examples: "Build the Body You Want." | "No Excuses. Just Results."

RESTAURANT:
  Colors: warm dark #1a0a00 bg, amber #d97706 accent
  Vibe: warm, rich, inviting, food-forward
  Hero: chef hat or plated dish visual, warm amber lighting
  Sections: hero → menu highlights (with actual dish names and prices) → reservation widget → chef story → testimonials → events
  CTA: "Reserve a Table"
  Headline examples: "Where Every Meal Is an Experience." | "Crafted with Passion. Served with Pride."

DENTAL:
  Colors: clean white #ffffff surface, sky blue #0ea5e9 accent, dark bg #0f172a
  Vibe: clinical trust, friendly, professional
  Hero: clean modern tooth or smile visual
  Sections: hero → new patient special ($99 exam+cleaning+X-rays) → services → team → reviews → before/after → booking
  CTA: "Book Your Appointment"
  Headline examples: "A Smile You'll Love to Show." | "Gentle Care. Brilliant Results."

AUTO DETAILING:
  Colors: gloss black #030712 bg, electric blue #3b82f6 accent
  Vibe: precision, premium shine, automotive luxury
  Hero: gleaming car or ceramic coating orb
  Sections: hero → packages (basic wash $X, full detail $X, ceramic coating $X) → before/after → certifications → testimonials → booking
  CTA: "Get a Free Quote"
  Headline examples: "Show-Room Shine. Every Time." | "We Don't Just Wash Cars. We Transform Them."

YOGA / WELLNESS:
  Colors: warm earth #1a1000 bg, sage green #65a30d accent
  Vibe: serene, mindful, community-focused
  Hero: lotus flower or peaceful floating orbs
  Sections: hero → class schedule → instructors → pricing (intro 30-day $49) → online streaming → testimonials
  CTA: "Try a Free Class"

REAL ESTATE:
  Colors: clean white surface, navy #1e3a5f, warm gold #b8860b accent
  Vibe: trustworthy, aspirational, results-proven
  Hero: modern home or skyline visual
  Sections: hero → stats (homes sold, avg days on market, client satisfaction) → featured listings → process → agent bio → testimonials → CTA
  CTA: "Get Your Home Value"
`;

// ── System prompt ─────────────────────────────────────────────────────────────

const DESIGN_SPEC_SYSTEM_PROMPT = `You are Apex Stitch — an elite visual design director specializing in high-conversion landing pages.

Your job: Read a business prompt and produce a VisualDesignSpec JSON that describes exactly how this page should look and feel. This is a DESIGN-FIRST step — think like a top-tier creative director, not a developer.

CRITICAL RULES:
1. Every element must match the SPECIFIC business in the prompt. Never fall back to generic patterns.
2. If the prompt says "barber shop" — the headline, CTA, objects, and copy must all be barbershop-specific. NOT ecommerce. NOT AI tools.
3. Objects in scene.primaryObject and scene.supportingObjects must match what the prompt describes. If the prompt says "spinning 3D razor" — primaryObject.label = "spinning straight razor", animation = "spin".
4. Copy must be punchy, niche-specific, and zero-filler. No "AI automation". No "set it and forget it". Real marketing copy for real businesses.
5. sectionFlow must be a realistic page structure for this specific niche, not a generic template.
6. CTA text must match what this type of business actually says: barber → "Book a Cut", law firm → "Free Case Review", restaurant → "Reserve a Table".

NICHE PLAYBOOKS (follow these as strong guidance):
${NICHE_PLAYBOOKS}

For niches NOT in the playbooks above, follow the same pattern:
- Lead with the business type's most powerful visual hook
- Use real industry copy patterns
- Price your services with realistic ranges if applicable
- CTA must drive the primary conversion action for that business type

Return ONLY valid JSON matching this exact structure:
{
  "businessType": string,
  "businessLabel": string,
  "niche": string,
  "heroComposition": string,
  "sectionFlow": [string],
  "overallMood": string,
  "layoutRationale": string,
  "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "textMuted": "#hex" },
  "style": string,
  "font": string,
  "motion": string,
  "scene": {
    "primaryObject": { "label": string, "semanticType": string, "animation": string, "material": string, "color": "#hex", "fallbackPrimitive": string, "objectPrompt": string },
    "supportingObjects": [{ "label": string, "semanticType": string, "animation": string, "material": string, "color": "#hex", "fallbackPrimitive": string, "objectPrompt": string }],
    "environment": string,
    "backgroundDescription": string,
    "particleEffect": string,
    "lighting": string,
    "cameraWork": string
  },
  "copy": { "headline": string, "subheadline": string, "heroBody": string, "ctaText": string, "seoTitle": string, "seoDescription": string },
  "sections": [{ "type": string, "title": string, "subtitle": string, "body": string, "items": [{"title":string,"body":string,"value":string}], "imagePrompt": string, "order": number }],
  "form": { "title": string, "fields": [string], "submitText": string, "crmTag": string },
  "designSource": "stitch-style",
  "designRationale": string
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in design spec response");
  return raw.slice(start, end + 1);
}

// Build a synchronous fallback design spec when AI is unavailable
function buildFallbackSpec(prompt: string, intent: ParsedPromptIntent): VisualDesignSpec {
  const primary = intent.colors[0] ?? (intent.style === "dark" ? "#1a1a1a" : "#6366f1");
  const secondary = intent.colors[1] ?? "#a855f7";
  const accent = intent.colors[2] ?? "#06b6d4";

  const primaryObj: SceneObjectSpec = intent.semanticObjects.length > 0
    ? {
        label: intent.semanticObjects[0].label,
        semanticType: intent.semanticObjects[0].semanticType,
        animation: intent.semanticObjects[0].animation as any,
        material: intent.semanticObjects[0].material,
        color: intent.semanticObjects[0].color,
        fallbackPrimitive: intent.semanticObjects[0].fallbackPrimitive,
        objectPrompt: `${intent.semanticObjects[0].label} for a ${intent.businessLabel} landing page`,
        scale: intent.semanticObjects[0].scale,
      }
    : {
        label: `${intent.businessLabel} emblem`,
        semanticType: intent.businessType,
        animation: "slow_float",
        material: "distort",
        color: primary,
        fallbackPrimitive: "orb",
        objectPrompt: `Abstract emblem representing ${intent.businessLabel}`,
      };

  const supportingObjects: SceneObjectSpec[] = intent.semanticObjects.slice(1).map(o => ({
    label: o.label,
    semanticType: o.semanticType,
    animation: o.animation as any,
    material: o.material,
    color: o.color,
    fallbackPrimitive: o.fallbackPrimitive,
    objectPrompt: `${o.label} supporting element`,
  }));

  // Default section flows per niche
  const nicheFlows: Record<string, string[]> = {
    beauty: ["hero", "services", "pricing", "team", "testimonials", "booking_form"],
    barbershop: ["hero", "stats", "services", "team", "testimonials", "booking_form"],
    health: ["hero", "services", "team", "stats", "testimonials", "booking_form"],
    legal: ["hero", "stats", "services", "process", "testimonials", "contact"],
    fitness: ["hero", "stats", "programs", "testimonials", "pricing", "cta_banner"],
    food: ["hero", "menu", "gallery", "reservation_form", "story", "testimonials"],
    automotive: ["hero", "services", "pricing", "gallery", "testimonials", "contact"],
    home_services: ["hero", "services", "stats", "gallery", "testimonials", "quote_form"],
    real_estate: ["hero", "stats", "listings", "process", "testimonials", "contact"],
    tech: ["hero", "features", "demo", "pricing", "testimonials", "cta_banner"],
    ecommerce: ["hero", "featured_products", "categories", "testimonials", "cta_banner"],
  };

  const sectionFlow = nicheFlows[intent.businessType] ?? nicheFlows[intent.niche] ?? ["hero", "features", "testimonials", "contact"];

  return {
    businessType: intent.businessType,
    businessLabel: intent.businessLabel,
    niche: intent.niche,
    heroComposition: `${intent.businessLabel} hero with ${primaryObj.label} and ${intent.style} aesthetic`,
    sectionFlow,
    overallMood: `${intent.style} ${intent.businessLabel} experience`,
    layoutRationale: `Standard conversion layout for ${intent.businessLabel}`,
    colors: {
      primary,
      secondary,
      accent,
      background: intent.style === "dark" ? "#030712" : "#f8fafc",
      surface: intent.style === "dark" ? "#0f172a" : "#ffffff",
      text: intent.style === "dark" ? "#f8fafc" : "#0f172a",
      textMuted: intent.style === "dark" ? "#94a3b8" : "#475569",
    },
    style: intent.style,
    font: "Inter",
    motion: intent.motion,
    scene: {
      primaryObject: primaryObj,
      supportingObjects,
      environment: intent.environment,
      backgroundDescription: `${intent.style} ${intent.environment} backdrop for ${intent.businessLabel}`,
      particleEffect: intent.style === "dark" ? "floating dust motes" : "soft light particles",
      lighting: intent.lighting,
      cameraWork: "slow orbit",
    },
    copy: {
      headline: nicheCopyline(intent.businessType, intent.businessLabel),
      subheadline: `${intent.businessLabel} serving ${intent.targetAudience}`,
      heroBody: `Experience the difference at ${intent.businessLabel}. We specialize in serving ${intent.targetAudience} with unmatched quality and care.`,
      ctaText: intent.ctaText,
      seoTitle: `${intent.businessLabel} | Premium ${intent.businessLabel} Services`,
      seoDescription: `${intent.businessLabel} offering premium services to ${intent.targetAudience}. ${intent.ctaText} today.`,
    },
    sections: buildFallbackSections(intent, sectionFlow),
    form: {
      title: `${intent.ctaText}`,
      fields: intent.formFields,
      submitText: intent.ctaText,
      crmTag: intent.crmTag,
    },
    designSource: "stitch-style",
    designRationale: `Fallback design spec for ${intent.businessLabel} with ${intent.style} aesthetic`,
  };
}

function nicheCopyline(businessType: string, businessLabel: string): string {
  const map: Record<string, string> = {
    barbershop: "Sharp Cuts. Sharper Style.",
    personal_injury_law: "Injured? We Fight. You Win.",
    med_spa: "Your Best Skin. Every Day.",
    gym: "Build the Body You Want.",
    restaurant: "Where Every Meal Is an Experience.",
    dental: "A Smile You'll Love to Show.",
    auto_detailing: "Show-Room Shine. Every Time.",
    yoga_studio: "Find Your Balance. Transform Your Life.",
    real_estate: "Your Dream Home Starts Here.",
    saas: "Work Smarter. Grow Faster.",
    roofing: "Your Roof. Our Promise.",
    marketing_agency: "We Grow Brands. Period.",
    business_coach: "Your Success. Our Mission.",
  };
  return map[businessType] ?? `${businessLabel} — Excellence You Can Feel`;
}

function buildFallbackSections(intent: ParsedPromptIntent, sectionFlow: string[]): SectionSpec[] {
  const sections: SectionSpec[] = [];
  let order = 0;

  for (const sectionType of sectionFlow) {
    switch (sectionType) {
      case "hero":
        sections.push({ type: "hero", title: nicheCopyline(intent.businessType, intent.businessLabel), subtitle: `Premium ${intent.businessLabel} Services`, order: order++ });
        break;
      case "stats":
        sections.push({ type: "stats", title: `Why Choose Us`, items: nicheStats(intent.businessType), order: order++ });
        break;
      case "services":
      case "programs":
        sections.push({ type: "services", title: `Our Services`, subtitle: `Everything you need from your ${intent.businessLabel}`, items: nicheServices(intent.businessType), order: order++ });
        break;
      case "pricing":
        sections.push({ type: "pricing", title: `Our Packages`, items: nichePricing(intent.businessType), order: order++ });
        break;
      case "testimonials":
        sections.push({ type: "testimonials", title: `What Our Clients Say`, items: nicheTestimonials(intent.businessType, intent.businessLabel), order: order++ });
        break;
      case "team":
        sections.push({ type: "team", title: `Meet the Team`, subtitle: `Experts dedicated to your experience`, order: order++ });
        break;
      case "booking_form":
      case "quote_form":
      case "contact":
        sections.push({ type: "contact", title: intent.ctaText, subtitle: `Book in under 60 seconds`, order: order++ });
        break;
      case "faq":
        sections.push({ type: "faq", title: `Frequently Asked Questions`, items: nicheFAQ(intent.businessType), order: order++ });
        break;
      case "process":
        sections.push({ type: "process", title: `How It Works`, items: nicheProcess(intent.businessType), order: order++ });
        break;
      case "cta_banner":
        sections.push({ type: "cta_banner", title: `Ready to Get Started?`, subtitle: intent.ctaText, order: order++ });
        break;
    }
  }

  return sections;
}

// ── Niche-specific section content ─────────────────────────────────────────────

function nicheStats(businessType: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    barbershop: [{ title: "500+", body: "Happy Clients Per Month" }, { title: "10+", body: "Years of Experience" }, { title: "4.9★", body: "Average Google Rating" }],
    personal_injury_law: [{ title: "$50M+", body: "Recovered for Clients" }, { title: "2,000+", body: "Cases Won" }, { title: "97%", body: "Client Satisfaction" }],
    gym: [{ title: "1,200+", body: "Active Members" }, { title: "25", body: "Expert Coaches" }, { title: "500+", body: "Transformations" }],
    dental: [{ title: "10,000+", body: "Smiles Created" }, { title: "4.9★", body: "Google Rating" }, { title: "20+", body: "Years Serving the Community" }],
    restaurant: [{ title: "200+", body: "5-Star Reviews" }, { title: "50+", body: "Menu Items" }, { title: "15+", body: "Years of Excellence" }],
    real_estate: [{ title: "500+", body: "Homes Sold" }, { title: "$200M+", body: "In Sales Volume" }, { title: "98%", body: "List-to-Sale Ratio" }],
  };
  return map[businessType] ?? [
    { title: "500+", body: "Happy Clients" },
    { title: "10+", body: "Years in Business" },
    { title: "4.9★", body: "Average Rating" },
  ];
}

function nicheServices(businessType: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    barbershop: [
      { title: "Classic Haircut", body: "Precision cut tailored to your face shape", value: "$35" },
      { title: "Fade & Taper", body: "Flawless skin fade or taper by master barbers", value: "$45" },
      { title: "Hot Towel Shave", body: "Old-school luxury straight razor shave experience", value: "$55" },
      { title: "Beard Trim & Shape", body: "Line-up and sculpt your beard to perfection", value: "$30" },
    ],
    dental: [
      { title: "Teeth Whitening", body: "Professional whitening for a brilliantly bright smile", value: "From $199" },
      { title: "Dental Implants", body: "Permanent tooth replacement that looks and feels natural", value: "Consultation Required" },
      { title: "Invisalign", body: "Clear aligners for a straighter smile without metal braces", value: "From $3,500" },
      { title: "Emergency Dental", body: "Same-day emergency appointments available", value: "Call Now" },
    ],
    gym: [
      { title: "Personal Training", body: "1-on-1 sessions with certified coaches", value: "From $75/session" },
      { title: "Group Classes", body: "HIIT, strength, and cardio classes daily", value: "Included in membership" },
      { title: "Nutrition Coaching", body: "Custom meal plans and macro tracking", value: "From $150/mo" },
    ],
  };
  return map[businessType] ?? [
    { title: "Service 1", body: "Our signature offering for discerning clients" },
    { title: "Service 2", body: "Tailored to meet your specific needs" },
    { title: "Service 3", body: "Premium quality at competitive rates" },
  ];
}

function nichePricing(businessType: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    barbershop: [
      { title: "Basic Cut", body: "Classic haircut, shampoo & style", value: "$35" },
      { title: "Premium Experience", body: "Cut + beard trim + hot towel treatment", value: "$65" },
      { title: "The Works", body: "Full grooming service with scalp massage", value: "$90" },
    ],
    gym: [
      { title: "Basic", body: "Gym access + group classes", value: "$49/mo" },
      { title: "Premium", body: "All access + 4 PT sessions/mo", value: "$149/mo" },
      { title: "Elite", body: "Unlimited PT + nutrition coaching", value: "$299/mo" },
    ],
  };
  return map[businessType] ?? [
    { title: "Starter", body: "Perfect for getting started", value: "Contact for pricing" },
    { title: "Professional", body: "Our most popular package", value: "Contact for pricing" },
    { title: "Premium", body: "The complete experience", value: "Contact for pricing" },
  ];
}

function nicheTestimonials(businessType: string, businessLabel: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    barbershop: [
      { title: "Marcus T.", body: "Best fade in the city. Been coming here for 3 years and never leaving. They know exactly what I want before I even say it." },
      { title: "James R.", body: "The hot towel shave experience is on another level. My skin has never felt better. Worth every dollar." },
    ],
    gym: [
      { title: "Sarah K.", body: "Lost 35 lbs in 6 months. The coaches here actually care about your progress. Best investment I've ever made." },
      { title: "Mike D.", body: "Gained 20 lbs of muscle in 4 months. The programming is elite and the community keeps you accountable." },
    ],
    restaurant: [
      { title: "Jennifer L.", body: "The best dining experience I've had in years. Every dish was executed to perfection. We'll be back for every anniversary." },
      { title: "Robert M.", body: "The chef's tasting menu is worth every penny. Service is impeccable and the atmosphere is stunning." },
    ],
  };
  return map[businessType] ?? [
    { title: "Happy Client", body: `Working with ${businessLabel} was an outstanding experience. I'd recommend them to anyone.` },
    { title: "Satisfied Customer", body: `${businessLabel} exceeded all my expectations. Professional, reliable, and results-driven.` },
  ];
}

function nicheFAQ(businessType: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    barbershop: [
      { title: "Do I need an appointment?", body: "Walk-ins welcome but appointments are recommended to guarantee your preferred time slot." },
      { title: "How long does a haircut take?", body: "Standard cuts take 30–45 minutes. Full grooming services take 60–90 minutes." },
      { title: "What should I bring?", body: "Just yourself! Reference photos are always helpful if you have a specific style in mind." },
    ],
    dental: [
      { title: "Do you accept my insurance?", body: "We accept most major dental insurance plans. Call us to verify your coverage." },
      { title: "How often should I come in?", body: "We recommend professional cleaning and checkup every 6 months." },
      { title: "Do you offer payment plans?", body: "Yes! We offer 0% financing through CareCredit for qualified patients." },
    ],
  };
  return map[businessType] ?? [
    { title: "How do I get started?", body: "Simply contact us or use our online booking form to schedule your first appointment." },
    { title: "What can I expect?", body: "A professional, welcoming experience tailored to your specific needs." },
  ];
}

function nicheProcess(businessType: string): SectionSpec["items"] {
  const map: Record<string, SectionSpec["items"]> = {
    personal_injury_law: [
      { title: "Free Consultation", body: "Tell us your story. No cost, no commitment.", value: "Step 1" },
      { title: "Case Evaluation", body: "Our attorneys review the facts and build your case.", value: "Step 2" },
      { title: "We Fight For You", body: "We negotiate with insurance companies on your behalf.", value: "Step 3" },
      { title: "You Get Paid", body: "We don't win unless you win. Zero upfront fees.", value: "Step 4" },
    ],
    real_estate: [
      { title: "Discovery Call", body: "We learn your goals, timeline, and budget.", value: "Step 1" },
      { title: "Market Analysis", body: "We present a detailed CMA for your property or search.", value: "Step 2" },
      { title: "Showings & Offers", body: "We negotiate the best deal on your behalf.", value: "Step 3" },
      { title: "Closing Day", body: "Smooth closing process with zero surprises.", value: "Step 4" },
    ],
  };
  return map[businessType] ?? [
    { title: "Reach Out", body: "Contact us to discuss your needs.", value: "Step 1" },
    { title: "Custom Plan", body: "We create a plan tailored to you.", value: "Step 2" },
    { title: "Execution", body: "We deliver results with precision and care.", value: "Step 3" },
    { title: "Results", body: "You experience the difference quality makes.", value: "Step 4" },
  ];
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateVisualDesignSpec(
  prompt: string,
  intent: ParsedPromptIntent,
): Promise<VisualDesignSpec> {
  const userMessage = buildDesignBrief(prompt, intent);

  try {
    const response = await aiChat(
      [
        { role: "system", content: DESIGN_SPEC_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.85, maxTokens: 4096, jsonMode: true, timeoutMs: 25000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[VISUAL-DESIGN] AI call failed, using fallback spec");
      return buildFallbackSpec(prompt, intent);
    }

    const raw = extractJSON(response.text);
    const spec = JSON.parse(raw) as VisualDesignSpec;
    spec.designSource = "stitch-style";

    // Ensure semantic objects from the intent parser are preserved
    if (intent.semanticObjects.length > 0) {
      const primaryHint = intent.semanticObjects[0];
      // Only override AI if it produced a generic object despite specific intent
      const aiPrimLabel = (spec.scene?.primaryObject?.label ?? "").toLowerCase();
      const isGenericAIPrimary = aiPrimLabel === "orb" || aiPrimLabel === "sphere" || aiPrimLabel === "";
      if (isGenericAIPrimary) {
        spec.scene.primaryObject = {
          label: primaryHint.label,
          semanticType: primaryHint.semanticType,
          animation: primaryHint.animation as any,
          material: primaryHint.material,
          color: primaryHint.color,
          fallbackPrimitive: primaryHint.fallbackPrimitive,
          objectPrompt: `${primaryHint.label} for ${intent.businessLabel} landing page`,
        };
      }
    }

    return spec;
  } catch (err) {
    console.warn("[VISUAL-DESIGN] generateVisualDesignSpec error:", err instanceof Error ? err.message : err);
    return buildFallbackSpec(prompt, intent);
  }
}

function buildDesignBrief(prompt: string, intent: ParsedPromptIntent): string {
  const objectsStr = intent.semanticObjects.length > 0
    ? `\nVisual objects requested: ${intent.semanticObjects.map(o => `"${o.label}" (animation: ${o.animation})`).join(", ")}`
    : "";

  const colorStr = intent.colors.length > 0
    ? `\nColor hints from prompt: ${intent.colors.join(", ")}`
    : "";

  return `Design a landing page for: "${prompt}"

Detected context:
- Business: ${intent.businessLabel} (type: ${intent.businessType}, niche: ${intent.niche})
- Style/vibe: ${intent.style}
- Motion: ${intent.motion}
- CTA intent: ${intent.ctaText}
- Target audience: ${intent.targetAudience}${objectsStr}${colorStr}

Produce a complete VisualDesignSpec JSON. Every field must be specific to this business — no generic placeholders. Return ONLY JSON.`;
}
