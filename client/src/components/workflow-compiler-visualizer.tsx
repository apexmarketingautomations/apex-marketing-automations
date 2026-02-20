import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Zap, MessageSquare, Clock, GitFork, Target, Mail, UserPlus, TrendingUp, Bell, Globe, Sparkles, 
  CheckCircle2, Loader2, AlertTriangle, Play, ArrowDown 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ManifestStep {
  id: string;
  action_type: string;
  label?: string;
  params: Record<string, any>;
}

interface Manifest {
  name: string;
  description?: string;
  trigger: { type: string; filters?: Record<string, any> };
  steps: ManifestStep[];
}

interface VisualizerProps {
  manifest: Manifest | null;
  isBuilding: boolean;
  onComplete?: () => void;
}

const ACTION_CONFIG: Record<string, { icon: typeof Zap; color: string; glow: string }> = {
  SendTwilioSMS: { icon: MessageSquare, color: "text-blue-400", glow: "shadow-blue-500/30" },
  Wait: { icon: Clock, color: "text-amber-400", glow: "shadow-amber-500/30" },
  Condition: { icon: GitFork, color: "text-purple-400", glow: "shadow-purple-500/30" },
  DeployMetaAd: { icon: Target, color: "text-pink-400", glow: "shadow-pink-500/30" },
  SendEmail: { icon: Mail, color: "text-cyan-400", glow: "shadow-cyan-500/30" },
  CreateContact: { icon: UserPlus, color: "text-emerald-400", glow: "shadow-emerald-500/30" },
  UpdateDeal: { icon: TrendingUp, color: "text-orange-400", glow: "shadow-orange-500/30" },
  AlertTeam: { icon: Bell, color: "text-red-400", glow: "shadow-red-500/30" },
  WebhookCall: { icon: Globe, color: "text-indigo-400", glow: "shadow-indigo-500/30" },
  AIGenerate: { icon: Sparkles, color: "text-violet-400", glow: "shadow-violet-500/30" },
};

const TRIGGER_CONFIG: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  OnCrashDetected: { icon: AlertTriangle, color: "text-red-400", label: "Crash Detected" },
  OnNewLead: { icon: UserPlus, color: "text-emerald-400", label: "New Lead" },
  OnMissedCall: { icon: Bell, color: "text-amber-400", label: "Missed Call" },
  OnFormSubmit: { icon: Globe, color: "text-blue-400", label: "Form Submit" },
  OnAppointmentBooked: { icon: Clock, color: "text-cyan-400", label: "Appointment" },
  OnReviewReceived: { icon: Sparkles, color: "text-purple-400", label: "Review" },
  OnSMSReply: { icon: MessageSquare, color: "text-blue-400", label: "SMS Reply" },
  Manual: { icon: Play, color: "text-slate-400", label: "Manual" },
};

function StepParamSummary({ step }: { step: ManifestStep }) {
  const { action_type, params } = step;
  switch (action_type) {
    case "SendTwilioSMS":
      return <span className="text-blue-300/70">"{(params.body || "").slice(0, 60)}..."</span>;
    case "Wait":
      return <span className="text-amber-300/70">{params.duration_minutes} min delay</span>;
    case "Condition":
      return <span className="text-purple-300/70">Check: {params.check}</span>;
    case "DeployMetaAd":
      return <span className="text-pink-300/70">{params.campaign_name || "Geo-targeted Ad"}</span>;
    case "AlertTeam":
      return <span className="text-red-300/70">{params.message?.slice(0, 50)}</span>;
    case "CreateContact":
      return <span className="text-emerald-300/70">{params.first_name} {params.last_name || ""}</span>;
    default:
      return <span className="text-slate-400">{step.label || action_type}</span>;
  }
}

