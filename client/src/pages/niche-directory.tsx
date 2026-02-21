import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, Sparkles, Scale, UtensilsCrossed, Stethoscope, Sparkle,
  Car, Shield, Activity, GraduationCap, ShoppingBag, PawPrint, Camera,
  Heart, Home, Dumbbell, Gem, Megaphone
} from "lucide-react";

const niches = [
  { slug: "/lawyers", name: "Law Firms", desc: "AI intake, lead qualification, and case management for personal injury and legal practices.", icon: Scale, color: "indigo" },
  { slug: "/realtors", name: "Real Estate", desc: "Listing promotion, buyer qualification, and automated follow-up for agents and brokerages.", icon: Home, color: "blue" },
  { slug: "/restaurants", name: "Restaurants", desc: "Reservation management, review routing, and SMS campaigns for food service businesses.", icon: UtensilsCrossed, color: "orange" },
  { slug: "/dentists", name: "Dental Practices", desc: "Patient recall, appointment booking, and insurance FAQ automation for dental offices.", icon: Stethoscope, color: "sky" },
  { slug: "/medspa", name: "Med Spas", desc: "Consultation booking, treatment showcases, and loyalty programs for aesthetic clinics.", icon: Sparkle, color: "rose" },
  { slug: "/auto-dealers", name: "Auto Dealers", desc: "AI BDC agents, vehicle pages, and trade-in qualification for car dealerships.", icon: Car, color: "red" },
  { slug: "/insurance", name: "Insurance", desc: "Quote assistance, policy renewal automation, and compliance-safe messaging for agents.", icon: Shield, color: "blue" },
  { slug: "/chiropractors", name: "Chiropractors", desc: "Patient reactivation, booking automation, and wellness content for chiropractic practices.", icon: Activity, color: "emerald" },
  { slug: "/coaches", name: "Coaches & Consultants", desc: "Discovery call booking, funnel building, and nurture sequences for coaches.", icon: GraduationCap, color: "purple" },
  { slug: "/ecommerce", name: "E-Commerce", desc: "Cart recovery, AI support, product pages, and retargeting for online stores.", icon: ShoppingBag, color: "amber" },
  { slug: "/pet-services", name: "Pet Services", desc: "Scheduling, vaccination reminders, and seasonal campaigns for groomers and vets.", icon: PawPrint, color: "teal" },
  { slug: "/photography", name: "Photography", desc: "Booking management, portfolio pages, and referral campaigns for photographers.", icon: Camera, color: "pink" },
  { slug: "/wedding", name: "Wedding & Events", desc: "Inquiry response, timeline management, and vendor coordination for planners.", icon: Heart, color: "rose" },
  { slug: "/home-services", name: "Home Services", desc: "Lead capture, estimate automation, and review management for contractors.", icon: Home, color: "emerald" },
  { slug: "/gym", name: "Gyms & Fitness", desc: "Member engagement, class booking, and retention campaigns for fitness businesses.", icon: Dumbbell, color: "red" },
  { slug: "/luxe", name: "Luxury & Beauty", desc: "Premium booking, VIP campaigns, and brand management for high-end salons.", icon: Gem, color: "purple" },
  { slug: "/marketers", name: "Marketing Agencies", desc: "White-label CRM, client management, and campaign automation for agencies.", icon: Megaphone, color: "cyan" },
];

const colorMap: Record<string, { bg: string; text: string; border: string; hoverBorder: string }> = {
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/10", hoverBorder: "hover:border-cyan-500/30" },
  blue: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/10", hoverBorder: "hover:border-blue-500/30" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/10", hoverBorder: "hover:border-orange-500/30" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/10", hoverBorder: "hover:border-emerald-500/30" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/10", hoverBorder: "hover:border-purple-500/30" },
  pink: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/10", hoverBorder: "hover:border-pink-500/30" },
  red: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/10", hoverBorder: "hover:border-red-500/30" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/10", hoverBorder: "hover:border-indigo-500/30" },
  teal: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/10", hoverBorder: "hover:border-teal-500/30" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/10", hoverBorder: "hover:border-rose-500/30" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/10", hoverBorder: "hover:border-amber-500/30" },
  sky: { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/10", hoverBorder: "hover:border-sky-500/30" },
};

export default function NicheDirectory() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <nav className="fixed top-0 w-full z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <span className="text-lg font-black tracking-tight cursor-pointer">
              <span className="text-cyan-400">APEX</span> <span className="text-white/60">Industries</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/pricing"><span className="text-sm text-slate-400 hover:text-white transition-colors cursor-pointer" data-testid="link-pricing">Pricing</span></Link>
            <a href="/api/login" className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 text-white text-sm font-bold hover:opacity-90 transition-opacity" data-testid="button-get-started">
              Get Started <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-16 px-6" data-testid="section-hero">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 text-cyan-400 bg-white/5 mb-6">
              <Sparkles size={12} /> BUILT FOR EVERY INDUSTRY
            </div>
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-5xl md:text-6xl font-black tracking-tight leading-[1.1] mb-6" data-testid="text-hero-headline">
            One Platform.{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">Every Industry.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-lg text-slate-400 max-w-2xl mx-auto">
            Apex Marketing Automations is tailored for {niches.length}+ industries. Find yours and see how AI can transform your business.
          </motion.p>
        </div>
      </section>

      <section className="pb-20 px-6" data-testid="section-niches">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {niches.map((niche, i) => {
            const c = colorMap[niche.color] || colorMap.cyan;
            return (
              <motion.div
                key={niche.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={niche.slug}>
                  <div className={`group p-6 rounded-xl border ${c.border} ${c.hoverBorder} bg-white/[0.02] hover:bg-white/[0.04] transition-all cursor-pointer`} data-testid={`card-niche-${niche.slug.slice(1)}`}>
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                        <niche.icon size={22} className={c.text} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white mb-1 group-hover:text-white/90">{niche.name}</h3>
                        <p className="text-sm text-slate-500 leading-relaxed">{niche.desc}</p>
                        <span className={`inline-flex items-center gap-1 mt-3 text-xs font-bold ${c.text} group-hover:gap-2 transition-all`}>
                          Learn More <ArrowRight size={12} />
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="py-16 px-6 border-t border-white/5" data-testid="section-cta">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-black mb-4">Don't See Your Industry?</h2>
          <p className="text-slate-400 mb-6">Apex works for any business that needs AI-powered communication, automation, and growth tools. Start your free trial and customize it for your niche.</p>
          <a href="/api/login" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-lg hover:opacity-90 transition-all" data-testid="button-cta-start">
            Start Free Trial <ArrowRight size={18} />
          </a>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Home</span></Link>
            <Link href="/pricing"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Pricing</span></Link>
            <Link href="/demo"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Demo</span></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
