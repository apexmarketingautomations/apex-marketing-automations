import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { UserSearch, Clock, Cog, Puzzle, Phone, Layers, Mail, BookOpen, MessageSquare, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "coaches",
  industry: "Coaches & Consultants",
  tagline: "Built for Coaches, Consultants & Course Creators",
  headline: "Scale Your Practice With",
  headlineAccent: "AI-Powered Systems",
  subheadline: "Stop trading time for money. Apex automates client acquisition, qualification, and nurture — so you can focus on coaching while your pipeline fills itself.",
  accentColor: "purple",
  accentGradient: "from-purple-500 to-violet-600",
  painPoints: [
    { icon: UserSearch, title: "Client Acquisition Struggle", desc: "You're great at coaching but terrible at marketing. Finding new clients feels like a full-time job on top of your actual coaching work." },
    { icon: Clock, title: "Time Wasted on Unqualified Leads", desc: "You spend hours on discovery calls with people who can't afford you, aren't ready, or aren't a fit. Every bad call costs you time you could spend with paying clients." },
    { icon: Cog, title: "No Systems or Processes", desc: "Your business runs on scattered tools — Calendly, Mailchimp, Google Sheets, Stripe. Nothing talks to each other and things fall through the cracks." },
    { icon: Puzzle, title: "Too Many Scattered Tools", desc: "You're paying for 6-8 different software tools that don't integrate. It's expensive, confusing, and you spend more time managing tools than coaching clients." },
  ],
  features: [
    { icon: Phone, title: "AI Discovery Call Booking", desc: "AI pre-qualifies prospects on budget, goals, and timeline before they book a discovery call. Only talk to people who are actually ready to invest in coaching.", gradient: "from-purple-500 to-violet-600", stat: "90% qualified booking rate" },
    { icon: Layers, title: "Funnel Builder", desc: "Build high-converting funnels for your coaching programs, courses, and workshops. Landing pages, opt-in forms, and sales pages — all connected to your pipeline.", gradient: "from-blue-500 to-indigo-600", stat: "Launch funnels in minutes" },
    { icon: Mail, title: "Nurture Sequences", desc: "Automated email and SMS sequences that educate prospects, build authority, and move them toward booking a call. Deliver value on autopilot while you coach.", gradient: "from-emerald-500 to-teal-600", stat: "45% email open rate" },
    { icon: BookOpen, title: "Coaching Portal", desc: "Client-facing portal where coaching clients access session recordings, homework, resources, and progress tracking. Professional experience that justifies premium pricing.", gradient: "from-amber-500 to-orange-600", stat: "Elevate client experience" },
    { icon: MessageSquare, title: "Testimonial Collection", desc: "Automated post-program testimonial requests with guided prompts that help clients articulate their transformation. Build social proof that sells your next program.", gradient: "from-rose-500 to-pink-600", stat: "4x more testimonials collected" },
    { icon: Target, title: "Thought Leadership Ads", desc: "Launch Facebook and Instagram ads that position you as the go-to expert. AI creates content from your existing material and targets your ideal client avatar.", gradient: "from-cyan-500 to-blue-600", stat: "60% lower cost per lead" },
  ],
  stats: [
    { value: 90, suffix: "%", label: "Qualified Booking Rate" },
    { value: 3, suffix: "x", label: "Client Pipeline Growth" },
    { value: 45, suffix: "%", label: "Higher Close Rate" },
    { value: 500, suffix: "+", label: "Coaches Trust Apex" },
  ],
  testimonials: [
    { quote: "The AI pre-qualification changed everything. I went from 15 discovery calls a week with 3 closes to 6 calls a week with 5 closes. Every call is now with someone ready to invest.", name: "Brandon Marshall", role: "Executive Leadership Coach" },
    { quote: "I replaced Calendly, ConvertKit, Teachable, and Stripe with one platform. Saving $400/month and everything finally works together. My funnel-to-client flow is seamless now.", name: "Samantha Reed", role: "Business Coach & Course Creator" },
    { quote: "The nurture sequences do the selling for me. By the time someone books a discovery call, they've already consumed my best content and are pre-sold on my methodology.", name: "Derek Williams", role: "Mindset & Performance Coach" },
  ],
  faqs: [
    { q: "Is this just for 1-on-1 coaches or can it handle group programs?", a: "Both. Apex works for 1-on-1 coaching, group programs, masterminds, online courses, and hybrid models. You can create separate funnels and workflows for each offer." },
    { q: "How does the AI pre-qualification work?", a: "Before someone books a discovery call, the AI asks qualifying questions about their goals, budget range, timeline, and commitment level. Only qualified prospects can book a slot on your calendar." },
    { q: "Can I use this for course launches?", a: "Absolutely. Build launch funnels with waitlists, webinar registration, sales pages, and automated follow-up sequences. The system handles the entire launch workflow." },
    { q: "Does it replace my current tech stack?", a: "For most coaches, yes. Apex replaces your scheduling tool, email platform, landing page builder, CRM, and client portal. Everything in one system means better data and fewer headaches." },
    { q: "What results do coaches typically see?", a: "Most coaches see a 40-60% improvement in discovery call quality within the first month and a 2-3x increase in qualified leads within 90 days. The pre-qualification alone is worth the investment." },
  ],
  ctaText: "Start Scaling Your Practice",
};

export default function CoachesLanding() {
  return <NicheLanding config={config} />;
}
