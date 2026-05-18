/**
 * server/services/compositionValidator.ts
 *
 * Composition validation for the Stitch-style layout engine.
 *
 * Generation FAILS validation when:
 *   1. The output collapses to a generic, block-stack-like shape.
 *   2. The layout tree is too shallow / too small to be a real composition.
 *   3. The composition is structurally identical to a recently generated page.
 *   4. The composition lacks visual variance (too few distinct primitives).
 *   5. The prompt-specific business identity is not reflected in the copy.
 *
 * A failing layout is not silently shipped — the caller regenerates (with the
 * deterministic planner) or surfaces the issue.
 */

import type {
  ComposedLayout,
  LayoutNode,
  LayoutNodeType,
} from "../../client/src/lib/dynamic-pages/layoutTree";
import {
  countNodes,
  layoutDepth,
  layoutVocabulary,
  walkLayout,
} from "../../client/src/lib/dynamic-pages/layoutTree";
import type { ParsedPromptIntent } from "./visualPromptParser";

export interface CompositionIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface CompositionReport {
  passed: boolean;
  score: number;          // 0–100
  archetype: string;
  signature: string;
  issues: CompositionIssue[];
}

// ── Recently-seen signatures ──────────────────────────────────────────────────
// In-memory ring buffer. Catches "every page looks structurally identical"
// across consecutive generations within a process.

const RECENT_SIGNATURES: string[] = [];
const RECENT_LIMIT = 24;

export function registerComposition(signature: string): void {
  RECENT_SIGNATURES.push(signature);
  if (RECENT_SIGNATURES.length > RECENT_LIMIT) RECENT_SIGNATURES.shift();
}

export function clearCompositionHistory(): void {
  RECENT_SIGNATURES.length = 0;
}

// ── Heuristics ────────────────────────────────────────────────────────────────

/** Primitives that signal genuine spatial composition (not block-filling). */
const COMPOSITIONAL_PRIMITIVES: LayoutNodeType[] = [
  "split_layout", "glass_panel", "motion_cluster", "floating_panel",
  "grid", "marquee", "scene", "stat",
];

/** The "generic" vocabulary — a tree using ONLY these is a flat block stack. */
const GENERIC_VOCABULARY = new Set<LayoutNodeType>([
  "container", "zone", "stack", "text", "heading", "cta",
]);

function collectText(root: LayoutNode): string {
  const parts: string[] = [];
  walkLayout(root, (n) => {
    const c = n.content;
    if (!c) return;
    for (const v of [c.text, c.title, c.body, c.eyebrow, c.quoteText, c.statLabel, c.ctaText, c.badgeText]) {
      if (typeof v === "string" && v.trim()) parts.push(v.toLowerCase());
    }
  });
  return parts.join(" ");
}

const GENERIC_COPY_MARKERS = [
  "automate. convert. grow", "ai-powered solutions", "grow your business with ai",
  "set it and forget it", "cutting-edge technology and proven strategies",
  "your business, elevated", "lorem ipsum",
];

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidateOptions {
  /** When true, a signature collision is a warning, not an error (first run). */
  allowDuplicateSignature?: boolean;
}

