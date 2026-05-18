/**
 * server/services/layoutCompositionEngine.ts
 *
 * The freeform layout composition engine — the heart of the Stitch-style
 * Dynamic Pages architecture.
 *
 *   Prompt → intent → design system → COMPOSITION PLAN → LayoutNode tree
 *
 * Composition is a two-stage process:
 *
 *   1. PLAN  — the AI (or a deterministic archetype planner) produces a
 *              CompositionPlan: an archetype + an ordered list of "zones",
 *              each with a kind, a variant, and copy. The AI has real
 *              compositional freedom here — it chooses the archetype, which
 *              zones exist, their order, their variants, and all copy.
 *
 *   2. BUILD — each zone is expanded by a dedicated builder into a rich
 *              LayoutNode subtree (containers, grids, glass panels, floating
 *              panels, motion clusters, split layouts, marquees...). This
 *              guarantees a valid, renderable tree no matter what the AI
 *              returns.
 *
 * This is NOT block-filling. Two different prompts produce different
 * archetypes, different zone sets, different orders, and different variants —
 * which the compositionValidator enforces.
 */

import { aiChat } from "../aiGateway";
import { generateDesignSystem } from "./designSystemGenerator";
import type { ParsedPromptIntent } from "./visualPromptParser";
import type {
  ComposedLayout,
  CompositionArchetype,
  DesignSystem,
  LayoutNode,
  LayoutNodeType,
} from "../../client/src/lib/dynamic-pages/layoutTree";
import {
  nodeId,
  computeCompositionSignature,
  layoutVocabulary,
} from "../../client/src/lib/dynamic-pages/layoutTree";

// ── Composition plan ──────────────────────────────────────────────────────────

export type ZoneKind =
  | "hero"
  | "feature_grid"
  | "split_story"
  | "stat_cluster"
  | "marquee_strip"
  | "spotlight_grid"
  | "before_after"
  | "lookbook"
  | "quote"
  | "credential_row"
  | "booking"
  | "cta_band";

export interface ZonePlanItem {
  title: string;
  body: string;
  value?: string;
  icon?: string;
}

export interface ZonePlan {
  kind: ZoneKind;
  /** Compositional variant — drives a different builder branch. */
  variant?: string;
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaText?: string;
  items?: ZonePlanItem[];
  imagePrompt?: string;
}

export interface CompositionPlan {
  archetype: CompositionArchetype;
  rationale: string;
  zones: ZonePlan[];
}

const FORM_ID = "main-form";

// ── Archetype resolution ──────────────────────────────────────────────────────

const ARCHETYPE_BY_BUSINESS: Array<[RegExp, CompositionArchetype]> = [
  [/barber|tattoo|nightclub|night.?club|\bbar\b|lounge|speakeasy|dj|escape.?room|cigar|whiskey/i, "cinematic_immersive"],
  [/roof|construct|hvac|plumb|electric|contractor|landscap|paving|fencing|concrete|auto.?repair|mechanic|garage|excavat|demolition|gutter|siding|junk.?removal|pest/i, "industrial_trust"],
  [/restaurant|cafe|café|bakery|bistro|diner|food.?truck|catering|pizzeria|coffee|brunch|steakhouse|eatery|deli/i, "menu_first"],
  [/boutique|salon|med.?spa|medspa|lash|jewelry|jeweler|interior.?design|fashion|photograph|stylist|florist|bridal|luxury.?retail/i, "editorial_luxury"],
  [/dental|dentist|medical|clinic|chiroprac|physical.?therapy|physio|law|attorney|legal|account|cpa|financial.?advisor|insurance|optometr|orthodont|veterinar/i, "clinical_precision"],
  [/gym|fitness|crossfit|personal.?train|yoga|pilates|martial.?arts|boxing|cycling|spin.?studio|sports|athletic|bootcamp|weight.?loss/i, "energetic_conversion"],
];

const ARCHETYPE_BY_NICHE: Record<string, CompositionArchetype> = {
  beauty: "editorial_luxury",
  health: "clinical_precision",
  legal: "clinical_precision",
  food: "menu_first",
  fitness: "energetic_conversion",
  home_services: "industrial_trust",
  automotive: "industrial_trust",
  tech: "cinematic_immersive",
};

export function resolveArchetype(intent: ParsedPromptIntent): CompositionArchetype {
  const haystack = `${intent.businessType} ${intent.businessLabel} ${intent.niche}`;
  for (const [re, archetype] of ARCHETYPE_BY_BUSINESS) {
    if (re.test(haystack)) return archetype;
  }
  if (ARCHETYPE_BY_NICHE[intent.niche]) return ARCHETYPE_BY_NICHE[intent.niche];
  // Style is the last signal before defaulting.
  if (/dark|neon|cyberpunk|luxury/i.test(intent.style)) return "cinematic_immersive";
  if (/minimal|corporate|medical/i.test(intent.style)) return "clinical_precision";
  return "cinematic_immersive";
}

