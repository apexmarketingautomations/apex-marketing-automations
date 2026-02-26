import { useState } from "react";
import { Star, Clock, Shield, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SalesChatbot } from "@/components/sales-chatbot";
import { Link } from "wouter";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Star,
  Clock,
  Shield,
};

function HeroSplit({
  headline,
  subheadline,
  cta_text,
}: {
  headline: string;
  subheadline: string;
  cta_text: string;
  image_prompt?: string;
}) {
  return (
    <div className="min-h-screen flex items-center relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-30"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?q=80&w=2070&auto=format&fit=crop')`,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/60" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
        <div
          className="space-y-8"
        >
          <div className="inline-block px-4 py-1.5 border border-[#D4AF37]/30 rounded-full text-xs tracking-[0.3em] uppercase text-[#D4AF37]">
            Limited Time Offer
          </div>
          <h1
            className="text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {headline}
          </h1>
          <p className="text-xl text-gray-300 max-w-lg leading-relaxed">
            {subheadline}
          </p>
          <Button
            size="lg"
            className="bg-[#D4AF37] hover:bg-[#C4A030] text-black border-0 text-lg px-10 py-7 rounded-none font-semibold tracking-wider uppercase"
            data-testid="button-claim-voucher"
          >
            {cta_text}
          </Button>
          <div className="flex items-center gap-6 text-sm text-gray-400 pt-4">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#D4AF37]" />
              <span>No commitment</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#D4AF37]" />
              <span>FDA approved</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#D4AF37]" />
              <span>Free consultation</span>
            </div>
          </div>
        </div>

        <div
          className="hidden lg:block"
        >
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-[#D4AF37]/20 to-transparent rounded-2xl blur-xl" />
            <img
              src="https://images.unsplash.com/photo-1629909613654-28e377c37b09?q=80&w=800&auto=format&fit=crop"
              alt="Luxury spa treatment"
              className="relative rounded-2xl shadow-2xl border border-white/10 w-full aspect-[4/5] object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Features3Col({
  title,
  features,
}: {
  title: string;
  features: { icon: string; title: string; text: string }[];
}) {
  return (
    <div className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {title}
          </h2>
          <div className="w-24 h-0.5 bg-[#D4AF37] mx-auto" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, idx) => {
            const IconComp = ICON_MAP[feature.icon] || Star;
            return (
              <div
                key={idx}
              >
                <Card className="bg-zinc-900/50 border-zinc-800 hover:border-[#D4AF37]/30 transition-colors duration-300 h-full">
                  <CardContent className="p-8 text-center space-y-4">
                    <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] mx-auto">
                      <IconComp className="h-7 w-7" />
                    </div>
                    <h3 className="text-xl font-semibold text-white">
                      {feature.title}
                    </h3>
                    <p className="text-gray-400 leading-relaxed">
                      {feature.text}
                    </p>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingForm({
  form_id,
  title,
}: {
  form_id: string;
  title: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="py-24 px-6" id={form_id}>
      <div className="max-w-lg mx-auto">
        <div>
          <Card className="bg-zinc-900/80 border-zinc-800 shadow-2xl">
            <CardContent className="p-10 space-y-8">
              <div className="text-center space-y-3">
                <h2
                  className="text-3xl font-bold text-white"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {title}
                </h2>
                <p className="text-gray-400">
                  Lock in $12/unit for your first Botox treatment.
                </p>
              </div>

              {submitted ? (
                <div
                  className="text-center py-8 space-y-4"
                >
                  <div className="h-16 w-16 bg-[#D4AF37] rounded-full flex items-center justify-center mx-auto">
                    <Check className="h-8 w-8 text-black" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">
                    You're In!
                  </h3>
                  <p className="text-gray-400">
                    Our team will reach out shortly to confirm your appointment.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">
                      Full Name
                    </label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 h-12"
                      data-testid="input-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">
                      Phone Number
                    </label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 h-12"
                      data-testid="input-phone"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || !name.trim() || !phone.trim()}
                    className="w-full bg-[#D4AF37] hover:bg-[#C4A030] text-black border-0 py-6 rounded-none font-semibold tracking-wider uppercase text-base"
                    data-testid="button-submit-booking"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      "Claim Your Voucher"
                    )}
                  </Button>
                  <p className="text-xs text-center text-zinc-500">
                    By submitting, you agree to receive SMS updates.
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  HERO_SPLIT: HeroSplit,
  FEATURES_3_COL: Features3Col,
  BOOKING_FORM: BookingForm,
};

const SITE_DATA = {
  site_config: {
    title: "Luxe Med Spa - Botox Special",
    theme: {
      primary_color: "#D4AF37",
      bg_color: "#000000",
      font: "Playfair Display",
    },
  },
  sections: [
    {
      type: "HERO_SPLIT",
      props: {
        headline: "Reclaim Your Youth.",
        subheadline:
          "Premium Botox treatments starting at just $12/unit.",
        cta_text: "Claim Voucher",
        image_prompt:
          "luxury spa waiting room, gold accents, 4k photorealistic",
      },
    },
    {
      type: "FEATURES_3_COL",
      props: {
        title: "Why Choose Luxe?",
        features: [
          {
            icon: "Star",
            title: "Expert Injectors",
            text: "Certified MDs only.",
          },
          {
            icon: "Clock",
            title: "15 Min Procedure",
            text: "In and out on your lunch break.",
          },
          {
            icon: "Shield",
            title: "FDA Approved",
            text: "Only genuine Allergan products.",
          },
        ],
      },
    },
    {
      type: "BOOKING_FORM",
      props: {
        form_id: "botox_offer_form",
        title: "Secure Your Price",
      },
    },
  ],
};

export default function LuxeLanding() {
  return (
    <div
      className="min-h-screen text-white font-sans selection:bg-[#D4AF37] selection:text-black"
      style={{
        backgroundColor: SITE_DATA.site_config.theme.bg_color,
        fontFamily: `'${SITE_DATA.site_config.theme.font}', serif`,
        ["--primary" as any]: SITE_DATA.site_config.theme.primary_color,
      }}
    >
      <nav className="absolute top-0 w-full z-50 p-6 flex justify-between items-center">
        <div
          className="font-bold text-2xl tracking-tight text-[#D4AF37]"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          LUXE.
        </div>
        <div className="flex gap-6 text-sm font-medium tracking-wider text-zinc-400">
          <Link href="/" className="hover:text-white transition-colors">
            Dashboard
          </Link>
          <a href="#botox_offer_form" className="text-[#D4AF37] hover:text-[#E4BF47] transition-colors">
            Book Now
          </a>
        </div>
      </nav>

      {SITE_DATA.sections.map((section, idx) => {
        const Component = COMPONENT_MAP[section.type];
        if (!Component) return null;
        return (
          <section key={idx}>
            <Component {...section.props} />
          </section>
        );
      })}

      <footer className="bg-black py-12 border-t border-zinc-900 text-center text-zinc-600 text-sm">
        <p>&copy; 2026 LUXE MED SPA. ALL RIGHTS RESERVED.</p>
      </footer>
      <SalesChatbot niche="luxe" accentColor="#D4AF37" />
    </div>
  );
}
