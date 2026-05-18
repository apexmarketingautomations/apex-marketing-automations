/**
 * server/services/aiPromptToIdentityDNA.ts
 *
 * AI-driven Identity Visual DNA generation and patching.
 * Calls aiChat (Anthropic → Groq fallback) to produce an IdentityVisualDNA from a prompt.
 */

import { aiChat } from "../aiGateway";
import type { IdentityVisualDNA, IdentityStyle, SceneObject } from "../../client/src/lib/card-identity/schema";

// ── System Prompt ─────────────────────────────────────────────────────────────

const IDENTITY_SYSTEM_PROMPT = `You are an elite AI brand identity designer for Apex Marketing OS.

Your job is to generate a complete IdentityVisualDNA JSON from a user's description.

RULES:
1. Return ONLY valid JSON — no markdown, no code blocks, no explanations.
2. Generate compelling, niche-specific branding copy (tagline, authorityHook, ctaPrimary).
3. Color palette must match the niche and mood perfectly. Use hex strings only.
4. Max 4 scene objects. Particle count 200-800 for mobile optimization.
5. The JSON must match this exact structure:
{
  "version": "1.0",
  "prompt": string,
  "identityStyle": "luxury_founder"|"cyberpunk_creative"|"warm_professional"|"playful_service"|"bold_authority"|"minimal_tech"|"cinematic_realtor"|"energetic_fitness"|"elegant_beauty"|"raw_industrial"|"nature_wellness"|"gold_finance",
  "motionProfile": "cinematic_slow"|"energetic"|"subtle"|"static"|"playful",
  "lightingStyle": string,
  "particleStyle": "floating_energy"|"none"|"rain"|"sparkle"|"confetti"|"starfield",
  "interactionStyle": "premium_glass"|"magnetic"|"playful_bounce"|"minimal",
  "ctaBehavior": "magnetic_glow"|"pulse"|"shimmer"|"bounce"|"none",
  "cameraMotion": "slow_orbit"|"static"|"drift"|"lock",
  "themeIntensity": 0.0-1.0,
  "mobileOptimization": true,
  "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex", "background": "#hex", "surface": "#hex", "text": "#hex" },
  "scene": {
    "environment": "space"|"luxury"|"neon_city"|"nature"|"abstract"|"minimal"|"club",
    "objects": [{ "id": string, "type": "orb"|"ring"|"cube"|"crystal"|"logo_float"|"particles_burst", "position": [x,y,z], "scale": 0.5-2.0, "color": "#hex", "material": "distort"|"glass"|"emissive"|"metallic"|"wobble", "animation": "float"|"spin"|"pulse"|"orbit"|"breathe", "opacity": 0.3-1.0 }],
    "particles": { "enabled": bool, "count": 200-800, "color": "#hex", "size": 0.02-0.08, "speed": 0.1-2.0, "type": "float"|"rain"|"sparkle"|"swirl" },
    "lighting": { "ambientIntensity": 0.1-0.8, "pointLights": [{ "position": [x,y,z], "color": "#hex", "intensity": 0.5-3.0 }] },
    "postProcessing": { "bloom": bool, "bloomIntensity": 0.5-2.5, "vignette": bool, "chromaticAberration": bool }
  },
  "typography": { "headingFont": "Inter", "bodyFont": "Inter", "headingWeight": 700|800|900, "letterSpacing": "-0.02em"|"0"|"0.05em" },
  "branding": { "tagline": string, "bioImprovement": string, "ctaPrimary": string, "ctaSecondary": string, "authorityHook": string },
  "niche": string,
  "generatedAt": string
}`;

// ── Keyword Parser (fallback) ─────────────────────────────────────────────────

interface ParsedIntent {
  style: IdentityStyle;
  colors: [string, string, string, string, string, string];
  environment: IdentityVisualDNA["scene"]["environment"];
  motionProfile: IdentityVisualDNA["motionProfile"];
  particleStyle: IdentityVisualDNA["particleStyle"];
  lightingStyle: string;
  niche: string;
  ctaPrimary: string;
  authorityHook: string;
  bloom: boolean;
  bloomIntensity: number;
}