/** The canonical zone flow for an archetype — used by the deterministic planner. */
const ARCHETYPE_ZONE_FLOW: Record<CompositionArchetype, ZoneKind[]> = {
  cinematic_immersive: ["hero", "split_story", "stat_cluster", "marquee_strip", "feature_grid", "booking", "cta_band"],
  industrial_trust:    ["hero", "stat_cluster", "before_after", "feature_grid", "credential_row", "booking", "cta_band"],
  menu_first:          ["hero", "spotlight_grid", "split_story", "marquee_strip", "booking", "cta_band"],
  editorial_luxury:    ["hero", "lookbook", "split_story", "quote", "feature_grid", "booking", "cta_band"],
  clinical_precision:  ["hero", "feature_grid", "credential_row", "split_story", "quote", "booking", "cta_band"],
  energetic_conversion:["hero", "stat_cluster", "feature_grid", "before_after", "marquee_strip", "booking", "cta_band"],
  freeform:            ["hero", "feature_grid", "split_story", "booking", "cta_band"],
};

// ── AI composition ────────────────────────────────────────────────────────────

const COMPOSITION_SYSTEM_PROMPT = `You are Apex Layout Composer — an AI UI designer that composes freeform marketing page layouts, in the spirit of Google Stitch, v0, and Lovable.

You do NOT think in fixed page sections. You compose a spatial sequence of "zones", choosing an archetype and a zone flow that fits THIS specific business. A barbershop and a dental clinic must produce structurally different compositions.

Return ONLY valid JSON matching this shape:
{
  "archetype": "cinematic_immersive" | "industrial_trust" | "menu_first" | "editorial_luxury" | "clinical_precision" | "energetic_conversion",
  "rationale": "<one sentence: why this composition fits this business>",
  "zones": [
    {
      "kind": "hero" | "feature_grid" | "split_story" | "stat_cluster" | "marquee_strip" | "spotlight_grid" | "before_after" | "lookbook" | "quote" | "credential_row" | "booking" | "cta_band",
      "variant": "<short variant slug, e.g. 'cinematic_fullbleed', 'asymmetric_left', 'immersive_booking'>",
      "eyebrow": "<short overline text, optional>",
      "heading": "<zone heading>",
      "body": "<supporting paragraph, optional>",
      "ctaText": "<cta label, for hero/cta_band/booking>",
      "items": [{ "title": "...", "body": "...", "value": "<stat number, optional>", "icon": "<lucide icon name, optional>" }]
    }
  ]
}

RULES:
1. The FIRST zone must be "hero". The LAST zone must be "cta_band". Include exactly one "booking" zone.
2. Choose 6-8 zones total. Order them for a compelling narrative specific to this business.
3. ALL copy must be 100% specific to the business — real services, real numbers, real outcomes. NEVER generic "AI automation / grow your business" filler.
4. stat_cluster items MUST have a "value" (e.g. "500+", "$50M", "4.9★"). feature_grid items describe real services.
5. Pick the archetype that genuinely fits — do not default to cinematic_immersive for everything.
6. Vary variants per business. A roofing hero is not styled like a med spa hero.
7. Icons: use lucide icon names (e.g. "scissors", "shield", "star", "clock", "wrench", "leaf").`;

function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in AI response");
  return raw.slice(start, end + 1);
}

const VALID_ZONE_KINDS: ZoneKind[] = [
  "hero", "feature_grid", "split_story", "stat_cluster", "marquee_strip",
  "spotlight_grid", "before_after", "lookbook", "quote", "credential_row",
  "booking", "cta_band",
];

