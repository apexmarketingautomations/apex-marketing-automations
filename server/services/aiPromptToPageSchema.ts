/**
 * server/services/aiPromptToPageSchema.ts
 *
 * AI-driven page schema generation and patching.
 *
 * Two generation modes:
 *   "apex-fast"    — single AI call with niche-aware system prompt (fast, ~3s)
 *   "stitch-style" — design spec first, then schema mapping + validation (richer, ~6s)
 *
 * Both modes:
 *   1. Run the intent parser to extract structured context
 *   2. Generate the schema (fast) or design spec → schema (stitch)
 *   3. Run quality validation and auto-fix mismatches
 *   4. Generate HTML sections
 *   5. Generate hero image in parallel
 */

import { aiChat, aiGenerateImage } from "../aiGateway";
import { parsePromptIntent } from "./visualPromptParser";
import { generateVisualDesignSpec } from "./visualDesignGenerator";
import { validateGeneratedSchema } from "./qualityValidator";
import { composeLayout, applyHeroImage } from "./layoutCompositionEngine";
import { validateComposition, registerComposition } from "./compositionValidator";
import type { DynamicPageSchema, WebGLSceneSchema, SceneObject, SectionSchema } from "../../client/src/lib/dynamic-pages/schema";
import type { ParsedPromptIntent, SemanticObjectHint } from "./visualPromptParser";
import type { VisualDesignSpec, SceneObjectSpec, SectionSpec } from "./visualDesignGenerator";

export type GenerationMode = "apex-fast" | "stitch-style" | "stitch-import";

const NOW = () => new Date().toISOString();
function randomId(): string { return Math.random().toString(36).slice(2, 10); }

// ── Apex Fast system prompt ───────────────────────────────────────────────────
// Niche-aware, tightly controlled. Forces specific output per business type.

const APEX_FAST_SYSTEM_PROMPT = `You are Apex Page Generator — an expert marketing landing page architect.

Generate a DynamicPageSchema JSON from the user's prompt and intent context.

HARD RULES — violating any of these will produce a rejected result:
1. Return ONLY valid JSON. No markdown, no code blocks, no explanations.
2. The niche, businessType, headline, CTA, and CRM tag MUST match the business in the prompt.
   - "Barber Shop" prompt → businessType "barbershop", headline about barbering, CTA "Book a Cut", crmTag "barbershop-lead"
   - "Law Firm" prompt → CTA "Free Case Review", NOT "Shop Now"
   - NEVER output generic AI/ecommerce copy for a real-world service business
3. If the prompt describes a specific visual object (razor, gavel, dumbbell, etc.) → that object MUST appear in scene.objects with the correct label and animation.
4. scene.objects labels must describe the actual requested object. "orb" is only acceptable when NO specific object was mentioned.
5. CTA must drive the primary conversion action: booking → "Book a ___", quote → "Get a Free ___", consultation → "Free ___ Consultation"
6. CRM automationTag must be niche-specific: barbershop → "barbershop-lead", law → "pi-lead", NOT "new-lead" or "ecommerce-lead"
7. Generate 6–10 content sections. Make them niche-specific with real copy, real prices where applicable.
8. Colors must be valid hex strings (#rrggbb).
9. Max 6 scene objects. Max particle count 1200.

Schema structure:
{
  "version": "1.0",
  "id": "<8-char-id>",
  "designSource": "apex-generator",
  "meta": { "title": string, "slug": string, "niche": string, "businessType": string, "prompt": string, "createdAt": string, "updatedAt": string },
  "theme": { "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "textMuted": "#hex" }, "style": string, "motion": string, "font": "Inter" },
  "copy": { "headline": string, "subheadline": string, "body": string, "seoTitle": string, "seoDescription": string },
  "scene": {
    "sceneType": "custom_prompt_scene",
    "prompt": string,
    "environment": string,
    "objects": [{ "id": string, "label": string, "type": "orb"|"torus"|"box"|"cone"|"cylinder"|"ring", "style": string, "props": [string], "position": [x,y,z], "scale": [x,y,z], "animation": "slow_float"|"orbit"|"spin"|"idle"|"bob"|"pulse"|"drift"|"wave", "color": "#hex", "emissive": "#hex", "material": "distort"|"wobble"|"standard"|"glass"|"metallic"|"emissive", "distort": 0.0-1.0, "opacity": 0.5-1.0 }],
    "particles": { "type": "stars"|"rain"|"snow"|"dust"|"sparks"|"bubbles"|"leaves", "density": "low"|"medium"|"high", "speed": 0.1-3.0, "color": "#hex", "count": 200-1200, "size": 0.01-0.1 },
    "lighting": { "type": "neon_rim"|"warm_studio"|"cool_ambient"|"dramatic"|"sunset"|"medical"|"neutral", "colors": ["#hex","#hex","#hex"], "intensity": 0.5-3.0, "ambientIntensity": 0.1-1.0 },
    "camera": { "mode": "slow_orbit"|"fixed"|"gentle_sway"|"cinematic_pan"|"static", "intensity": 0.1-2.0, "fov": 45-90 },
    "postProcessing": { "bloom": bool, "bloomIntensity": 0.5-3.0, "chromaticAberration": bool, "vignette": bool, "vignetteIntensity": 0.3-1.0 }
  },
  "sections": [{ "id": string, "type": "hero"|"features"|"testimonials"|"faq"|"cta_banner"|"services"|"team"|"gallery"|"pricing"|"contact"|"stats"|"process", "title": string, "subtitle": string, "body": string, "items": [{"title":string,"body":string}], "visible": true, "order": number }],
  "cta": { "primaryText": string, "primaryUrl": "#contact", "secondaryText": string, "secondaryUrl": "#learn-more", "animation": "none"|"pulse"|"glow"|"bounce"|"shimmer", "color": "#hex" },
  "forms": [{ "id": string, "title": string, "submitText": string, "fields": [{"name":string,"label":string,"type":"text"|"email"|"phone"|"textarea"|"select","required":bool,"options":[string]}], "crmTag": string }],
  "analytics": { "pageType": "landing", "niche": string, "funnelStage": "awareness"|"consideration"|"conversion", "trackingEvents": ["page_view","cta_click","form_submit"] },
  "crm": { "leadSource": "dynamic-page", "automationTag": string, "assignedWorkflow": string },
  "publish": { "published": false, "slug": string, "canonicalUrl": "" }
}`;

