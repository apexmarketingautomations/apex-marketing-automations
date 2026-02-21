import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { PawPrint, Calendar, Star, MessageSquare, Heart, Bell } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "pet-services",
  industry: "Pet Services",
  headline: "Get Your Free",
  headlineAccent: "Pet Business Growth Plan",
  subheadline: "Discover how AI-powered scheduling, vaccination reminders, and seasonal campaigns can grow your client base and keep pet parents coming back.",
  accentColor: "teal",
  benefits: [
    { icon: Calendar, text: "Online booking system with automated confirmations" },
    { icon: Bell, text: "Vaccination and grooming reminders that drive rebookings" },
    { icon: Star, text: "Automated review requests from happy pet parents" },
    { icon: MessageSquare, text: "SMS campaigns for seasonal promotions and specials" },
    { icon: Heart, text: "Loyalty programs that reward repeat customers" },
    { icon: PawPrint, text: "Pet profile pages with service history tracking" },
  ],
  qualifyingQuestions: [
    { id: "businessType", label: "Type of Pet Business", type: "select", options: ["Veterinary Clinic", "Pet Grooming", "Dog Boarding/Daycare", "Dog Training", "Pet Store/Retail", "Mobile Grooming", "Pet Sitting/Walking", "Other"], required: true },
    { id: "clientCount", label: "Active clients per month?", type: "radio", options: ["Under 50", "50-150", "150-400", "400+"], required: true },
    { id: "teamSize", label: "Team size?", type: "radio", options: ["Just me", "2-5", "6-15", "16+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Inconsistent bookings", "No-shows", "Low online reviews", "No reminder system", "Seasonal slowdowns", "All of the above"] },
  ],
  thankYouTitle: "Pawsitively Booked!",
  thankYouMessage: "Our pet industry marketing specialist will prepare a custom growth plan for your business. Check your email for your session confirmation.",
};

export default function PetServicesFunnel() {
  return <NicheFunnel config={config} />;
}
