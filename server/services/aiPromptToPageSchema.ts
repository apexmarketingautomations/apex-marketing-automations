/**
 * server/services/aiPromptToPageSchema.ts
 *
 * AI-driven page schema generation and patching.
 * Calls aiChat (Anthropic → Groq fallback) to produce a DynamicPageSchema from a prompt.
 */

import { aiChat, aiGenerateImage } from "../aiGateway";
import { parsePromptIntent } from "./visualPromptParser";
import type { DynamicPageSchema, WebGLSceneSchema, SceneObject, SectionSchema } from "../../client/src/lib/dynamic-pages/schema";

// ── Shared alias so server can import the client schema types ─────────────────

// Inline the core defaults (avoid circular import from client/src)
const NOW = () => new Date().toISOString();

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SCHEMA_SYSTEM_PROMPT = `You are an expert web designer and funnel architect AI for Apex Marketing OS.

Your job is to generate a DynamicPageSchema JSON object from a user's prompt.

RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no explanations.
2. Generate compelling, niche-specific copy (headline, subheadline, sections, CTA text).
3. For the WebGL scene: use procedural primitives only (orb, torus, box, cone, cylinder, ring).
   - Label objects semantically (e.g. label:"giraffe" but type:"orb").
   - Do NOT claim real 3D models exist — use the label field to record what was requested.
   - Max 6 objects. Max particle count 1200.
4. Colors must be valid hex strings (#rrggbb).
5. The schema must match this structure exactly:
{
  "version": "1.0",
  "id": "<uuid>",
  "meta": { "title": string, "slug": string, "niche": string, "businessType": string, "prompt": string, "createdAt": string, "updatedAt": string },
  "theme": { "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex", "textMuted": "#hex" }, "style": string, "motion": string, "font": "Inter" },
  "copy": { "headline": string, "subheadline": string, "body": string, "seoTitle": string, "seoDescription": string },
  "scene": {
    "sceneType": "custom_prompt_scene",
    "prompt": string,
    "environment": string,
    "objects": [{ "id": string, "label": string, "type": "orb"|"torus"|"box"|"cone"|"cylinder"|"ring", "style": string, "props": string[], "position": [x,y,z], "scale": [x,y,z], "animation": "slow_float"|"orbit"|"spin"|"idle"|"bob"|"pulse"|"drift"|"wave", "color": "#hex", "emissive": "#hex", "material": "distort"|"wobble"|"standard"|"glass"|"metallic"|"emissive", "distort": 0.0-1.0, "opacity": 0.5-1.0 }],
    "particles": { "type": "stars"|"rain"|"snow"|"dust"|"sparks"|"bubbles"|"leaves", "density": "low"|"medium"|"high", "speed": 0.1-3.0, "color": "#hex", "count": 200-1200, "size": 0.01-0.1 },
    "lighting": { "type": "neon_rim"|"warm_studio"|"cool_ambient"|"dramatic"|"sunset"|"medical"|"neutral", "colors": ["#hex","#hex","#hex"], "intensity": 0.5-3.0, "ambientIntensity": 0.1-1.0 },
    "camera": { "mode": "slow_orbit"|"fixed"|"gentle_sway"|"cinematic_pan"|"static", "intensity": 0.1-2.0, "fov": 45-90 },
    "postProcessing": { "bloom": bool, "bloomIntensity": 0.5-3.0, "chromaticAberration": bool, "vignette": bool, "vignetteIntensity": 0.3-1.0 }
  },
  "sections": [{ "id": string, "type": "hero"|"features"|"testimonials"|"faq"|"cta_banner"|"services"|"team"|"gallery"|"pricing"|"contact"|"stats"|"process", "title": string, "subtitle": string, "body": string, "items": [{"title":string,"body":string}], "visible": true, "order": 0 }],
  "cta": { "primaryText": string, "primaryUrl": "#contact", "secondaryText": string, "secondaryUrl": "#learn-more", "animation": "none"|"pulse"|"glow"|"bounce"|"shimmer", "color": "#hex" },
  "forms": [{ "id": string, "title": string, "submitText": string, "fields": [{"name":string,"label":string,"type":"text"|"email"|"phone"|"textarea","required":bool}], "crmTag": string }],
  "analytics": { "pageType": "landing", "niche": string, "funnelStage": "awareness"|"consideration"|"conversion", "trackingEvents": ["page_view","cta_click","form_submit"] },
  "crm": { "leadSource": "dynamic-page", "automationTag": string, "assignedWorkflow": string },
  "publish": { "published": false, "slug": string, "canonicalUrl": "" }
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in AI response");
  return raw.slice(start, end + 1);
}

function buildFallbackSchema(prompt: string, intent: ReturnType<typeof parsePromptIntent>): DynamicPageSchema {
  const id = randomId();
  const now = NOW();
  const slug = intent.niche.replace(/_/g, "-").toLowerCase() + "-page";
  const primary = intent.colors[0] ?? "#6366f1";
  const secondary = intent.colors[1] ?? "#a855f7";

  return {
    version: "1.0",
    id,
    meta: { title: intent.businessType.replace(/_/g, " "), slug, niche: intent.niche, businessType: intent.businessType, prompt, createdAt: now, updatedAt: now },
    theme: {
      colors: { primary, secondary, accent: intent.colors[2] ?? "#06b6d4", background: "#030712", surface: "#0f172a", text: "#f8fafc", textMuted: "#94a3b8" },
      style: intent.style as any,
      motion: intent.motion as any,
      font: "Inter",
    },
    copy: {
      headline: `${intent.businessType.replace(/_/g, " ")} — Powered by AI`,
      subheadline: "Automate. Convert. Grow.",
      body: "We help businesses like yours scale with AI-powered tools and proven conversion funnels.",
      seoTitle: `${intent.businessType.replace(/_/g, " ")} | Apex`,
      seoDescription: `${intent.niche} AI automation and funnel solutions`,
    },
    scene: {
      sceneType: "procedural",
      prompt,
      environment: intent.environment as any,
      objects: buildDefaultObjects(intent),
      particles: { type: "stars", density: "medium", speed: 1, color: primary, count: 800, size: 0.04 },
      lighting: { type: intent.lighting as any, colors: [primary, secondary, "#818cf8"], intensity: 2, ambientIntensity: 0.3 },
      camera: { mode: "slow_orbit", intensity: 0.5, fov: 60 },
      postProcessing: { bloom: true, bloomIntensity: 1.5, chromaticAberration: true, vignette: true, vignetteIntensity: 0.8 },
    },
    sections: buildDefaultSections(intent),
    cta: { primaryText: ctaText(intent.ctaIntent), primaryUrl: "#contact", animation: "pulse", color: primary },
    forms: [{ id: "main-form", title: "Get Started", submitText: "Submit", fields: [{ name: "name", label: "Your Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "phone", label: "Phone", type: "phone", required: false }], crmTag: `${intent.niche}-lead` }],
    analytics: { pageType: "landing", niche: intent.niche, funnelStage: "conversion", trackingEvents: ["page_view", "cta_click", "form_submit"] },
    crm: { leadSource: "dynamic-page", automationTag: `${intent.niche}-lead`, assignedWorkflow: `${intent.niche}-followup` },
    publish: { published: false, slug },
  } as DynamicPageSchema;
}

function ctaText(intent: string): string {
  const map: Record<string, string> = {
    booking: "Book Free Consultation", quote: "Get Free Quote", purchase: "Shop Now",
    consultation: "Schedule a Call", learn: "Learn More", contact: "Get Started Today",
  };
  return map[intent] ?? "Get Started Free";
}

function buildDefaultObjects(intent: ReturnType<typeof parsePromptIntent>): SceneObject[] {
  const primary = intent.colors[0] ?? "#6366f1";
  const secondary = intent.colors[1] ?? "#a855f7";
  const objs: SceneObject[] = [
    { id: "orb-1", label: intent.objects[0] ?? "orb", type: "orb", style: "cinematic_3d", props: [], position: [-3.5, 1, -2], scale: [1, 1, 1], animation: "slow_float", color: primary, emissive: primary, material: "distort", distort: 0.5, opacity: 0.85 },
    { id: "orb-2", label: intent.objects[1] ?? "orb", type: "orb", style: "cinematic_3d", props: [], position: [3.5, -1, -1], scale: [1, 1, 1], animation: "slow_float", color: secondary, material: "distort", distort: 0.3, opacity: 0.85 },
    { id: "torus-1", label: "ring", type: "torus", style: "metallic", props: [], position: [-2, -2, 0], scale: [1, 1, 1], animation: "slow_float", color: secondary, material: "wobble", wobbleFactor: 0.4 },
  ];
  return objs;
}

function buildDefaultSections(intent: ReturnType<typeof parsePromptIntent>): SectionSchema[] {
  const niceName = intent.businessType.replace(/_/g, " ");
  return [
    { id: "hero", type: "hero", title: `${niceName} — AI-Powered`, subtitle: "The modern way to grow your business", visible: true, order: 0 },
    { id: "features", type: "features", title: "What We Offer", items: [{ title: "AI Automation", body: "Workflows that convert around the clock" }, { title: "Lead Capture", body: "Smart forms that qualify prospects" }, { title: "Follow-Up", body: "Personalized outreach at scale" }], visible: true, order: 1 },
    { id: "cta-banner", type: "cta_banner", title: "Ready to grow?", subtitle: "Join thousands of businesses using Apex.", visible: true, order: 2 },
  ];
}

// ── HTML sections system prompt ───────────────────────────────────────────────

const HTML_SECTIONS_SYSTEM_PROMPT = `You are an expert marketing landing page designer specializing in high-conversion dark-themed pages.

