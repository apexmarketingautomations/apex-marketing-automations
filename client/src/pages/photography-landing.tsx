import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { CalendarRange, Image, MessageCircle, DollarSign, Phone, Globe, FolderOpen, FileText, Users, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "photography",
  industry: "Photographers",
  tagline: "Built for Photographers & Creative Professionals",
  headline: "Book More Sessions With",
  headlineAccent: "AI-Powered Marketing",
  subheadline: "End the feast-or-famine cycle. Apex automates booking, showcases your portfolio, and nurtures leads — so your calendar stays full with dream clients.",
  accentColor: "pink",
  accentGradient: "from-pink-500 to-rose-600",
  painPoints: [
    { icon: CalendarRange, title: "Feast or Famine Bookings", desc: "Wedding season is slammed, then January is dead. Without consistent lead generation and nurture, your income swings wildly from month to month." },
    { icon: Image, title: "Portfolio Management Nightmare", desc: "Your best work is scattered across Instagram, your website, and hard drives. There's no centralized, beautiful way to showcase your work to potential clients." },
    { icon: MessageCircle, title: "Client Communication Overload", desc: "Endless back-and-forth about pricing, availability, shot lists, and timelines. You spend more time in your inbox than behind the camera." },
    { icon: DollarSign, title: "Pricing Inquiries Waste Time", desc: "Every inquiry starts with 'How much do you charge?' You spend hours sending quotes to people who ghost — and never qualify budget upfront." },
  ],
  features: [
    { icon: Phone, title: "AI Booking Assistant", desc: "24/7 AI assistant that answers pricing questions, checks your availability, qualifies budget and event type, and books consultations. Only talk to serious prospects.", gradient: "from-pink-500 to-rose-600", stat: "85% qualified booking rate" },
    { icon: Globe, title: "Portfolio Landing Pages", desc: "Stunning portfolio pages for each specialty — weddings, portraits, commercial, events. AI-optimized layouts showcase your best work with built-in booking widgets.", gradient: "from-purple-500 to-violet-600", stat: "2.5x more inquiries" },
    { icon: FolderOpen, title: "Client Galleries", desc: "Beautiful, password-protected client galleries for proofing and delivery. Clients select favorites, download high-res files, and share with family — all branded to you.", gradient: "from-blue-500 to-indigo-600", stat: "Professional client experience" },
    { icon: FileText, title: "Automated Invoicing", desc: "Send contracts, collect deposits, and manage payments automatically. Milestone-based invoicing for weddings and commercial projects keeps cash flow predictable.", gradient: "from-emerald-500 to-teal-600", stat: "Get paid 3x faster" },
    { icon: Users, title: "Referral Campaigns", desc: "Automated referral programs that turn happy clients into your best marketing channel. Past clients receive shareable links and rewards for sending new bookings your way.", gradient: "from-amber-500 to-orange-600", stat: "40% of new clients via referral" },
    { icon: Target, title: "Showcase Ads", desc: "Launch Instagram and Facebook ads featuring your best work. AI targets engaged couples, expecting parents, and businesses in your area who need professional photography.", gradient: "from-cyan-500 to-blue-600", stat: "55% lower cost per inquiry" },
  ],
  stats: [
    { value: 85, suffix: "%", label: "Qualified Booking Rate" },
    { value: 40, suffix: "%", label: "Revenue From Referrals" },
    { value: 3, suffix: "x", label: "Faster Payment Collection" },
    { value: 350, suffix: "+", label: "Photographers Trust Apex" },
  ],
  testimonials: [
    { quote: "The AI booking assistant filters out tire-kickers before they even get on my calendar. I went from 20 inquiry calls a week with 4 bookings to 8 calls with 7 bookings. Every call is qualified.", name: "Nicole Ashford", role: "Wedding Photographer, Nicole Ashford Studio" },
    { quote: "My portfolio landing pages convert 3x better than my old website. Each specialty has its own page with curated work and the booking widget is right there. Inquiries have never been higher.", name: "Marcus Bell", role: "Portrait & Commercial Photographer" },
    { quote: "The referral program generates 40% of my bookings now. Happy clients share a link, their friend books, and both get a print credit. It's word-of-mouth on autopilot.", name: "Emily Saunders", role: "Family & Newborn Photographer" },
  ],
  faqs: [
    { q: "Can I customize the portfolio pages to match my brand?", a: "Absolutely. Full control over colors, fonts, layout, and branding. Each portfolio page reflects your unique aesthetic while being optimized for conversion and SEO." },
    { q: "How does the AI handle pricing questions?", a: "You set your packages, pricing, and availability. The AI shares relevant pricing, qualifies the prospect on budget and event type, and books a consultation if they're a fit. No more pricing-then-ghosting." },
    { q: "Can clients order prints through the gallery?", a: "Yes. Client galleries include print ordering, digital download options, and album selection. You set pricing and fulfillment — Apex handles the client-facing experience." },
    { q: "Does it work for different photography specialties?", a: "Yes. Whether you shoot weddings, portraits, commercial, real estate, or events, Apex adapts. Create separate portfolios, pricing, and booking flows for each specialty." },
    { q: "What results do photographers typically see?", a: "Most photographers see a 50% reduction in time spent on admin, 2-3x more qualified inquiries, and a 30-40% increase in bookings within the first 90 days." },
  ],
  ctaText: "Start Booking Dream Clients",
};

export default function PhotographyLanding() {
  return <NicheLanding config={config} />;
}