function parseKeywords(prompt: string): ParsedIntent {
  const p = prompt.toLowerCase();

  // Cyberpunk / DJ / nightclub
  if (/cyberpunk|neon|dj|nightclub|rave|edm|club/.test(p)) {
    return {
      style: "cyberpunk_creative",
      colors: ["#ff00ff", "#00ffff", "#ff0099", "#050014", "#0a0020", "#ffffff"],
      environment: "neon_city",
      motionProfile: "energetic",
      particleStyle: "rain",
      lightingStyle: "neon_pulse",
      niche: "entertainment",
      ctaPrimary: "Book Me Now",
      authorityHook: "Setting the vibe since 2015",
      bloom: true,
      bloomIntensity: 2.5,
    };
  }

  // Luxury / gold / premium / finance
  if (/luxury|gold|premium|wealth|private|vip|concierge|finance|investment|hedge/.test(p)) {
    return {
      style: "gold_finance",
      colors: ["#d4af37", "#b8860b", "#ffd700", "#0a0805", "#0f0c07", "#ffffff"],
      environment: "luxury",
      motionProfile: "cinematic_slow",
      particleStyle: "sparkle",
      lightingStyle: "gold_luxury",
      niche: "finance",
      ctaPrimary: "Schedule a Private Consultation",
      authorityHook: "Managing $2B+ in private wealth",
      bloom: true,
      bloomIntensity: 1.8,
    };
  }

  // Attorney / law / legal
  if (/attorney|law|legal|lawyer|counsel|firm|litigation|court/.test(p)) {
    return {
      style: "bold_authority",
      colors: ["#4f46e5", "#7c3aed", "#06b6d4", "#030a1a", "#060f28", "#ffffff"],
      environment: "abstract",
      motionProfile: "cinematic_slow",
      particleStyle: "floating_energy",
      lightingStyle: "cool_authority",
      niche: "legal",
      ctaPrimary: "Request a Free Consultation",
      authorityHook: "Trusted by 1,000+ clients statewide",
      bloom: true,
      bloomIntensity: 1.2,
    };
  }

  // Realtor / real estate
  if (/realtor|real estate|property|homes|houses|realty|broker/.test(p)) {
    return {
      style: "cinematic_realtor",
      colors: ["#0ea5e9", "#0284c7", "#38bdf8", "#020e1a", "#041525", "#ffffff"],
      environment: "luxury",
      motionProfile: "cinematic_slow",
      particleStyle: "sparkle",
      lightingStyle: "sky_blue",
      niche: "real_estate",
      ctaPrimary: "See Available Listings",
      authorityHook: "$50M+ in closed transactions",
      bloom: true,
      bloomIntensity: 1.5,
    };
  }

  // Fitness / gym / coach / trainer
  if (/fitness|gym|coach|trainer|workout|athlete|strength|crossfit|hiit/.test(p)) {
    return {
      style: "energetic_fitness",
      colors: ["#22c55e", "#16a34a", "#84cc16", "#020a02", "#041008", "#ffffff"],
      environment: "abstract",
      motionProfile: "energetic",
      particleStyle: "floating_energy",
      lightingStyle: "neon_green",
      niche: "fitness",
      ctaPrimary: "Start Your Transformation",
      authorityHook: "500+ clients transformed",
      bloom: true,
      bloomIntensity: 2.0,
    };
  }

  // Beauty / med spa / aesthetic
  if (/med spa|beauty|aesthetic|spa|skin|facial|botox|filler|salon/.test(p)) {
    return {
      style: "elegant_beauty",
      colors: ["#e879f9", "#c026d3", "#f0abfc", "#160820", "#200a30", "#ffffff"],
      environment: "abstract",
      motionProfile: "cinematic_slow",
      particleStyle: "sparkle",
      lightingStyle: "rose_gold",
      niche: "beauty",
      ctaPrimary: "Book Your Consultation",
      authorityHook: "Trusted by 2,000+ clients",
      bloom: true,
      bloomIntensity: 1.6,
    };
  }

  // Pet / grooming / vet
  if (/pet|grooming|vet|veterinary|dog|cat|animal/.test(p)) {
    return {
      style: "playful_service",
      colors: ["#f97316", "#ea580c", "#fb923c", "#150800", "#1e0d00", "#ffffff"],
      environment: "nature",
      motionProfile: "playful",
      particleStyle: "confetti",
      lightingStyle: "warm_orange",
      niche: "pet_services",
      ctaPrimary: "Book a Grooming Session",
      authorityHook: "Happy pets, happy owners",
      bloom: false,
      bloomIntensity: 0.8,
    };
  }

  // Founder / startup / tech / AI
  if (/founder|startup|tech|ai |artificial|saas|software|engineer/.test(p)) {
    return {
      style: "luxury_founder",
      colors: ["#6366f1", "#a855f7", "#06b6d4", "#030712", "#0f1117", "#ffffff"],
      environment: "space",
      motionProfile: "cinematic_slow",
      particleStyle: "floating_energy",
      lightingStyle: "blue_holographic",
      niche: "technology",
      ctaPrimary: "Book a Strategy Call",
      authorityHook: "Building the future of AI",
      bloom: true,
      bloomIntensity: 1.5,
    };
  }

  // Warm / friendly professional default
  return {
    style: "warm_professional",
    colors: ["#0ea5e9", "#0284c7", "#38bdf8", "#030712", "#0f172a", "#ffffff"],
    environment: "abstract",
    motionProfile: "subtle",
    particleStyle: "floating_energy",
    lightingStyle: "cool_ambient",
    niche: "professional",
    ctaPrimary: "Get in Touch",
    authorityHook: "",
    bloom: true,
    bloomIntensity: 1.2,
  };
}

