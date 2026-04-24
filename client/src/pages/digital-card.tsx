import { AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import {
  CardLoading, CardNotFound, CardUnavailable, CardError,
  HeroSection, PrimaryActions, SaveShareBar, QRPanel,
  AboutSection, ServicesSection, TestimonialSection, LinksSection,
  SocialLinksSection, StickyActionBar, ShareModal, CardFooter, BackgroundGlow,
  HighIntentCta, LiveNowPill, BookingAutoExpand, RealtimeChannelStrip, FollowUpAcknowledgement,
  adaptPlatformCard, getCardTheme,
} from "@/components/card-core";
import type { SharedCardData, CardRenderConfig } from "@/components/card-core";
import { useCardAdaptation } from "@/hooks/useCardAdaptation";

type FetchState = "loading" | "success" | "not-found" | "unavailable" | "error";

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateVisitorId(): string {
  try {
    let v = localStorage.getItem("card_visitor_id");
    if (!v) {
      v = makeUuid();
      localStorage.setItem("card_visitor_id", v);
    }
    return v;
  } catch {
    return makeUuid();
  }
}

function newSessionId(): string {
  return makeUuid();
}

function useCardTracking(slug: string, active: boolean) {
  const sessionIdRef = useRef<string>("");
  const visitorIdRef = useRef<string>("");
  const startedAtRef = useRef<number>(Date.now());
  const maxScrollRef = useRef<number>(0);
  const milestonesRef = useRef<Set<number>>(new Set());
  const sessionStartedRef = useRef(false);

  const slugRef = useRef<string>("");
  if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
  if (!visitorIdRef.current) visitorIdRef.current = getOrCreateVisitorId();
  // If the slug changes mid-mount (e.g. client-side navigation between cards),
  // rotate the session so we don't reuse a sessionId across cards.
  if (slug && slugRef.current && slugRef.current !== slug) {
    sessionIdRef.current = newSessionId();
    sessionStartedRef.current = false;
    startedAtRef.current = Date.now();
    maxScrollRef.current = 0;
    milestonesRef.current = new Set();
  }
  if (slug) slugRef.current = slug;

  const sendEvent = useCallback((eventType: string, extras: Record<string, string | number> = {}) => {
    if (!active || !slug) return;
    const body = JSON.stringify({
      slug,
      sessionId: sessionIdRef.current,
      visitorId: visitorIdRef.current,
      eventType,
      referrer: document.referrer,
      ...extras,
    });
    try {
      if (eventType === "exit" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/track/event", blob);
        return;
      }
    } catch {}
    fetch("/api/track/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }, [active, slug]);

  const trackEvent = useCallback((eventType: string, eventTarget?: string) => {
    sendEvent(eventType, eventTarget ? { eventTarget } : {});
  }, [sendEvent]);

  useEffect(() => {
    if (!slug || !active || sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    startedAtRef.current = Date.now();
    fetch("/api/track/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        sessionId: sessionIdRef.current,
        visitorId: visitorIdRef.current,
        referrer: document.referrer,
      }),
      keepalive: true,
    }).catch(() => {});
    sendEvent("view");
  }, [slug, active, sendEvent]);

  useEffect(() => {
    if (!slug || !active) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const h = document.documentElement;
        const total = Math.max(1, h.scrollHeight - h.clientHeight);
        const pct = Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100)));
        if (pct > maxScrollRef.current) maxScrollRef.current = pct;
        for (const m of [25, 50, 75, 100]) {
          if (pct >= m && !milestonesRef.current.has(m)) {
            milestonesRef.current.add(m);
            sendEvent("scroll", { scrollDepth: m });
          }
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const onLeave = () => {
      const elapsed = Date.now() - startedAtRef.current;
      sendEvent("exit", { timeOnPage: elapsed, scrollDepth: maxScrollRef.current });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onLeave();
    };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [slug, active, sendEvent]);

  return trackEvent;
}

function TrackedSection({
  name, trackEvent, children,
}: { name: string; trackEvent: (eventType: string, eventTarget?: string) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seenRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !seenRef.current) {
          seenRef.current = true;
          trackEvent("section_view", name);
          obs.disconnect();
          break;
        }
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [name, trackEvent]);
  return <div ref={ref}>{children}</div>;
}

