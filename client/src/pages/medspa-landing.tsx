import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { Sun, ShoppingCart, CalendarX, Swords, Phone, Globe, Heart, ImageIcon, CreditCard, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "medspa",
  industry: "Med Spas",
  tagline: "Built for Med Spas & Aesthetics",
  headline: "Book More Consultations With",
  headlineAccent: "AI That Converts",
  subheadline: "Turn price shoppers into loyal members. Apex automates consultation booking, follow-ups, and loyalty programs — so your treatment rooms stay full year-round.",
  accentColor: "rose",
  accentGradient: "from-rose-500 to-pink-600",
  painPoints: [
    { icon: Sun, title: "Seasonal Demand Swings", desc: "Summer Botox rush, dead January. Without consistent marketing automation, your revenue roller-coasters between feast and famine every quarter." },
    { icon: ShoppingCart, title: "Price Shoppers Never Convert", desc: "70% of inquiries are price shopping. They ask about Botox pricing, get a number, and disappear. No system to nurture them into booked consultations." },
    { icon: CalendarX, title: "Consultation No-Shows", desc: "Free consultations have 30-40% no-show rates. Each empty slot costs you the treatment revenue and the time your injector could be earning." },
    { icon: Swords, title: "Intense Competition", desc: "New med spas open every month. Without strong online presence, consistent reviews, and social proof, you're losing clients to competitors with better marketing." },
  ],
  features: [
    { icon: Phone, title: "AI Consultation Booking", desc: "24/7 AI assistant that answers treatment questions, discusses options, and books consultations. Handles Botox, filler, laser, and body contouring inquiries naturally.", gradient: "from-rose-500 to-pink-600", stat: "Zero missed consultation requests" },
    { icon: Globe, title: "Treatment Landing Pages", desc: "Stunning landing pages for each service — Botox, lip filler, microneedling, laser hair removal — with pricing, results, and instant booking widgets.", gradient: "from-purple-500 to-violet-600", stat: "2.8x higher conversion rate" },
    { icon: Heart, title: "Loyalty & VIP Campaigns", desc: "Automated loyalty programs that reward repeat visits. Birthday offers, treatment milestones, and exclusive VIP pricing keep clients coming back.", gradient: "from-amber-500 to-orange-600", stat: "55% repeat booking rate" },
    { icon: ImageIcon, title: "Before & After Showcases", desc: "Beautiful galleries that display treatment results with consent-managed before/after photos. Build trust and social proof that converts browsers into clients.", gradient: "from-emerald-500 to-teal-600", stat: "Build trust instantly" },
    { icon: CreditCard, title: "Membership Management", desc: "Create and manage monthly membership programs with automated billing, treatment credits, and exclusive member pricing. Predictable recurring revenue for your med spa.", gradient: "from-blue-500 to-indigo-600", stat: "40% revenue from memberships" },
    { icon: Target, title: "Social Ads for Aesthetics", desc: "Launch Instagram and Facebook ads showcasing your results. AI generates ad copy, targets beauty-conscious audiences in your area, and drives consultation bookings.", gradient: "from-pink-500 to-fuchsia-600", stat: "48% lower cost per booking" },
  ],
  stats: [
    { value: 65, suffix: "%", label: "Consultation Show Rate" },
    { value: 3, suffix: "x", label: "More Monthly Bookings" },
    { value: 55, suffix: "%", label: "Client Retention Rate" },
    { value: 350, suffix: "+", label: "Med Spas Trust Apex" },
  ],
  testimonials: [
    { quote: "Our consultation no-show rate dropped from 35% to 12% with the automated reminder and deposit system. That alone recovered $8,000 in monthly revenue we were losing.", name: "Dr. Natalie Voss", role: "Owner, Glow Aesthetics" },
    { quote: "The membership program Apex helped us launch generates $22K in predictable monthly revenue. Clients love the VIP pricing and we love the consistency.", name: "Jessica Hartley", role: "Director, Luxe Med Spa" },
    { quote: "January used to be dead. Now our AI runs seasonal campaigns automatically — New Year specials, Valentine's packages — and we stay booked even in slow months.", name: "Amanda Chen", role: "Owner, Radiance Medical Aesthetics" },
  ],
  faqs: [
    { q: "Is this compliant with medical advertising regulations?", a: "Yes. Our platform includes compliance-safe messaging templates and before/after consent management. All communications follow FDA and state medical board advertising guidelines." },
    { q: "Can I manage memberships and packages?", a: "Absolutely. Create tiered membership programs with monthly Botox credits, discounted treatments, and VIP perks. Automated billing and renewal reminders keep everything running smoothly." },
    { q: "How does the consultation booking AI work?", a: "The AI answers questions about your treatments, discusses options, shares pricing, and books consultations — all via phone, text, or web chat. It can handle inquiries about any procedure you offer." },
    { q: "Can I showcase before and after results?", a: "Yes. The platform includes consent-managed galleries where you can display treatment results. Clients sign digital consent forms, and photos are beautifully presented on your landing pages." },
    { q: "What results do med spas typically see?", a: "Most med spas see a 40-60% increase in booked consultations within 60 days, a 30% improvement in no-show rates, and significant growth in membership revenue within the first quarter." },
  ],
  ctaText: "Start Booking More Clients",
};

export default function MedspaLanding() {
  return <NicheLanding config={config} />;
}