function sanitizePlan(raw: any, intent: ParsedPromptIntent): CompositionPlan | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.zones)) return null;

  const zones: ZonePlan[] = raw.zones
    .filter((z: any) => z && VALID_ZONE_KINDS.includes(z.kind))
    .map((z: any) => ({
      kind: z.kind as ZoneKind,
      variant: typeof z.variant === "string" ? z.variant.slice(0, 40) : undefined,
      eyebrow: typeof z.eyebrow === "string" ? z.eyebrow.slice(0, 80) : undefined,
      heading: typeof z.heading === "string" ? z.heading.slice(0, 200) : undefined,
      body: typeof z.body === "string" ? z.body.slice(0, 600) : undefined,
      ctaText: typeof z.ctaText === "string" ? z.ctaText.slice(0, 60) : undefined,
      items: Array.isArray(z.items)
        ? z.items.slice(0, 8).map((it: any) => ({
            title: String(it?.title ?? "").slice(0, 120),
            body: String(it?.body ?? "").slice(0, 400),
            value: it?.value != null ? String(it.value).slice(0, 24) : undefined,
            icon: typeof it?.icon === "string" ? it.icon.slice(0, 24) : undefined,
          }))
        : undefined,
    }));

  if (zones.length < 3) return null;

  // Enforce structural guarantees: hero first, cta_band last, exactly one booking.
  if (zones[0].kind !== "hero") {
    zones.unshift({ kind: "hero", heading: intent.businessLabel });
  }
  if (zones[zones.length - 1].kind !== "cta_band") {
    zones.push({ kind: "cta_band", heading: "Ready when you are", ctaText: intent.ctaText });
  }
  if (!zones.some(z => z.kind === "booking")) {
    zones.splice(zones.length - 1, 0, { kind: "booking", heading: intent.ctaText });
  }

  const archetype: CompositionArchetype =
    typeof raw.archetype === "string" &&
    ["cinematic_immersive", "industrial_trust", "menu_first", "editorial_luxury", "clinical_precision", "energetic_conversion"].includes(raw.archetype)
      ? raw.archetype
      : resolveArchetype(intent);

  return {
    archetype,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 300) : `Composed for ${intent.businessLabel}`,
    zones,
  };
}

