import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Calendar, Phone, Mail, Globe, Sparkles, Radio, MessageSquare, CheckCircle2, X } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Phase-5 action surfaces. These render only when the action layer asks for
// them; otherwise they noop so a baseline card render is unchanged.
// ---------------------------------------------------------------------------

export function BookingAutoExpand({
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
  const url = card.bookingUrl || card.calendarUrl;
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (adaptation.actions.autoExpandBooking && url && !dismissed) {
      // Defer one tick so the rest of the page renders first; we don't
      // want the iframe to block initial paint.
      const id = window.setTimeout(() => {
        setOpen(true);
        trackEvent?.("booking_auto_expand", `variant:${adaptation.variant}`);
      }, 600);
      return () => window.clearTimeout(id);
    }
  }, [adaptation.actions.autoExpandBooking, url, dismissed, adaptation.variant, trackEvent]);

  if (!url || !open) return null;
  const href = url.startsWith("http") ? url : `https://${url}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        className={`mb-6 rounded-2xl border ${theme.border} ${theme.cardBg} overflow-hidden`}
        data-testid="booking-auto-expand"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2 text-[12px] font-semibold">
            <Calendar size={14} style={{ color: card.brandColor }} />
            <span className={theme.text}>Pick a time that works</span>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              setDismissed(true);
            }}
            className={`${theme.muted} hover:opacity-80`}
            data-testid="button-dismiss-booking"
            aria-label="Close booking"
          >
            <X size={16} />
          </button>
        </div>
        <iframe
          src={href}
          className="w-full h-[480px] bg-white"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Booking"
        />
      </motion.div>
    </AnimatePresence>
  );
}

export function RealtimeChannelStrip({
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
  // Only render when peak-hour realtime preference is on AND we actually
  // have a real-time channel to offer. Otherwise the baseline action grid
  // already covers it.
  if (!adaptation.actions.realtimePreference) return null;
  if (!card.phone) return null;

  const smsBody = encodeURIComponent(
    `Hi ${card.preferredName || card.name.split(" ")[0]}, I just looked at your card and want to chat.`,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-2 mb-4"
      data-testid="realtime-channel-strip"
    >
      <a
        href={`tel:${card.phone}`}
        onClick={() => trackEvent?.("click_phone", "realtime:call")}
        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold text-[13px] hover:scale-[1.02] active:scale-[0.98] transition"
        data-testid="action-realtime-call"
      >
        <Phone size={16} />
        <span>Call now</span>
      </a>
      <a
        href={`sms:${card.phone}?&body=${smsBody}`}
        onClick={() => trackEvent?.("click_phone", "realtime:sms")}
        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-300 font-semibold text-[13px] hover:scale-[1.02] active:scale-[0.98] transition"
        data-testid="action-realtime-text"
      >
        <MessageSquare size={16} />
        <span>Text now</span>
      </a>
    </motion.div>
  );
}

export function FollowUpAcknowledgement({
  adaptation,
  theme,
}: {
  adaptation: CardAdaptation;
  theme: CardTheme;
}) {
  if (!adaptation.actions.followUpFlagged) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
      data-testid="followup-ack"
    >
      <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
      <span className={`text-[12px] ${theme.text} opacity-90`}>
        We've flagged your visit — if we miss each other, we'll follow up.
      </span>
    </motion.div>
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