// ── HTML sections system prompt ───────────────────────────────────────────────

const HTML_SECTIONS_SYSTEM_PROMPT = `You are an expert marketing landing page designer specializing in high-conversion dark-themed pages.

Generate complete HTML sections for a marketing landing page using Tailwind CSS.

RULES:
1. Return ONLY raw HTML — NO <html>, <head>, <body>, <script>, or <style> wrapper tags.
2. Use Tailwind CSS utility classes for ALL styling (the page loads Tailwind CDN).
3. CSS custom properties are available: var(--primary), var(--secondary), var(--accent), var(--bg), var(--surface), var(--text), var(--text-muted)
4. The page already has a dramatic WebGL 3D hero above with the main headline — do NOT add another hero section.
5. Generate these sections in this order:
   a) About / intro section with a REAL image
   b) Features/Services grid (3–6 cards with real niche-specific content)
   c) Stats bar (3–4 impressive niche-specific numbers)
   d) Testimonials (2–3 realistic client quotes with avatar images)
   e) CTA banner with gradient background
   f) Contact/booking form with niche-appropriate fields
6. Make ALL copy 100% specific to the niche — NO generic "AI automation" placeholders.
7. Stats must be realistic and niche-appropriate (barbershop → "500+ Cuts/Month", law firm → "$50M+ Recovered").
8. Testimonials: use realistic client first names + last initial and specific results tied to the niche.
9. Contact form fields must be appropriate for the niche (barbershop → service dropdown, date picker).
10. Use modern dark UI: glassmorphism cards (bg-white/5 backdrop-blur), gradient borders, glow effects.
11. Use inline style="..." with var(--primary) for dynamic theme color accents.
12. All hover effects via Tailwind hover: prefix.
13. Use semantic HTML5: <section>, <h2>, <h3>, <p>, <ul>, <form>.
14. Do NOT add a navigation bar or footer.

IMAGE RULES:
- For images use Unsplash CDN with niche-specific photo IDs from your training data.
  Format: https://images.unsplash.com/photo-PHOTO_ID?q=80&w=1200&auto=format&fit=crop
- For testimonial avatars: https://i.pravatar.cc/80?img=N where N is 1–70.
- Never use placeholder or broken image URLs.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in AI response");
  return raw.slice(start, end + 1);
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/on\w+\s*=/gi, "data-blocked=");
}

// ── Schema mapper: converts VisualDesignSpec → DynamicPageSchema ──────────────

function mapSpecToSchema(
  spec: VisualDesignSpec,
  prompt: string,
  subAccountId?: number,
): DynamicPageSchema {
  const now = NOW();
  const id = randomId();
  const slug = `${spec.businessType.replace(/_/g, "-").toLowerCase()}-${id}`;

  const primaryObj = spec.scene.primaryObject;
  const sceneObjects: SceneObject[] = [
    {
      id: `${primaryObj.semanticType}-1`,
      label: primaryObj.label,
      type: (primaryObj.fallbackPrimitive as any) ?? "orb",
      style: "cinematic_3d",
      props: [primaryObj.semanticType, primaryObj.objectPrompt],
      position: primaryObj.position ?? [0, 0, -2],
      scale: primaryObj.scale ?? [1, 1, 1],
      animation: primaryObj.animation as any,
      color: primaryObj.color,
      emissive: primaryObj.emissive ?? (primaryObj.material === "emissive" ? primaryObj.color : undefined),
      material: primaryObj.material as any,
      opacity: 0.95,
      ...(primaryObj.semanticType && { semanticType: primaryObj.semanticType } as any),
      objectCategory: "semantic_object" as any,
      fallbackPrimitive: primaryObj.fallbackPrimitive as any,
    },
    ...spec.scene.supportingObjects.slice(0, 4).map((obj, i) => ({
      id: `${obj.semanticType}-${i + 2}`,
      label: obj.label,
      type: (obj.fallbackPrimitive as any) ?? "orb",
      style: "cinematic_3d",
      props: [obj.semanticType],
      position: [
        (i % 2 === 0 ? -3 : 3) + Math.random() * 0.5,
        (i < 2 ? 1 : -1) + Math.random() * 0.5,
        -2 - i * 0.5,
      ] as [number, number, number],
      scale: [0.8, 0.8, 0.8] as [number, number, number],
      animation: obj.animation as any,
      color: obj.color,
      material: obj.material as any,
      opacity: 0.85,
      ...(obj.semanticType && { semanticType: obj.semanticType } as any),
      objectCategory: "semantic_object" as any,
      fallbackPrimitive: obj.fallbackPrimitive as any,
    })),
  ];

  const sections: SectionSchema[] = spec.sections.map(s => ({
    id: `${s.type}-${s.order}`,
    type: s.type as any,
    title: s.title,
    subtitle: s.subtitle,
    body: s.body,
    items: s.items,
    visible: true,
    order: s.order,
  }));

  const formFields = spec.form.fields.map(fieldName => ({
    name: fieldName,
    label: fieldName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    type: fieldTypeFor(fieldName),
    required: ["name", "phone", "email"].includes(fieldName),
    options: fieldOptionsFor(fieldName),
  }));

  return {
    version: "1.0",
    id,
    designSource: "stitch-style" as any,
    meta: {
      title: spec.businessLabel,
      slug,
      niche: spec.niche,
      businessType: spec.businessType,
      prompt,
      createdAt: now,
      updatedAt: now,
      subAccountId,
    },
    theme: {
      colors: spec.colors,
      style: spec.style as any,
      motion: spec.motion as any,
      font: spec.font,
    },
    copy: {
      headline: spec.copy.headline,
      subheadline: spec.copy.subheadline,
      body: spec.copy.heroBody,
      seoTitle: spec.copy.seoTitle,
      seoDescription: spec.copy.seoDescription,
    },
    scene: {
      sceneType: "custom_prompt_scene",
      prompt,
      environment: spec.scene.environment as any,
      objects: sceneObjects,
      particles: {
        type: particleTypeFor(spec.niche),
        density: "medium",
        speed: spec.motion === "cinematic" ? 0.5 : 1,
        color: spec.colors.primary,
        count: 600,
        size: 0.04,
      },
      lighting: {
        type: lightingTypeFor(spec.scene.lighting),
        colors: [spec.colors.primary, spec.colors.secondary, spec.colors.accent],
        intensity: 2,
        ambientIntensity: 0.3,
      },
      camera: {
        mode: "slow_orbit",
        intensity: spec.motion === "subtle" ? 0.3 : 0.6,
        fov: 60,
      },
      postProcessing: {
        bloom: true,
        bloomIntensity: spec.style === "dark" ? 1.8 : 1.2,
        chromaticAberration: spec.style !== "minimal",
        vignette: true,
        vignetteIntensity: 0.7,
      },
    },
    sections,
    cta: {
      primaryText: spec.copy.ctaText,
      primaryUrl: "#contact",
      animation: "pulse",
      color: spec.colors.accent,
    },
    forms: [{
      id: "main-form",
      title: spec.form.title,
      submitText: spec.form.submitText,
      fields: formFields,
      crmTag: spec.form.crmTag,
    }],
    analytics: {
      pageType: "landing",
      niche: spec.niche,
      funnelStage: "conversion",
      trackingEvents: ["page_view", "cta_click", "form_submit"],
    },
    crm: {
      leadSource: "dynamic-page",
      automationTag: spec.form.crmTag,
      assignedWorkflow: `${spec.businessType}-followup`,
    },
    publish: {
      published: false,
      slug,
      subAccountId,
    },
  } as DynamicPageSchema;
}

function fieldTypeFor(fieldName: string): "text" | "email" | "phone" | "textarea" | "select" {
  if (fieldName === "email") return "email";
  if (fieldName === "phone") return "phone";
  if (["message", "description", "accident_type", "tattoo_idea", "main_challenge", "case_type", "how_long"].includes(fieldName)) return "textarea";
  if (["service", "service_type", "fitness_goal", "experience_level", "party_size", "preferred_time"].includes(fieldName)) return "select";
  return "text";
}

function fieldOptionsFor(fieldName: string): string[] | undefined {
  const map: Record<string, string[]> = {
    service: ["Haircut", "Fade", "Beard Trim", "Hot Shave", "Full Grooming"],
    service_type: ["Basic", "Standard", "Premium"],
    fitness_goal: ["Lose Weight", "Build Muscle", "Improve Endurance", "General Fitness"],
    experience_level: ["Beginner", "Intermediate", "Advanced"],
    party_size: ["1", "2", "3-4", "5-6", "7+"],
    preferred_time: ["Morning (8am-12pm)", "Afternoon (12pm-5pm)", "Evening (5pm-8pm)"],
    case_type: ["Car Accident", "Slip & Fall", "Medical Malpractice", "Workplace Injury", "Other"],
  };
  return map[fieldName];
}

function particleTypeFor(niche: string): "stars" | "dust" | "sparks" | "bubbles" | "rain" | "snow" | "leaves" {
  const map: Record<string, any> = {
    beauty: "dust", health: "dust", fitness: "sparks", food: "dust",
    automotive: "sparks", home_services: "dust", legal: "stars",
    ecommerce: "stars", tech: "stars",
  };
  return map[niche] ?? "stars";
}

function lightingTypeFor(lightingDescription: string): "neon_rim" | "warm_studio" | "cool_ambient" | "dramatic" | "sunset" | "medical" | "neutral" {
  const d = lightingDescription.toLowerCase();
  if (d.includes("warm") || d.includes("amber")) return "warm_studio";
  if (d.includes("neon") || d.includes("electric")) return "neon_rim";
  if (d.includes("dramatic") || d.includes("rim")) return "dramatic";
  if (d.includes("medical") || d.includes("sterile")) return "medical";
  if (d.includes("sunset")) return "sunset";
  if (d.includes("cool") || d.includes("blue")) return "cool_ambient";
  return "dramatic";
}

// ── Fallback schema builder ───────────────────────────────────────────────────

function buildFallbackSchema(prompt: string, intent: ParsedPromptIntent): DynamicPageSchema {
  const id = randomId();
  const now = NOW();
  const slug = `${intent.businessType.replace(/_/g, "-")}-${id}`;
  const primary = intent.colors[0] ?? "#6366f1";
  const secondary = intent.colors[1] ?? "#a855f7";

  const sceneObjects: SceneObject[] = intent.semanticObjects.length > 0
    ? intent.semanticObjects.slice(0, 3).map((obj, i) => ({
        id: `${obj.semanticType}-${i + 1}`,
        label: obj.label,
        type: obj.fallbackPrimitive as any,
        style: "cinematic_3d",
        props: [obj.semanticType],
        position: [i === 0 ? 0 : (i % 2 === 0 ? -3 : 3), i === 0 ? 0 : (i < 2 ? 1 : -1), -2] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        animation: obj.animation as any,
        color: obj.color,
        material: obj.material as any,
        opacity: 0.9,
      }))
    : [
        { id: "orb-1", label: "orb", type: "orb" as any, style: "cinematic_3d", props: [], position: [-3.5, 1, -2] as any, scale: [1, 1, 1] as any, animation: "slow_float" as any, color: primary, material: "distort" as any, distort: 0.5, opacity: 0.85 },
        { id: "orb-2", label: "orb", type: "orb" as any, style: "cinematic_3d", props: [], position: [3.5, -1, -1] as any, scale: [1, 1, 1] as any, animation: "slow_float" as any, color: secondary, material: "distort" as any, distort: 0.3, opacity: 0.85 },
      ];

  const ctaText = intent.ctaText;

  return {
    version: "1.0",
    id,
    designSource: "apex-generator" as any,
    meta: { title: intent.businessLabel, slug, niche: intent.niche, businessType: intent.businessType, prompt, createdAt: now, updatedAt: now },
    theme: {
      colors: { primary, secondary, accent: intent.colors[2] ?? "#06b6d4", background: "#030712", surface: "#0f172a", text: "#f8fafc", textMuted: "#94a3b8" },
      style: intent.style as any,
      motion: intent.motion as any,
      font: "Inter",
    },
    copy: {
      headline: `${intent.businessLabel} — Built for Results`,
      subheadline: `Serving ${intent.targetAudience}`,
      body: `Premium ${intent.businessLabel} services tailored for ${intent.targetAudience}.`,
      seoTitle: `${intent.businessLabel} | Premium Services`,
      seoDescription: `${intent.businessLabel} offering premium services to ${intent.targetAudience}.`,
    },
    scene: {
      sceneType: "procedural",
      prompt,
      environment: intent.environment as any,
      objects: sceneObjects,
      particles: { type: "stars", density: "medium", speed: 1, color: primary, count: 600, size: 0.04 },
      lighting: { type: intent.lighting as any, colors: [primary, secondary, "#818cf8"], intensity: 2, ambientIntensity: 0.3 },
      camera: { mode: "slow_orbit", intensity: 0.5, fov: 60 },
      postProcessing: { bloom: true, bloomIntensity: 1.5, chromaticAberration: true, vignette: true, vignetteIntensity: 0.8 },
    },
    sections: [
      { id: "hero", type: "hero", title: intent.businessLabel, subtitle: `Serving ${intent.targetAudience}`, visible: true, order: 0 },
      { id: "services", type: "services" as any, title: "Our Services", visible: true, order: 1 },
      { id: "cta-banner", type: "cta_banner", title: "Ready to Get Started?", subtitle: ctaText, visible: true, order: 2 },
    ],
    cta: { primaryText: ctaText, primaryUrl: "#contact", animation: "pulse", color: primary },
    forms: [{
      id: "main-form",
      title: ctaText,
      submitText: ctaText,
      fields: intent.formFields.map(f => ({ name: f, label: f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), type: fieldTypeFor(f), required: ["name", "phone", "email"].includes(f) })),
      crmTag: intent.crmTag,
    }],
    analytics: { pageType: "landing", niche: intent.niche, funnelStage: "conversion", trackingEvents: ["page_view", "cta_click", "form_submit"] },
    crm: { leadSource: "dynamic-page", automationTag: intent.crmTag, assignedWorkflow: `${intent.businessType}-followup` },
    publish: { published: false, slug },
  } as DynamicPageSchema;
}

// ── HTML sections generator ───────────────────────────────────────────────────

async function generateSectionsHtml(
  prompt: string,
  schema: DynamicPageSchema,
  intent: ParsedPromptIntent,
  heroImageUrl?: string,
  uploadedImageUrl?: string,
): Promise<string> {
  const colors = schema.theme?.colors ?? {};
  const primaryImage = heroImageUrl ?? uploadedImageUrl;
  const imageContext = primaryImage ? `\n- Showcase/hero image URL: ${primaryImage}` : "";

  const userMessage = `Generate HTML sections for: "${prompt}"

