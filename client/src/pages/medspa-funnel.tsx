import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Sparkle, Calendar, Star, Camera, Gift, Shield } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "medspa",
  industry: "Med Spas",
  headline: "Get Your Free",
  headlineAccent: "Medspa Growth Blueprint",
  subheadline: "Discover how AI-powered consultation booking, treatment showcases, and loyalty programs can fill your appointment book and boost revenue.",
  accentColor: "rose",
  benefits: [
    { icon: Calendar, text: "AI booking assistant for consultations and treatments" },
    { icon: Star, text: "Automated review requests that build your 5-star reputation" },
    { icon: Camera, text: "Before/after gallery pages that convert browsers to bookings" },
    { icon: Gift, text: "Loyalty & membership programs that increase lifetime value" },
    { icon: Sparkle, text: "Treatment-specific landing pages with AI chat" },
    { icon: Shield, text: "HIPAA-compliant client communication" },
  ],
  qualifyingQuestions: [
    { id: "services", label: "Primary Services Offered", type: "select", options: ["Injectables (Botox/Filler)", "Laser Treatments", "Body Contouring", "Facials & Peels", "IV Therapy", "Wellness/Weight Loss", "Full-Service Med Spa", "Other"], required: true },
    { id: "providers", label: "How many providers?", type: "radio", options: ["1-2", "3-5", "6-10", "10+"], required: true },
    { id: "monthlyRevenue", label: "Monthly revenue range?", type: "radio", options: ["Under $20K", "$20K-$50K", "$50K-$150K", "$150K+"], required: true },
    { id: "biggestChallenge", label: "Biggest growth challenge?", type: "select", options: ["Not enough new clients", "Low rebooking rate", "High competition", "No loyalty program", "Weak online presence", "All of the above"] },
  ],
  thankYouTitle: "Your Glow-Up Strategy Is Coming!",
  thankYouMessage: "Our medspa marketing specialist will prepare a custom growth blueprint tailored to your services and goals. Check your email for confirmation.",
};

export default function MedspaFunnel() {
  return <NicheFunnel config={config} />;
}
