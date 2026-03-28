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
    bg: "bg-[#0a0a0f]",
    cardBg: "bg-white/[0.04]",
    text: "text-white",
    muted: "text-slate-400",
    accent: "text-indigo-400",
    border: "border-white/[0.08]",
    glass: "backdrop-blur-xl bg-black/60",
    heroOverlay: "from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent",
    ctaBg: "from-indigo-600 via-purple-600 to-fuchsia-600",
    isDark: true,
  },
  "luxury-dark": {
    bg: "bg-[#0d0d0d]",
    cardBg: "bg-white/[0.03]",
    text: "text-white",
    muted: "text-neutral-400",
    accent: "text-amber-400",
    border: "border-white/[0.06]",
    glass: "backdrop-blur-xl bg-black/70",
    heroOverlay: "from-[#0d0d0d] via-[#0d0d0d]/60 to-transparent",
    ctaBg: "from-amber-600 via-orange-600 to-red-600",
    isDark: true,
  },
  "clean-light": {
    bg: "bg-[#fafafa]",
    cardBg: "bg-white",
    text: "text-gray-900",
    muted: "text-gray-500",
    accent: "text-blue-600",
    border: "border-gray-200",
    glass: "backdrop-blur-xl bg-white/90",
    heroOverlay: "from-white via-white/60 to-transparent",
    ctaBg: "from-blue-600 via-indigo-600 to-violet-600",
    isDark: false,
  },
  "bold-agency": {
    bg: "bg-[#0f0f23]",
    cardBg: "bg-white/[0.05]",
    text: "text-white",
    muted: "text-slate-400",
    accent: "text-cyan-400",
    border: "border-cyan-500/20",
    glass: "backdrop-blur-xl bg-[#0f0f23]/80",
    heroOverlay: "from-[#0f0f23] via-[#0f0f23]/60 to-transparent",
    ctaBg: "from-cyan-500 via-blue-600 to-indigo-600",
    isDark: true,
  },
  "modern-gradient": {
    bg: "bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950",
    cardBg: "bg-white/[0.05]",
    text: "text-white",
    muted: "text-indigo-200/60",
    accent: "text-violet-400",
    border: "border-indigo-500/15",
    glass: "backdrop-blur-xl bg-indigo-950/60",
    heroOverlay: "from-slate-950 via-slate-950/60 to-transparent",
    ctaBg: "from-violet-600 via-purple-600 to-pink-600",
    isDark: true,
  },
  "minimal-neutral": {
    bg: "bg-[#f5f5f0]",
    cardBg: "bg-white",
    text: "text-stone-900",
    muted: "text-stone-500",
    accent: "text-stone-700",
    border: "border-stone-200",
    glass: "backdrop-blur-xl bg-[#f5f5f0]/95",
    heroOverlay: "from-[#f5f5f0] via-[#f5f5f0]/60 to-transparent",
    ctaBg: "from-stone-800 via-stone-700 to-stone-600",
    isDark: false,
  },
};

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
