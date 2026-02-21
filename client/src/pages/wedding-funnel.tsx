import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Heart, Calendar, MessageSquare, Star, FileText, Users } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "wedding",
  industry: "Wedding & Events",
  headline: "Get Your Free",
  headlineAccent: "Event Business Growth Plan",
  subheadline: "Discover how AI-powered inquiry response, timeline management, and vendor coordination can help you book more weddings and events.",
  accentColor: "rose",
  benefits: [
    { icon: MessageSquare, text: "AI auto-reply to wedding inquiries within seconds" },
    { icon: Calendar, text: "Timeline and planning tools with automated reminders" },
    { icon: Star, text: "Automated review requests from happy couples" },
    { icon: FileText, text: "Proposal and contract automation for faster booking" },
    { icon: Users, text: "Vendor coordination tools with shared timelines" },
    { icon: Heart, text: "Referral campaigns that turn couples into brand advocates" },
  ],
  qualifyingQuestions: [
    { id: "businessType", label: "Business Type", type: "select", options: ["Wedding Planner", "Event Planner", "Wedding Venue", "Florist", "DJ/Entertainment", "Catering", "Videographer", "Decor/Rentals", "Other"], required: true },
    { id: "eventsPerYear", label: "Events booked per year?", type: "radio", options: ["Under 10", "10-25", "25-50", "50+"], required: true },
    { id: "averagePrice", label: "Average booking value?", type: "radio", options: ["Under $2,000", "$2,000-$5,000", "$5,000-$15,000", "$15,000+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Not enough inquiries", "Low booking conversion", "Slow response time", "No referral system", "Off-season gaps", "All of the above"] },
  ],
  thankYouTitle: "Say 'I Do' to Growth!",
  thankYouMessage: "Our wedding & events marketing specialist will prepare a custom growth plan for your business. Check your email for your session details.",
};

export default function WeddingFunnel() {
  return <NicheFunnel config={config} />;
}