function applySeoMeta(card: SharedCardData) {
  const fallbackTitle = `${card.name || "Digital Card"}${card.title ? ` — ${card.title}` : ""}`;
  const title = card.seoTitle || fallbackTitle;
  const description = card.seoDescription || card.bio || card.tagline || `Connect with ${card.name || "us"}`;
  const image = card.ogImageUrl || card.coverImageUrl || card.photoUrl || "";
  const url = `${window.location.origin}/card/${card.slug}`;

  document.title = title;
  setMeta("description", description, false);
  setMeta("og:title", title, true);
  setMeta("og:description", description, true);
  setMeta("og:type", "profile", true);
  setMeta("og:url", url, true);
  if (image) setMeta("og:image", image, true);
  setMeta("twitter:card", image ? "summary_large_image" : "summary", false);
  setMeta("twitter:title", title, false);
  setMeta("twitter:description", description, false);
  if (image) setMeta("twitter:image", image, false);
}

function setMeta(key: string, value: string, isProperty: boolean) {
  if (!value) return;
  const attr = isProperty ? "property" : "name";
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

export default function DigitalCard() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug?.toLowerCase();
  const [card, setCard] = useState<SharedCardData | null>(null);
  const [state, setState] = useState<FetchState>("loading");
  const [showShare, setShowShare] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    if (!slug) { setState("not-found"); return; }
    fetch(`/api/public-card/${slug}`)
      .then(r => {
        if (r.status === 404) {
          return r.json().then(body => {
            if (body?.error === "Card not available") setState("unavailable");
            else setState("not-found");
          });
        }
        if (r.status === 403) { setState("unavailable"); return; }
        if (!r.ok) throw new Error("Request failed");
        return r.json().then(data => {
          const adapted = adaptPlatformCard(data);
          setCard(adapted);
          setState("success");
          applySeoMeta(adapted);
        });
      })
      .catch(() => setState("error"));
  }, [slug]);

  const trackEvent = useCardTracking(slug || "", state === "success");
  const adaptation = useCardAdaptation(slug, state === "success");
  const theme = getCardTheme(card?.theme);

  if (state === "loading") return <CardLoading />;
  if (state === "not-found") return <CardNotFound />;
  if (state === "unavailable") return <CardUnavailable />;
  if (state === "error") return <CardError />;
  if (!card) return <CardNotFound />;

  const cardUrl = `${window.location.origin}/card/${card.slug}`;
  const config: CardRenderConfig = {
    source: "platform",
    showBranding: true,
    cardUrl,
    trackEvent,
  };

  return (
    <div className={`min-h-screen ${theme.bg} relative`} data-testid="digital-card-page">
      <BackgroundGlow card={card} theme={theme} />

      <div className="relative z-10">
        <HeroSection card={card} theme={theme} />

        <div
          className={`px-5 max-w-[480px] mx-auto -mt-2 ${adaptation.compactMode ? "pb-20" : "pb-28"}`}
          data-adaptation-variant={adaptation.variant}
        >
          <LiveNowPill adaptation={adaptation} theme={theme} />
          <FollowUpAcknowledgement adaptation={adaptation} theme={theme} />
          <HighIntentCta card={card} theme={theme} adaptation={adaptation} trackEvent={trackEvent} />
          <BookingAutoExpand card={card} theme={theme} adaptation={adaptation} trackEvent={trackEvent} />
          <RealtimeChannelStrip card={card} theme={theme} adaptation={adaptation} trackEvent={trackEvent} />
          <PrimaryActions card={card} theme={theme} trackEvent={trackEvent} />
          <SaveShareBar card={card} theme={theme} config={config}
            onShare={() => { setShowShare(true); trackEvent("share"); }}
            onQR={() => { setShowQR(!showQR); trackEvent("qr_scan"); }} />
          <QRPanel cardUrl={cardUrl} theme={theme} visible={showQR} brandColor={card.brandColor} />
          {!adaptation.hideAbout && (
            <TrackedSection name="about" trackEvent={trackEvent}>
              <AboutSection card={card} theme={theme} />
            </TrackedSection>
          )}
          <TrackedSection name="services" trackEvent={trackEvent}>
            <ServicesSection card={card} theme={theme} />
          </TrackedSection>
          {!adaptation.hideTestimonials && (
            <TrackedSection name="testimonials" trackEvent={trackEvent}>
              <TestimonialSection card={card} theme={theme} />
            </TrackedSection>
          )}
          <TrackedSection name="links" trackEvent={trackEvent}>
            <LinksSection card={card} theme={theme} trackEvent={trackEvent} />
          </TrackedSection>
          <TrackedSection name="social" trackEvent={trackEvent}>
            <SocialLinksSection card={card} theme={theme} trackEvent={trackEvent} />
          </TrackedSection>
          <CardFooter config={config} theme={theme} />
        </div>
      </div>

      <StickyActionBar card={card} theme={theme} config={config}
        onShare={() => { setShowShare(true); trackEvent("share"); }} />

      <AnimatePresence>
        {showShare && <ShareModal card={card} theme={theme} config={config} onClose={() => setShowShare(false)} />}
      </AnimatePresence>
    </div>
  );
}
