import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Gem, Calendar, Star, Gift, Crown, Sparkles } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "luxe",
  industry: "Luxury & Beauty",
  headline: "Get Your Free",
  headlineAccent: "Premium Growth Strategy",
  subheadline: "See how AI-powered VIP booking, luxury campaigns, and reputation management can elevate your brand and attract high-value clients.",
  accentColor: "purple",
  benefits: [
    { icon: Calendar, text: "VIP booking system with priority scheduling" },
    { icon: Star, text: "Reputation management for a flawless 5-star image" },
    { icon: Gift, text: "Loyalty and membership programs for VIP clients" },
    { icon: Crown, text: "Premium brand landing pages that exude luxury" },
    { icon: Sparkles, text: "New treatment launch campaigns with exclusivity" },
    { icon: Gem, text: "High-end referral programs for your best clients" },
  ],
  qualifyingQuestions: [
    { id: "businessType", label: "Business Type", type: "select", options: ["High-End Salon", "Luxury Spa", "Beauty Bar", "Wellness Retreat", "Cosmetic Clinic", "Nail Studio", "Barbershop (Premium)", "Multi-Location Brand", "Other"], required: true },
    { id: "avgTicket", label: "Average client spend per visit?", type: "radio", options: ["Under $100", "$100-$250", "$250-$500", "$500+"], required: true },
    { id: "clientBase", label: "Active client base?", type: "radio", options: ["Under 100", "100-300", "300-700", "700+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Attracting high-value clients", "Low rebooking rate", "Brand perception", "No loyalty program", "Staff retention", "All of the above"] },
  ],
  thankYouTitle: "Luxe Growth Awaits!",
  thankYouMessage: "Our luxury brand strategist will review your business and prepare a bespoke growth plan. Check your email for confirmation.",
};

export default function LuxeFunnel() {
  return <NicheFunnel config={config} />;
}