function GhostNode({ step, index, isRevealed, isWiring }: { step: ManifestStep; index: number; isRevealed: boolean; isWiring: boolean }) {
  const config = ACTION_CONFIG[step.action_type] || { icon: Zap, color: "text-slate-400", glow: "shadow-slate-500/30" };
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.8 }}
      animate={isRevealed ? {
        opacity: 1,
        y: 0,
        scale: 1,
      } : { opacity: 0.15, y: 30, scale: 0.8 }}
      transition={{ duration: 0.5, delay: isWiring ? 0 : 0.1, ease: "easeOut" }}
      className="relative"
      data-testid={`compiler-step-${index}`}
    >
      {index > 0 && (
        <motion.div
          className="flex justify-center py-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: isRevealed ? 1 : 0.2 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className={`h-6 w-0.5 ${isRevealed ? 'bg-gradient-to-b from-cyan-500/60 to-cyan-500/20' : 'bg-white/10'}`}
            animate={isWiring ? {
              boxShadow: ["0 0 4px rgba(6,182,212,0)", "0 0 12px rgba(6,182,212,0.6)", "0 0 4px rgba(6,182,212,0)"],
            } : {}}
            transition={{ duration: 1, repeat: isWiring ? Infinity : 0 }}
          />
        </motion.div>
      )}

      <motion.div
        className={`relative border rounded-xl p-3 backdrop-blur-sm transition-all duration-500 ${
          isRevealed
            ? `border-white/20 bg-white/5 shadow-lg ${config.glow}`
            : 'border-white/5 bg-white/[0.02]'
        }`}
        animate={isWiring ? {
          borderColor: ["rgba(255,255,255,0.1)", "rgba(6,182,212,0.5)", "rgba(255,255,255,0.2)"],
          boxShadow: ["0 0 0px rgba(6,182,212,0)", "0 0 20px rgba(6,182,212,0.3)", "0 0 0px rgba(6,182,212,0)"],
        } : {}}
        transition={{ duration: 1.5, ease: "easeInOut" }}
      >
        <div className="flex items-center gap-3">
          <motion.div
            className={`p-2 rounded-lg ${isRevealed ? 'bg-white/10' : 'bg-white/[0.03]'}`}
            animate={isWiring ? { rotate: [0, 10, -10, 0] } : {}}
            transition={{ duration: 0.5 }}
          >
            <Icon className={`h-4 w-4 ${isRevealed ? config.color : 'text-white/20'}`} />
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isRevealed ? config.color : 'text-white/20'}`}>
                {step.action_type}
              </span>
              {isWiring && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1"
                >
                  <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                  <span className="text-[10px] text-cyan-400">WIRING</span>
                </motion.div>
              )}
              {isRevealed && !isWiring && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                </motion.div>
              )}
            </div>
            <p className={`text-xs mt-0.5 truncate ${isRevealed ? 'text-white/60' : 'text-white/10'}`}>
              {step.label || <StepParamSummary step={step} />}
            </p>
          </div>
          <Badge variant="outline" className={`text-[9px] ${isRevealed ? 'border-white/20 text-white/50' : 'border-white/5 text-white/10'}`}>
            #{index + 1}
          </Badge>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function WorkflowCompilerVisualizer({ manifest, isBuilding, onComplete }: VisualizerProps) {
  const [revealedSteps, setRevealedSteps] = useState<number>(0);
  const [wiringStep, setWiringStep] = useState<number>(-1);
  const [buildComplete, setBuildComplete] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!manifest || !isBuilding) {
      setRevealedSteps(0);
      setWiringStep(-1);
      setBuildComplete(false);
      return;
    }

    const totalSteps = manifest.steps.length;
    let currentStep = 0;

    const revealNext = () => {
      if (currentStep >= totalSteps) {
        setBuildComplete(true);
        onComplete?.();
        return;
      }

      setWiringStep(currentStep);

      setTimeout(() => {
        setRevealedSteps(currentStep + 1);
        setWiringStep(-1);
        currentStep++;

        setTimeout(revealNext, 400);
      }, 800);
    };

    const timer = setTimeout(revealNext, 500);
    return () => clearTimeout(timer);
  }, [manifest, isBuilding]);

  useEffect(() => {
    if (!isBuilding && manifest) {
      setRevealedSteps(manifest.steps.length);
      setBuildComplete(true);
    }
  }, [isBuilding, manifest]);

  if (!manifest) return null;

  const triggerConfig = TRIGGER_CONFIG[manifest.trigger.type] || TRIGGER_CONFIG.Manual;
  const TriggerIcon = triggerConfig.icon;

  return (
    <div ref={containerRef} className="space-y-2" data-testid="compiler-visualizer">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative border border-white/20 rounded-xl p-3 bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 backdrop-blur-sm"
        data-testid="compiler-trigger"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/10">
            <TriggerIcon className={`h-4 w-4 ${triggerConfig.color}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">TRIGGER</span>
              <Badge variant="outline" className="text-[9px] border-cyan-500/30 text-cyan-400">
                {triggerConfig.label}
              </Badge>
            </div>
            {manifest.trigger.filters && Object.keys(manifest.trigger.filters).length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {Object.entries(manifest.trigger.filters).map(([key, val]) => (
                  <Badge key={key} variant="secondary" className="text-[9px] bg-white/5 text-white/50">
                    {key}: {Array.isArray(val) ? val.join(", ") : String(val)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {isBuilding && (
            <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
              <Zap className="h-4 w-4 text-cyan-400" />
            </motion.div>
          )}
        </div>
      </motion.div>

      <div className="flex justify-center">
        <motion.div
          className="h-4 w-0.5 bg-gradient-to-b from-cyan-500/40 to-transparent"
          animate={isBuilding ? { opacity: [0.3, 1, 0.3] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </div>

      <div className="space-y-0">
        <AnimatePresence mode="popLayout">
          {manifest.steps.map((step, i) => (
            <GhostNode
              key={step.id || `step-${i}`}
              step={step}
              index={i}
              isRevealed={i < revealedSteps}
              isWiring={i === wiringStep}
            />
          ))}
        </AnimatePresence>
      </div>

      {buildComplete && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center justify-center gap-2 py-2 text-xs"
          data-testid="compiler-complete"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-emerald-400 font-medium">
            {manifest.steps.length} steps wired — Automation compiled
          </span>
        </motion.div>
      )}
    </div>
  );
}

export { ACTION_CONFIG, TRIGGER_CONFIG };
export type { Manifest, ManifestStep };