Business context:
- Business: ${intent.businessLabel} (type: ${intent.businessType}, niche: ${intent.niche})
- Style: ${intent.style}
- Headline: "${schema.copy?.headline ?? ""}"
- CTA: "${schema.cta?.primaryText ?? "Get Started"}"
- Theme: primary=${colors.primary}, secondary=${colors.secondary}, accent=${colors.accent}${imageContext}

Generate ALL sections with 100% niche-specific copy and realistic content. Do NOT use generic "AI automation" placeholders.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: HTML_SECTIONS_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.85, maxTokens: 4096, timeoutMs: 30000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[AI-PAGE-HTML] HTML generation failed");
      return "";
    }

    const clean = response.text
      .replace(/^```html?\n?/i, "")
      .replace(/```$/m, "")
      .trim();

    return sanitizeHtml(clean);
  } catch (err) {
    console.warn("[AI-PAGE-HTML] error:", err instanceof Error ? err.message : err);
    return "";
  }
}

// ── Hero image prompt builder ─────────────────────────────────────────────────

function buildHeroImagePrompt(prompt: string, intent: ParsedPromptIntent): string {
  const styleMap: Record<string, string> = {
    luxury: "ultra-luxury, high-end, cinematic lighting, editorial photography",
    dark: "dark aesthetic, dramatic shadows, professional photography",
    warm: "warm inviting tones, natural light, lifestyle photography",
    energetic: "dynamic energy, vibrant colors, bold composition",
    calm: "serene, soft, minimal, zen atmosphere",
    tech: "sleek technology, blue/purple lighting, futuristic",
  };
  const styleDesc = styleMap[intent.style] ?? "professional, high-quality, commercial photography";
  return `Professional ${intent.businessLabel} marketing image. ${prompt.trim().slice(0, 300)}. ${styleDesc}. Photorealistic, 8K, no text or logos, centered composition for a website hero.`;
}

