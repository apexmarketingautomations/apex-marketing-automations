import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Stethoscope, Phone, Calendar, Star, MessageSquare, Shield } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "dentists",
  industry: "Dental Practices",
  headline: "Get Your Free",
  headlineAccent: "Patient Growth Strategy",
  subheadline: "See how AI-powered patient recall, appointment booking, and review automation can keep your chairs full and your practice growing.",
  accentColor: "sky",
  benefits: [
    { icon: Phone, text: "AI receptionist answers calls and books appointments 24/7" },
    { icon: Calendar, text: "Automated recall reminders reduce lapsed patients by 60%" },
    { icon: Star, text: "Automated Google review requests after every visit" },
    { icon: MessageSquare, text: "SMS campaigns for cleanings, whitening, and new patient specials" },
    { icon: Stethoscope, text: "Insurance FAQ chatbot that answers patient questions instantly" },
    { icon: Shield, text: "HIPAA-compliant messaging and data storage" },
  ],
  qualifyingQuestions: [
    { id: "practiceType", label: "Type of Practice", type: "select", options: ["General Dentistry", "Cosmetic Dentistry", "Orthodontics", "Pediatric Dentistry", "Oral Surgery", "Periodontics", "Multi-Specialty", "Other"], required: true },
    { id: "providers", label: "How many providers (dentists/hygienists)?", type: "radio", options: ["1-2", "3-5", "6-10", "10+"], required: true },
    { id: "monthlyPatients", label: "New patients per month?", type: "radio", options: ["Under 10", "10-30", "30-60", "60+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Low new patient volume", "Patients not returning for recalls", "Missed calls", "Bad online reviews", "Insurance confusion", "All of the above"] },
  ],
  thankYouTitle: "Your Appointment Is Set!",
  thankYouMessage: "A dental marketing specialist will review your practice profile and prepare a custom growth plan before your session. Watch your inbox for details.",
};

export default function DentistsFunnel() {
  return <NicheFunnel config={config} />;
}