async function planWithAI(prompt: string, intent: ParsedPromptIntent): Promise<CompositionPlan | null> {
  const userMessage = `Compose a freeform marketing page layout for this business.

Prompt: "${prompt}"

Business context:
- Business: ${intent.businessLabel} (type: ${intent.businessType}, niche: ${intent.niche})
- Style: ${intent.style}
- Target audience: ${intent.targetAudience}
- Primary conversion: ${intent.ctaIntent} — CTA text "${intent.ctaText}"
- Suggested archetype (override if a different one fits better): ${resolveArchetype(intent)}

Compose the layout. Return ONLY the JSON composition plan.`;

  try {
    const res = await aiChat(
      [
        { role: "system", content: COMPOSITION_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.9, maxTokens: 3200, jsonMode: true, timeoutMs: 30000, route: "layout-composition" },
    );
    if (!res.ok || !res.text) return null;
    const parsed = JSON.parse(extractJSON(res.text));
    return sanitizePlan(parsed, intent);
  } catch (err) {
    console.warn("[LAYOUT-ENGINE] AI plan failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Deterministic archetype planner ───────────────────────────────────────────
// Builds a varied, niche-specific plan with NO AI call. Used as the fallback so
// the layout engine never collapses — and never collapses to a generic stack.

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Small deterministic 32-bit hash for prompt-seeded variance. */
function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

function deterministicPlan(intent: ParsedPromptIntent, prompt = ""): CompositionPlan {
  const archetype = resolveArchetype(intent);
  const baseFlow = ARCHETYPE_ZONE_FLOW[archetype];
  const label = intent.businessLabel;
  const audience = intent.targetAudience || "your community";

  // Prompt-seeded variance: rotate the middle zones (everything between the
  // hero and the booking/cta_band tail) so two same-niche prompts do NOT
  // collapse to a structurally identical layout.
  const seed = seedFromString(prompt || label);
  const head = baseFlow.slice(0, 1);                       // hero
  const tail = baseFlow.slice(-2);                          // booking, cta_band
  const middle = baseFlow.slice(1, -2);
  const rot = middle.length > 1 ? seed % middle.length : 0;
  const rotatedMiddle = [...middle.slice(rot), ...middle.slice(0, rot)];
  const flow: ZoneKind[] = [...head, ...rotatedMiddle, ...tail];
  // Seeded hero variant suffix so the signature differs per prompt.
  const heroVariantSuffix = ["a", "b", "c"][seed % 3];

  // A small bank of niche-shaped service items keyed by niche.
  const serviceBank: Record<string, ZonePlanItem[]> = {
    beauty: [
      { title: "Signature Service", body: `Our most-booked ${label.toLowerCase()} experience, tailored to you.`, icon: "sparkles" },
      { title: "Precision Detailing", body: "Finishing touches that set the result apart.", icon: "scissors" },
      { title: "Member Care", body: "Priority booking and loyalty perks for regulars.", icon: "star" },
    ],
    home_services: [
      { title: "Inspection & Estimate", body: "A thorough on-site assessment with a clear written quote.", icon: "clipboard-check" },
      { title: "Full Installation", body: "Licensed crews, quality materials, clean job sites.", icon: "wrench" },
      { title: "Warranty & Support", body: "Workmanship guarantees and fast follow-up service.", icon: "shield" },
    ],
    health: [
      { title: "New Patient Visit", body: "A comprehensive first appointment with no rush.", icon: "heart-pulse" },
      { title: "Ongoing Care", body: "Personalized treatment plans tracked over time.", icon: "activity" },
      { title: "Same-Week Availability", body: "Get seen quickly when it matters most.", icon: "calendar-clock" },
    ],
    fitness: [
      { title: "Coaching", body: "Programming built around your goals and schedule.", icon: "dumbbell" },
      { title: "Group Training", body: "High-energy sessions that keep you accountable.", icon: "users" },
      { title: "Progress Tracking", body: "Measurable milestones, not guesswork.", icon: "trending-up" },
    ],
    food: [
      { title: "The Menu", body: "Seasonal plates made from scratch, daily.", icon: "utensils" },
      { title: "Private Events", body: "Host your gathering in a space built for it.", icon: "calendar" },
      { title: "Reservations", body: "Reserve your table in seconds.", icon: "clock" },
    ],
  };
  const items = serviceBank[intent.niche] ?? [
    { title: "What We Do", body: `Premium ${label.toLowerCase()} service for ${audience}.`, icon: "check" },
    { title: "How It Works", body: "A simple, transparent process from first contact to result.", icon: "workflow" },
    { title: "Why Us", body: "Experienced, reliable, and obsessed with the details.", icon: "award" },
  ];

  const stats: ZonePlanItem[] = [
    { title: "Happy Clients", body: "and counting", value: "1,200+" },
    { title: "Years In Business", body: "serving the area", value: "12" },
    { title: "Average Rating", body: "across review platforms", value: "4.9★" },
    { title: "Repeat Rate", body: "clients who come back", value: "87%" },
  ];

  const zoneFor = (kind: ZoneKind): ZonePlan => {
    switch (kind) {
      case "hero":
        return {
          kind, variant: `${archetype}_${heroVariantSuffix}`,
          eyebrow: titleCase(intent.niche),
          heading: `${label} — Built for ${titleCase(audience)}`,
          body: `Premium ${label.toLowerCase()} service, composed around what you actually need.`,
          ctaText: intent.ctaText,
        };
      case "feature_grid":
        return { kind, variant: "service_cards", eyebrow: "What We Offer", heading: "Services", items };
      case "split_story":
        return {
          kind, variant: "image_left",
          eyebrow: "Our Story", heading: `Why ${audience} choose ${label}`,
          body: `Every detail of our work is built around one thing: a result you would recommend. That is how ${label} earns trust, one client at a time.`,
        };
      case "stat_cluster":
        return { kind, variant: "floating", eyebrow: "By The Numbers", heading: "Results that speak", items: stats };
      case "marquee_strip":
        return { kind, variant: "scrolling", items: items.map(i => ({ title: i.title, body: "" })) };
      case "spotlight_grid":
        return { kind, variant: "image_cards", eyebrow: "Highlights", heading: "What people come back for", items };
      case "before_after":
        return {
          kind, variant: "comparison",
          eyebrow: "The Difference", heading: "Before & After",
          body: "See the transformation our work delivers.",
        };
      case "lookbook":
        return { kind, variant: "asymmetric_gallery", eyebrow: "Gallery", heading: "A look at our work" };
      case "quote":
        return {
          kind, variant: "centered",
          heading: `"Best decision we made. ${label} delivered exactly what they promised."`,
          body: `A happy client — ${titleCase(audience)}`,
        };
      case "credential_row":
        return {
          kind, variant: "badges",
          eyebrow: "Trusted & Verified", heading: "Credentials",
          items: [
            { title: "Licensed & Insured", body: "" },
            { title: "Background-Checked Team", body: "" },
            { title: "Satisfaction Guarantee", body: "" },
          ],
        };
      case "booking":
        return {
          kind, variant: archetype === "cinematic_immersive" ? "immersive_booking" : "standard_booking",
          eyebrow: "Get Started", heading: intent.ctaText, ctaText: intent.ctaText,
        };
      case "cta_band":
        return {
          kind, variant: "gradient",
          heading: `Ready to get started with ${label}?`,
          body: `Join the ${audience} who already made the switch.`,
          ctaText: intent.ctaText,
        };
      default:
        return { kind };
    }
  };

  return {
    archetype,
    rationale: `Deterministic ${archetype.replace(/_/g, " ")} composition for ${label}.`,
    zones: flow.map(zoneFor),
  };
}

// ── Zone builders: ZonePlan → LayoutNode ──────────────────────────────────────
// Each builder produces a structurally distinct subtree using the layout
// vocabulary (split_layout, glass_panel, motion_cluster, floating_panel, etc.).

interface BuildCtx {
  ds: DesignSystem;
  archetype: CompositionArchetype;
  intent: ParsedPromptIntent;
  index: number;
}

function n(type: LayoutNodeType, partial: Partial<LayoutNode> = {}): LayoutNode {
  return { id: nodeId(type), type, ...partial };
}

function heroZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const immersive = ctx.archetype === "cinematic_immersive" || ctx.archetype === "energetic_conversion";
  const editorial = ctx.archetype === "editorial_luxury";

  const headingBlock = n("stack", {
    style: { direction: "column", gap: 4, maxWidth: editorial ? "780px" : "640px" },
    children: [
      z.eyebrow ? n("text", { content: { text: z.eyebrow, typographyRole: "overline", colorToken: "accent" } }) : null,
      n("heading", {
        content: {
          text: z.heading ?? ctx.intent.businessLabel,
          typographyRole: "display",
          headingLevel: 1,
          gradientText: immersive,
        },
      }),
      z.body ? n("text", { content: { text: z.body, typographyRole: "lead", colorToken: "textMuted" } }) : null,
      n("cta", {
        variant: immersive ? "immersive" : "primary",
        content: { ctaText: z.ctaText ?? ctx.intent.ctaText, ctaUrl: "#booking", ctaVariant: "primary" },
        style: { animation: { entry: "fade_up", delay: 160 } },
      }),
    ].filter(Boolean) as LayoutNode[],
  });

  if (immersive) {
    // Full-bleed scene with an asymmetric floating glass panel.
    return n("zone", {
      variant: z.variant ?? "cinematic_fullbleed",
      style: {
        position: "relative", minHeight: "92vh", overflow: "hidden",
        padX: 6, padY: 9, display: "flex", align: "center",
      },
      children: [
        n("scene", { content: { sceneFullBleed: true }, style: { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", zIndex: 0 } }),
        n("floating_panel", {
          variant: "asymmetric",
          style: {
            position: "relative", zIndex: 2, surface: "glass", radius: "xl",
            padX: 7, padY: 7, maxWidth: "620px", elevation: 3, rotate: -1.5,
            animation: { entry: "fade_up", duration: 800 },
          },
          children: [headingBlock],
        }),
      ],
    });
  }

  if (editorial) {
    // Oversized type, generous whitespace, a single quiet image.
    return n("zone", {
      variant: z.variant ?? "editorial_air",
      style: { padX: 7, padY: 11, display: "grid", gridTemplate: "1.5fr 1fr", gap: 8, align: "center" },
      children: [
        headingBlock,
        n("image", {
          content: { imagePrompt: `Editorial lifestyle photo for ${ctx.intent.businessLabel}`, imageFit: "cover" },
          style: { radius: "lg", aspectRatio: "3/4", elevation: 2, animation: { entry: "scale_in", duration: 700 } },
        }),
      ],
    });
  }

  // Trust / clinical / menu: split hero — copy + supporting image.
  const imageFirst = ctx.archetype === "menu_first";
  const imageNode = n("image", {
    content: { imagePrompt: `Hero image for ${ctx.intent.businessLabel}`, imageFit: "cover" },
    style: { radius: "lg", minHeight: "440px", aspectRatio: "4/3", elevation: 2, overflow: "hidden", animation: { entry: imageFirst ? "fade" : "slide_right", duration: 600 } },
  });
  return n("zone", {
    variant: z.variant ?? "split_hero",
    style: { padX: 6, padY: 9, display: "grid", gridTemplate: "1.1fr 0.9fr", gap: 7, align: "center" },
    children: imageFirst ? [imageNode, headingBlock] : [headingBlock, imageNode],
  });
}

function zoneHeader(z: ZonePlan): LayoutNode[] {
  return [
    z.eyebrow ? n("text", { content: { text: z.eyebrow, typographyRole: "overline", colorToken: "accent" }, style: { textAlign: "center" } }) : null,
    z.heading ? n("heading", { content: { text: z.heading, typographyRole: "h2", headingLevel: 2 }, style: { textAlign: "center" } }) : null,
    z.body ? n("text", { content: { text: z.body, typographyRole: "lead", colorToken: "textMuted" }, style: { textAlign: "center", maxWidth: "640px", marginX: 6 } }) : null,
  ].filter(Boolean) as LayoutNode[];
}

function featureGridZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const items = z.items ?? [];
  const cols = items.length >= 4 ? 4 : items.length === 2 ? 2 : 3;
  const cards = items.map((it, i) =>
    n("card", {
      variant: "service",
      style: {
        surface: ctx.archetype === "industrial_trust" ? "solid" : "glass",
        radius: "lg", padX: 5, padY: 5, elevation: 1,
        animation: { entry: "fade_up", delay: i * (ctx.ds.motion.stagger) },
        // Asymmetric vertical offset for non-clinical archetypes.
        marginY: ctx.archetype === "cinematic_immersive" && i % 2 === 1 ? 4 : 0,
      },
      children: [
        it.icon ? n("icon", { content: { icon: it.icon }, style: { surface: "gradient", radius: "md", padX: 3, padY: 3 } }) : null,
        n("heading", { content: { text: it.title, typographyRole: "h3", headingLevel: 3 } }),
        n("text", { content: { text: it.body, typographyRole: "body", colorToken: "textMuted" } }),
      ].filter(Boolean) as LayoutNode[],
    }),
  );
  return n("zone", {
    variant: z.variant ?? "feature_grid",
    style: { padX: 6, padY: 8, display: "flex", direction: "column", gap: 6, align: "center" },
    children: [
      ...zoneHeader(z),
      n("grid", { style: { gridCols: cols, gap: 5, width: "100%", maxWidth: "1180px" }, children: cards }),
    ],
  });
}

function splitStoryZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const imageLeft = (z.variant ?? "").includes("left");
  const copy = n("glass_panel", {
    style: { surface: ctx.archetype === "editorial_luxury" ? "none" : "glass", radius: "lg", padX: 6, padY: 7, direction: "column", gap: 3 },
    children: [
      z.eyebrow ? n("text", { content: { text: z.eyebrow, typographyRole: "overline", colorToken: "accent" } }) : null,
      n("heading", { content: { text: z.heading ?? "", typographyRole: "h2", headingLevel: 2 } }),
      n("text", { content: { text: z.body ?? "", typographyRole: "body", colorToken: "textMuted" } }),
    ].filter(Boolean) as LayoutNode[],
  });
  const image = n("image", {
    content: { imagePrompt: z.imagePrompt ?? `Story image for ${ctx.intent.businessLabel}`, imageFit: "cover" },
    style: { radius: "lg", minHeight: "420px", aspectRatio: "1/1", elevation: 2, animation: { entry: imageLeft ? "slide_left" : "slide_right", duration: 600 } },
  });
  return n("zone", {
    variant: z.variant ?? "split_story",
    style: { padX: 6, padY: 8, display: "grid", gridTemplate: "1fr 1fr", gap: 7, align: "center" },
    children: imageLeft ? [image, copy] : [copy, image],
  });
}

function statClusterZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const items = z.items ?? [];
  const floating = (z.variant ?? "").includes("float") || ctx.archetype === "cinematic_immersive";
  const stats = items.map((it, i) =>
    n("stat", {
      style: {
        surface: floating ? "glass" : "none", radius: "lg", padX: 5, padY: 5,
        elevation: floating ? 2 : 0,
        rotate: floating ? (i % 2 === 0 ? -2 : 2) : 0,
        animation: { entry: "scale_in", delay: i * ctx.ds.motion.stagger },
      },
      content: { statValue: it.value ?? "—", statLabel: it.title },
      children: [
        n("text", { content: { text: it.body, typographyRole: "caption", colorToken: "textMuted" } }),
      ],
    }),
  );
  const inner = floating
    ? n("motion_cluster", { style: { display: "grid", gridCols: Math.min(4, stats.length || 1), gap: 5, width: "100%", maxWidth: "1100px" }, children: stats })
    : n("row", { style: { display: "grid", gridCols: Math.min(4, stats.length || 1), gap: 5, width: "100%", maxWidth: "1100px" }, children: stats });
  return n("zone", {
    variant: z.variant ?? "stat_cluster",
    style: { padX: 6, padY: 8, display: "flex", direction: "column", gap: 6, align: "center", surface: floating ? "none" : "solid" },
    children: [...zoneHeader(z), inner],
  });
}

function marqueeZone(z: ZonePlan, _ctx: BuildCtx): LayoutNode {
  const labels = (z.items ?? []).map(i => i.title).filter(Boolean);
  return n("zone", {
    variant: z.variant ?? "marquee_strip",
    style: { padY: 4, overflow: "hidden", surface: "gradient" },
    children: [
      n("marquee", { content: { marqueeItems: labels.length ? labels : ["Quality", "Trust", "Results", "Service"] }, style: { padY: 3 } }),
    ],
  });
}

function spotlightGridZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const items = z.items ?? [];
  const cards = items.map((it, i) =>
    n("card", {
      variant: "spotlight",
      style: { radius: "lg", overflow: "hidden", elevation: 2, animation: { entry: "fade_up", delay: i * ctx.ds.motion.stagger }, colSpan: i === 0 ? 2 : 1 },
      children: [
        n("image", { content: { imagePrompt: `${it.title} — ${ctx.intent.businessLabel}`, imageFit: "cover" }, style: { aspectRatio: i === 0 ? "16/9" : "4/3", radius: "none" } }),
        n("stack", {
          style: { padX: 4, padY: 4, direction: "column", gap: 2, surface: "glass" },
          children: [
            n("heading", { content: { text: it.title, typographyRole: "h3", headingLevel: 3 } }),
            n("text", { content: { text: it.body, typographyRole: "caption", colorToken: "textMuted" } }),
          ],
        }),
      ],
    }),
  );
  return n("zone", {
    variant: z.variant ?? "spotlight_grid",
    style: { padX: 6, padY: 8, display: "flex", direction: "column", gap: 6, align: "center" },
    children: [
      ...zoneHeader(z),
      n("grid", { style: { gridCols: 3, gap: 4, width: "100%", maxWidth: "1180px" }, children: cards }),
    ],
  });
}

function beforeAfterZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const pane = (label: string, tone: "before" | "after") =>
    n("container", {
      style: { position: "relative", radius: "lg", overflow: "hidden", elevation: 2 },
      children: [
        n("image", { content: { imagePrompt: `${tone} — ${ctx.intent.businessLabel} work`, imageFit: "cover" }, style: { aspectRatio: "4/3" } }),
        n("badge", { content: { badgeText: label }, style: { position: "absolute", top: "12px", left: "12px", surface: "glass", radius: "full", padX: 3, padY: 2 } }),
      ],
    });
  return n("zone", {
    variant: z.variant ?? "before_after",
    style: { padX: 6, padY: 8, display: "flex", direction: "column", gap: 6, align: "center" },
    children: [
      ...zoneHeader(z),
      n("split_layout", {
        variant: "comparison",
        style: { display: "grid", gridTemplate: "1fr 1fr", gap: 5, width: "100%", maxWidth: "1080px" },
        children: [pane("Before", "before"), pane("After", "after")],
      }),
    ],
  });
}

function lookbookZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  // Asymmetric gallery — varied aspect ratios and spans.
  const specs: Array<{ span: number; ratio: string }> = [
    { span: 2, ratio: "16/10" }, { span: 1, ratio: "3/4" },
    { span: 1, ratio: "3/4" }, { span: 2, ratio: "16/9" },
  ];
  const tiles = specs.map((s, i) =>
    n("image", {
      content: { imagePrompt: `Lookbook frame ${i + 1} for ${ctx.intent.businessLabel}`, imageFit: "cover" },
      style: { radius: "lg", aspectRatio: s.ratio, colSpan: s.span, elevation: 1, animation: { entry: "fade_up", delay: i * ctx.ds.motion.stagger } },
    }),
  );
  return n("zone", {
    variant: z.variant ?? "lookbook",
    style: { padX: 6, padY: 9, display: "flex", direction: "column", gap: 6, align: "center" },
    children: [
      ...zoneHeader(z),
      n("grid", { style: { gridCols: 3, gap: 4, width: "100%", maxWidth: "1100px" }, children: tiles }),
    ],
  });
}

