import { motion } from "framer-motion";
import { Calendar, Phone, Mail, Globe, Sparkles, Radio } from "lucide-react";
import type { SharedCardData, CardTheme } from "./index";
import type { CardAdaptation } from "@/hooks/useCardAdaptation";

// ---------------------------------------------------------------------------
// Adaptive surfaces — purely additive UI that the card render can opt into
// when the intelligence layer says "this visitor is hot" or "this card is in
// its peak hour right now". None of these components own state; they read
// directives from useCardAdaptation and render or noop.
// ---------------------------------------------------------------------------

interface CtaConfig {
  label: string;
  href: string;
  icon: typeof Calendar;
  event: string;
}

function resolveCta(card: SharedCardData, surfaceCta: CardAdaptation["surfaceCta"]): CtaConfig | null {
  if (!surfaceCta) return null;
  switch (surfaceCta) {
    case "book": {
      const url = card.bookingUrl || card.calendarUrl;
      if (!url) return null;
      return {
        label: "Book a time",
        href: url.startsWith("http") ? url : `https://${url}`,
        icon: Calendar,
        event: "click_booking",
      };
    }
    case "call":
      return card.phone
        ? { label: `Call ${card.preferredName || card.name.split(" ")[0]}`, href: `tel:${card.phone}`, icon: Phone, event: "click_phone" }
        : null;
    case "email":
      return card.email
        ? { label: `Email ${card.preferredName || card.name.split(" ")[0]}`, href: `mailto:${card.email}`, icon: Mail, event: "click_email" }
        : null;
    case "website":
      return card.website
        ? {
            label: "Open website",
            href: card.website.startsWith("http") ? card.website : `https://${card.website}`,
            icon: Globe,
            event: "click_website",
          }
        : null;
    default:
      return null;
  }
}

export function HighIntentCta({
  card,
  theme,
  adaptation,
  trackEvent,
}: {
  card: SharedCardData;
  theme: CardTheme;
  adaptation: CardAdaptation;
  trackEvent?: (t: string, e?: string) => void;
}) {
  const cta = resolveCta(card, adaptation.surfaceCta);
  if (!cta) return null;

  return (
    <motion.a
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      href={cta.href}
      target={cta.href.startsWith("http") ? "_blank" : undefined}
      rel={cta.href.startsWith("http") ? "noopener noreferrer" : undefined}
      onClick={() => trackEvent?.(cta.event, `surface:${adaptation.variant}`)}
      data-testid="cta-surfaced"
      data-variant={adaptation.variant}
      className="flex items-center justify-between mb-6 px-5 py-4 rounded-2xl font-bold text-sm cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]"
      style={{
        background: `linear-gradient(135deg, ${card.brandColor}, ${card.accentColor})`,
        boxShadow: `0 12px 32px -8px ${card.brandColor}80`,
      }}
    >
      <span className="flex items-center gap-2.5 text-white">
        <Sparkles size={16} />
        <span>{cta.label}</span>
      </span>
      <cta.icon size={20} className="text-white" />
    </motion.a>
  );
}

export function LiveNowPill({ adaptation, theme }: { adaptation: CardAdaptation; theme: CardTheme }) {
  if (!adaptation.showLiveSignal) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center justify-center gap-2 mb-3"
      data-testid="pill-live-now"
    >
      <span
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold ${theme.cardBg} border ${theme.border}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <Radio size={11} className="text-emerald-400" />
        <span className="text-emerald-300">Usually replies right now</span>
      </span>
    </motion.div>
  );
}
