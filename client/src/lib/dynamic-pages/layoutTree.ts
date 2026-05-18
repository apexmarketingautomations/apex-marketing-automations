/**
 * client/src/lib/dynamic-pages/layoutTree.ts
 *
 * Freeform AI-composed layout architecture for Dynamic Pages.
 *
 * This REPLACES the fixed `sections: SectionSchema[]` block stack with a
 * recursive layout tree — closer to how Stitch / v0 / Lovable compose UIs.
 *
 * Pipeline:
 *   Prompt → intent → design system → layout composition → LayoutNode tree → React UI
 *
 * The tree is rendered by `LayoutTreeRenderer.tsx`. The legacy block renderer
 * still works for `generationMode: "apex-fast"` — this is purely additive.
 *
 * Apex backend systems (CRM, forms, analytics, publishing, routing) are
 * unchanged: a `form` node references `DynamicPageSchema.forms[]` by id, and a
 * `cta` node carries the conversion action. The layout tree owns visual
 * composition only — not lead capture wiring.
 */

// ── Design system tokens ──────────────────────────────────────────────────────

export type SpacingToken = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface ColorTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  /** Full CSS gradient string for hero / accent fills */
  gradient: string;
}

export interface TypographyRoleToken {
  size: string;          // clamp() responsive size
  weight: number;
  lineHeight: string;
  letterSpacing?: string;
  textTransform?: "none" | "uppercase";
}

export type TypographyRole =
  | "display"   // oversized hero type
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "lead"      // larger intro paragraph
  | "caption"
  | "overline"  // small uppercase eyebrow
  | "label";

export interface TypographySystem {
  fontFamily: string;        // body font stack
  headingFamily: string;     // display/heading font stack
  roles: Record<TypographyRole, TypographyRoleToken>;
}

export interface MotionSystem {
  intensity: "none" | "subtle" | "medium" | "expressive" | "cinematic";
  /** ms durations keyed by purpose */
  durations: { fast: number; base: number; slow: number; cinematic: number };
  easing: string;            // cubic-bezier
  /** Default scroll-reveal stagger in ms */
  stagger: number;
}

export interface DesignSystem {
  colors: ColorTokens;
  /** spacing[token] → px. Index 0..12 */
  spacing: number[];
  typography: TypographySystem;
  /** radius keyed name → CSS value */
  radius: Record<"none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full", string>;
  /** elevation[level] → box-shadow string. Index 0..4 */
  elevation: string[];
  motion: MotionSystem;
  breakpoints: { mobile: number; tablet: number; desktop: number };
}

// ── Layout node ───────────────────────────────────────────────────────────────

/**
 * The compositional vocabulary. These are NOT fixed page sections — they are
 * spatial / structural primitives the AI freely combines into novel layouts.
 */
export type LayoutNodeType =
  // structural
  | "container"        // generic flex/grid/block region
  | "zone"             // a full responsive band (replaces "section")
  | "grid"             // adaptive grid of children
  | "stack"            // vertical stack
  | "row"              // horizontal row
  | "split_layout"     // asymmetric two-pane region
  | "floating_panel"   // absolutely-positioned floating element
  | "glass_panel"      // glassmorphism surface
  | "motion_cluster"   // group of independently-animated children
  | "marquee"          // horizontally scrolling strip
  | "spacer"
  | "divider"
  // content
  | "text"
  | "heading"
  | "image"
  | "scene"            // the WebGL 3D scene
  | "cta"
  | "form"
  | "card"
  | "stat"
  | "badge"
  | "icon"
  | "list"
  | "quote";

export type NodeSurface = "none" | "solid" | "glass" | "gradient" | "elevated" | "outline";

export type NodeRadius = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

export interface NodeAnimation {
  /** Entry animation when scrolled into view */
  entry?: "none" | "fade" | "fade_up" | "fade_down" | "slide_left" | "slide_right" | "scale_in" | "blur_in";
  /** Continuous ambient animation */
  ambient?: "none" | "float" | "pulse" | "drift" | "spin_slow" | "shimmer" | "breathe";
  /** Delay in ms for staggered reveals */
  delay?: number;
  /** Duration override in ms */
  duration?: number;
  /** Parallax depth: -1 (background) .. 1 (foreground) */
  parallax?: number;
}

export interface ResponsiveOverrides {
  mobile?: Partial<LayoutNodeStyle>;
  tablet?: Partial<LayoutNodeStyle>;
}

export interface LayoutNodeStyle {
  // box model
  display?: "flex" | "grid" | "block";
  direction?: "row" | "column";
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  wrap?: boolean;
  gap?: SpacingToken;
  padX?: SpacingToken;
  padY?: SpacingToken;
  marginX?: SpacingToken;
  marginY?: SpacingToken;

  // grid
  gridCols?: number;
  /** raw grid-template-columns override, e.g. "1.4fr 1fr" for asymmetry */
  gridTemplate?: string;
  colSpan?: number;

  // sizing
  width?: string;
  maxWidth?: string;
  height?: string;
  minHeight?: string;
  aspectRatio?: string;