Generate complete HTML sections for a marketing landing page using Tailwind CSS.

RULES:
1. Return ONLY raw HTML — NO <html>, <head>, <body>, <script>, or <style> wrapper tags.
2. Use Tailwind CSS utility classes for ALL styling (the page loads Tailwind CDN).
3. CSS custom properties are available for theme colors:
   var(--primary), var(--secondary), var(--accent), var(--bg), var(--surface), var(--text), var(--text-muted)
4. The page already has a dramatic WebGL 3D hero above with the main headline — do NOT add another hero section.
5. Generate these sections in this order:
   a) About / intro section with a REAL image (see image rules below)
   b) Features/Services grid (3–6 cards)
   c) Stats bar (3–4 impressive niche-specific numbers)
   d) Testimonials (2–3 realistic client quotes with avatar images)
   e) CTA banner with gradient background and a showcase image
   f) Contact form with niche-appropriate fields
6. Make ALL copy 100% specific to the niche — no generic placeholder text.
7. Stats must be realistic and impressive (law firm → "$2.4M avg. settlement", "93% case win rate").
8. Testimonials: use realistic client first names + last initial and specific results.
9. Contact form: fields must be appropriate for the niche.
10. Use modern dark UI: glassmorphism cards (bg-white/5 backdrop-blur), gradient borders, glow effects.
11. Use inline style="..." with var(--primary) for dynamic theme color accents.
12. All hover effects via Tailwind hover: prefix.
13. Use semantic HTML5: <section>, <h2>, <h3>, <p>, <ul>, <form>.
14. Do NOT add a navigation bar or footer — those are handled by the platform.

