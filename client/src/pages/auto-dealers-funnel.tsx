import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Car, Phone, Bot, Globe, Target, DollarSign } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "auto-dealers",
  industry: "Auto Dealers",
  headline: "Get Your Free",
  headlineAccent: "Dealership Growth Strategy",
  subheadline: "See how AI-powered BDC agents, vehicle pages, and trade-in qualification can sell more cars while cutting your marketing costs.",
  accentColor: "red",
  benefits: [
    { icon: Phone, text: "AI BDC agent handles internet leads 24/7" },
    { icon: Bot, text: "AI chatbot qualifies buyers by budget, trade-in, and credit" },
    { icon: Globe, text: "Dynamic vehicle landing pages for every model" },
    { icon: Target, text: "Geo-targeted Facebook & Instagram ads for local buyers" },
    { icon: DollarSign, text: "Trade-in value estimator that captures lead info" },
    { icon: Car, text: "Integrates with your DMS and CRM systems" },
  ],
  qualifyingQuestions: [
    { id: "dealerType", label: "Dealership Type", type: "select", options: ["New Car Franchise", "Used Car Independent", "New & Used Combined", "Luxury/Exotic", "Commercial/Fleet", "Motorcycle/Powersports", "RV/Marine", "Other"], required: true },
    { id: "monthlyUnits", label: "Monthly unit sales?", type: "radio", options: ["Under 30", "30-75", "75-150", "150+"], required: true },
    { id: "bdcSize", label: "Current BDC team size?", type: "radio", options: ["No BDC", "1-3 reps", "4-8 reps", "8+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Slow lead response", "Low internet close rate", "High ad spend waste", "No follow-up system", "Staffing BDC", "All of the above"] },
  ],
  thankYouTitle: "Let's Drive Sales!",
  thankYouMessage: "Our automotive marketing specialist will analyze your dealership and prepare a custom AI growth strategy. Check your email for confirmation.",
};

export default function AutoDealersFunnel() {
  return <NicheFunnel config={config} />;
}