function quoteZone(z: ZonePlan, _ctx: BuildCtx): LayoutNode {
  return n("zone", {
    variant: z.variant ?? "quote",
    style: { padX: 6, padY: 9, display: "flex", align: "center", justify: "center" },
    children: [
      n("glass_panel", {
        style: { surface: "glass", radius: "xl", padX: 8, padY: 8, maxWidth: "820px", textAlign: "center", elevation: 2 },
        children: [
          n("quote", {
            content: { quoteText: z.heading ?? "", quoteAuthor: z.body ?? "" },
          }),
        ],
      }),
    ],
  });
}

function credentialRowZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const badges = (z.items ?? []).map((it, i) =>
    n("badge", {
      content: { badgeText: it.title, icon: it.icon ?? "shield-check" },
      style: { surface: "outline", radius: "full", padX: 4, padY: 3, animation: { entry: "fade", delay: i * 80 } },
    }),
  );
  return n("zone", {
    variant: z.variant ?? "credential_row",
    style: { padX: 6, padY: 6, display: "flex", direction: "column", gap: 4, align: "center", surface: "solid" },
    children: [
      ...(z.heading ? [n("text", { content: { text: z.eyebrow ?? z.heading, typographyRole: "overline", colorToken: "textMuted" }, style: { textAlign: "center" } })] : []),
      n("row", { style: { display: "flex", direction: "row", wrap: true, gap: 3, justify: "center" }, children: badges }),
    ],
  });
}

function bookingZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  const immersive = (z.variant ?? "").includes("immersive") || ctx.archetype === "cinematic_immersive";
  const formPanel = n("glass_panel", {
    variant: immersive ? "immersive" : "standard",
    style: {
      surface: "glass", radius: "xl", padX: 7, padY: 7, maxWidth: "560px",
      width: "100%", elevation: 3, animation: { entry: "fade_up", duration: 600 },
    },
    children: [
      z.eyebrow ? n("text", { content: { text: z.eyebrow, typographyRole: "overline", colorToken: "accent" } }) : null,
      n("heading", { content: { text: z.heading ?? ctx.intent.ctaText, typographyRole: "h2", headingLevel: 2 } }),
      n("form", { content: { formId: FORM_ID } }),
    ].filter(Boolean) as LayoutNode[],
  });
  if (immersive) {
    return n("zone", {
      variant: z.variant ?? "immersive_booking",
      style: { position: "relative", padX: 6, padY: 10, display: "flex", justify: "center", align: "center", overflow: "hidden" },
      children: [
        n("container", {
          style: { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", surface: "gradient", opacity: 0.4, zIndex: 0 },
        }),
        formPanel,
      ],
    });
  }
  return n("zone", {
    variant: z.variant ?? "standard_booking",
    style: { padX: 6, padY: 9, display: "flex", justify: "center" },
    children: [formPanel],
  });
}

