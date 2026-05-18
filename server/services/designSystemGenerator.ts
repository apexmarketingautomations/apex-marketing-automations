/**
 * server/services/designSystemGenerator.ts
 *
 * Generates a full DesignSystem (color tokens, spacing scale, typography
 * system, radius, elevation, motion) from a ParsedPromptIntent.
 *
 * Deterministic — no AI call. The AI composes the LAYOUT; the design system
 * is derived from the parsed intent so it is fast, reliable, and consistent.
 *
 * Different styles produce fundamentally different systems: a "luxury" brand
 * gets sharp corners, a serif display face, and slow cinematic motion; a
 * "tech" brand gets rounded glass surfaces and snappier transitions.
 */

import type { ParsedPromptIntent } from "./visualPromptParser";
import type {
  DesignSystem,
  ColorTokens,
  TypographySystem,
  TypographyRole,
  TypographyRoleToken,
  MotionSystem,
} from "../../client/src/lib/dynamic-pages/layoutTree";

// ── Color helpers ─────────────────────────────────────────────────────────────

function clampHex(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6) || "6366f1", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(c => clampHex(c).toString(16).padStart(2, "0")).join("");
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function lighten(hex: string, t: number): string { return mix(hex, "#ffffff", t); }
function darken(hex: string, t: number): string { return mix(hex, "#000000", t); }

function isValidHex(s: string | undefined): s is string {
  return !!s && /^#?[0-9a-fA-F]{3,8}$/.test(s.trim());
}

// ── Style profiles ────────────────────────────────────────────────────────────
// Each style is a complete visual personality. This is what makes a barbershop
// page look nothing like a dental clinic page.

interface StyleProfile {
  /** dark or light base */
  base: "dark" | "light";
  /** background hex */
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  /** default primary if the prompt gave no colors */
  fallbackPrimary: string;
  fallbackSecondary: string;
  fallbackAccent: string;
  headingFamily: string;
  bodyFamily: string;
  /** radius personality */
  radiusScale: "sharp" | "soft" | "rounded" | "pill";
  /** how aggressive the type scale is */
  typeScale: "compact" | "balanced" | "dramatic";
  motionIntensity: MotionSystem["intensity"];
  /** spacing density multiplier */
  density: number;
}

