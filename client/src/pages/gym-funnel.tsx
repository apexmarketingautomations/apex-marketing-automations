import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { Dumbbell, Users, Calendar, Star, Target, Heart } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "gym",
  industry: "Gyms & Fitness",
  headline: "Get Your Free",
  headlineAccent: "Fitness Business Growth Plan",
  subheadline: "Discover how AI-powered member engagement, class booking, and retention campaigns can grow your gym and reduce cancellations.",
  accentColor: "red",
  benefits: [
    { icon: Users, text: "AI lead nurture that converts trial visits into memberships" },
    { icon: Calendar, text: "Class booking system with automated waitlists" },
    { icon: Star, text: "Review automation that attracts new members" },
    { icon: Target, text: "Local ad campaigns targeting fitness-minded prospects" },
    { icon: Heart, text: "Retention campaigns that reduce member churn" },
    { icon: Dumbbell, text: "Challenge and program launch funnels" },
  ],
  qualifyingQuestions: [
    { id: "facilityType", label: "Type of Facility", type: "select", options: ["Traditional Gym", "CrossFit Box", "Yoga/Pilates Studio", "Martial Arts", "Personal Training Studio", "Boutique Fitness", "Swimming/Aquatics", "Multi-Location Chain", "Other"], required: true },
    { id: "memberCount", label: "Active member count?", type: "radio", options: ["Under 100", "100-300", "300-700", "700+"], required: true },
    { id: "monthlyGoal", label: "New members needed per month?", type: "radio", options: ["5-10", "10-25", "25-50", "50+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge?", type: "select", options: ["Low new member signups", "High cancellation rate", "Empty class slots", "No referral program", "Competition from big box gyms", "All of the above"] },
  ],
  thankYouTitle: "Let's Crush Your Goals!",
  thankYouMessage: "A fitness marketing specialist will review your facility and prepare a custom AI growth strategy. Check your email for session details.",
};

export default function GymFunnel() {
  return <NicheFunnel config={config} />;
}
