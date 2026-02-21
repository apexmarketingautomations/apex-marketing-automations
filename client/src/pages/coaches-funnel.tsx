import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { GraduationCap, Calendar, Globe, Mail, Users, Zap } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "coaches",
  industry: "Coaches & Consultants",
  headline: "Get Your Free",
  headlineAccent: "Coaching Business Blueprint",
  subheadline: "Discover how AI-powered funnels, discovery call booking, and nurture sequences can help you sign more high-ticket clients with less effort.",
  accentColor: "purple",
  benefits: [
    { icon: Calendar, text: "AI discovery call booking that qualifies prospects first" },
    { icon: Globe, text: "High-converting funnel pages for your programs and offers" },
    { icon: Mail, text: "Automated nurture sequences that warm leads to buy" },
    { icon: Users, text: "Client onboarding flows that reduce churn" },
    { icon: Zap, text: "Webinar and challenge funnels with built-in follow-up" },
    { icon: GraduationCap, text: "Course launch campaigns with countdown urgency" },
  ],
  qualifyingQuestions: [
    { id: "coachType", label: "Type of Coaching/Consulting", type: "select", options: ["Business Coaching", "Life Coaching", "Health & Fitness", "Career/Executive", "Relationship", "Marketing/Sales", "Financial", "Mindset/Spiritual", "Other"], required: true },
    { id: "pricePoint", label: "Average program price?", type: "radio", options: ["Under $500", "$500-$2,000", "$2,000-$10,000", "$10,000+"], required: true },
    { id: "monthlyRevenue", label: "Current monthly revenue?", type: "radio", options: ["Under $5K", "$5K-$15K", "$15K-$50K", "$50K+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Not enough leads", "Low close rate on calls", "No nurture/follow-up", "Inconsistent revenue", "Can't scale past 1-on-1", "All of the above"] },
  ],
  thankYouTitle: "Level Up Incoming!",
  thankYouMessage: "Our coaching business strategist will review your business model and prepare a custom AI growth plan. Check your inbox for the details.",
};

export default function CoachesFunnel() {
  return <NicheFunnel config={config} />;
}