function buildFallbackDNA(prompt: string, profileContext?: ProfileContext): IdentityVisualDNA {
  const intent = parseKeywords(prompt);
  const now = new Date().toISOString();
  const [primary, secondary, accent, background, surface, text] = intent.colors;

  return {
    version: "1.0",
    prompt,
    identityStyle: intent.style,
    motionProfile: intent.motionProfile,
    lightingStyle: intent.lightingStyle,
    particleStyle: intent.particleStyle,
    interactionStyle: "premium_glass",
    ctaBehavior: intent.bloom ? "magnetic_glow" : "pulse",
    cameraMotion: "slow_orbit",
    themeIntensity: 0.7,
    mobileOptimization: true,
    colors: { primary, secondary, accent, background, surface, text },
    scene: {
      environment: intent.environment,
      objects: [
        { id: "orb1", type: "orb", position: [-2, 0.5, -1], scale: 1, color: primary, material: "distort", animation: "float", opacity: 0.85 },
        { id: "orb2", type: "orb", position: [2, -0.5, -2], scale: 0.7, color: secondary, material: "glass", animation: "pulse", opacity: 0.6 },
      ],
      particles: { enabled: intent.particleStyle !== "none", count: 500, color: primary, size: 0.04, speed: 0.5, type: "float" },
      lighting: {
        ambientIntensity: 0.3,
        pointLights: [
          { position: [5, 5, 5], color: primary, intensity: 2 },
          { position: [-5, -5, -3], color: secondary, intensity: 1.5 },
        ],
      },
      postProcessing: { bloom: intent.bloom, bloomIntensity: intent.bloomIntensity, vignette: true, chromaticAberration: false },
    },
    typography: { headingFont: "Inter", bodyFont: "Inter", headingWeight: 900, letterSpacing: "-0.02em" },
    branding: {
      tagline: profileContext?.bio ? undefined : prompt.slice(0, 80),
      ctaPrimary: intent.ctaPrimary,
      ctaSecondary: "View Portfolio",
      authorityHook: intent.authorityHook || undefined,
    },
    niche: intent.niche,
    generatedAt: now,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in AI response");
  return raw.slice(start, end + 1);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ProfileContext {
  name?: string;
  title?: string;
  company?: string;
  bio?: string;
  niche?: string;
}

export async function generateIdentityDNA(prompt: string, profileContext?: ProfileContext): Promise<IdentityVisualDNA> {
  const now = new Date().toISOString();
  const contextStr = profileContext
    ? `\nProfile context:\n- Name: ${profileContext.name || "unknown"}\n- Title: ${profileContext.title || "unknown"}\n- Company: ${profileContext.company || "unknown"}\n- Bio: ${profileContext.bio || "none"}\n- Niche: ${profileContext.niche || "unknown"}`
    : "";

  const userMessage = `Generate an IdentityVisualDNA for this visual description: "${prompt}"
${contextStr}

Make the branding copy specific, powerful, and niche-appropriate. The scene should visually match the prompt. Return ONLY the JSON.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: IDENTITY_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.8, maxTokens: 3000, jsonMode: true, timeoutMs: 25000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[IDENTITY] AI call failed, using fallback DNA");
      return buildFallbackDNA(prompt, profileContext);
    }

    const raw = extractJSON(response.text);
    const parsed = JSON.parse(raw) as IdentityVisualDNA;

    // Enforce required fields
    parsed.version = "1.0";
    parsed.prompt = prompt;
    parsed.generatedAt = now;
    parsed.mobileOptimization = true;

    // Clamp themeIntensity
    if (typeof parsed.themeIntensity !== "number") parsed.themeIntensity = 0.7;
    parsed.themeIntensity = Math.max(0, Math.min(1, parsed.themeIntensity));

    // Clamp particle count for mobile
    if (parsed.scene?.particles?.count) {
      parsed.scene.particles.count = Math.min(800, parsed.scene.particles.count);
    }

    // Limit objects
    if (Array.isArray(parsed.scene?.objects)) {
      parsed.scene.objects = parsed.scene.objects.slice(0, 4);
    }

    console.log(`[IDENTITY] Generated DNA for prompt: "${prompt.slice(0, 60)}" style=${parsed.identityStyle}`);
    return parsed;
  } catch (err) {
    console.error("[IDENTITY] Error:", err instanceof Error ? err.message : err);
    return buildFallbackDNA(prompt, profileContext);
  }
}

export async function patchIdentityDNA(existingDNA: IdentityVisualDNA, prompt: string): Promise<IdentityVisualDNA> {
  const now = new Date().toISOString();

  const userMessage = `You have this existing IdentityVisualDNA:
${JSON.stringify(existingDNA, null, 2)}

The user wants to make this change: "${prompt}"

Patch the DNA minimally — only change what the user asked for. Preserve everything else.
Return the COMPLETE updated DNA as JSON.`;

  try {
    const response = await aiChat(
      [
        { role: "system", content: IDENTITY_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.5, maxTokens: 3000, jsonMode: true, timeoutMs: 25000 }
    );

    if (!response.ok || !response.text) {
      console.warn("[IDENTITY] Patch AI call failed, returning existing DNA");
      return existingDNA;
    }

    const raw = extractJSON(response.text);
    const patched = JSON.parse(raw) as IdentityVisualDNA;
    patched.version = "1.0";
    patched.prompt = existingDNA.prompt;
    patched.generatedAt = now;
    patched.mobileOptimization = true;
    if (patched.scene?.particles?.count) {
      patched.scene.particles.count = Math.min(800, patched.scene.particles.count);
    }
    if (Array.isArray(patched.scene?.objects)) {
      patched.scene.objects = patched.scene.objects.slice(0, 4);
    }
    console.log(`[IDENTITY] Patched DNA: "${prompt.slice(0, 60)}"`);
    return patched;
  } catch (err) {
    console.warn("[IDENTITY] patchIdentityDNA failed, returning existing DNA:", err instanceof Error ? err.message : err);
    return existingDNA;
  }
}

// ── Card content generation ───────────────────────────────────────────────────

export interface GeneratedCardContent {
  bio: string;
  tagline: string;
  services: Array<{ label: string; description: string; icon: string; color: string }>;
  testimonial: { quote: string; author: string; role: string } | null;
}

const SERVICE_COLORS = [
  "linear-gradient(135deg,#6366f1,#4f46e5)",
  "linear-gradient(135deg,#a855f7,#9333ea)",
  "linear-gradient(135deg,#06b6d4,#0891b2)",
  "linear-gradient(135deg,#10b981,#059669)",
  "linear-gradient(135deg,#f59e0b,#d97706)",
  "linear-gradient(135deg,#ef4444,#dc2626)",
];

export async function generateCardContent(
  prompt: string,
  context: { name?: string; title?: string; company?: string; niche?: string; imageUrl?: string }
): Promise<GeneratedCardContent> {
  const nameStr = context.name ? `Name: ${context.name}` : "";
  const titleStr = context.title ? `Title: ${context.title}` : "";
  const companyStr = context.company ? `Company: ${context.company}` : "";
  const imageStr = context.imageUrl ? `Profile/brand image provided: ${context.imageUrl}` : "";

  const systemPrompt = `You are an expert copywriter and business card content strategist.
Generate compelling, niche-specific content for a digital business card.
Return ONLY valid JSON — no markdown, no code blocks.
JSON structure:
{
  "bio": string (2-3 sentences, first-person, specific to their niche, ~80 words),
  "tagline": string (punchy 5-10 word tagline, niche-specific),
  "services": [
    { "label": string (2-3 words), "description": string (8-12 words), "icon": string (one of: home|hammer|wrench|zap|scale|shield|heart|stethoscope|car|camera|palette|sparkles|briefcase|leaf|scissors|trending|dollar|star|phone|mail), "color": string (pick from: red|orange|gold|green|teal|blue|purple|pink) }
  ] (3-5 services, highly niche-specific),
  "testimonial": { "quote": string (1-2 sentences, specific outcome, realistic), "author": string (first name + last initial), "role": string (their job/context) } or null
}
Rules:
- Bio must NOT be generic. "Award-winning" is OK. Reference specific outcomes, locations, or niches.
- Services must match exactly what this type of business does.
- Testimonial quote must include a specific result (e.g. "sold in 4 days", "saved me $12k", "recovered in 6 weeks").
- If niche is unclear, infer from the prompt.`;

  const userMsg = `Generate card content for: "${prompt}"
${nameStr} ${titleStr} ${companyStr} ${imageStr}`.trim();

  try {
    const response = await aiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      { temperature: 0.85, maxTokens: 1200, jsonMode: true, timeoutMs: 20000 }
    );

    if (!response.ok || !response.text) throw new Error("AI returned empty response");

    const raw = response.text.slice(response.text.indexOf("{"), response.text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(raw) as GeneratedCardContent;

    // Assign gradient colors to services
    if (Array.isArray(parsed.services)) {
      parsed.services = parsed.services.slice(0, 5).map((svc, i) => ({
        ...svc,
        color: SERVICE_COLORS[i % SERVICE_COLORS.length],
      }));
    }

    return parsed;
  } catch (err) {
    console.warn("[IDENTITY] generateCardContent failed:", err instanceof Error ? err.message : err);
    // Minimal fallback
    return {
      bio: context.name
        ? `${context.name} is a dedicated ${context.title ?? "professional"} committed to delivering exceptional results for every client.`
        : "A dedicated professional committed to delivering exceptional results for every client.",
      tagline: context.title ? `Expert ${context.title} Services` : "Professional. Trusted. Exceptional.",
      services: [
        { label: "Consultation", description: "Expert advice tailored to your needs", icon: "briefcase", color: SERVICE_COLORS[0] },
        { label: "Full Service", description: "End-to-end professional support", icon: "star", color: SERVICE_COLORS[1] },
        { label: "Follow-Up", description: "Ongoing support after every engagement", icon: "phone", color: SERVICE_COLORS[2] },
      ],
      testimonial: null,
    };
  }
}