const STYLE_PROFILES: Record<string, StyleProfile> = {
  dark: {
    base: "dark", background: "#050507", surface: "#101014", surfaceAlt: "#17171d",
    text: "#f5f5f7", textMuted: "#9b9ba6",
    fallbackPrimary: "#dc2626", fallbackSecondary: "#1f2937", fallbackAccent: "#f59e0b",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "soft", typeScale: "dramatic", motionIntensity: "cinematic", density: 1.15,
  },
  luxury: {
    base: "dark", background: "#0a0807", surface: "#14110e", surfaceAlt: "#1d1813",
    text: "#f4efe6", textMuted: "#a99f8c",
    fallbackPrimary: "#c9a14a", fallbackSecondary: "#1d1813", fallbackAccent: "#e8d8a8",
    headingFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "sharp", typeScale: "dramatic", motionIntensity: "cinematic", density: 1.4,
  },
  minimal: {
    base: "light", background: "#fafafa", surface: "#ffffff", surfaceAlt: "#f2f2f4",
    text: "#0c0c0e", textMuted: "#6b6b73",
    fallbackPrimary: "#111113", fallbackSecondary: "#e4e4e7", fallbackAccent: "#2563eb",
    headingFamily: "'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "sharp", typeScale: "compact", motionIntensity: "subtle", density: 1.3,
  },
  corporate: {
    base: "light", background: "#f7f8fa", surface: "#ffffff", surfaceAlt: "#eef1f5",
    text: "#0f1729", textMuted: "#5b6577",
    fallbackPrimary: "#1d4ed8", fallbackSecondary: "#0f1729", fallbackAccent: "#0891b2",
    headingFamily: "'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "soft", typeScale: "balanced", motionIntensity: "subtle", density: 1.2,
  },
  warm: {
    base: "light", background: "#fdf8f3", surface: "#ffffff", surfaceAlt: "#f6ece1",
    text: "#2a1f17", textMuted: "#8a7864",
    fallbackPrimary: "#c2632f", fallbackSecondary: "#3d2c1e", fallbackAccent: "#e0a458",
    headingFamily: "'Fraunces', 'Playfair Display', Georgia, serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "balanced", motionIntensity: "medium", density: 1.25,
  },
  neon: {
    base: "dark", background: "#04040a", surface: "#0c0c1a", surfaceAlt: "#141430",
    text: "#f0f0ff", textMuted: "#8a8ab5",
    fallbackPrimary: "#d946ef", fallbackSecondary: "#6d28d9", fallbackAccent: "#22d3ee",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "dramatic", motionIntensity: "cinematic", density: 1.1,
  },
  cyberpunk: {
    base: "dark", background: "#05060a", surface: "#0d0f17", surfaceAlt: "#15192a",
    text: "#e6f7ff", textMuted: "#7d8ba5",
    fallbackPrimary: "#22d3ee", fallbackSecondary: "#f43f5e", fallbackAccent: "#facc15",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "sharp", typeScale: "dramatic", motionIntensity: "cinematic", density: 1.05,
  },
  tech: {
    base: "dark", background: "#070a12", surface: "#0e1422", surfaceAlt: "#16203a",
    text: "#eef2ff", textMuted: "#8893ad",
    fallbackPrimary: "#3b82f6", fallbackSecondary: "#1e293b", fallbackAccent: "#06b6d4",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "balanced", motionIntensity: "medium", density: 1.15,
  },
  nature: {
    base: "light", background: "#f4f7f0", surface: "#ffffff", surfaceAlt: "#e6efe0",
    text: "#1a2418", textMuted: "#5f7058",
    fallbackPrimary: "#3f7d3f", fallbackSecondary: "#26331f", fallbackAccent: "#a3c861",
    headingFamily: "'Fraunces', Georgia, serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "balanced", motionIntensity: "medium", density: 1.3,
  },
  medical: {
    base: "light", background: "#f5fafd", surface: "#ffffff", surfaceAlt: "#e8f2f8",
    text: "#0c2230", textMuted: "#577484",
    fallbackPrimary: "#0d9488", fallbackSecondary: "#0c2230", fallbackAccent: "#38bdf8",
    headingFamily: "'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "compact", motionIntensity: "subtle", density: 1.25,
  },
  legal: {
    base: "dark", background: "#0a0c12", surface: "#12151f", surfaceAlt: "#1b2030",
    text: "#eef0f5", textMuted: "#8b93a7",
    fallbackPrimary: "#b08d57", fallbackSecondary: "#1b2030", fallbackAccent: "#d9c08a",
    headingFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "sharp", typeScale: "balanced", motionIntensity: "subtle", density: 1.3,
  },
  vibrant: {
    base: "light", background: "#fffdf7", surface: "#ffffff", surfaceAlt: "#fdf0e6",
    text: "#1c1024", textMuted: "#6d5f78",
    fallbackPrimary: "#f5760a", fallbackSecondary: "#7c3aed", fallbackAccent: "#ec4899",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "pill", typeScale: "dramatic", motionIntensity: "expressive", density: 1.2,
  },
  energetic: {
    base: "dark", background: "#0a0708", surface: "#15100f", surfaceAlt: "#201817",
    text: "#fff5f0", textMuted: "#a5938c",
    fallbackPrimary: "#f97316", fallbackSecondary: "#16a34a", fallbackAccent: "#facc15",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "dramatic", motionIntensity: "expressive", density: 1.1,
  },
  glassmorphism: {
    base: "dark", background: "#0a0a16", surface: "#15152a", surfaceAlt: "#1e1e3c",
    text: "#f2f2fb", textMuted: "#9494b8",
    fallbackPrimary: "#818cf8", fallbackSecondary: "#1e1e3c", fallbackAccent: "#22d3ee",
    headingFamily: "'Sora', 'Inter', system-ui, sans-serif",
    bodyFamily: "'Inter', system-ui, sans-serif",
    radiusScale: "rounded", typeScale: "balanced", motionIntensity: "medium", density: 1.2,
  },
};

function resolveProfile(style: string): StyleProfile {
  return STYLE_PROFILES[style] ?? STYLE_PROFILES.dark;
}

// ── Color tokens ──────────────────────────────────────────────────────────────

