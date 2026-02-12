import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
  Loader2,
  Globe,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatWidget } from "@/components/chat-widget";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck, Clock, Sparkles, Star, Dumbbell, Heart, Zap, Trophy, CheckCircle2,
};

function HeroSection({ title, subtitle, cta, image, theme }: any) {
  return (
    <div
      className="py-20 px-6 md:px-12 flex flex-col items-center text-center relative overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div
        className="absolute inset-0 opacity-20 bg-cover bg-center z-0"
        style={{ backgroundImage: `url(${image})` }}
      />
      <div className="relative z-10 max-w-3xl space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-4xl md:text-6xl font-bold tracking-tight"
          style={{ fontFamily: theme.font }}
          data-testid="text-liquid-hero-title"
        >
          {title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="text-lg md:text-xl opacity-90"
        >
          {subtitle}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Button
            size="lg"
            className="mt-4 font-bold"
            style={{ backgroundColor: theme.primary, color: theme.bg }}
            data-testid="button-liquid-hero-cta"
          >
            {cta}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function FeatureSection({ title, features, theme }: any) {
  return (
    <div className="py-16 px-6 md:px-12 bg-white/5" style={{ color: theme.text }}>
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12" style={{ fontFamily: theme.font }}>
          {title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f: any, i: number) => {
            const IconComponent = ICON_MAP[f.icon] || Star;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                data-testid={`card-liquid-feature-${i}`}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                  style={{ backgroundColor: theme.primary + "20", color: theme.primary }}
                >
                  <IconComponent size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                <p className="text-sm opacity-70">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSection({ title, theme }: any) {
  return (
    <div className="py-20 px-6 text-center" style={{ backgroundColor: theme.bg, color: theme.text }}>
      <div className="max-w-md mx-auto p-8 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-sm">
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
        <div className="space-y-4">
          <Input placeholder="Full Name" className="bg-white/10 border-white/20" data-testid="input-liquid-name" />
          <Input placeholder="Email Address" className="bg-white/10 border-white/20" data-testid="input-liquid-email" />
          <Input placeholder="Phone Number" className="bg-white/10 border-white/20" data-testid="input-liquid-phone" />
          <Button
            className="w-full font-bold"
            style={{ backgroundColor: theme.primary, color: theme.bg }}
            data-testid="button-liquid-submit"
          >
            Check Availability
          </Button>
          <p className="text-xs opacity-50 mt-4">Powered by Apex Marketing Animation</p>
        </div>
      </div>
    </div>
  );
}

const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  HERO: HeroSection,
  FEATURES: FeatureSection,
  BOOKING: BookingSection,
};

function getVisitorContext() {
  const hour = new Date().getHours();
  let timeOfDay = "morning";
  if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
  else if (hour >= 17 && hour < 21) timeOfDay = "evening";
  else if (hour >= 21 || hour < 5) timeOfDay = "night";

  const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);

  const referrer = document.referrer;
  let source = "direct";
  if (referrer.includes("google")) source = "google";
  else if (referrer.includes("facebook") || referrer.includes("fb.")) source = "facebook";
  else if (referrer.includes("instagram")) source = "instagram";
  else if (referrer.includes("tiktok")) source = "tiktok";
  else if (referrer.includes("twitter") || referrer.includes("x.com")) source = "twitter";
  else if (referrer) source = "referral";

  return {
    device: isMobile ? "mobile" : "desktop",
    referrer: source,
    timeOfDay,
    hour,
    language: navigator.language || "en-US",
  };
}

export default function LiquidWebsite() {
  const [siteData, setSiteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<any>(null);

  useEffect(() => {
    const ctx = getVisitorContext();
    setContext(ctx);

    fetch("/api/generate-liquid-site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ctx),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to generate personalized site");
        return res.json();
      })
      .then((data) => {
        setSiteData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-6"
        >
          <div className="relative">
            <Globe className="h-16 w-16 text-indigo-500 animate-pulse" />
            <Loader2 className="h-8 w-8 text-indigo-400 animate-spin absolute -bottom-1 -right-1" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">Building your personalized experience...</p>
            <p className="text-sm text-neutral-400">AI is customizing this page just for you</p>
          </div>
          {context && (
            <div className="mt-4 text-xs text-neutral-500 bg-white/5 rounded-lg p-3 space-y-1" data-testid="text-liquid-context">
              <p>Device: {context.device}</p>
              <p>Time: {context.timeOfDay} ({context.hour}:00)</p>
              <p>Source: {context.referrer}</p>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{error}</p>
          <Button onClick={() => window.location.reload()} variant="outline" data-testid="button-liquid-retry">
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!siteData) return null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: siteData.theme?.bg || "#0a0a0a" }}>
      {siteData.sections?.map((section: any, i: number) => {
        const Component = COMPONENT_MAP[section.type];
        if (!Component) return null;
        return <Component key={i} {...section.props} theme={siteData.theme} />;
      })}

      <ChatWidget primaryColor={siteData.theme?.primary || "#D4AF37"} />
    </div>
  );
}
