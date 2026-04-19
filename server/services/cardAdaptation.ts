// ---------------------------------------------------------------------------
// Card adaptation rule engine.
//
// Pure, deterministic translator from intelligence signals → render
// directives the public card page applies on top of its existing layout.
// No data-model changes, no rebuild of the intelligence pipeline — every
// input here already exists in tracking_visits / tracking_events /
// card_intelligence_snapshots and the trackingInsights service.
//
// Directives are intentionally narrow: each one maps to a small, reversible
// UI change so a wrong adaptation degrades to "normal card", never broken.
// ---------------------------------------------------------------------------

export type StrongestCta = "book" | "call" | "email" | "website" | null;

export interface CardAdaptation {
  // Surface the strongest CTA above the standard action grid. Used when the
  // visitor has shown intent and we want to remove a click.
  surfaceCta: StrongestCta;
  // Hide secondary explanatory blocks (bio, testimonials) so conversion
  // elements dominate the viewport.
  hideAbout: boolean;
  hideTestimonials: boolean;
  // Compress vertical padding / card spacing for return visitors who don't
  // need the showcase treatment again.
  compactMode: boolean;
  // Render a "live now / call now" pill near the primary CTA when the
  // visitor lands during one of the card's peak engagement hours.
  showLiveSignal: boolean;
  // Diagnostic codes — the frontend can surface these in dev tooling and
  // we pipe them into the response so test traffic can verify rules.
  reasons: string[];
  // Stable variant id so we can A/B-track the directive set later without a
  // schema change. Derived purely from the directives, not the inputs.
  variant: string;
}

export interface AdaptationInput {
  // Snapshot fields (already filtered to non-test traffic upstream).
  taps: number;
  uniqueVisitors: number;
  repeatVisitors: number;
  bookingUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  // Visit-level signal — set when the requesting visit has been flagged
  // by the intent detector. Defaults to false for anonymous fresh visits.
  visitIsHighIntent: boolean;
  // Server-computed top engagement hours (0-23). Empty array = unknown.
  peakHours: number[];
  // Current hour at the requesting visitor's location. Server uses UTC by
  // default but the client may override via ?hour= so peak-hour matching
  // is timezone-aware without us storing TZ per visitor.
  currentHour: number;
  // Insight codes from trackingInsights.generateInsights — we consume the
  // codes (not the messages) so the rule engine stays decoupled from copy.
  insightCodes: Set<string>;
}

const REPEAT_RATE_PRIORITIZE_CONVERSION = 0.25;

function pickStrongestCta(input: AdaptationInput): StrongestCta {
  // Prefer high-commitment actions that match the card's wiring. Booking is
  // the strongest because it captures intent + contact info in one step;
  // call is next because it's a live conversation.
  if (input.bookingUrl) return "book";
  if (input.phone) return "call";
  if (input.email) return "email";
  if (input.website) return "website";
  return null;
}

export function computeCardAdaptation(input: AdaptationInput): CardAdaptation {
  const reasons: string[] = [];
  let surfaceCta: StrongestCta = null;
  let hideAbout = false;
  let hideTestimonials = false;
  let compactMode = false;
  let showLiveSignal = false;

  const repeatRate =
    input.uniqueVisitors > 0 ? input.repeatVisitors / input.uniqueVisitors : 0;

  // (1) high_intent on this specific visit ⇒ surface strongest CTA + reduce
  // friction. This is the most aggressive adaptation; we only fire it when
  // the intent flag is set on the visitor's own visit (no cross-pollination
  // from other visitors' intent state).
  if (input.visitIsHighIntent) {
    surfaceCta = pickStrongestCta(input);
    hideAbout = true; // friction reduction — they've already decided
    compactMode = true;
    reasons.push("visit_high_intent");
  }

  // (2) repeat_engagement signal at the card level ⇒ reduce explanatory
  // content for everyone (the card has proven its messaging works on
  // repeat visitors, so trim the showcase).
  if (
    input.insightCodes.has("repeat_engagement") ||
    repeatRate > REPEAT_RATE_PRIORITIZE_CONVERSION
  ) {
    hideAbout = true;
    hideTestimonials = true;
    if (!surfaceCta) surfaceCta = pickStrongestCta(input);
    reasons.push("repeat_engagement");
  }

  // (3) peak_hours signal AND the visitor is currently in one of those
  // hours ⇒ prioritize real-time interaction. We don't surface live signals
  // off-peak because falsely promising "available now" at 2AM would erode
  // trust faster than no signal at all.
  if (
    input.insightCodes.has("peak_hours") &&
    input.peakHours.includes(input.currentHour)
  ) {
    showLiveSignal = true;
    // Bias toward the live-conversation CTA when one is available.
    if (input.phone && (!surfaceCta || surfaceCta === "email" || surfaceCta === "website")) {
      surfaceCta = "call";
    }
    reasons.push("in_peak_hour");
  }

  // Stable variant tag for downstream analytics ("did the adaptation
  // actually move the needle?"). Built from directives only so the same
  // payload always produces the same variant id.
  const variant = [
    surfaceCta ? `cta:${surfaceCta}` : "cta:none",
    hideAbout ? "ha" : "",
    hideTestimonials ? "ht" : "",
    compactMode ? "c" : "",
    showLiveSignal ? "live" : "",
  ]
    .filter(Boolean)
    .join("|") || "baseline";

  return {
    surfaceCta,
    hideAbout,
    hideTestimonials,
    compactMode,
    showLiveSignal,
    reasons,
    variant,
  };
}
