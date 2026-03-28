import { AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import {
  CardLoading, CardNotFound, CardUnavailable, CardError,
  HeroSection, PrimaryActions, SaveShareBar, QRPanel,
  AboutSection, ServicesSection, TestimonialSection, LinksSection,
  SocialLinksSection, StickyActionBar, ShareModal, CardFooter, BackgroundGlow,
  adaptPlatformCard, getCardTheme,
} from "@/components/card-core";
import type { SharedCardData, CardRenderConfig } from "@/components/card-core";

type FetchState = "loading" | "success" | "not-found" | "unavailable" | "error";

function useCardAnalytics(slug: string, active: boolean) {
  const tracked = useRef(false);
  const trackEvent = useCallback((eventType: string, eventTarget?: string) => {
    if (!active) return;
    const visitorId = localStorage.getItem("card_visitor_id") || crypto.randomUUID();
    localStorage.setItem("card_visitor_id", visitorId);
    fetch(`/api/public-card/${slug}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        eventTarget,
        visitorId,
        userAgent: navigator.userAgent,
        referrer: document.referrer,
      }),
    }).catch(() => {});
  }, [slug, active]);

  useEffect(() => {
    if (!tracked.current && slug && active) {
      trackEvent("view");
      tracked.current = true;
    }
  }, [slug, active, trackEvent]);

  return trackEvent;
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
          setCard(adaptPlatformCard(data));
          setState("success");
        });
      })
      .catch(() => setState("error"));
  }, [slug]);

  const trackEvent = useCardAnalytics(slug || "", state === "success");
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

        <div className="px-5 max-w-[480px] mx-auto -mt-2 pb-28">
          <PrimaryActions card={card} theme={theme} trackEvent={trackEvent} />
          <SaveShareBar card={card} theme={theme} config={config}
            onShare={() => { setShowShare(true); trackEvent("share"); }}
            onQR={() => { setShowQR(!showQR); trackEvent("qr_scan"); }} />
          <QRPanel cardUrl={cardUrl} theme={theme} visible={showQR} brandColor={card.brandColor} />
          <AboutSection card={card} theme={theme} />
          <ServicesSection card={card} theme={theme} />
          <TestimonialSection card={card} theme={theme} />
          <LinksSection card={card} theme={theme} trackEvent={trackEvent} />
          <SocialLinksSection card={card} theme={theme} trackEvent={trackEvent} />
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
