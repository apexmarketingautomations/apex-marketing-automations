import { adaptPlatformCard } from "./adapters";
import { getCardTheme } from "./themes";
import {
  HeroSection,
  PrimaryActions,
  SaveShareBar,
  QRPanel,
  AboutSection,
  ServicesSection,
  TestimonialSection,
  LinksSection,
  SocialLinksSection,
  CardFooter,
  BackgroundGlow,
} from "./components";
import type { CardRenderConfig } from "./types";

interface BuilderPreviewProps {
  config: any;
  previewMode?: "mobile" | "desktop";
}

const noop = () => {};

export function BuilderPreview({ config, previewMode = "mobile" }: BuilderPreviewProps) {
  const card = adaptPlatformCard(config);
  const theme = getCardTheme(card.theme);
  const cardUrl = card.slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/card/${card.slug}`
    : "https://example.com/card/preview";

  const renderConfig: CardRenderConfig = {
    source: "platform",
    showBranding: true,
    cardUrl,
    trackEvent: noop,
  };

  const containerWidth = previewMode === "mobile" ? "max-w-[420px]" : "max-w-[640px]";

  return (
    <div
      className={`${containerWidth} mx-auto ${theme.bg} relative overflow-hidden rounded-xl`}
      data-testid="builder-preview"
      data-theme={card.theme}
    >
      <BackgroundGlow card={card} theme={theme} />

      <div className="relative z-10">
        <HeroSection card={card} theme={theme} />

        <div className="px-5 max-w-[480px] mx-auto -mt-2 pb-8">
          <PrimaryActions card={card} theme={theme} trackEvent={noop} />
          <SaveShareBar
            card={card}
            theme={theme}
            config={renderConfig}
            onShare={noop}
            onQR={noop}
          />
          <QRPanel cardUrl={cardUrl} theme={theme} visible={false} brandColor={card.brandColor} />
          <AboutSection card={card} theme={theme} />
          <ServicesSection card={card} theme={theme} />
          <TestimonialSection card={card} theme={theme} />
          <LinksSection card={card} theme={theme} trackEvent={noop} />
          <SocialLinksSection card={card} theme={theme} trackEvent={noop} />
          <CardFooter config={renderConfig} theme={theme} />
        </div>
      </div>
    </div>
  );
}
