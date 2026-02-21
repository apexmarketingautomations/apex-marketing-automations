import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { Search, ShieldAlert, RefreshCw, DollarSign, Bot, Mail, Users, Lock, GitBranch, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "insurance",
  industry: "Insurance Agents",
  tagline: "Built for Independent Agents & Agencies",
  headline: "Write More Policies With",
  headlineAccent: "AI-Powered Automation",
  subheadline: "Stop losing quotes to faster agencies. Apex responds instantly, automates renewals, and cross-sells existing clients — so your book of business grows on autopilot.",
  accentColor: "blue",
  accentGradient: "from-blue-500 to-indigo-600",
  painPoints: [
    { icon: Search, title: "Quote Shoppers Disappear", desc: "Prospects request quotes from 5 agencies at once. If you don't respond within minutes with a compelling offer, they bind with someone faster." },
    { icon: ShieldAlert, title: "Compliance Headaches", desc: "Every text, email, and ad must be compliant with state regulations and carrier guidelines. One mistake can mean fines or losing your appointment." },
    { icon: RefreshCw, title: "Policy Renewal Churn", desc: "15-20% of policies don't renew each year. Without proactive outreach, clients shop around or let coverage lapse — and you lose recurring revenue." },
    { icon: DollarSign, title: "High Cost Per Lead", desc: "Insurance leads from aggregators cost $25-80 each. Without proper nurture and follow-up, most of those expensive leads never convert to bound policies." },
  ],
  features: [
    { icon: Bot, title: "AI Quote Assistant", desc: "24/7 AI that collects prospect information, coverage needs, and basic underwriting details — then routes qualified leads to you with complete quote-ready data.", gradient: "from-blue-500 to-indigo-600", stat: "Respond to quotes in seconds" },
    { icon: RefreshCw, title: "Policy Renewal Automation", desc: "Automated renewal campaigns that start 90 days before expiration. Personalized touchpoints remind clients of their coverage value and make renewal effortless.", gradient: "from-emerald-500 to-teal-600", stat: "94% renewal retention rate" },
    { icon: Users, title: "Referral Campaigns", desc: "Turn satisfied policyholders into referral sources. Automated referral programs with tracking, rewards, and follow-up sequences for every warm introduction.", gradient: "from-amber-500 to-orange-600", stat: "3x more referrals generated" },
    { icon: Lock, title: "Compliance-Safe Messaging", desc: "Pre-approved message templates that meet state insurance regulations and carrier requirements. Send confidently knowing every communication is compliant.", gradient: "from-purple-500 to-violet-600", stat: "100% compliance confidence" },
    { icon: GitBranch, title: "Cross-Sell Workflows", desc: "Identify clients with coverage gaps and automatically trigger personalized cross-sell campaigns. Auto, home, umbrella, life — maximize lifetime value per household.", gradient: "from-rose-500 to-pink-600", stat: "42% cross-sell conversion" },
    { icon: Target, title: "Lead Generation Ads", desc: "Launch Facebook and Google ads targeting life events — new home, new car, new baby — that trigger insurance needs. AI-optimized copy drives qualified leads.", gradient: "from-cyan-500 to-blue-600", stat: "58% lower cost per lead" },
  ],
  stats: [
    { value: 94, suffix: "%", label: "Policy Renewal Rate" },
    { value: 42, suffix: "%", label: "Cross-Sell Conversion" },
    { value: 58, suffix: "%", label: "Lower Cost Per Lead" },
    { value: 600, suffix: "+", label: "Agencies Trust Apex" },
  ],
  testimonials: [
    { quote: "My renewal rate jumped from 82% to 94% after implementing automated renewal campaigns. The 90-day touchpoint sequence keeps clients engaged and eliminates surprise non-renewals.", name: "David Kowalski", role: "Owner, Kowalski Insurance Agency" },
    { quote: "The cross-sell workflows identified $180K in coverage gaps across my existing book. Automated campaigns converted 40% of those into new policies without a single cold call.", name: "Patricia Nguyen", role: "Principal Agent, Nguyen & Associates" },
    { quote: "Compliance used to keep me up at night. Now every message goes through pre-approved templates. I market confidently knowing I won't get a call from the DOI.", name: "Michael Santos", role: "Independent Agent, Santos Insurance Group" },
  ],
  faqs: [
    { q: "Is the messaging system compliant with state insurance regulations?", a: "Yes. All templates are designed with insurance compliance in mind. You can customize within compliant frameworks, and the system flags any potentially non-compliant language before sending." },
    { q: "Does it integrate with my agency management system?", a: "Apex integrates with Applied Epic, Hawksoft, EZLynx, and other major AMS platforms. Policy data, client info, and renewal dates sync automatically." },
    { q: "How does the cross-sell workflow work?", a: "The system analyzes your book of business to identify coverage gaps — auto-only clients who need home, homeowners without umbrella, families without life. Then it triggers personalized campaigns for each gap." },
    { q: "Can I use this for both personal and commercial lines?", a: "Absolutely. Configure separate workflows, landing pages, and lead qualification for personal lines, commercial lines, benefits, and specialty products." },
    { q: "What's the ROI for insurance agencies?", a: "Most agencies see a 10-15% improvement in retention within 90 days and generate 3-5 additional cross-sell policies per month per 100 clients. The platform typically pays for itself within the first month." },
  ],
  ctaText: "Start Writing More Policies",
};

export default function InsuranceLanding() {
  return <NicheLanding config={config} />;
}