// ── Stitch-style generation (freeform layout engine) ──────────────────────────
// The new default. Composes a freeform LayoutNode tree instead of block
// sections. The schema still carries scene/forms/crm/theme/meta — only the
// rendering architecture changes.

async function generateStitchStyleSchema(
  prompt: string,
  intent: ParsedPromptIntent,
  subAccountId?: number,
  uploadedImageUrl?: string,
): Promise<DynamicPageSchema> {
  // Phase 1: design spec, hero image, and freeform layout — all in parallel
  const [specResult, heroImageResult, layoutResult] = await Promise.allSettled([
    generateVisualDesignSpec(prompt, intent),
    aiGenerateImage(buildHeroImagePrompt(prompt, intent)),
    composeLayout(prompt, intent),
  ]);

  const spec = specResult.status === "fulfilled" ? specResult.value : null;
  const heroImageUrl = heroImageResult.status === "fulfilled" && heroImageResult.value
    ? heroImageResult.value
    : uploadedImageUrl;

  // Phase 2: schema skeleton (scene, theme, copy, forms, crm) from spec or fallback
  let schema = spec ? mapSpecToSchema(spec, prompt, subAccountId) : buildFallbackSchema(prompt, intent);
  if (subAccountId) schema.meta.subAccountId = subAccountId;
  if (heroImageUrl) schema.scene.fallbackImage = heroImageUrl;

  // Phase 3: scene/copy quality validation + auto-fix
  const validation = validateGeneratedSchema(schema, prompt, intent);
  if (!validation.passed && validation.fixedSchema) {
    console.log(`[STITCH] Auto-fixed ${validation.issues.filter(i => i.severity === "error").length} schema errors`);
    schema = validation.fixedSchema;
  }

  // Phase 4: attach the freeform layout tree
  let layout = layoutResult.status === "fulfilled" ? layoutResult.value : null;
  if (!layout) {
    console.warn("[STITCH] Layout composition failed — using deterministic composer");
    layout = await composeLayout(prompt, intent, { deterministicOnly: true });
  }
  if (heroImageUrl) applyHeroImage(layout, heroImageUrl);

  // Phase 5: composition validation — reject generic / identical / low-variance layouts
  let report = validateComposition(layout, intent);
  if (!report.passed) {
    console.warn(`[STITCH] Composition rejected (${report.issues.filter(i => i.severity === "error").map(i => i.code).join(", ")}) — recomposing`);
    layout = await composeLayout(prompt, intent, { deterministicOnly: true });
    if (heroImageUrl) applyHeroImage(layout, heroImageUrl);
    report = validateComposition(layout, intent, { allowDuplicateSignature: true });
  }
  registerComposition(layout.compositionSignature);
  console.log(`[STITCH] Composition ${report.passed ? "passed" : "shipped with warnings"} score=${report.score} archetype=${layout.archetype}`);

  schema.layout = layout;
  schema.generationMode = "stitch-style";
  schema.designSource = "apex-generator";
  // The layout tree replaces HTML sections — clear any legacy generatedHtml.
  schema.generatedHtml = undefined;

  return schema;
}