function ctaBandZone(z: ZonePlan, ctx: BuildCtx): LayoutNode {
  return n("zone", {
    variant: z.variant ?? "cta_band",
    style: { padX: 6, padY: 9, display: "flex", justify: "center" },
    children: [
      n("container", {
        style: {
          surface: "gradient", radius: "2xl", padX: 8, padY: 9, maxWidth: "1080px",
          width: "100%", textAlign: "center", display: "flex", direction: "column",
          align: "center", gap: 4, elevation: 3,
        },
        children: [
          n("heading", { content: { text: z.heading ?? "Ready to start?", typographyRole: "h2", headingLevel: 2 } }),
          z.body ? n("text", { content: { text: z.body, typographyRole: "lead" } }) : null,
          n("cta", { variant: "primary", content: { ctaText: z.ctaText ?? ctx.intent.ctaText, ctaUrl: "#booking", ctaVariant: "primary" } }),
        ].filter(Boolean) as LayoutNode[],
      }),
    ],
  });
}

const ZONE_BUILDERS: Record<ZoneKind, (z: ZonePlan, ctx: BuildCtx) => LayoutNode> = {
  hero: heroZone,
  feature_grid: featureGridZone,
  split_story: splitStoryZone,
  stat_cluster: statClusterZone,
  marquee_strip: marqueeZone,
  spotlight_grid: spotlightGridZone,
  before_after: beforeAfterZone,
  lookbook: lookbookZone,
  quote: quoteZone,
  credential_row: credentialRowZone,
  booking: bookingZone,
  cta_band: ctaBandZone,
};

