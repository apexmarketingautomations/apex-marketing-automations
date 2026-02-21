import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Camera, Calendar, Globe, Star, Users, Image } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "photography",
  industry: "Photographers",
  headline: "Get Your Free",
  headlineAccent: "Photography Business Blueprint",
  subheadline: "See how AI-powered booking management, portfolio pages, and referral campaigns can fill your calendar with dream clients year-round.",
  accentColor: "pink",
  benefits: [
    { icon: Calendar, text: "Automated inquiry response and session booking" },
    { icon: Globe, text: "Stunning portfolio landing pages that convert visitors" },
    { icon: Star, text: "Review requests that build your 5-star reputation" },
    { icon: Users, text: "Referral campaigns that turn clients into ambassadors" },
    { icon: Image, text: "Gallery delivery pages with upsell opportunities" },
    { icon: Camera, text: "Seasonal mini-session campaigns that fill your calendar" },
  ],
  qualifyingQuestions: [
    { id: "specialty", label: "Photography Specialty", type: "select", options: ["Wedding", "Portrait/Family", "Newborn/Maternity", "Commercial/Product", "Real Estate", "Event", "Boudoir", "Sports", "Other"], required: true },
    { id: "bookingsPerMonth", label: "Sessions booked per month?", type: "radio", options: ["Under 5", "5-15", "15-30", "30+"], required: true },
    { id: "averageInvestment", label: "Average client investment?", type: "radio", options: ["Under $300", "$300-$1,000", "$1,000-$3,000", "$3,000+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Not enough inquiries", "Slow off-season", "Low booking conversion", "No referral system", "Competing on price", "All of the above"] },
  ],
  thankYouTitle: "Picture Perfect!",
  thankYouMessage: "A photography marketing specialist will review your brand and prepare a custom growth strategy. Check your email for confirmation details.",
};

export default function PhotographyFunnel() {
  return <NicheFunnel config={config} />;
}