function buildColorTokens(intent: ParsedPromptIntent, profile: StyleProfile): ColorTokens {
  const promptColors = (intent.colors ?? []).filter(isValidHex).map(c => (c.startsWith("#") ? c : `#${c}`));

  const primary   = promptColors[0] ?? profile.fallbackPrimary;
  const secondary = promptColors[1] ?? profile.fallbackSecondary;
  const accent    = promptColors[2] ?? profile.fallbackAccent;

  const isDark = profile.base === "dark";
  const border = isDark ? lighten(profile.surface, 0.12) : darken(profile.surfaceAlt, 0.08);

  const gradient = isDark
    ? `linear-gradient(135deg, ${primary} 0%, ${mix(primary, accent, 0.5)} 50%, ${darken(accent, 0.1)} 100%)`
    : `linear-gradient(135deg, ${primary} 0%, ${mix(primary, accent, 0.4)} 100%)`;

  return {
    primary,
    secondary,
    accent,
    background: profile.background,
    surface: profile.surface,
    surfaceAlt: profile.surfaceAlt,
    text: profile.text,
    textMuted: profile.textMuted,
    border,
    gradient,
  };
}

// ── Typography ────────────────────────────────────────────────────────────────

const TYPE_SCALES: Record<StyleProfile["typeScale"], Record<TypographyRole, TypographyRoleToken>> = {
  compact: {
    display:  { size: "clamp(2.4rem, 5vw, 3.8rem)", weight: 800, lineHeight: "1.05", letterSpacing: "-0.02em" },
    h1:       { size: "clamp(2rem, 3.6vw, 2.8rem)", weight: 700, lineHeight: "1.12", letterSpacing: "-0.015em" },
    h2:       { size: "clamp(1.5rem, 2.4vw, 2rem)", weight: 700, lineHeight: "1.2" },
    h3:       { size: "clamp(1.15rem, 1.6vw, 1.4rem)", weight: 600, lineHeight: "1.3" },
    lead:     { size: "clamp(1.05rem, 1.4vw, 1.25rem)", weight: 400, lineHeight: "1.6" },
    body:     { size: "1rem", weight: 400, lineHeight: "1.65" },
    caption:  { size: "0.85rem", weight: 400, lineHeight: "1.5" },
    overline: { size: "0.72rem", weight: 600, lineHeight: "1.4", letterSpacing: "0.14em", textTransform: "uppercase" },
    label:    { size: "0.9rem", weight: 600, lineHeight: "1.4" },
  },
  balanced: {
    display:  { size: "clamp(2.8rem, 6.5vw, 5rem)", weight: 800, lineHeight: "1.02", letterSpacing: "-0.025em" },
    h1:       { size: "clamp(2.2rem, 4.4vw, 3.4rem)", weight: 700, lineHeight: "1.1", letterSpacing: "-0.02em" },
    h2:       { size: "clamp(1.7rem, 3vw, 2.4rem)", weight: 700, lineHeight: "1.18" },
    h3:       { size: "clamp(1.25rem, 1.9vw, 1.6rem)", weight: 600, lineHeight: "1.3" },
    lead:     { size: "clamp(1.1rem, 1.6vw, 1.4rem)", weight: 400, lineHeight: "1.6" },
    body:     { size: "1.05rem", weight: 400, lineHeight: "1.7" },
    caption:  { size: "0.875rem", weight: 400, lineHeight: "1.5" },
    overline: { size: "0.75rem", weight: 600, lineHeight: "1.4", letterSpacing: "0.16em", textTransform: "uppercase" },
    label:    { size: "0.95rem", weight: 600, lineHeight: "1.4" },
  },
  dramatic: {
    display:  { size: "clamp(3.2rem, 9vw, 7.5rem)", weight: 900, lineHeight: "0.95", letterSpacing: "-0.04em" },
    h1:       { size: "clamp(2.6rem, 5.6vw, 4.6rem)", weight: 800, lineHeight: "1.04", letterSpacing: "-0.03em" },
    h2:       { size: "clamp(2rem, 3.8vw, 3.2rem)", weight: 800, lineHeight: "1.1", letterSpacing: "-0.02em" },
    h3:       { size: "clamp(1.4rem, 2.2vw, 1.9rem)", weight: 700, lineHeight: "1.25" },
    lead:     { size: "clamp(1.15rem, 1.9vw, 1.6rem)", weight: 400, lineHeight: "1.55" },
    body:     { size: "1.08rem", weight: 400, lineHeight: "1.7" },
    caption:  { size: "0.875rem", weight: 400, lineHeight: "1.5" },
    overline: { size: "0.78rem", weight: 700, lineHeight: "1.4", letterSpacing: "0.2em", textTransform: "uppercase" },
    label:    { size: "0.95rem", weight: 600, lineHeight: "1.4" },
  },
};

