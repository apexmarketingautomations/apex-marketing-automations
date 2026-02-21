import { NicheFunnel, NicheFunnelConfig } from "@/components/niche-funnel";
import { UtensilsCrossed, MessageSquare, Star, Calendar, Users, Megaphone } from "lucide-react";

const config: NicheFunnelConfig = {
  slug: "restaurants",
  industry: "Restaurants",
  headline: "Get Your Free",
  headlineAccent: "Restaurant Growth Plan",
  subheadline: "Discover how AI-powered reservations, review management, and SMS campaigns can fill more seats and keep guests coming back.",
  accentColor: "orange",
  benefits: [
    { icon: Calendar, text: "AI reservation system that reduces no-shows by 40%" },
    { icon: Star, text: "Automated review requests after every dining experience" },
    { icon: MessageSquare, text: "SMS marketing campaigns for specials and events" },
    { icon: Users, text: "Loyalty programs that increase repeat visits" },
    { icon: UtensilsCrossed, text: "Digital menu pages with online ordering integration" },
    { icon: Megaphone, text: "Social media ad campaigns targeting local diners" },
  ],
  qualifyingQuestions: [
    { id: "restaurantType", label: "Type of Restaurant", type: "select", options: ["Fine Dining", "Casual Dining", "Fast Casual", "QSR/Fast Food", "Bar & Grill", "Café/Coffee Shop", "Food Truck", "Catering", "Other"], required: true },
    { id: "locations", label: "How many locations?", type: "radio", options: ["1", "2-5", "6-15", "16+"], required: true },
    { id: "monthlyCovers", label: "Average monthly covers per location?", type: "radio", options: ["Under 500", "500-2,000", "2,000-5,000", "5,000+"], required: true },
    { id: "biggestChallenge", label: "Biggest challenge right now?", type: "select", options: ["Empty seats midweek", "Bad or few reviews", "No repeat customer system", "High marketing costs", "No-shows", "All of the above"] },
  ],
  thankYouTitle: "Table for Success — Booked!",
  thankYouMessage: "Our restaurant marketing specialist will analyze your current setup and prepare a custom growth strategy. Check your email for the confirmation.",
};

export default function RestaurantsFunnel() {
  return <NicheFunnel config={config} />;
}