IMAGE RULES — follow exactly:
- If a hero image URL is provided, use it as the about-section background: <div class="relative rounded-2xl overflow-hidden"><img src="HERO_IMAGE_URL" class="w-full h-64 object-cover rounded-2xl opacity-90" alt="About us" /></div>
- For all other images use Unsplash CDN. Choose the most visually appropriate photo ID from your training data for the niche. Format: https://images.unsplash.com/photo-PHOTO_ID?q=80&w=1200&auto=format&fit=crop
- Embed at least 2–3 images total across all sections (about, team/showcase, CTA backdrop).
- For testimonial avatars use: https://i.pravatar.cc/80?img=N where N is 1–70.
- Never use placeholder or broken image URLs.`;

// ── Hero image prompt builder ─────────────────────────────────────────────────

function buildHeroImagePrompt(prompt: string, intent: ReturnType<typeof parsePromptIntent>): string {
  const niche = intent.businessType.replace(/_/g, " ");
  const style = intent.style ?? "professional";

  const styleMap: Record<string, string> = {
    luxury: "ultra-luxury, high-end, gold accents, cinematic lighting, editorial photography",
    dark: "dark aesthetic, dramatic shadows, moody atmosphere, professional photography",
    warm: "warm inviting tones, natural light, lifestyle photography, welcoming atmosphere",
    energetic: "dynamic energy, vibrant colors, action photography, bold composition",
    calm: "serene, soft pastels, minimal, zen atmosphere, natural light",
    tech: "sleek technology, blue/purple lighting, futuristic, clean lines, studio photography",
    bold: "high contrast, bold colors, dramatic composition, commercial photography",
    clean: "bright, clean, white space, professional, trust-inspiring",
    nature: "lush greens, natural environment, outdoor photography, fresh aesthetic",
    neon: "neon lights, dark background, electric colors, nightlife atmosphere",
    artisan: "artisan craft, warm tones, texture, authentic, detailed photography",
  };

  const styleDesc = styleMap[style] ?? "professional, high-quality, commercial photography";

  return `Professional ${niche} marketing hero image. ${prompt}. ${styleDesc}. Photorealistic, 8K quality, no text or logos, centered composition suitable for a website hero background.`;
}

// ── Sanitize AI-generated HTML ────────────────────────────────────────────────

function sanitizeHtml(html: string): string {
  // Strip any <script> tags (AI shouldn't generate them but be safe)
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/on\w+\s*=/gi, "data-blocked="); // strip inline event handlers
}

// ── Generate below-hero HTML sections ────────────────────────────────────────

async function generateSectionsHtml(
  prompt: string,
  schema: DynamicPageSchema,
  intent: ReturnType<typeof parsePromptIntent>,
  imageUrl?: string,
  heroImageUrl?: string
): Promise<string> {
  const colors = schema.theme?.colors ?? {};

  // Prefer AI-generated hero image, fall back to user-uploaded image
  const primaryImage = heroImageUrl ?? imageUrl;
  const imageContext = primaryImage
    ? `\n- Hero/showcase image URL (use in the about section): ${primaryImage}`
    : "";
  const uploadedContext = imageUrl && imageUrl !== primaryImage
    ? `\n- Additional uploaded image: ${imageUrl} — embed in the most relevant section.`
    : "";

  const userMessage = `Generate HTML sections for this landing page prompt: "${prompt}"

