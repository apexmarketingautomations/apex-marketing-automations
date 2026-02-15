import { useState } from "react";
import {
  Rocket,
  Phone,
  Bot,
  Globe,
  GitFork,
  CheckCircle2,
  Loader2,
  Sparkles,
  AlertCircle,
  SkipForward,
  Zap,
  Shield,
  Users,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const INDUSTRIES = [
  { id: "fitness", label: "Fitness / Gym", icon: "💪" },
  { id: "restaurant", label: "Restaurant / Food", icon: "🍽️" },
  { id: "medspa", label: "Med Spa / Wellness", icon: "✨" },
  { id: "realestate", label: "Real Estate", icon: "🏠" },
  { id: "dental", label: "Dental / Medical", icon: "🦷" },
  { id: "auto", label: "Auto / Detailing", icon: "🚗" },
  { id: "salon", label: "Salon / Beauty", icon: "💅" },
  { id: "legal", label: "Legal / Law Firm", icon: "⚖️" },
  { id: "luxury", label: "Luxury Services", icon: "👑" },
  { id: "tech", label: "Tech / SaaS", icon: "🖥️" },
  { id: "ecommerce", label: "E-Commerce", icon: "🛒" },
  { id: "other", label: "Other", icon: "🔮" },
];

type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

interface LaunchStep {
  id: string;
  label: string;
  status: StepStatus;
  icon: any;
}

const STEP_ICONS: Record<string, any> = {
  account: Users,
  phone: Phone,
  voice: Bot,
  bot: Sparkles,
  site: Globe,
  workflow: GitFork,
};

function StepIndicator({ step, index }: { step: LaunchStep; index: number }) {
  const Icon = STEP_ICONS[step.id] || Zap;
  return (
    <motion.div
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.15, duration: 0.4 }}
      className="flex items-center gap-4 py-4 px-5 rounded-xl border border-white/5 bg-white/[0.02]"
      data-testid={`step-${step.id}`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
        step.status === "done" ? "bg-emerald-500/20 text-emerald-400" :
        step.status === "running" ? "bg-indigo-500/20 text-indigo-400" :
        step.status === "skipped" ? "bg-yellow-500/10 text-yellow-500/50" :
        step.status === "error" ? "bg-red-500/20 text-red-400" :
        "bg-white/5 text-white/20"
      }`}>
        {step.status === "running" ? <Loader2 size={22} className="animate-spin" /> :
         step.status === "done" ? <CheckCircle2 size={22} /> :
         step.status === "skipped" ? <SkipForward size={18} /> :
         step.status === "error" ? <AlertCircle size={22} /> :
         <Icon size={22} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${
          step.status === "done" ? "text-emerald-400" :
          step.status === "running" ? "text-white" :
          step.status === "skipped" ? "text-yellow-500/50" :
          "text-white/30"
        }`}>{step.label}</p>
        <p className="text-[11px] mt-0.5 opacity-40">
          {step.status === "done" ? "Completed" :
           step.status === "running" ? "In progress..." :
           step.status === "skipped" ? "Skipped (not configured)" :
           step.status === "error" ? "Failed" :
           "Waiting"}
        </p>
      </div>
      {step.status === "done" && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-emerald-400">
          <CheckCircle2 size={20} />
        </motion.div>
      )}
    </motion.div>
  );
}