export function validateComposition(
  layout: ComposedLayout,
  intent: ParsedPromptIntent,
  options: ValidateOptions = {},
): CompositionReport {
  const issues: CompositionIssue[] = [];
  const root = layout.root;

  const total = countNodes(root);
  const depth = layoutDepth(root);
  const vocab = layoutVocabulary(root);
  const vocabSet = new Set(vocab);

  // ── 1. Size / depth — too small to be a real composition ──────────────────
  if (total < 14) {
    issues.push({
      severity: "error", code: "TREE_TOO_SMALL",
      message: `Layout tree has only ${total} nodes — too sparse to be a real composition (min 14).`,
    });
  }
  if (depth < 3) {
    issues.push({
      severity: "error", code: "TREE_TOO_SHALLOW",
      message: `Layout nesting depth is ${depth} — a real composition needs nested structure (min 3).`,
    });
  }

  // ── 2. Generic block-stack shape ──────────────────────────────────────────
  const nonGeneric = vocab.filter(t => !GENERIC_VOCABULARY.has(t));
  if (nonGeneric.length === 0) {
    issues.push({
      severity: "error", code: "GENERIC_BLOCK_STACK",
      message: "Composition uses only generic containers/text/headings — this is a block stack, not a freeform layout.",
    });
  }

  // ── 3. Compositional variance — must use real layout primitives ───────────
  const primitivesUsed = COMPOSITIONAL_PRIMITIVES.filter(p => vocabSet.has(p));
  if (primitivesUsed.length < 3) {
    issues.push({
      severity: "error", code: "LOW_VISUAL_VARIANCE",
      message: `Only ${primitivesUsed.length} compositional primitive(s) used (${primitivesUsed.join(", ") || "none"}). Need ≥3 of: ${COMPOSITIONAL_PRIMITIVES.join(", ")}.`,
    });
  } else if (primitivesUsed.length < 5) {
    issues.push({
      severity: "warning", code: "MODERATE_VARIANCE",
      message: `Composition uses ${primitivesUsed.length} primitives — richer layouts use 5+.`,
    });
  }

  // ── 4. Distinct zone variants — zones must not all look the same ──────────
  const zoneVariants = new Set<string>();
  let zoneCount = 0;
  for (const child of root.children ?? []) {
    if (child.type === "zone") {
      zoneCount += 1;
      zoneVariants.add(child.variant ?? "_default");
    }
  }
  if (zoneCount >= 4 && zoneVariants.size < Math.ceil(zoneCount / 2)) {
    issues.push({
      severity: "error", code: "ZONE_VARIANT_COLLAPSE",
      message: `${zoneCount} zones but only ${zoneVariants.size} distinct variants — zones are too uniform.`,
    });
  }

  // ── 5. Identical-layout detection ─────────────────────────────────────────
  if (RECENT_SIGNATURES.includes(layout.compositionSignature)) {
    issues.push({
      severity: options.allowDuplicateSignature ? "warning" : "error",
      code: "DUPLICATE_COMPOSITION",
      message: `Composition signature ${layout.compositionSignature} is identical to a recently generated page — layouts must vary.`,
    });
  }

  // ── 6. Prompt-specific identity reflected in the copy ─────────────────────
  const text = collectText(root);
  const labelTokens = intent.businessLabel.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const reflectsBusiness =
    labelTokens.some(tok => text.includes(tok)) ||
    text.includes(intent.businessType.replace(/_/g, " ")) ||
    text.includes(intent.niche);
  if (!reflectsBusiness) {
    issues.push({
      severity: "error", code: "PROMPT_NOT_REFLECTED",
      message: `No copy references "${intent.businessLabel}" / "${intent.niche}" — composition is not prompt-specific.`,
    });
  }
  for (const marker of GENERIC_COPY_MARKERS) {
    if (text.includes(marker)) {
      issues.push({
        severity: "error", code: "GENERIC_PLACEHOLDER_COPY",
        message: `Generic placeholder copy detected: "${marker}".`,
      });
      break;
    }
  }

  // ── 7. Scene presence — the immersive hero is a core differentiator ───────
  if (!vocabSet.has("scene") && layout.archetype === "cinematic_immersive") {
    issues.push({
      severity: "warning", code: "MISSING_SCENE",
      message: "Cinematic archetype with no WebGL scene node — hero will feel flat.",
    });
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  let score = 100;
  for (const issue of issues) score -= issue.severity === "error" ? 22 : 6;
  score = Math.max(0, score);

  const passed = !issues.some(i => i.severity === "error");

  return {
    passed,
    score,
    archetype: layout.archetype,
    signature: layout.compositionSignature,
    issues,
  };
}