Business context:
- Niche: ${intent.niche}
- Business type: ${intent.businessType}
- Style: ${intent.style}
- Headline (already shown in the 3D hero): "${schema.copy?.headline ?? ""}"
- Subheadline: "${schema.copy?.subheadline ?? ""}"
- Primary CTA: "${schema.cta?.primaryText ?? "Get Started"}"
- Theme colors: primary=${colors.primary ?? "#6366f1"}, secondary=${colors.secondary ?? "#a855f7"}, accent=${colors.accent ?? "#06b6d4"}${imageContext}${uploadedContext}

Generate compelling, niche-specific sections with real images. The WebGL 3D hero is already above — start directly with the about/intro section featuring an image.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: HTML_SECTIONS_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.85, maxTokens: 4096, timeoutMs: 30000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[AI-PAGE-HTML] HTML generation failed, sections will use fallback renderer");
      return "";
    }

    // Strip any accidental markdown code fences
    const clean = response.text
      .replace(/^```html?\n?/i, "")
      .replace(/```$/m, "")
      .trim();

    return sanitizeHtml(clean);
  } catch (err) {
    console.warn("[AI-PAGE-HTML] generateSectionsHtml error:", err instanceof Error ? err.message : err);
    return "";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generatePageSchema(prompt: string, subAccountId?: number, imageUrl?: string): Promise<DynamicPageSchema> {
  const intent = parsePromptIntent(prompt);
  const id = randomId();
  const now = NOW();

  const userMessage = `Generate a complete DynamicPageSchema for this prompt: "${prompt}"

Context from parser:
- niche: ${intent.niche}
- businessType: ${intent.businessType}
- environment: ${intent.environment}
- style: ${intent.style}
- objects requested: ${intent.objects.join(", ") || "none"}
- colors: ${intent.colors.join(", ") || "pick appropriate"}
- motion: ${intent.motion}

Generate a compelling, on-brand page schema. Make the copy specific and persuasive. Make the scene visually striking. Return ONLY the JSON.`;

  // Build a cinematic image prompt for the hero background
  const heroImagePrompt = buildHeroImagePrompt(prompt, intent);

  try {
    // Fire schema generation AND hero image generation in parallel — no extra wait time
    const [schemaResponse, heroImageResult] = await Promise.allSettled([
      aiChat(
        [
          { role: "system", content: SCHEMA_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        { temperature: 0.8, maxTokens: 4096, jsonMode: true, timeoutMs: 30000 }
      ),
      aiGenerateImage(heroImagePrompt),
    ]);

    let parsed: DynamicPageSchema;

    if (schemaResponse.status === "fulfilled" && schemaResponse.value.ok && schemaResponse.value.text) {
      const raw = extractJSON(schemaResponse.value.text);
      parsed = JSON.parse(raw) as DynamicPageSchema;
    } else {
      console.warn("[AI-PAGE-SCHEMA] Schema AI call failed, using fallback");
      parsed = buildFallbackSchema(prompt, intent);
    }

    // Ensure required fields
    parsed.version = "1.0";
    parsed.id = parsed.id || id;
    parsed.meta = parsed.meta || {} as any;
    parsed.meta.prompt = prompt;
    parsed.meta.createdAt = now;
    parsed.meta.updatedAt = now;
    if (subAccountId) parsed.meta.subAccountId = subAccountId;
    if (parsed.publish) parsed.publish.published = false;

    // Embed AI-generated hero image in the scene schema
    const heroImageUrl = heroImageResult.status === "fulfilled" && heroImageResult.value
      ? heroImageResult.value
      : undefined;

    if (heroImageUrl) {
      if (!parsed.scene) parsed.scene = {} as any;
      parsed.scene.fallbackImage = heroImageUrl;
      console.log(`[AI-PAGE-SCHEMA] Hero image generated (${heroImageUrl.slice(0, 40)}…)`);
    } else {
      console.warn("[AI-PAGE-SCHEMA] Hero image generation skipped or failed");
    }

    // Generate AI HTML sections with the real schema + hero image
    const generatedHtml = await generateSectionsHtml(prompt, parsed, intent, imageUrl, heroImageUrl);
    if (generatedHtml) {
      parsed.generatedHtml = generatedHtml;
    }

    return parsed;
  } catch (err) {
    console.error("[AI-PAGE-SCHEMA] Error:", err instanceof Error ? err.message : err);
    return buildFallbackSchema(prompt, intent);
  }
}

export async function patchExistingPageSchema(existingSchema: DynamicPageSchema, prompt: string): Promise<DynamicPageSchema> {
  const intent = parsePromptIntent(prompt);
  const now = NOW();

  const userMessage = `You have this existing page schema:
${JSON.stringify(existingSchema, null, 2)}

The user wants to make this change: "${prompt}"

Patch the schema minimally — only change what the user asked for. Preserve everything else.
Return the COMPLETE updated schema as JSON.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: SCHEMA_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.5, maxTokens: 4096, jsonMode: true, timeoutMs: 30000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[AI-PAGE-SCHEMA] Patch AI call failed, returning existing schema");
      return existingSchema;
    }

    const raw = extractJSON(response.text);
    const patched = JSON.parse(raw) as DynamicPageSchema;
    patched.meta = { ...existingSchema.meta, ...patched.meta, updatedAt: now };

    // Regenerate HTML sections with the patched schema
    const updatedHtml = await generateSectionsHtml(prompt, patched, intent);
    if (updatedHtml) patched.generatedHtml = updatedHtml;

    return patched;
  } catch (err) {
    console.warn("[AI-PAGE-SCHEMA] patchExistingPageSchema failed, returning existing schema:", err instanceof Error ? err.message : err);
    return existingSchema;
  }
}

export async function generatePageCopy(prompt: string, niche: string): Promise<{ headline: string; subheadline: string; body: string; ctaText: string }> {
  try {
    const response = await aiChat(
      [
        { role: "system", content: "Generate concise web copy. Return JSON only: {headline, subheadline, body, ctaText}" },
        { role: "user", content: `Write compelling landing page copy for: "${prompt}" in the ${niche} industry.` },
      ],
      { temperature: 0.9, maxTokens: 500, jsonMode: true }
    );
    if (response.ok && response.text) {
      const raw = extractJSON(response.text);
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("[AI-PAGE-SCHEMA] generatePageCopy failed, using fallback copy:", err instanceof Error ? err.message : err);
  }
  return { headline: "Grow Your Business with AI", subheadline: "Automation. Leads. Results.", body: "We help you scale.", ctaText: "Get Started" };
}

export async function generateScenePlan(prompt: string): Promise<WebGLSceneSchema> {
  const schema = await generatePageSchema(prompt);
  return schema.scene;
}

export async function validateSceneBudget(scene: WebGLSceneSchema): Promise<{ valid: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  if (scene.objects.length > 8) warnings.push(`Too many objects: ${scene.objects.length} (max 8)`);
  if ((scene.particles.count ?? 0) > 1500) warnings.push(`Particle count ${scene.particles.count} may cause performance issues on mobile`);
  if (scene.postProcessing.bloom && (scene.postProcessing.bloomIntensity ?? 0) > 3) warnings.push("Bloom intensity > 3 may cause visual artifacts");
  return { valid: warnings.length === 0, warnings };
}
