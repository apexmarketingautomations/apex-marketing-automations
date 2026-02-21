import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { Sun, ListChecks, Users, MessageSquare, Bot, Calendar, Link2, UserCircle, Star, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "wedding",
  industry: "Wedding Planners",
  tagline: "Built for Wedding Planners & Event Professionals",
  headline: "Plan More Weddings With",
  headlineAccent: "AI-Powered Efficiency",
  subheadline: "Stop drowning in emails and vendor coordination. Apex automates inquiry response, timeline management, and client communication — so you can create magical events.",
  accentColor: "rose",
  accentGradient: "from-rose-500 to-pink-600",
  painPoints: [
    { icon: Sun, title: "Seasonal Demand Spikes", desc: "Peak season means 60-hour weeks of juggling multiple weddings. Off-season means scrambling for any booking. There's no system to smooth the revenue curve." },
    { icon: ListChecks, title: "Complex Timeline Management", desc: "Every wedding has 200+ tasks across 12-18 months. Tracking deadlines, vendor deliverables, and client decisions across multiple events is overwhelming." },
    { icon: Users, title: "Vendor Coordination Chaos", desc: "Coordinating with 10-15 vendors per wedding — florists, caterers, DJs, photographers — means endless emails, calls, and follow-ups that eat your entire day." },
    { icon: MessageSquare, title: "Client Communication Overload", desc: "Brides and families want constant updates. Every decision sparks a chain of messages. You spend more time in your inbox than designing beautiful events." },
  ],
  features: [
    { icon: Bot, title: "AI Inquiry Response", desc: "24/7 AI assistant that responds to wedding inquiries instantly. Qualifies couples on date, budget, guest count, and vision — then books discovery calls with ready-to-sign clients.", gradient: "from-rose-500 to-pink-600", stat: "Respond in under 60 seconds" },
    { icon: Calendar, title: "Event Timeline Pages", desc: "Beautiful, shareable timeline pages for each wedding. Clients, vendors, and wedding parties all see their tasks, deadlines, and day-of schedule in one place.", gradient: "from-purple-500 to-violet-600", stat: "Zero missed deadlines" },
    { icon: Link2, title: "Vendor Communication Hub", desc: "Centralized vendor inbox where all communications are organized by wedding and vendor. No more searching through email threads — everything is in context.", gradient: "from-blue-500 to-indigo-600", stat: "Save 10+ hours per week" },
    { icon: UserCircle, title: "Client Portal", desc: "Branded client portal where couples track progress, approve designs, make decisions, and communicate with your team. Professional experience that justifies premium fees.", gradient: "from-emerald-500 to-teal-600", stat: "Elevate client experience" },
    { icon: Star, title: "Review Collection", desc: "Automated post-wedding review requests timed perfectly — after the honeymoon when the glow is still strong. Couples share their experience on Google and The Knot.", gradient: "from-amber-500 to-orange-600", stat: "4.9★ average planner rating" },
    { icon: Target, title: "Wedding Ads", desc: "Launch Instagram and Facebook ads targeting newly engaged couples in your area. AI-generated ad creative showcases your best weddings and drives qualified inquiries.", gradient: "from-cyan-500 to-blue-600", stat: "50% lower cost per inquiry" },
  ],
  stats: [
    { value: 60, suffix: "s", label: "Average Inquiry Response" },
    { value: 10, suffix: "+", label: "Hours Saved Per Week" },
    { value: 45, suffix: "%", label: "More Weddings Booked" },
    { value: 200, suffix: "+", label: "Planners Trust Apex" },
  ],
  testimonials: [
    { quote: "The AI inquiry responder books 3x more discovery calls than my old contact form. Couples love getting an instant, personalized response at 11pm when they're excitedly planning. It feels like magic.", name: "Christina Palazzo", role: "Owner, Palazzo Events & Design" },
    { quote: "Managing vendor communication across 8 simultaneous weddings used to be my nightmare. The vendor hub keeps everything organized by event and vendor. I found 10 hours a week I didn't know I had.", name: "Lauren Kim", role: "Lead Planner, Blush & Bloom Weddings" },
    { quote: "The client portal is what elevated us from a good planner to a luxury experience. Couples share their portal link with family and everyone stays informed. It's our biggest differentiator.", name: "Alejandra Reyes", role: "Founder, AR Event Studio" },
  ],
  faqs: [
    { q: "Can I manage multiple weddings simultaneously?", a: "Absolutely. Each wedding gets its own timeline, vendor list, client portal, and communication thread. Switch between events seamlessly and never let details fall through the cracks." },
    { q: "How does the AI handle wedding inquiries?", a: "The AI asks about the wedding date, venue preferences, guest count, budget range, and vision. It shares your portfolio and availability, then books a discovery call with qualified couples." },
    { q: "Can vendors access the system?", a: "Yes. Vendors get limited access to their specific tasks, deadlines, and day-of timeline. They can confirm deliverables and communicate directly through the platform." },
    { q: "Does it work for corporate events too?", a: "Yes. While optimized for weddings, Apex works beautifully for corporate events, galas, fundraisers, and any event that requires vendor coordination and client management." },
    { q: "What results do wedding planners typically see?", a: "Most planners see a 40-50% increase in booked weddings within 90 days, 10+ hours saved per week on admin tasks, and significantly improved client satisfaction scores." },
  ],
  ctaText: "Start Planning More Weddings",
};

export default function WeddingLanding() {
  return <NicheLanding config={config} />;
}
