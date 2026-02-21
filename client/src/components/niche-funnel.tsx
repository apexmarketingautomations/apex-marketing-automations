import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  ArrowRight, ArrowLeft, CheckCircle2, Sparkles, User, Mail, Phone,
  Building2, Calendar, Clock, Loader2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface FunnelQuestion {
  id: string;
  label: string;
  type: "select" | "text" | "textarea" | "radio";
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

export interface FunnelBenefit {
  icon: LucideIcon;
  text: string;
}

export interface NicheFunnelConfig {
  slug: string;
  industry: string;
  headline: string;
  headlineAccent: string;
  subheadline: string;
  accentColor: string;
  benefits: FunnelBenefit[];
  qualifyingQuestions: FunnelQuestion[];
  thankYouTitle: string;
  thankYouMessage: string;
  calendarNote?: string;
}

const accentMap: Record<string, { text: string; bg: string; border: string; gradient: string; glow: string; ring: string }> = {
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500", border: "border-cyan-500/30", gradient: "from-cyan-500 to-blue-600", glow: "shadow-cyan-500/20", ring: "ring-cyan-500/40" },
  blue: { text: "text-blue-400", bg: "bg-blue-500", border: "border-blue-500/30", gradient: "from-blue-500 to-indigo-600", glow: "shadow-blue-500/20", ring: "ring-blue-500/40" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500", border: "border-emerald-500/30", gradient: "from-emerald-500 to-green-600", glow: "shadow-emerald-500/20", ring: "ring-emerald-500/40" },
  purple: { text: "text-purple-400", bg: "bg-purple-500", border: "border-purple-500/30", gradient: "from-purple-500 to-violet-600", glow: "shadow-purple-500/20", ring: "ring-purple-500/40" },
  pink: { text: "text-pink-400", bg: "bg-pink-500", border: "border-pink-500/30", gradient: "from-pink-500 to-rose-600", glow: "shadow-pink-500/20", ring: "ring-pink-500/40" },
  amber: { text: "text-amber-400", bg: "bg-amber-500", border: "border-amber-500/30", gradient: "from-amber-500 to-orange-600", glow: "shadow-amber-500/20", ring: "ring-amber-500/40" },
  red: { text: "text-red-400", bg: "bg-red-500", border: "border-red-500/30", gradient: "from-red-500 to-rose-600", glow: "shadow-red-500/20", ring: "ring-red-500/40" },
  indigo: { text: "text-indigo-400", bg: "bg-indigo-500", border: "border-indigo-500/30", gradient: "from-indigo-500 to-violet-600", glow: "shadow-indigo-500/20", ring: "ring-indigo-500/40" },
  teal: { text: "text-teal-400", bg: "bg-teal-500", border: "border-teal-500/30", gradient: "from-teal-500 to-cyan-600", glow: "shadow-teal-500/20", ring: "ring-teal-500/40" },
  rose: { text: "text-rose-400", bg: "bg-rose-500", border: "border-rose-500/30", gradient: "from-rose-500 to-pink-600", glow: "shadow-rose-500/20", ring: "ring-rose-500/40" },
  orange: { text: "text-orange-400", bg: "bg-orange-500", border: "border-orange-500/30", gradient: "from-orange-500 to-amber-600", glow: "shadow-orange-500/20", ring: "ring-orange-500/40" },
  sky: { text: "text-sky-400", bg: "bg-sky-500", border: "border-sky-500/30", gradient: "from-sky-500 to-blue-600", glow: "shadow-sky-500/20", ring: "ring-sky-500/40" },
};

const steps = ["Your Info", "About Your Business", "Schedule", "Confirmed"];

export function NicheFunnel({ config }: { config: NicheFunnelConfig }) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({
    firstName: "", lastName: "", email: "", phone: "", businessName: "",
    preferredTime: "", preferredDay: "",
  });
  const colors = accentMap[config.accentColor] || accentMap.cyan;

  const updateField = (key: string, value: string) => setFormData(prev => ({ ...prev, [key]: value }));

  const canAdvance = () => {
    if (step === 0) return formData.firstName && formData.email && formData.phone;
    if (step === 1) {
      const required = config.qualifyingQuestions.filter(q => q.required !== false);
      return required.every(q => formData[q.id]?.trim());
    }
    if (step === 2) return formData.preferredDay && formData.preferredTime;
    return true;
  };

  const handleNext = async () => {
    if (step === 2) {
      setSubmitting(true);
      await new Promise(r => setTimeout(r, 1500));
      setSubmitting(false);
      setStep(3);
    } else {
      setStep(s => s + 1);
    }
  };

  const inputClass = `w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 outline-none transition-all focus:border-white/20 focus:${colors.ring} focus:ring-2 text-sm`;
  const labelClass = "block text-sm font-medium text-slate-300 mb-1.5";

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <nav className="fixed top-0 w-full z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href={`/${config.slug}`}>
            <span className="text-lg font-black tracking-tight cursor-pointer" data-testid="link-logo">
              <span className={colors.text}>APEX</span> <span className="text-white/60">for {config.industry}</span>
            </span>
          </Link>
          <Link href={`/${config.slug}`}>
            <span className="text-sm text-slate-400 hover:text-white transition-colors cursor-pointer" data-testid="link-back">Back to Overview</span>
          </Link>
        </div>
      </nav>

      <div className="pt-28 pb-20 px-4">
        <div className="max-w-5xl mx-auto grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2 pt-4">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${colors.border} ${colors.text} bg-white/5 mb-4`}>
                <Sparkles size={11} /> FREE STRATEGY SESSION
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-tight mb-3" data-testid="text-funnel-headline">
                {config.headline}{" "}
                <span className={`bg-gradient-to-r ${colors.gradient} bg-clip-text text-transparent`}>{config.headlineAccent}</span>
              </h1>
              <p className="text-slate-400 text-sm leading-relaxed mb-8">{config.subheadline}</p>

              <div className="space-y-3">
                {config.benefits.map((b, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }} className="flex items-start gap-3" data-testid={`benefit-${i}`}>
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colors.gradient} flex items-center justify-center shrink-0 mt-0.5`}>
                      <b.icon size={14} className="text-white" />
                    </div>
                    <span className="text-sm text-slate-300">{b.text}</span>
                  </motion.div>
                ))}
              </div>

              <div className="mt-8 p-4 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className={colors.text} />
                  <span className="text-xs font-bold text-white">100% Free — No credit card required</span>
                </div>
                <p className="text-xs text-slate-500">Takes less than 2 minutes. We'll show you exactly how Apex can transform your {config.industry.toLowerCase()} business.</p>
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-3">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 flex-1">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${i < step ? `bg-gradient-to-br ${colors.gradient} text-white` : i === step ? `border-2 ${colors.border} ${colors.text}` : "border border-white/10 text-slate-600"}`}>
                      {i < step ? <CheckCircle2 size={14} /> : i + 1}
                    </div>
                    {i < steps.length - 1 && <div className={`flex-1 h-px ${i < step ? colors.bg : "bg-white/10"} transition-all`} />}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">Step {step + 1} of {steps.length}: <span className="text-white font-medium">{steps[step]}</span></p>
            </div>

            <motion.div className="p-6 md:p-8 rounded-2xl bg-white/[0.03] border border-white/5 backdrop-blur-sm" data-testid="funnel-form">
              <AnimatePresence mode="wait">
                {step === 0 && (
                  <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                    <h2 className="text-xl font-bold mb-1">Tell us about yourself</h2>
                    <p className="text-sm text-slate-400 mb-4">We'll use this to personalize your strategy session.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>First Name *</label>
                        <div className="relative">
                          <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input className={`${inputClass} pl-9`} placeholder="John" value={formData.firstName} onChange={e => updateField("firstName", e.target.value)} data-testid="input-firstName" />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Last Name</label>
                        <input className={inputClass} placeholder="Smith" value={formData.lastName} onChange={e => updateField("lastName", e.target.value)} data-testid="input-lastName" />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Email Address *</label>
                      <div className="relative">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input className={`${inputClass} pl-9`} type="email" placeholder="john@business.com" value={formData.email} onChange={e => updateField("email", e.target.value)} data-testid="input-email" />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Phone Number *</label>
                      <div className="relative">
                        <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input className={`${inputClass} pl-9`} type="tel" placeholder="(555) 123-4567" value={formData.phone} onChange={e => updateField("phone", e.target.value)} data-testid="input-phone" />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Business Name</label>
                      <div className="relative">
                        <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input className={`${inputClass} pl-9`} placeholder="Your Business LLC" value={formData.businessName} onChange={e => updateField("businessName", e.target.value)} data-testid="input-businessName" />
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                    <h2 className="text-xl font-bold mb-1">About Your Business</h2>
                    <p className="text-sm text-slate-400 mb-4">Help us understand your needs so we can tailor your strategy.</p>
                    {config.qualifyingQuestions.map(q => (
                      <div key={q.id}>
                        <label className={labelClass}>{q.label}{q.required !== false && " *"}</label>
                        {q.type === "select" && (
                          <select className={inputClass} value={formData[q.id] || ""} onChange={e => updateField(q.id, e.target.value)} data-testid={`input-${q.id}`}>
                            <option value="" className="bg-neutral-900">Select...</option>
                            {q.options?.map(o => <option key={o} value={o} className="bg-neutral-900">{o}</option>)}
                          </select>
                        )}
                        {q.type === "text" && (
                          <input className={inputClass} placeholder={q.placeholder || ""} value={formData[q.id] || ""} onChange={e => updateField(q.id, e.target.value)} data-testid={`input-${q.id}`} />
                        )}
                        {q.type === "textarea" && (
                          <textarea className={`${inputClass} min-h-[80px]`} placeholder={q.placeholder || ""} value={formData[q.id] || ""} onChange={e => updateField(q.id, e.target.value)} data-testid={`input-${q.id}`} />
                        )}
                        {q.type === "radio" && (
                          <div className="grid grid-cols-2 gap-2 mt-1">
                            {q.options?.map(o => (
                              <button key={o} onClick={() => updateField(q.id, o)} className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${formData[q.id] === o ? `${colors.border} ${colors.text} bg-white/5` : "border-white/10 text-slate-400 hover:border-white/20"}`} data-testid={`radio-${q.id}-${o}`}>
                                {o}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                    <h2 className="text-xl font-bold mb-1">Pick Your Session Time</h2>
                    <p className="text-sm text-slate-400 mb-4">{config.calendarNote || "Choose a day and time that works best for your free strategy call."}</p>
                    <div>
                      <label className={labelClass}>Preferred Day *</label>
                      <div className="relative">
                        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <select className={`${inputClass} pl-9`} value={formData.preferredDay} onChange={e => updateField("preferredDay", e.target.value)} data-testid="input-preferredDay">
                          <option value="" className="bg-neutral-900">Select a day...</option>
                          <option value="Monday" className="bg-neutral-900">Monday</option>
                          <option value="Tuesday" className="bg-neutral-900">Tuesday</option>
                          <option value="Wednesday" className="bg-neutral-900">Wednesday</option>
                          <option value="Thursday" className="bg-neutral-900">Thursday</option>
                          <option value="Friday" className="bg-neutral-900">Friday</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Preferred Time *</label>
                      <div className="relative">
                        <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <select className={`${inputClass} pl-9`} value={formData.preferredTime} onChange={e => updateField("preferredTime", e.target.value)} data-testid="input-preferredTime">
                          <option value="" className="bg-neutral-900">Select a time...</option>
                          <option value="9:00 AM" className="bg-neutral-900">9:00 AM</option>
                          <option value="10:00 AM" className="bg-neutral-900">10:00 AM</option>
                          <option value="11:00 AM" className="bg-neutral-900">11:00 AM</option>
                          <option value="12:00 PM" className="bg-neutral-900">12:00 PM</option>
                          <option value="1:00 PM" className="bg-neutral-900">1:00 PM</option>
                          <option value="2:00 PM" className="bg-neutral-900">2:00 PM</option>
                          <option value="3:00 PM" className="bg-neutral-900">3:00 PM</option>
                          <option value="4:00 PM" className="bg-neutral-900">4:00 PM</option>
                          <option value="5:00 PM" className="bg-neutral-900">5:00 PM</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Anything else we should know?</label>
                      <textarea className={`${inputClass} min-h-[80px]`} placeholder="Tell us about your biggest challenge right now..." value={formData.notes || ""} onChange={e => updateField("notes", e.target.value)} data-testid="input-notes" />
                    </div>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div key="step3" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }} className={`w-20 h-20 rounded-full bg-gradient-to-br ${colors.gradient} flex items-center justify-center mx-auto mb-6`}>
                      <CheckCircle2 size={40} className="text-white" />
                    </motion.div>
                    <h2 className="text-2xl font-black mb-3" data-testid="text-thank-you">{config.thankYouTitle}</h2>
                    <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto mb-6">{config.thankYouMessage}</p>
                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 max-w-sm mx-auto mb-6">
                      <p className="text-xs text-slate-500 mb-2">Your session details:</p>
                      <p className="text-sm text-white font-medium">{formData.preferredDay} at {formData.preferredTime}</p>
                      <p className="text-xs text-slate-400 mt-1">{formData.email}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Link href={`/${config.slug}`}>
                        <span className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r ${colors.gradient} text-white font-bold text-sm hover:opacity-90 transition-all cursor-pointer`} data-testid="button-back-landing">
                          Back to {config.industry} <ArrowRight size={14} />
                        </span>
                      </Link>
                      <Link href="/pricing">
                        <span className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 text-white font-bold text-sm hover:bg-white/5 transition-all cursor-pointer" data-testid="button-view-pricing">
                          View Plans
                        </span>
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {step < 3 && (
                <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
                  {step > 0 ? (
                    <button onClick={() => setStep(s => s - 1)} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors" data-testid="button-back">
                      <ArrowLeft size={14} /> Back
                    </button>
                  ) : <div />}
                  <button
                    onClick={handleNext}
                    disabled={!canAdvance() || submitting}
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r ${colors.gradient} text-white font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg ${colors.glow}`}
                    data-testid="button-next"
                  >
                    {submitting ? (
                      <><Loader2 size={14} className="animate-spin" /> Booking...</>
                    ) : step === 2 ? (
                      <>Book My Session <CheckCircle2 size={14} /></>
                    ) : (
                      <>Continue <ArrowRight size={14} /></>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      <footer className="py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">&copy; {new Date().getFullYear()} Apex Marketing Automations. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Home</span></Link>
            <Link href="/niches"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Industries</span></Link>
            <Link href="/pricing"><span className="text-xs text-slate-500 hover:text-white transition-colors cursor-pointer">Pricing</span></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
