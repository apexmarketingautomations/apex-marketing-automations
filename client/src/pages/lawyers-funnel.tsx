import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Scale, Phone, Bot, Globe, Clock, Shield } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "lawyers",
  industry: "Law Firms",
  headline: "Get Your Free",
  headlineAccent: "Case Growth Strategy",
  subheadline: "See exactly how AI-powered intake and automation can help your firm sign more cases, respond faster, and lower your cost per lead.",
  accentColor: "indigo",
  benefits: [
    { icon: Phone, text: "24/7 AI intake that qualifies leads & books consultations" },
    { icon: Bot, text: "AI chatbot trained on your specific practice areas" },
    { icon: Globe, text: "High-converting landing pages for every case type" },
    { icon: Clock, text: "Automated follow-up that nurtures leads until they sign" },
    { icon: Scale, text: "HIPAA-compliant with attorney-client privilege safeguards" },
    { icon: Shield, text: "Integrates with Clio, MyCase, and PracticePanther" },
  ],
  qualifyingQuestions: [
    { id: "practiceArea", label: "Primary Practice Area", type: "select", options: ["Personal Injury", "Family Law", "Criminal Defense", "Estate Planning", "Workers' Comp", "Immigration", "Business/Corporate", "Other"], required: true },
    { id: "firmSize", label: "How many attorneys in your firm?", type: "radio", options: ["Solo", "2-5", "6-15", "16+"], required: true },
    { id: "monthlyLeads", label: "How many leads do you get per month?", type: "radio", options: ["Under 20", "20-50", "50-100", "100+"], required: true },
    { id: "biggestChallenge", label: "What's your biggest growth challenge?", type: "select", options: ["Missed calls & slow response", "High cost per lead", "Poor lead quality", "No follow-up system", "Not enough cases", "All of the above"] },
  ],
  thankYouTitle: "You're All Set!",
  thankYouMessage: "Our legal marketing specialist will review your firm's profile and prepare a custom AI growth strategy before your call. Check your email for confirmation details.",
};

export default function LawyersFunnel() {
  return <NicheFunnel config={config} />;
}
