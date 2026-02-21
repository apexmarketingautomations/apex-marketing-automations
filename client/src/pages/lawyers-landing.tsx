import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { Phone, DollarSign, FolderOpen, UserX, Bot, Scale, Globe, Mail, Star, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "lawyers",
  industry: "Law Firms",
  tagline: "Built for Personal Injury & Legal Practices",
  headline: "Sign More Cases With",
  headlineAccent: "AI-Powered Intake",
  subheadline: "Never lose a case lead to slow response again. Apex answers calls, qualifies prospects, and nurtures leads 24/7 — so you can focus on winning cases.",
  accentColor: "indigo",
  accentGradient: "from-indigo-500 to-violet-600",
  painPoints: [
    { icon: Phone, title: "Slow Lead Response", desc: "Potential clients call after an accident and expect immediate help. If you don't answer in 5 minutes, they call the next firm on Google." },
    { icon: DollarSign, title: "Expensive Marketing", desc: "PI keywords cost $150-400 per click on Google Ads. Without proper follow-up, most of that spend is wasted on leads that never convert." },
    { icon: FolderOpen, title: "Scattered Case Management", desc: "Leads come from TV ads, Google, referrals, and your website — but there's no single system to track them from intake to signed retainer." },
    { icon: UserX, title: "No Follow-Up System", desc: "Studies show it takes 5-7 touches to sign a PI client. Without automated nurture, warm leads sign with competitors who stay in contact." },
  ],
  features: [
    { icon: Phone, title: "AI Intake Calls", desc: "24/7 AI receptionist trained on your practice areas. It gathers accident details, assesses case viability, and schedules consultations instantly.", gradient: "from-indigo-500 to-violet-600", stat: "Zero missed intake calls" },
    { icon: Bot, title: "Lead Qualification Bot", desc: "AI chatbot on your website and landing pages qualifies prospects by case type, injury severity, statute of limitations, and insurance status.", gradient: "from-blue-500 to-indigo-600", stat: "85% of leads pre-qualified" },
    { icon: Globe, title: "Case Landing Pages", desc: "Generate high-converting landing pages for each practice area — car accidents, slip and fall, medical malpractice — with AI-written content and lead capture.", gradient: "from-purple-500 to-indigo-600", stat: "3x higher conversion rate" },
    { icon: Mail, title: "Automated Nurture Sequences", desc: "Drip campaigns that educate and follow up with prospects who aren't ready to sign. Includes case updates, FAQ content, and soft CTAs to schedule a consult.", gradient: "from-violet-500 to-purple-600", stat: "40% more retainers signed" },
    { icon: Star, title: "Reputation Management", desc: "Automatically request Google reviews from satisfied clients. Route negative feedback privately. Build the 5-star reputation that wins new cases.", gradient: "from-amber-500 to-orange-600", stat: "4.8★ average rating" },
    { icon: Target, title: "Meta Ads for PI Cases", desc: "Launch geo-targeted Facebook and Instagram ads for personal injury cases with AI-generated ad copy, audience targeting, and direct lead capture.", gradient: "from-pink-500 to-rose-600", stat: "62% lower cost per lead" },
  ],
  stats: [
    { value: 97, suffix: "%", label: "Intake Call Answer Rate" },
    { value: 3, suffix: "x", label: "More Cases Signed" },
    { value: 45, suffix: "%", label: "Lower Cost Per Case" },
    { value: 500, suffix: "+", label: "Law Firms Trust Apex" },
  ],
  testimonials: [
    { quote: "We went from missing 60% of after-hours calls to capturing every single lead. The AI intake bot sounds incredibly professional and gathers all the case details we need.", name: "Marcus Thompson", role: "Managing Partner, Thompson & Associates" },
    { quote: "Our cost per signed case dropped by half after switching to Apex. The automated nurture sequences keep prospects warm until they're ready to retain us.", name: "Sarah Mitchell", role: "Marketing Director, Citywide Legal Group" },
    { quote: "The case landing pages convert at 3x our old website. Each practice area has its own optimized page with the AI chatbot qualifying leads in real-time.", name: "David Reyes", role: "Solo PI Attorney, Reyes Law" },
  ],
  faqs: [
    { q: "Is this HIPAA and attorney-client privilege compliant?", a: "Yes. All data is encrypted at rest and in transit. Our AI intake system is designed with legal confidentiality in mind — conversations are private, stored securely, and never used for training." },
    { q: "Can the AI bot handle different practice areas?", a: "Absolutely. You can train separate intake flows for PI, workers' comp, medical malpractice, and more. Each flow asks practice-specific qualifying questions." },
    { q: "How does it integrate with my existing case management software?", a: "Apex integrates with Clio, MyCase, PracticePanther, and other popular legal CRMs via Zapier and direct API connections. Qualified leads sync automatically." },
    { q: "What happens when a lead needs to speak to an actual attorney?", a: "The AI qualifies the lead, gathers essential case details, and immediately routes qualified prospects to your team via call transfer, text alert, or calendar booking — based on your preferences." },
    { q: "How quickly can I get started?", a: "Most firms are fully set up within 24 hours. Our onboarding includes AI training on your practice areas, landing page creation, and workflow configuration." },
  ],
  ctaText: "Start Signing More Cases",
};

export default function LawyersLanding() {
  return <NicheLanding config={config} />;
}