function buildTypography(profile: StyleProfile): TypographySystem {
  return {
    fontFamily: profile.bodyFamily,
    headingFamily: profile.headingFamily,
    roles: TYPE_SCALES[profile.typeScale],
  };
}

// ── Radius ────────────────────────────────────────────────────────────────────

const RADIUS_SCALES: Record<StyleProfile["radiusScale"], DesignSystem["radius"]> = {
  sharp:   { none: "0", sm: "1px",  md: "2px",  lg: "3px",   xl: "4px",   "2xl": "6px",   full: "9999px" },
  soft:    { none: "0", sm: "4px",  md: "8px",  lg: "12px",  xl: "16px",  "2xl": "24px",  full: "9999px" },
  rounded: { none: "0", sm: "6px",  md: "12px", lg: "18px",  xl: "26px",  "2xl": "36px",  full: "9999px" },
  pill:    { none: "0", sm: "10px", md: "18px", lg: "28px",  xl: "40px",  "2xl": "56px",  full: "9999px" },
};

// ── Elevation ─────────────────────────────────────────────────────────────────

function buildElevation(profile: StyleProfile): string[] {
  const isDark = profile.base === "dark";
  if (isDark) {
    return [
      "none",
      "0 1px 2px rgba(0,0,0,0.4)",
      "0 6px 18px rgba(0,0,0,0.5)",
      "0 16px 40px rgba(0,0,0,0.6)",
      "0 28px 70px rgba(0,0,0,0.7)",
    ];
  }
  return [
    "none",
    "0 1px 2px rgba(15,23,42,0.06)",
    "0 6px 18px rgba(15,23,42,0.1)",
    "0 16px 40px rgba(15,23,42,0.14)",
    "0 28px 70px rgba(15,23,42,0.18)",
  ];
}

// ── Motion ────────────────────────────────────────────────────────────────────

const MOTION_DURATIONS: Record<MotionSystem["intensity"], MotionSystem["durations"]> = {
  none:       { fast: 0,   base: 0,   slow: 0,    cinematic: 0 },
  subtle:     { fast: 120, base: 200, slow: 320,  cinematic: 500 },
  medium:     { fast: 160, base: 280, slow: 460,  cinematic: 720 },
  expressive: { fast: 180, base: 340, slow: 560,  cinematic: 900 },
  cinematic:  { fast: 220, base: 420, slow: 700,  cinematic: 1200 },
};

function buildMotion(intent: ParsedPromptIntent, profile: StyleProfile): MotionSystem {
  // Prompt motion can override the style default, but never exceeds it by more
  // than one step — the style sets the ceiling.
  const order: MotionSystem["intensity"][] = ["none", "subtle", "medium", "expressive", "cinematic"];
  const promptMotion = (intent.motion ?? "").toLowerCase();
  const promptIdx = order.indexOf(promptMotion as MotionSystem["intensity"]);
  const styleIdx = order.indexOf(profile.motionIntensity);
  const idx = promptIdx >= 0 ? Math.min(promptIdx, styleIdx + 1) : styleIdx;
  const intensity = order[Math.max(0, Math.min(order.length - 1, idx))];

  return {
    intensity,
    durations: MOTION_DURATIONS[intensity],
    easing: intensity === "cinematic" || intensity === "expressive"
      ? "cubic-bezier(0.16, 1, 0.3, 1)"
      : "cubic-bezier(0.4, 0, 0.2, 1)",
    stagger: intensity === "cinematic" ? 110 : intensity === "expressive" ? 90 : 70,
  };
}

// ── Spacing ───────────────────────────────────────────────────────────────────

function buildSpacing(profile: StyleProfile): number[] {
  // 13-step scale, index 0..12. Density multiplier widens luxury/minimal pages.
  const base = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 224];
  return base.map(v => Math.round(v * profile.density));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateDesignSystem(intent: ParsedPromptIntent): DesignSystem {
  const profile = resolveProfile((intent.style ?? "dark").toLowerCase());

  return {
    colors: buildColorTokens(intent, profile),
    spacing: buildSpacing(profile),
    typography: buildTypography(profile),
    radius: RADIUS_SCALES[profile.radiusScale],
    elevation: buildElevation(profile),
    motion: buildMotion(intent, profile),
    breakpoints: { mobile: 640, tablet: 1024, desktop: 1280 },
  };
}

/** Exposed so the renderer / tests can resolve a style to its base mode. */
export function styleBaseMode(style: string): "dark" | "light" {
  return resolveProfile((style ?? "dark").toLowerCase()).base;
}
