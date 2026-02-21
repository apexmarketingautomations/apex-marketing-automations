import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Shield, Phone, FileText, Users, Clock, CheckCircle2 } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "insurance",
  industry: "Insurance Agencies",
  headline: "Get Your Free",
  headlineAccent: "Agency Growth Strategy",
  subheadline: "Discover how AI-powered quote assistance, policy renewal automation, and compliant messaging can grow your book of business faster.",
  accentColor: "blue",
  benefits: [
    { icon: Phone, text: "AI assistant answers policy questions and captures quote requests" },
    { icon: FileText, text: "Automated renewal reminders that reduce policy lapses" },
    { icon: Users, text: "Cross-sell campaigns based on current coverage gaps" },
    { icon: Clock, text: "Instant quote follow-up sequences that close faster" },
    { icon: Shield, text: "Compliance-safe messaging templates for all carriers" },
    { icon: CheckCircle2, text: "Integrates with AMS360, Hawksoft, and Applied Epic" },
  ],
  qualifyingQuestions: [
    { id: "agencyType", label: "Agency Type", type: "select", options: ["Independent Agency", "Captive Agency", "Brokerage", "MGA/MGU", "Virtual/Remote Agency", "Other"], required: true },
    { id: "linesOfBusiness", label: "Primary Lines of Business", type: "select", options: ["Personal Lines (Home/Auto)", "Commercial Lines", "Life & Health", "Benefits/Group", "Specialty/Surplus", "All Lines"], required: true },
    { id: "agencySize", label: "How many licensed agents?", type: "radio", options: ["Solo", "2-5", "6-15", "16+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Policy renewals falling off", "Not enough new leads", "Slow quoting process", "Cross-sell opportunities missed", "Compliance concerns", "All of the above"] },
  ],
  thankYouTitle: "Your Growth Plan Is On Its Way!",
  thankYouMessage: "An insurance marketing specialist will review your agency profile and prepare a tailored AI growth strategy. Watch your inbox for details.",
};

export default function InsuranceFunnel() {
  return <NicheFunnel config={config} />;
}
