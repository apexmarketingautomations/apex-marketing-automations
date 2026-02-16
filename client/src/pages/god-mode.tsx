import { useState } from "react";
import { useLocation } from "wouter";
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
  ArrowRight,
  ExternalLink,
  RefreshCcw,
  BookOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { GOD_MODE_STEPS } from "@/components/tutorial-steps";

const INDUSTRIES = [
  { id: "fitness", label: "Fitness / Gym", icon: "\u{1F4AA}" },
  { id: "restaurant", label: "Restaurant / Food", icon: "\u{1F37D}\u{FE0F}" },
  { id: "medspa", label: "Med Spa / Wellness", icon: "\u{2728}" },
  { id: "realestate", label: "Real Estate", icon: "\u{1F3E0}" },
  { id: "dental", label: "Dental / Medical", icon: "\u{1F9B7}" },
  { id: "auto", label: "Auto / Detailing", icon: "\u{1F697}" },
  { id: "salon", label: "Salon / Beauty", icon: "\u{1F485}" },
  { id: "legal", label: "Legal / Law Firm", icon: "\u{2696}\u{FE0F}" },
  { id: "luxury", label: "Luxury Services", icon: "\u{1F451}" },
  { id: "tech", label: "Tech / SaaS", icon: "\u{1F5A5}\u{FE0F}" },
  { id: "ecommerce", label: "E-Commerce", icon: "\u{1F6D2}" },
  { id: "other", label: "Other", icon: "\u{1F52E}" },
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
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_god_mode");
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

      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });

      toast({ title: "God Mode Activated!", description: `${businessName} is fully deployed.` });
    } catch (err: any) {
      clearInterval(animateSteps);
      toast({ title: "Launch Error", description: err.message, variant: "destructive" });
      setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s));
    } finally {
      setIsLaunching(false);
    }
  };

  const handleReset = () => {
    setBusinessName("");
    setIndustry("");
    setWebsite("");
    setAreaCode("");
    setIsLaunching(false);
    setLaunched(false);
    setSteps([]);
    setResults(null);
  };

  const doneCount = steps.filter(s => s.status === "done").length;
  const totalCount = steps.length;

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
              <Zap size={12} /> GOD MODE
            </div>
            <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
              <BookOpen size={16} className="mr-1" /> Tutorial
            </Button>
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
                  disabled={isLaunching}
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
                      disabled={isLaunching}
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
                  disabled={isLaunching}
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
                  disabled={isLaunching}
                  data-testid="input-area-code"
                />
                <p className="text-[10px] text-slate-600 mt-1">For your AI phone number</p>
              </div>

              {!launched ? (
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
              ) : (
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className="w-full py-6 text-base font-bold rounded-xl border-white/10 hover:bg-white/5"
                  data-testid="button-reset-god-mode"
                >
                  <RefreshCcw className="mr-2" size={18} />
                  Deploy Another Business
                </Button>
              )}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <div className="glass-panel rounded-2xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Rocket size={18} className="text-purple-400" />
                  <h2 className="font-bold text-lg">Launch Sequence</h2>
                </div>
                {steps.length > 0 && (
                  <span className="text-xs text-slate-400 font-mono">{doneCount}/{totalCount} complete</span>
                )}
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
                  className="mt-6 space-y-4"
                >
                  <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-4">
                      <CheckCircle2 size={20} className="text-emerald-400" />
                      <h3 className="font-bold text-emerald-400">Empire Deployed!</h3>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Account</span>
                        <span className="font-mono text-white text-xs">{results.businessName} (ID: {results.accountId})</span>
                      </div>
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
                      {results.jobId && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Bot Training</span>
                          <span className="text-emerald-400 text-xs">Job #{results.jobId} started</span>
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
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setLocation("/")}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                      data-testid="button-goto-inbox"
                    >
                      <Users size={14} />
                      Inbox
                      <ArrowRight size={12} className="ml-auto opacity-40" />
                    </button>
                    <button
                      onClick={() => setLocation("/workflows")}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                      data-testid="button-goto-workflows"
                    >
                      <GitFork size={14} />
                      Workflows
                      <ArrowRight size={12} className="ml-auto opacity-40" />
                    </button>
                    {results.siteGenerated && (
                      <button
                        onClick={() => setLocation("/site-builder")}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                        data-testid="button-goto-site-builder"
                      >
                        <Globe size={14} />
                        Site Builder
                        <ArrowRight size={12} className="ml-auto opacity-40" />
                      </button>
                    )}
                    {results.agentId && (
                      <button
                        onClick={() => setLocation("/voice-agent")}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                        data-testid="button-goto-voice-agent"
                      >
                        <Bot size={14} />
                        Voice Agent
                        <ArrowRight size={12} className="ml-auto opacity-40" />
                      </button>
                    )}
                    {results.jobId && (
                      <button
                        onClick={() => setLocation("/bot-trainer")}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                        data-testid="button-goto-bot-trainer"
                      >
                        <Sparkles size={14} />
                        Bot Trainer
                        <ArrowRight size={12} className="ml-auto opacity-40" />
                      </button>
                    )}
                    <button
                      onClick={() => setLocation("/billing")}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white transition-colors"
                      data-testid="button-goto-billing"
                    >
                      <ExternalLink size={14} />
                      Billing
                      <ArrowRight size={12} className="ml-auto opacity-40" />
                    </button>
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
      {showTutorial && <TutorialOverlay steps={GOD_MODE_STEPS} storageKey="apex_tutorial_god_mode" onClose={closeTutorial} accentColor="red" />}
    </div>
  );
}
