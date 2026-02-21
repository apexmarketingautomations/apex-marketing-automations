import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Megaphone, Users, Globe, BarChart3, Zap, Layers } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "marketers",
  industry: "Marketing Agencies",
  headline: "Get Your Free",
  headlineAccent: "Agency Scaling Blueprint",
  subheadline: "Discover how white-label AI CRM, client dashboards, and campaign automation can help you scale your agency while reducing overhead.",
  accentColor: "cyan",
  benefits: [
    { icon: Layers, text: "White-label CRM you can brand as your own" },
    { icon: Users, text: "Client portal with metrics, messages, and reports" },
    { icon: Globe, text: "AI site builder to launch client websites in minutes" },
    { icon: BarChart3, text: "Agency dashboard showing all clients at a glance" },
    { icon: Zap, text: "Workflow automation that replaces manual tasks" },
    { icon: Megaphone, text: "Ad campaign launcher across Meta and Google" },
  ],
  qualifyingQuestions: [
    { id: "agencyType", label: "Agency Focus", type: "select", options: ["Full-Service Digital", "Social Media Marketing", "SEO/Content", "PPC/Paid Media", "Branding/Creative", "Web Design/Dev", "PR/Communications", "Niche-Specific", "Other"], required: true },
    { id: "clientCount", label: "Active client count?", type: "radio", options: ["Under 5", "5-15", "15-30", "30+"], required: true },
    { id: "monthlyRevenue", label: "Monthly recurring revenue?", type: "radio", options: ["Under $10K", "$10K-$30K", "$30K-$100K", "$100K+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Client churn", "Manual work doesn't scale", "No white-label tools", "Inconsistent results", "Can't show ROI", "All of the above"] },
  ],
  thankYouTitle: "Scale Mode Activated!",
  thankYouMessage: "An agency growth strategist will review your business model and prepare a custom scaling plan. Check your email for session details.",
};

export default function MarketersFunnel() {
  return <NicheFunnel config={config} />;
}