export default function GodMode() {
  const { toast } = useToast();
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [steps, setSteps] = useState<LaunchStep[]>([]);
  const [results, setResults] = useState<any>(null);

  const handleLaunch = async () => {
    if (!businessName.trim() || !industry) return;
    setIsLaunching(true);
    setLaunched(false);

    const initialSteps: LaunchStep[] = [
      { id: "account", label: "Creating Sub-Account", status: "running", icon: Users },
      { id: "phone", label: "Provisioning AI Phone Line", status: "pending", icon: Phone },
      { id: "voice", label: "Deploying Voice Agent", status: "pending", icon: Bot },
      { id: "bot", label: "Training AI Knowledge Bot", status: "pending", icon: Sparkles },
      { id: "site", label: "Generating Landing Page", status: "pending", icon: Globe },
      { id: "workflow", label: "Creating Missed-Call Workflow", status: "pending", icon: GitFork },
    ];
    setSteps(initialSteps);

    let stepIdx = 0;
    const animateSteps = setInterval(() => {
      stepIdx++;
      if (stepIdx < initialSteps.length) {
        setSteps(prev => prev.map((s, i) =>
          i === stepIdx ? { ...s, status: "running" } :
          i < stepIdx ? { ...s, status: "done" } : s
        ));
      }
    }, 2500);

    try {
      const res = await fetch("/api/god-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          industry,
          website: website.trim() || undefined,
          areaCode: areaCode.trim() || undefined,
        }),
      });

      clearInterval(animateSteps);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Launch failed");
      }

      const data = await res.json();
      setResults(data);

      const finalSteps = data.steps.map((s: any) => ({
        id: s.id,
        label: s.label,
        status: s.status as StepStatus,
        icon: STEP_ICONS[s.id] || Zap,
      }));
      setSteps(finalSteps);
      setLaunched(true);

      toast({ title: "God Mode Activated!", description: `${businessName} is fully deployed.` });
    } catch (err: any) {
      clearInterval(animateSteps);
      toast({ title: "Launch Error", description: err.message, variant: "destructive" });
      setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s));
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 mb-6">
            <Zap size={12} /> GOD MODE
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4" data-testid="text-god-mode-title">
            One-Click <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Empire Builder</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Enter your business details and we'll automatically provision everything — phone line, AI voice agent, chatbot, landing page, and automation workflows.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <div className="glass-panel rounded-2xl p-6 space-y-5 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Shield size={18} className="text-indigo-400" />
                <h2 className="font-bold text-lg">Business Details</h2>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Business Name *</label>
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Apex Fitness Studio"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                  data-testid="input-business-name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2">Industry *</label>
                <div className="grid grid-cols-3 gap-2">
                  {INDUSTRIES.map((ind) => (
                    <button
                      key={ind.id}
                      onClick={() => setIndustry(ind.id)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-medium transition-all ${
                        industry === ind.id
                          ? "border-indigo-500 bg-indigo-500/10 text-indigo-300 shadow-lg shadow-indigo-500/10"
                          : "border-white/5 bg-white/[0.02] text-slate-400 hover:bg-white/5 hover:border-white/10"
                      }`}
                      data-testid={`button-industry-${ind.id}`}
                    >
                      <span className="text-lg">{ind.icon}</span>
                      <span className="truncate w-full text-center leading-tight">{ind.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Website URL (optional)</label>
                <Input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://mybusiness.com"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                  data-testid="input-website"
                />
                <p className="text-[10px] text-slate-600 mt-1">We'll scrape this to train your AI chatbot</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Area Code (optional)</label>
                <Input
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="239"
                  maxLength={3}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 w-32"
                  data-testid="input-area-code"
                />
                <p className="text-[10px] text-slate-600 mt-1">For your AI phone number</p>
              </div>

              <Button
                onClick={handleLaunch}
                disabled={isLaunching || !businessName.trim() || !industry}
                className="w-full py-6 text-base font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500 rounded-xl shadow-xl shadow-indigo-500/20 disabled:opacity-40"
                data-testid="button-launch-god-mode"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="mr-2 animate-spin" size={20} />
                    Deploying Empire...
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2" size={20} />
                    LAUNCH GOD MODE
                  </>
                )}
              </Button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <div className="glass-panel rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-2 mb-5">
                <Rocket size={18} className="text-purple-400" />
                <h2 className="font-bold text-lg">Launch Sequence</h2>
              </div>

              {steps.length === 0 ? (
                <div className="text-center py-16 text-slate-600">
                  <Rocket size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm">Fill in business details and hit Launch</p>
                  <p className="text-xs mt-1 opacity-50">6 systems will be deployed automatically</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence>
                    {steps.map((step, i) => (
                      <StepIndicator key={step.id} step={step} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {launched && results && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={20} className="text-emerald-400" />
                    <h3 className="font-bold text-emerald-400">Empire Deployed!</h3>
                  </div>
                  <div className="space-y-2 text-sm">
                    {results.phoneNumber && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Phone Line</span>
                        <span className="font-mono text-white">{results.phoneNumber}</span>
                      </div>
                    )}
                    {results.agentId && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Voice Agent</span>
                        <span className="font-mono text-emerald-400 text-xs">{results.agentId.slice(0, 16)}...</span>
                      </div>
                    )}
                    {results.siteGenerated && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Landing Page</span>
                        <span className="text-emerald-400 text-xs">Generated & Saved</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Workflow</span>
                      <span className="text-emerald-400 text-xs">Missed-Call Text Back Active</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          {[
            { icon: Phone, label: "AI Phone Line", desc: "Twilio number auto-provisioned" },
            { icon: Bot, label: "Voice Agent", desc: "Vapi AI receptionist deployed" },
            { icon: Globe, label: "Landing Page", desc: "AI-generated with 10+ sections" },
            { icon: GitFork, label: "Automation", desc: "Missed call text-back workflow" },
          ].map((item, i) => (
            <div key={i} className="text-center p-4 rounded-xl border border-white/5 bg-white/[0.02]">
              <item.icon size={24} className="mx-auto mb-2 text-indigo-400/50" />
              <p className="text-xs font-bold text-white/70">{item.label}</p>
              <p className="text-[10px] text-slate-600 mt-1">{item.desc}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
