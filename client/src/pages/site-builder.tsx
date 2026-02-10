import { useState } from "react";
import {
  Send,
  Smartphone,
  Monitor,
  RefreshCcw,
  Save,
  Loader2,
  LayoutTemplate,
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
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
        <h1
          className="text-4xl md:text-6xl font-bold tracking-tight"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h1>
        <p className="text-lg md:text-xl opacity-90">{subtitle}</p>
        <Button
          size="lg"
          className="mt-4 font-bold"
          style={{ backgroundColor: theme.primary, color: theme.bg }}
          data-testid="button-hero-cta"
        >
          {cta}
        </Button>
      </div>
    </div>
  );
}

function FeatureSection({ title, features, theme }: any) {
  return (
    <div
      className="py-16 px-6 md:px-12 bg-white/5"
      style={{ color: theme.text }}
    >
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-3xl font-bold text-center mb-12"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f: any, i: number) => {
            const IconComponent = ICON_MAP[f.icon] || Star;
            return (
              <div
                key={i}
                className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: theme.primary + "20",
                    color: theme.primary,
                  }}
                >
                  <IconComponent size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                <p className="text-sm opacity-70">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSection({ title, theme }: any) {
  return (
    <div
      className="py-20 px-6 text-center"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-md mx-auto p-8 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-sm">
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
        <div className="space-y-4">
          <Input
            placeholder="Full Name"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-name"
          />
          <Input
            placeholder="Email Address"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-email"
          />
          <Button
            className="w-full font-bold"
            style={{ backgroundColor: theme.primary, color: theme.bg }}
            data-testid="button-preview-submit"
          >
            Check Availability
          </Button>
          <p className="text-xs opacity-50 mt-4">Powered by Nexus AI</p>
        </div>
      </div>
    </div>
  );
}

const TEMPLATES: Record<string, any> = {
  luxe: {
    theme: {
      primary: "#D4AF37",
      bg: "#0a0a0a",
      text: "#ffffff",
      font: "Playfair Display",
    },
    sections: [
      {
        type: "HERO",
        props: {
          title: "Timeless Elegance.",
          subtitle:
            "Luxury aesthetic treatments for the modern individual.",
          cta: "Book Consultation",
          image:
            "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?q=80&w=2070&auto=format&fit=crop",
        },
      },
      {
        type: "FEATURES",
        props: {
          title: "Why Choose Luxe?",
          features: [
            {
              icon: "ShieldCheck",
              title: "Board Certified",
              desc: "Treatments performed by MDs only.",
            },
            {
              icon: "Clock",
              title: "Zero Downtime",
              desc: "Lunch break procedures available.",
            },
            {
              icon: "Sparkles",
              title: "Premium Products",
              desc: "Only FDA-approved fillers used.",
            },
          ],
        },
      },
      {
        type: "BOOKING",
        props: {
          title: "Secure Your Exclusive Offer",
          formId: "form_luxe",
        },
      },
    ],
  },
  gym: {
    theme: {
      primary: "#ef4444",
      bg: "#0a0a0a",
      text: "#ffffff",
      font: "Inter",
    },
    sections: [
      {
        type: "HERO",
        props: {
          title: "Transform Your Body.",
          subtitle:
            "Join the 6-week challenge that has helped 1,000+ members reach their goals.",
          cta: "Start Free Trial",
          image:
            "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2070&auto=format&fit=crop",
        },
      },
      {
        type: "FEATURES",
        props: {
          title: "Why Train With Us?",
          features: [
            {
              icon: "Dumbbell",
              title: "Expert Trainers",
              desc: "Certified personal trainers for every session.",
            },
            {
              icon: "Zap",
              title: "High Intensity",
              desc: "Maximum results in minimum time.",
            },
            {
              icon: "Trophy",
              title: "Proven Results",
              desc: "94% of members hit their goals.",
            },
          ],
        },
      },
      {
        type: "BOOKING",
        props: {
          title: "Claim Your Free Trial",
          formId: "form_gym",
        },
      },
    ],
  },
  dental: {
    theme: {
      primary: "#3b82f6",
      bg: "#0f172a",
      text: "#ffffff",
      font: "Inter",
    },
    sections: [
      {
        type: "HERO",
        props: {
          title: "Your Perfect Smile Awaits.",
          subtitle:
            "Gentle, modern dentistry for the whole family. New patient specials available.",
          cta: "Book Appointment",
          image:
            "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?q=80&w=2070&auto=format&fit=crop",
        },
      },
      {
        type: "FEATURES",
        props: {
          title: "Modern Care You Can Trust",
          features: [
            {
              icon: "Heart",
              title: "Gentle Approach",
              desc: "Pain-free treatments with sedation options.",
            },
            {
              icon: "ShieldCheck",
              title: "Licensed Professionals",
              desc: "Board-certified dentists and hygienists.",
            },
            {
              icon: "Clock",
              title: "Same Day Service",
              desc: "Emergency appointments available daily.",
            },
          ],
        },
      },
      {
        type: "BOOKING",
        props: {
          title: "Schedule Your Visit",
          formId: "form_dental",
        },
      },
    ],
  },
};

function generateSiteFromPrompt(prompt: string): any {
  const lower = prompt.toLowerCase();

  if (lower.includes("gym") || lower.includes("fitness") || lower.includes("workout")) {
    return TEMPLATES.gym;
  }
  if (lower.includes("dent") || lower.includes("smile") || lower.includes("clinic")) {
    return TEMPLATES.dental;
  }

  const customTheme = {
    primary: "#D4AF37",
    bg: "#0a0a0a",
    text: "#ffffff",
    font: "Playfair Display",
  };

  if (lower.includes("red")) customTheme.primary = "#ef4444";
  if (lower.includes("blue")) customTheme.primary = "#3b82f6";
  if (lower.includes("green")) customTheme.primary = "#22c55e";
  if (lower.includes("purple")) customTheme.primary = "#a855f7";
  if (lower.includes("pink")) customTheme.primary = "#ec4899";

  const title = lower.includes("gym")
    ? "Transform Your Body."
    : lower.includes("spa") || lower.includes("luxe") || lower.includes("med")
    ? "Timeless Elegance."
    : "Welcome to Your Business.";

  return {
    theme: customTheme,
    sections: [
      {
        type: "HERO",
        props: {
          title,
          subtitle: "Premium services tailored for you. Book today and experience the difference.",
          cta: "Get Started",
          image:
            "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?q=80&w=2070&auto=format&fit=crop",
        },
      },
      {
        type: "FEATURES",
        props: {
          title: "Why Choose Us?",
          features: [
            { icon: "Star", title: "Top Rated", desc: "5-star reviews from hundreds of clients." },
            { icon: "Clock", title: "Fast Service", desc: "Quick and efficient — respect your time." },
            { icon: "ShieldCheck", title: "Trusted", desc: "Licensed, insured, and certified." },
          ],
        },
      },
      {
        type: "BOOKING",
        props: {
          title: "Book Your Appointment",
          formId: "form_custom",
        },
      },
    ],
  };
}

export default function SiteBuilder() {
  const [prompt, setPrompt] = useState("");
  const [siteData, setSiteData] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const [history, setHistory] = useState<string[]>([]);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setHistory((prev) => [...prev, prompt]);

    await new Promise((r) => setTimeout(r, 1800));
    const data = generateSiteFromPrompt(prompt);
    setSiteData(data);
    setIsGenerating(false);
    setPrompt("");
  };

  const handlePublish = () => {
    toast({
      title: "Site Published!",
      description: "Your landing page is now live.",
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col md:flex-row font-sans overflow-hidden">
      <div className="w-full md:w-[400px] border-r border-white/10 flex flex-col bg-neutral-900 z-10 h-screen md:h-auto md:min-h-screen">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <LayoutTemplate className="text-indigo-500" />
            Site Builder
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Describe your business, get a landing page.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 && (
            <div className="text-center text-neutral-500 mt-10 text-sm p-4 border border-dashed border-white/10 rounded-xl">
              <p className="mb-3">Try prompts like:</p>
              <ul className="space-y-2 text-indigo-400">
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Gym landing page, aggressive red/black theme"
                      )
                    }
                    data-testid="button-prompt-gym"
                  >
                    "Gym landing page, aggressive style"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Luxury med spa funnel, gold and black theme"
                      )
                    }
                    data-testid="button-prompt-luxe"
                  >
                    "Luxury med spa, gold & black"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Dentist funnel, clean blue/white, friendly"
                      )
                    }
                    data-testid="button-prompt-dental"
                  >
                    "Dentist funnel, clean & friendly"
                  </button>
                </li>
              </ul>
            </div>
          )}
          {history.map((h, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 p-3 rounded-lg text-sm border border-white/5"
            >
              <span className="opacity-50 text-xs block mb-1">YOU</span>
              {h}
            </motion.div>
          ))}
          {isGenerating && (
            <div className="flex items-center gap-2 text-indigo-400 text-sm animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating layout & copy...
            </div>
          )}
          {siteData && !isGenerating && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-500/10 p-3 rounded-lg text-sm border border-indigo-500/20"
            >
              <span className="opacity-50 text-xs block mb-1">AI</span>
              <div className="flex items-center gap-2 text-indigo-300">
                <CheckCircle2 className="h-4 w-4" />
                Site generated with {siteData.sections.length} sections.
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Theme: {siteData.theme.font} /{" "}
                <span
                  className="inline-block w-3 h-3 rounded-full align-middle"
                  style={{ backgroundColor: siteData.theme.primary }}
                />{" "}
                {siteData.theme.primary}
              </p>
            </motion.div>
          )}
        </div>

        <div className="p-4 bg-neutral-950 border-t border-white/10">
          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the website..."
              className="bg-white/5 border-white/10 focus:border-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              data-testid="input-prompt"
            />
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="bg-indigo-600 hover:bg-indigo-700"
              data-testid="button-generate"
            >
              <Send size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-neutral-950 relative flex flex-col">
        <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-neutral-900">
          <div className="flex items-center gap-2 bg-neutral-800 p-1 rounded-lg">
            <button
              onClick={() => setViewMode("desktop")}
              className={`p-2 rounded transition-colors ${
                viewMode === "desktop"
                  ? "bg-indigo-600 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
              data-testid="button-view-desktop"
            >
              <Monitor size={16} />
            </button>
            <button
              onClick={() => setViewMode("mobile")}
              className={`p-2 rounded transition-colors ${
                viewMode === "mobile"
                  ? "bg-indigo-600 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
              data-testid="button-view-mobile"
            >
              <Smartphone size={16} />
            </button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5"
              onClick={handleGenerate}
              disabled={!prompt.trim() && history.length === 0}
              data-testid="button-regenerate"
            >
              <RefreshCcw size={14} className="mr-2" /> Regenerate
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handlePublish}
              disabled={!siteData}
              data-testid="button-publish"
            >
              <Save size={14} className="mr-2" /> Publish
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 flex justify-center items-start bg-neutral-950/50">
          {siteData ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className={`bg-white shadow-2xl overflow-hidden transition-all duration-500 ease-in-out ${
                viewMode === "mobile"
                  ? "w-[375px] rounded-[30px] border-[8px] border-neutral-800"
                  : "w-full max-w-5xl rounded-lg"
              }`}
              style={{ minHeight: "800px" }}
              data-testid="preview-canvas"
            >
              {siteData.sections.map((section: any, i: number) => {
                const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
                  HERO: HeroSection,
                  FEATURES: FeatureSection,
                  BOOKING: BookingSection,
                };
                const Component = COMPONENT_MAP[section.type];
                if (!Component) return null;
                const props = { ...section.props, theme: siteData.theme };
                return <Component key={i} {...props} />;
              })}
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center text-neutral-600 space-y-4 mt-32">
              <LayoutTemplate size={64} className="opacity-20" />
              <p className="text-lg">Enter a prompt to generate a preview</p>
              <p className="text-sm text-neutral-500">
                Describe your business type, style, and color preferences
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