// ── Apex Fast generation ──────────────────────────────────────────────────────

async function generateApexFastSchema(
  prompt: string,
  intent: ParsedPromptIntent,
  subAccountId?: number,
  uploadedImageUrl?: string,
): Promise<DynamicPageSchema> {
  const now = NOW();
  const id = randomId();

  const userMessage = `Generate a DynamicPageSchema for: "${prompt}"

Intent context (use this to generate niche-specific output — do NOT override with generic content):
- Business: ${intent.businessLabel}
- businessType: ${intent.businessType}
- niche: ${intent.niche}
- style: ${intent.style}
- environment: ${intent.environment}
- Specific objects requested: ${intent.semanticObjects.map(o => `"${o.label}" (type: ${o.semanticType}, animation: ${o.animation})`).join(", ") || "none — use abstract theme objects"}
- Colors: ${intent.colors.join(", ") || "pick palette appropriate for the niche"}
- motion: ${intent.motion}
- CTA text: "${intent.ctaText}"
- CRM tag: "${intent.crmTag}"
- Form fields: ${intent.formFields.join(", ")}

Generate everything niche-specific. Return ONLY JSON.`;

  const [schemaResponse, heroImageResult] = await Promise.allSettled([
    aiChat(
      [
        { role: "system", content: APEX_FAST_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.8, maxTokens: 4096, jsonMode: true, timeoutMs: 30000 }
    ),
    aiGenerateImage(buildHeroImagePrompt(prompt, intent)),
  ]);

  let schema: DynamicPageSchema;

  if (schemaResponse.status === "fulfilled" && schemaResponse.value.ok && schemaResponse.value.text) {
    try {
      const raw = extractJSON(schemaResponse.value.text);
      schema = JSON.parse(raw) as DynamicPageSchema;
    } catch {
      console.warn("[APEX-FAST] JSON parse failed, using fallback");
      schema = buildFallbackSchema(prompt, intent);
    }
  } else {
    console.warn("[APEX-FAST] AI call failed, using fallback");
    schema = buildFallbackSchema(prompt, intent);
  }

  // Normalize required fields
  schema.version = "1.0";
  schema.id = schema.id || id;
  schema.designSource = (schema.designSource as any) ?? "apex-generator";
  schema.meta = schema.meta ?? ({} as any);
  schema.meta.prompt = prompt;
  schema.meta.createdAt = now;
  schema.meta.updatedAt = now;
  if (subAccountId) schema.meta.subAccountId = subAccountId;
  if (schema.publish) schema.publish.published = false;

  const heroImageUrl = heroImageResult.status === "fulfilled" && heroImageResult.value ? heroImageResult.value : undefined;
  if (heroImageUrl && schema.scene) schema.scene.fallbackImage = heroImageUrl;

  // Quality validation + auto-fix
  const validation = validateGeneratedSchema(schema, prompt, intent);
  if (!validation.passed && validation.fixedSchema) {
    console.log(`[APEX-FAST] Auto-fixed ${validation.issues.filter(i => i.severity === "error").length} errors`);
    schema = validation.fixedSchema;
  }

  const generatedHtml = await generateSectionsHtml(prompt, schema, intent, heroImageUrl, uploadedImageUrl);
  if (generatedHtml) schema.generatedHtml = generatedHtml;

  return schema;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generatePageSchema(
  prompt: string,
  subAccountId?: number,
  uploadedImageUrl?: string,
  mode: GenerationMode = "stitch-style",
): Promise<DynamicPageSchema> {
  const intent = parsePromptIntent(prompt);

  console.log(`[PAGE-GEN] mode=${mode} niche=${intent.niche} businessType=${intent.businessType} objects=[${intent.semanticObjects.map(o => o.label).join(", ")}]`);

  try {
    if (mode === "stitch-style") {
      return await generateStitchStyleSchema(prompt, intent, subAccountId, uploadedImageUrl);
    } else {
      return await generateApexFastSchema(prompt, intent, subAccountId, uploadedImageUrl);
    }
  } catch (err) {
    console.error("[PAGE-GEN] Fatal error:", err instanceof Error ? err.message : err);
    return buildFallbackSchema(prompt, intent);
  }
}

export async function patchExistingPageSchema(
  existingSchema: DynamicPageSchema,
  prompt: string,
): Promise<DynamicPageSchema> {
  const intent = parsePromptIntent(prompt);
  const now = NOW();

  const userMessage = `You have this existing page schema:
${JSON.stringify(existingSchema, null, 2)}

User wants to change: "${prompt}"

Patch the schema minimally — only change what was asked. Preserve everything else.
Return the COMPLETE updated schema as JSON.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: APEX_FAST_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.5, maxTokens: 4096, jsonMode: true, timeoutMs: 30000 }
    );

    if (!response.ok || !response.text) return existingSchema;

    const raw = extractJSON(response.text);
    const patched = JSON.parse(raw) as DynamicPageSchema;
    patched.meta = { ...existingSchema.meta, ...patched.meta, updatedAt: now };

    const updatedHtml = await generateSectionsHtml(prompt, patched, intent);
    if (updatedHtml) patched.generatedHtml = updatedHtml;

    return patched;
  } catch (err) {
    console.warn("[PAGE-GEN] patchExistingPageSchema failed:", err instanceof Error ? err.message : err);
    return existingSchema;
  }
}

export async function generatePageCopy(prompt: string, niche: string): Promise<{ headline: string; subheadline: string; body: string; ctaText: string }> {
  const intent = parsePromptIntent(prompt);
  try {
    const response = await aiChat(
      [
        { role: "system", content: "Generate concise web copy. Return JSON only: {headline, subheadline, body, ctaText}" },
        { role: "user", content: `Write compelling landing page copy for: "${prompt}" — business type: ${intent.businessLabel}. Make it 100% niche-specific.` },
      ],
      { temperature: 0.9, maxTokens: 500, jsonMode: true }
    );
    if (response.ok && response.text) {
      const raw = extractJSON(response.text);
      return JSON.parse(raw);
    }
  } catch { // allow-silent-catch: JSON parse fallback — caller returns static copy text below
  }
  return { headline: `${intent.businessLabel} — Built for Results`, subheadline: `Serving ${intent.targetAudience}`, body: `Premium services tailored for you.`, ctaText: intent.ctaText };
}

export async function generateScenePlan(prompt: string): Promise<WebGLSceneSchema> {
  const schema = await generatePageSchema(prompt, undefined, undefined, "apex-fast");
  return schema.scene;
}

export async function validateSceneBudget(scene: WebGLSceneSchema): Promise<{ valid: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  if (scene.objects.length > 8) warnings.push(`Too many objects: ${scene.objects.length} (max 8)`);
  if ((scene.particles.count ?? 0) > 1500) warnings.push(`Particle count ${scene.particles.count} may cause performance issues on mobile`);
  if (scene.postProcessing.bloom && (scene.postProcessing.bloomIntensity ?? 0) > 3) warnings.push("Bloom intensity > 3 may cause visual artifacts");
  return { valid: warnings.length === 0, warnings };
}
