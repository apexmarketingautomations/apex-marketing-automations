import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// useCardAdaptation
//
// Pulls render directives from /api/intelligence/cards/by-slug/:slug/adaptation
// and degrades to "no adaptation" on any failure so the card always renders.
// ---------------------------------------------------------------------------

export interface CardAdaptation {
  surfaceCta: "book" | "call" | "email" | "website" | null;
  hideAbout: boolean;
  hideTestimonials: boolean;
  compactMode: boolean;
  showLiveSignal: boolean;
  reasons: string[];
  variant: string;
}

export const NO_ADAPTATION: CardAdaptation = {
  surfaceCta: null,
  hideAbout: false,
  hideTestimonials: false,
  compactMode: false,
  showLiveSignal: false,
  reasons: [],
  variant: "baseline",
};

function readVisitId(): string | null {
  // The capture redirect appends the signed attribution token as ?_av=...
  // and we mirror the visit_id into a cookie at /t/:slug. We can't read
  // HttpOnly cookies, so use the URL token query param if present.
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("_visit") || url.searchParams.get("visit");
  } catch {
    return null;
  }
}

export function useCardAdaptation(slug: string | undefined, active: boolean): CardAdaptation {
  const [adaptation, setAdaptation] = useState<CardAdaptation>(NO_ADAPTATION);

  useEffect(() => {
    if (!slug || !active) return;
    const visitId = readVisitId();
    const hour = new Date().getHours();
    const params = new URLSearchParams({ hour: String(hour) });
    if (visitId) params.set("visit", visitId);

    let cancelled = false;
    fetch(`/api/intelligence/cards/by-slug/${encodeURIComponent(slug)}/adaptation?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setAdaptation(data as CardAdaptation);
      })
      .catch(() => {
        // Silent fallback — adaptation is purely additive UX.
      });

    return () => {
      cancelled = true;
    };
  }, [slug, active]);

  return adaptation;
}