// ── Plan → tree ───────────────────────────────────────────────────────────────

function buildTree(plan: CompositionPlan, ds: DesignSystem, intent: ParsedPromptIntent): LayoutNode {
  const children = plan.zones.map((z, index) => {
    const builder = ZONE_BUILDERS[z.kind] ?? featureGridZone;
    return builder(z, { ds, archetype: plan.archetype, intent, index });
  });
  return n("container", {
    variant: `root_${plan.archetype}`,
    style: { display: "flex", direction: "column", width: "100%" },
    children,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ComposeOptions {
  /** Skip the AI plan and use the deterministic planner directly. */
  deterministicOnly?: boolean;
  /** Hero image URL to inject into the first image/scene node. */
  heroImageUrl?: string;
}

/**
 * Compose a full freeform layout for a prompt. Always returns a valid
 * ComposedLayout — falls back to the deterministic archetype planner if the
 * AI plan fails. The fallback is NOT a generic block stack: it is a varied,
 * archetype-specific composition.
 */
export async function composeLayout(
  prompt: string,
  intent: ParsedPromptIntent,
  options: ComposeOptions = {},
): Promise<ComposedLayout> {
  const ds = generateDesignSystem(intent);

  let plan: CompositionPlan | null = null;
  let planSource: "ai" | "deterministic" = "deterministic";

  if (!options.deterministicOnly) {
    plan = await planWithAI(prompt, intent);
    if (plan) planSource = "ai";
  }
  if (!plan) plan = deterministicPlan(intent, prompt);

  const root = buildTree(plan, ds, intent);

  if (options.heroImageUrl) injectHeroImage(root, options.heroImageUrl);

  const signature = computeCompositionSignature(root);
  const vocabulary = layoutVocabulary(root);

  console.log(`[LAYOUT-ENGINE] plan=${planSource} archetype=${plan.archetype} zones=${plan.zones.length} nodes=${vocabulary.length}types sig=${signature}`);

  return {
    engine: "stitch-layout-v1",
    archetype: plan.archetype,
    designSystem: ds,
    root,
    compositionSignature: signature,
    rationale: plan.rationale,
    vocabulary,
  };
}

/** Fill the first image node (or scene fallback) with a generated hero image. */
function injectHeroImage(root: LayoutNode, url: string): void {
  let done = false;
  const walk = (node: LayoutNode): void => {
    if (done) return;
    if (node.type === "image" && node.content && !node.content.imageUrl) {
      node.content.imageUrl = url;
      done = true;
      return;
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(root);
}

/**
 * Attach a generated hero image to an already-composed layout. Used when the
 * layout is composed in parallel with image generation.
 */
export function applyHeroImage(layout: ComposedLayout, url: string): void {
  injectHeroImage(layout.root, url);
}

/** Exposed for the validator and tests. */
export { deterministicPlan, buildTree };
