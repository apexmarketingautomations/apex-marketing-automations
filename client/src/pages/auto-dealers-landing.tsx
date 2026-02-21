import { NicheLanding, NicheLandingConfig } from "@/components/niche-landing";
import { Clock, Zap, Shuffle, UserX, Phone, Car, Users, Bot, Wrench, Target } from "lucide-react";

const config: NicheLandingConfig = {
  slug: "auto-dealers",
  industry: "Auto Dealers",
  tagline: "Built for Dealerships & Auto Groups",
  headline: "Sell More Cars With",
  headlineAccent: "AI-Powered BDC",
  subheadline: "Internet leads go cold in minutes. Apex responds instantly, qualifies buyers, and books appointments — so your sales floor stays packed with ready-to-buy customers.",
  accentColor: "red",
  accentGradient: "from-red-500 to-rose-600",
  painPoints: [
    { icon: Clock, title: "Internet Leads Going Cold", desc: "The average dealer takes 2+ hours to respond to an internet lead. By then, the buyer has already contacted 5 other dealerships and made an appointment elsewhere." },
    { icon: Zap, title: "Slow Response Times", desc: "Your BDC team is overwhelmed with calls, emails, and chat inquiries. Lead response time directly correlates with show rate — and you're losing the speed game." },
    { icon: Shuffle, title: "Scattered Lead Sources", desc: "Leads pour in from AutoTrader, Cars.com, your website, Facebook Marketplace, and walk-ins — but there's no unified system to manage and prioritize them all." },
    { icon: UserX, title: "Lost Follow-Ups", desc: "80% of car buyers need 5-8 touches before visiting a dealership. Without automated nurture, your BDC drops the ball and warm leads go to competitors." },
  ],
  features: [
    { icon: Phone, title: "AI BDC Agent", desc: "24/7 virtual BDC that responds to internet leads in under 60 seconds. Qualifies buyers on budget, trade-in, and timeline — then books showroom appointments.", gradient: "from-red-500 to-rose-600", stat: "Sub-60 second lead response" },
    { icon: Car, title: "Vehicle Landing Pages", desc: "Generate stunning VDP-style landing pages for featured inventory with specs, pricing, financing calculator, and instant chat. Drive traffic from ads directly to specific vehicles.", gradient: "from-blue-500 to-indigo-600", stat: "Launch VDPs in seconds" },
    { icon: Users, title: "Lead Round-Robin", desc: "Automatically distribute leads across your sales team based on availability, expertise, and performance. Fair distribution, faster response, better accountability.", gradient: "from-emerald-500 to-teal-600", stat: "100% lead coverage" },
    { icon: Bot, title: "Trade-In Qualification Bot", desc: "AI captures trade-in details, year, make, model, condition, and mileage — then provides instant estimated value. Pre-qualifies the deal before the customer even walks in.", gradient: "from-amber-500 to-orange-600", stat: "70% of trades pre-qualified" },
    { icon: Wrench, title: "Service Reminders", desc: "Automated service lane campaigns for oil changes, tire rotations, and warranty work. Turn your service department into a retention machine that drives repeat purchases.", gradient: "from-purple-500 to-violet-600", stat: "38% service retention lift" },
    { icon: Target, title: "Inventory Ads", desc: "Launch dynamic Facebook and Instagram ads showcasing your inventory. AI generates ad copy for each vehicle and targets in-market buyers in your DMA.", gradient: "from-pink-500 to-fuchsia-600", stat: "55% lower cost per appointment" },
  ],
  stats: [
    { value: 47, suffix: "%", label: "Higher Show Rate" },
    { value: 60, suffix: "s", label: "Average Lead Response" },
    { value: 28, suffix: "%", label: "More Units Sold Monthly" },
    { value: 200, suffix: "+", label: "Dealerships Trust Apex" },
  ],
  testimonials: [
    { quote: "Our internet lead response went from 2 hours to under a minute. Show rates jumped 40% and we're selling 15 more units a month without adding BDC headcount.", name: "Tony Marchetti", role: "GM, Marchetti Auto Group" },
    { quote: "The AI trade-in bot is genius. Customers come in with realistic expectations because they already got an estimate. It cuts negotiation time in half.", name: "Diana Flores", role: "Internet Director, Premier Honda" },
    { quote: "We replaced three separate tools — our CRM, lead distributor, and email platform — with Apex. Saving $2,400 a month and our pipeline is cleaner than ever.", name: "Ryan O'Brien", role: "Sales Manager, O'Brien Chevrolet" },
  ],
  faqs: [
    { q: "Does it integrate with our DMS and CRM?", a: "Yes. Apex integrates with DealerSocket, VinSolutions, CDK, and other major automotive DMS/CRM platforms. Lead data syncs both ways to keep your existing workflows intact." },
    { q: "How does the AI BDC handle complex buyer questions?", a: "The AI is trained on automotive sales best practices. It handles pricing, financing options, trade-in inquiries, and inventory availability. For complex negotiations, it smoothly transfers to your sales team." },
    { q: "Can I use this for both new and used inventory?", a: "Absolutely. Create vehicle landing pages, run ads, and manage leads for both new and pre-owned inventory. The system handles franchise and independent dealerships alike." },
    { q: "Will it work for our service department too?", a: "Yes. Service reminder campaigns, appointment booking, and customer follow-up are all included. Turn your service lane into a profit center and customer retention engine." },
    { q: "What's the typical ROI timeline?", a: "Most dealerships see measurable improvements in lead response time and show rates within the first week. Full ROI — more units sold and lower cost per sale — typically materializes within 30-60 days." },
  ],
  ctaText: "Start Selling More Cars",
};

export default function AutoDealersLanding() {
  return <NicheLanding config={config} />;
}
