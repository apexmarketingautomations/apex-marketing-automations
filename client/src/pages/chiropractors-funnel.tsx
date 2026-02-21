import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Activity, Phone, Calendar, Star, Heart, Users } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "chiropractors",
  industry: "Chiropractors",
  headline: "Get Your Free",
  headlineAccent: "Practice Growth Plan",
  subheadline: "See how AI-powered patient reactivation, booking automation, and wellness campaigns can keep your adjustment tables full every day.",
  accentColor: "emerald",
  benefits: [
    { icon: Phone, text: "AI receptionist books appointments and answers common questions" },
    { icon: Calendar, text: "Patient reactivation campaigns that bring back lapsed patients" },
    { icon: Star, text: "Automated Google review requests after every adjustment" },
    { icon: Heart, text: "Wellness content campaigns that position you as an authority" },
    { icon: Users, text: "Referral program automation that rewards loyal patients" },
    { icon: Activity, text: "Treatment plan reminders that improve compliance" },
  ],
  qualifyingQuestions: [
    { id: "practiceType", label: "Practice Type", type: "select", options: ["Solo Practice", "Multi-Doctor Practice", "Sports Chiropractic", "Pediatric/Family", "Functional Medicine + Chiro", "Integrated Wellness Center", "Other"], required: true },
    { id: "weeklyPatients", label: "Patient visits per week?", type: "radio", options: ["Under 50", "50-100", "100-200", "200+"], required: true },
    { id: "practiceAge", label: "How long has your practice been open?", type: "radio", options: ["Under 1 year", "1-3 years", "3-10 years", "10+ years"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["New patient acquisition", "Patient retention/reactivation", "Online reputation", "Missed calls", "No referral system", "All of the above"] },
  ],
  thankYouTitle: "Alignment Achieved!",
  thankYouMessage: "A chiropractic marketing specialist will review your practice and prepare a custom growth strategy. Check your email for confirmation details.",
};

export default function ChiropractorsFunnel() {
  return <NicheFunnel config={config} />;
}
