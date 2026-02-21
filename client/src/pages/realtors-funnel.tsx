import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Home, Phone, Globe, Target, Users, BarChart3 } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "realtors",
  industry: "Real Estate",
  headline: "Get Your Free",
  headlineAccent: "Real Estate Growth Strategy",
  subheadline: "See how AI-powered listing promotion, buyer qualification, and automated follow-up can help you close more deals with less hustle.",
  accentColor: "blue",
  benefits: [
    { icon: Phone, text: "AI assistant qualifies buyer and seller leads 24/7" },
    { icon: Globe, text: "AI-generated listing landing pages that capture leads" },
    { icon: Target, text: "Geo-targeted social ads for open houses and listings" },
    { icon: Users, text: "Automated drip campaigns for your sphere of influence" },
    { icon: BarChart3, text: "Pipeline dashboard showing deals from lead to close" },
    { icon: Home, text: "Neighborhood market report pages that attract sellers" },
  ],
  qualifyingQuestions: [
    { id: "role", label: "Your Role", type: "select", options: ["Solo Agent", "Team Leader", "Brokerage Owner", "ISA/Admin", "New Agent (Under 1 year)", "Other"], required: true },
    { id: "transactions", label: "Transactions closed last 12 months?", type: "radio", options: ["Under 10", "10-25", "25-50", "50+"], required: true },
    { id: "leadSource", label: "Primary lead source?", type: "radio", options: ["Zillow/Realtor.com", "Social Media", "Referrals", "Open Houses", "No consistent source"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Not enough leads", "Leads don't convert", "No follow-up system", "Inconsistent marketing", "Can't scale past solo", "All of the above"] },
  ],
  thankYouTitle: "Under Contract for Growth!",
  thankYouMessage: "A real estate marketing specialist will review your business and prepare a custom AI strategy. Check your email for session details.",
};

export default function RealtorsFunnel() {
  return <NicheFunnel config={config} />;
}
