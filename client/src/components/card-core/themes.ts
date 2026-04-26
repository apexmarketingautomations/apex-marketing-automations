export interface CardTheme {
  bg: string;
  cardBg: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  glass: string;
  heroOverlay: string;
  ctaBg: string;
  isDark: boolean;
}

export const CARD_THEMES: Record<string, CardTheme> = {
  "executive-dark": {
    bg: "bg-[#050507]",
    cardBg: "bg-white/[0.04]",
    text: "text-white",
    muted: "text-zinc-400",
    accent: "text-blue-400",
    border: "border-white/[0.08]",
    glass: "backdrop-blur-xl bg-black/70",
    heroOverlay: "from-[#050507] via-[#050507]/60 to-transparent",
    ctaBg: "from-blue-500 via-blue-600 to-indigo-700",
    isDark: true,
  },
  "luxury-dark": {
    bg: "bg-[#0f0f10]",
    cardBg: "bg-white/[0.03]",
    text: "text-white",
    muted: "text-amber-100/60",
    accent: "text-amber-300",
    border: "border-amber-500/10",
    glass: "backdrop-blur-xl bg-black/70",
    heroOverlay: "from-[#0f0f10] via-[#0f0f10]/60 to-transparent",
    ctaBg: "from-amber-400 via-yellow-500 to-amber-600",
    isDark: true,
  },
  "clean-light": {
    bg: "bg-[#fdfcf8]",
    cardBg: "bg-white",
    text: "text-stone-900",
    muted: "text-stone-500",
    accent: "text-stone-900",
    border: "border-stone-200",
    glass: "backdrop-blur-xl bg-white/95",
    heroOverlay: "from-[#fdfcf8] via-[#fdfcf8]/60 to-transparent",
    ctaBg: "from-stone-900 via-stone-800 to-stone-900",
    isDark: false,
  },
  "bold-agency": {
    bg: "bg-[#0a0820]",
    cardBg: "bg-white/[0.05]",
    text: "text-white",
    muted: "text-pink-200/60",
    accent: "text-pink-400",
    border: "border-pink-500/20",
    glass: "backdrop-blur-xl bg-[#0a0820]/85",
    heroOverlay: "from-[#0a0820] via-[#0a0820]/60 to-transparent",
    ctaBg: "from-pink-500 via-fuchsia-500 to-cyan-400",
    isDark: true,
  },
  "modern-gradient": {
    bg: "bg-gradient-to-br from-[#fff1e6] via-[#ffd6a5] to-[#fdb6a3]",
    cardBg: "bg-white/70",
    text: "text-[#1a2540]",
    muted: "text-[#1a2540]/60",
    accent: "text-[#1a2540]",
    border: "border-[#1a2540]/10",
    glass: "backdrop-blur-xl bg-white/80",
    heroOverlay: "from-[#fdb6a3] via-[#ffd6a5]/40 to-transparent",
    ctaBg: "from-[#1a2540] via-[#2d3a5f] to-[#fdb6a3]",
    isDark: false,
  },
  "minimal-neutral": {
    bg: "bg-[#f4f1ea]",
    cardBg: "bg-white",
    text: "text-[#1a2e1a]",
    muted: "text-[#1a2e1a]/60",
    accent: "text-[#2d5a3d]",
    border: "border-[#2d5a3d]/15",
    glass: "backdrop-blur-xl bg-[#f4f1ea]/95",
    heroOverlay: "from-[#f4f1ea] via-[#f4f1ea]/60 to-transparent",
    ctaBg: "from-[#2d5a3d] via-[#3d6a4d] to-[#5a7848]",
    isDark: false,
  },
};

export const THEME_DISPLAY_NAMES: Record<string, string> = {
  "executive-dark": "Onyx",
  "luxury-dark": "Champagne",
  "clean-light": "Porcelain",
  "bold-agency": "Neon Pulse",
  "modern-gradient": "Coastal",
  "minimal-neutral": "Botanical",
};

export function getThemeDisplayName(id: string): string {
  return THEME_DISPLAY_NAMES[id] || id.replace(/-/g, " ");
}

export const PREMIUM_THEMES = Object.keys(CARD_THEMES);

export const BASE_THEME = "executive-dark";

export function getCardTheme(name?: string): CardTheme {
  return CARD_THEMES[name || ""] || CARD_THEMES[BASE_THEME];
}

export function getAvailableThemes(tier?: string): string[] {
  if (tier === "premium" || tier === "pro") return PREMIUM_THEMES;
  return [BASE_THEME];
}

export function resolveThemeForTier(requestedTheme: string | undefined, tier?: string): string {
  const available = getAvailableThemes(tier);
  if (requestedTheme && available.includes(requestedTheme)) return requestedTheme;
  return BASE_THEME;
}

export function canRemoveBranding(source: "platform" | "standalone", tier?: string): boolean {
  if (source === "platform") return true;
  return tier === "premium" || tier === "pro";
}

export function getAvailableLayouts(tier?: string): string[] {
  const base = ["default", "modern", "bold", "minimal"];
  if (tier === "pro") return [...base, "executive", "creative"];
  return base;
}
