import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { UserMinus, TrendingDown, CalendarDays, Megaphone, Phone, Mail, ClipboardList, Star, FileText, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "chiropractors",
  industry: "Chiropractors",
  tagline: "Built for Chiropractic & Wellness Practices",
  headline: "Grow Your Practice With",
  headlineAccent: "AI-Powered Patient Growth",
  subheadline: "Stop relying on word-of-mouth alone. Apex automates patient booking, reactivation, and reviews — so your adjusting tables stay full and your practice thrives.",
  accentColor: "emerald",
  accentGradient: "from-emerald-500 to-green-600",
  painPoints: [
    { icon: UserMinus, title: "Patient Retention Drop-Off", desc: "50% of chiropractic patients stop coming after their initial treatment plan. Without reactivation campaigns, you lose lifetime patient value every single month." },
    { icon: TrendingDown, title: "Seasonal Patient Drops", desc: "January resolutions and summer slowdowns create unpredictable revenue. Without proactive marketing, your schedule has feast-or-famine swings." },
    { icon: CalendarDays, title: "Manual Scheduling Headaches", desc: "Phone tag, voicemails, and manual booking eat up your front desk's time. Patients want instant online booking — and they'll go to whoever offers it." },
    { icon: Megaphone, title: "Word-of-Mouth Only", desc: "Referrals are great but unpredictable. Without a systematic marketing engine, you're leaving growth up to chance while competitors invest in ads and automation." },
  ],
  features: [
    { icon: Phone, title: "AI Booking Assistant", desc: "24/7 AI receptionist that books new patient exams, follow-up adjustments, and wellness visits. Handles insurance questions and finds available slots automatically.", gradient: "from-emerald-500 to-green-600", stat: "Zero missed patient calls" },
    { icon: Mail, title: "Patient Reactivation Campaigns", desc: "Automated outreach to inactive patients with personalized messaging. Gentle reminders about the importance of ongoing care bring lapsed patients back to your table.", gradient: "from-cyan-500 to-teal-600", stat: "32% reactivation rate" },
    { icon: ClipboardList, title: "Treatment Plan Pages", desc: "Create educational landing pages for conditions you treat — sciatica, back pain, headaches, sports injuries. Attract new patients searching for solutions online.", gradient: "from-blue-500 to-indigo-600", stat: "Rank for local searches" },
    { icon: Star, title: "Review Generation", desc: "Automatically request Google reviews after positive visits. Smart routing sends happy patients to review sites and captures constructive feedback privately.", gradient: "from-amber-500 to-orange-600", stat: "4.9★ average practice rating" },
    { icon: FileText, title: "Wellness Content", desc: "AI-generated blog posts, social media content, and email newsletters about wellness, posture, and preventive care. Position yourself as the local wellness authority.", gradient: "from-purple-500 to-violet-600", stat: "Consistent content pipeline" },
    { icon: Target, title: "Community Ads", desc: "Launch hyper-local Facebook and Instagram ads targeting people with back pain, sports injuries, and wellness interests in your ZIP codes.", gradient: "from-rose-500 to-pink-600", stat: "52% lower cost per patient" },
  ],
  stats: [
    { value: 32, suffix: "%", label: "Patient Reactivation Rate" },
    { value: 45, suffix: "%", label: "More New Patients" },
    { value: 89, suffix: "%", label: "Retention After 6 Months" },
    { value: 300, suffix: "+", label: "Practices Trust Apex" },
  ],
  testimonials: [
    { quote: "The patient reactivation campaigns brought back 45 inactive patients in our first month. These are people who hadn't been in for 6-12 months — now they're on regular care plans again.", name: "Dr. Jason Whitfield", role: "Owner, Whitfield Chiropractic" },
    { quote: "We went from 12 Google reviews to 180+ in six months. The automated review requests after every visit make it effortless. New patients say they found us because of our reviews.", name: "Dr. Emily Tran", role: "Founder, Align Wellness Center" },
    { quote: "The AI booking assistant saved us from hiring another front desk person. It handles 70% of our scheduling calls and patients love the instant text booking option.", name: "Dr. Michael Russo", role: "Owner, Russo Family Chiropractic" },
  ],
  faqs: [
    { q: "Is this HIPAA compliant for chiropractic practices?", a: "Yes. All patient data is encrypted and stored securely. Our system is fully HIPAA compliant with BAA agreements available. Patient communications are private and secure." },
    { q: "Can it handle different appointment types?", a: "Absolutely. Configure separate booking flows for new patient exams, follow-up adjustments, massage therapy, decompression, and any other services you offer. Each has its own time slots and intake forms." },
    { q: "How does patient reactivation work?", a: "The system identifies patients who haven't visited in 30, 60, or 90+ days and triggers personalized outreach sequences. Messages include health reminders, special offers, and one-tap rebooking links." },
    { q: "Will this help me compete with bigger practices?", a: "Yes. Apex levels the playing field by giving you the same AI-powered marketing and automation tools that multi-location practices use — at a fraction of the cost." },
    { q: "How quickly can I see results?", a: "Most practices see increased Google reviews within the first two weeks and measurable new patient growth within 30-60 days. Patient reactivation campaigns typically show results within the first month." },
  ],
  ctaText: "Start Growing Your Practice",
};

export default function ChiropractorsLanding() {
  return <NicheLanding config={config} />;
}