  // positioning
  position?: "relative" | "absolute" | "sticky";
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: number;

  // surface / paint
  surface?: NodeSurface;
  background?: string;        // hex / gradient / "" → token
  radius?: NodeRadius;
  elevation?: 0 | 1 | 2 | 3 | 4;
  borderAccent?: boolean;     // 1px accent-colored border
  overflow?: "visible" | "hidden" | "clip";
  opacity?: number;
  rotate?: number;            // degrees — used for asymmetric / dynamic comps
  blur?: number;              // backdrop blur px

  // text
  textAlign?: "left" | "center" | "right";

  animation?: NodeAnimation;
  responsive?: ResponsiveOverrides;
}

export interface LayoutNodeContent {
  // text / heading
  text?: string;
  typographyRole?: TypographyRole;
  /** semantic heading level, independent of visual role */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  colorToken?: keyof ColorTokens;
  gradientText?: boolean;

  // image
  imageUrl?: string;
  imagePrompt?: string;       // for deferred AI image generation
  imageAlt?: string;
  imageFit?: "cover" | "contain";

  // cta — wires into DynamicPageSchema.cta / conversion
  ctaText?: string;
  ctaUrl?: string;
  ctaVariant?: "primary" | "secondary" | "ghost";

  // form — references DynamicPageSchema.forms[].id
  formId?: string;

  // scene — renders the WebGL hero
  sceneFullBleed?: boolean;

  // card / stat / quote
  eyebrow?: string;
  title?: string;
  body?: string;
  statValue?: string;
  statLabel?: string;
  quoteText?: string;
  quoteAuthor?: string;
  icon?: string;              // lucide icon name
  badgeText?: string;

  // list
  listItems?: string[];

  // marquee
  marqueeItems?: string[];
}

export interface LayoutNode {
  id: string;
  type: LayoutNodeType;
  /** Primitive variant — gives the renderer compositional intent
   *  (e.g. cta variant "immersive_booking", split_layout variant "cinematic_hero"). */
  variant?: string;
  style?: LayoutNodeStyle;
  content?: LayoutNodeContent;
  children?: LayoutNode[];
}

// ── Composed layout ───────────────────────────────────────────────────────────

/**
 * Composition archetype — a fundamentally different spatial language.
 * The validator uses this + compositionSignature to guarantee variance:
 * two different niches must not collapse to the same archetype + signature.
 */
export type CompositionArchetype =
  | "cinematic_immersive"   // dark, full-bleed scene, asymmetric floating panels
  | "industrial_trust"      // bold split bands, before/after, heavy stats
  | "menu_first"            // visual card grid, ambient imagery, reservation flow
  | "editorial_luxury"      // oversized type, generous whitespace, lookbook scroll
  | "clinical_precision"    // calm aligned grid, credential-forward
  | "energetic_conversion"  // high-contrast motion clusters, transformation focus
  | "freeform";             // AI-composed, no fixed archetype

export interface ComposedLayout {
  engine: "stitch-layout-v1";
  archetype: CompositionArchetype;
  designSystem: DesignSystem;
  root: LayoutNode;
  /** Stable hash of the structural shape — used to detect identical layouts. */
  compositionSignature: string;
  /** One-line explanation of why this composition fits the prompt. */
  rationale?: string;
  /** Distinct node types used — a variance signal for the validator. */
  vocabulary?: LayoutNodeType[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _nodeCounter = 0;
export function nodeId(type: string): string {
  _nodeCounter += 1;
  return `${type}-${_nodeCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Walk every node depth-first. */
export function walkLayout(node: LayoutNode, visit: (n: LayoutNode, depth: number) => void, depth = 0): void {
  visit(node, depth);
  for (const child of node.children ?? []) walkLayout(child, visit, depth + 1);
}

/** Count nodes in a tree. */
export function countNodes(node: LayoutNode): number {
  let n = 0;
  walkLayout(node, () => { n += 1; });
  return n;
}

/** Collect the distinct set of node types present in a tree. */
export function layoutVocabulary(node: LayoutNode): LayoutNodeType[] {
  const set = new Set<LayoutNodeType>();
  walkLayout(node, (n) => set.add(n.type));
  return [...set];
}

/** Maximum nesting depth of the tree. */
export function layoutDepth(node: LayoutNode): number {
  let max = 0;
  walkLayout(node, (_n, depth) => { if (depth > max) max = depth; });
  return max;
}

/**
 * Deterministic structural fingerprint. Captures the SHAPE of the tree
 * (node types + nesting + variants) but not the copy — so two pages with
 * the same skeleton but different text still collide. That is intentional:
 * the validator rejects structurally identical layouts.
 */
export function computeCompositionSignature(root: LayoutNode): string {
  const parts: string[] = [];
  walkLayout(root, (n, depth) => {
    parts.push(`${depth}:${n.type}:${n.variant ?? "_"}:${(n.children?.length ?? 0)}`);
  });
  const raw = parts.join("|");
  // Small, dependency-free 32-bit hash (FNV-1a)
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
