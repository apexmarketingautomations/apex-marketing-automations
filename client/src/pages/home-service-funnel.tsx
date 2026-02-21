import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Home, Phone, Star, FileText, Target, Wrench } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "home-services",
  industry: "Home Services",
  headline: "Get Your Free",
  headlineAccent: "Contractor Growth Strategy",
  subheadline: "See how AI-powered lead capture, estimate automation, and review management can fill your calendar with quality jobs year-round.",
  accentColor: "emerald",
  benefits: [
    { icon: Phone, text: "AI answering service captures leads even when you're on a job" },
    { icon: FileText, text: "Automated estimate follow-ups that close more bids" },
    { icon: Star, text: "Review automation that builds your 5-star reputation" },
    { icon: Target, text: "Local service ads targeting homeowners in your area" },
    { icon: Wrench, text: "Service-specific landing pages for every trade" },
    { icon: Home, text: "Seasonal maintenance campaigns that drive repeat business" },
  ],
  qualifyingQuestions: [
    { id: "tradeType", label: "Type of Home Service", type: "select", options: ["HVAC", "Plumbing", "Electrical", "Roofing", "General Contractor", "Landscaping", "Pest Control", "Cleaning", "Painting", "Other"], required: true },
    { id: "monthlyJobs", label: "Jobs completed per month?", type: "radio", options: ["Under 10", "10-30", "30-75", "75+"], required: true },
    { id: "teamSize", label: "Team size (including you)?", type: "radio", options: ["Just me", "2-5", "6-15", "16+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Not enough leads", "Missed calls on job sites", "Low review count", "Estimates that don't close", "Seasonal slowdowns", "All of the above"] },
  ],
  thankYouTitle: "Let's Build Something Great!",
  thankYouMessage: "A home services marketing specialist will review your business and prepare a custom growth plan. Check your email for confirmation.",
};

export default function HomeServiceFunnel() {
  return <NicheFunnel config={config} />;
}
