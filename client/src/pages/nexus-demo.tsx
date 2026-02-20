import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import { Satellite, Brain, GitFork, BarChart3, ArrowRight, ChevronRight, CheckCircle2, Zap, MessageSquare, Users, Clock, MapPin, AlertTriangle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const SCENE_DURATION = 5000;
const TOTAL_SCENES = 4;

function SentinelScene({ active }: { active: boolean }) {
  const [pulseCount, setPulseCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    setPulseCount(0);
    const interval = setInterval(() => setPulseCount(p => p + 1), 800);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 relative" data-testid="scene-sentinel">
      <div className="relative w-full max-w-2xl aspect-[16/9] rounded-2xl overflow-hidden mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-cyan-950" />
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: "radial-gradient(circle at 25% 25%, rgba(6,182,212,0.15) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(99,102,241,0.1) 0%, transparent 50%)",
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: "linear-gradient(rgba(6,182,212,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.05) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/40"
              initial={{ width: 20, height: 20, opacity: 0.8 }}
              animate={active ? {
                width: [20, 200 + i * 80],
                height: [20, 200 + i * 80],
                opacity: [0.8, 0],
              } : {}}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
            />
          ))}
          <motion.div
            className="relative z-10 w-5 h-5 rounded-full bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.8)]"
            animate={active ? { scale: [1, 1.4, 1] } : {}}
            transition={{ duration: 1, repeat: Infinity }}
          />
        </div>

        <motion.div
          className="absolute top-4 left-4 flex items-center gap-2"
          initial={{ opacity: 0, x: -20 }}
          animate={active ? { opacity: 1, x: 0 } : {}}
          transition={{ delay: 0.3 }}
        >
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span className="text-xs text-cyan-300/80 font-mono">26.1884° N, 80.1711° W</span>
        </motion.div>

        <motion.div
          className="absolute bottom-4 right-4"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: 1 } : {}}
          transition={{ delay: 0.6 }}
        >
          <span className="text-xs text-white/40 font-mono">LIVE FEED</span>
          <motion.span
            className="inline-block w-2 h-2 rounded-full bg-red-500 ml-2"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </motion.div>
      </div>

      <motion.div
        className="text-center space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={active ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1" data-testid="badge-severity">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
            SEVERITY: HIGH
          </Badge>
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 px-3 py-1" data-testid="badge-timestamp">
            <Clock className="w-3.5 h-3.5 mr-1.5" />
            {new Date().toLocaleTimeString()}
          </Badge>
        </div>
        <h2 className="text-2xl md:text-4xl font-bold text-white" data-testid="text-sentinel-title">
          <span className="text-cyan-400">Sentinel Alert:</span> MVA Detected
        </h2>
        <p className="text-lg md:text-xl text-white/60" data-testid="text-sentinel-location">
          I-95 & Commercial Blvd, Fort Lauderdale
        </p>
        <motion.div
          className="flex items-center justify-center gap-2 text-sm text-emerald-400"
          initial={{ opacity: 0 }}
          animate={active && pulseCount > 2 ? { opacity: 1 } : {}}
        >
          <Shield className="w-4 h-4" />
          <span>Geofence radius: 5 miles — Deploying response protocol...</span>
        </motion.div>
      </motion.div>
    </div>
  );
}

function OrchestratorScene({ active }: { active: boolean }) {
  const steps = [
    { text: "Analyzing incident severity...", icon: Brain },
    { text: "Geofence deployed — 5mi radius", icon: Satellite },
    { text: "SMS template generated", icon: MessageSquare },
    { text: "Workflow triggered", icon: Zap },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4" data-testid="scene-orchestrator">
      <motion.div
        className="mb-10 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={active ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 mb-6">
          <Brain className="w-5 h-5 text-indigo-400" />
          <span className="text-sm font-medium text-indigo-300">AI Orchestrator</span>
        </div>
        <h2 className="text-2xl md:text-4xl font-bold text-white" data-testid="text-orchestrator-title">Processing Alert</h2>
        <p className="text-white/50 mt-2">Apex AI is coordinating the response in real-time</p>
      </motion.div>

      <div className="w-full max-w-md space-y-4">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]"
            initial={{ opacity: 0, x: -40 }}
            animate={active ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.8 + i * 0.7, duration: 0.5 }}
            data-testid={`step-orchestrator-${i}`}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={active ? { scale: 1 } : {}}
              transition={{ delay: 1.1 + i * 0.7, type: "spring", stiffness: 300 }}
            >
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            </motion.div>
            <div className="flex items-center gap-3 flex-1">
              <step.icon className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="text-white/80 text-sm md:text-base">{step.text}</span>
            </div>
            <motion.div
              className="text-xs text-white/30 font-mono shrink-0"
              initial={{ opacity: 0 }}
              animate={active ? { opacity: 1 } : {}}
              transition={{ delay: 1.3 + i * 0.7 }}
            >
              +{(i * 0.8 + 0.3).toFixed(1)}s
            </motion.div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function WorkflowScene({ active }: { active: boolean }) {
  const nodes = [
    { label: "Trigger", icon: Zap, color: "from-red-500 to-orange-500" },
    { label: "SMS", icon: MessageSquare, color: "from-cyan-500 to-blue-500" },
    { label: "AI Bot", icon: Brain, color: "from-indigo-500 to-violet-500" },
    { label: "CRM Entry", icon: Users, color: "from-emerald-500 to-teal-500" },
    { label: "Follow-up", icon: Clock, color: "from-amber-500 to-yellow-500" },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4" data-testid="scene-workflow">
      <motion.div
        className="mb-10 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={active ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 mb-6">
          <GitFork className="w-5 h-5 text-violet-400" />
          <span className="text-sm font-medium text-violet-300">Workflow Engine</span>
        </div>
        <h2 className="text-2xl md:text-4xl font-bold text-white" data-testid="text-workflow-title">Executing Workflow</h2>
        <p className="text-white/50 mt-2">Automated pipeline running in sequence</p>
      </motion.div>

      <div className="flex flex-col md:flex-row items-center gap-3 md:gap-0 w-full max-w-3xl justify-center">
        {nodes.map((node, i) => (
          <div key={i} className="flex flex-col md:flex-row items-center" data-testid={`node-workflow-${i}`}>
            <motion.div
              className="relative flex flex-col items-center"
              initial={{ opacity: 0.2, scale: 0.8 }}
              animate={active ? { opacity: 1, scale: 1 } : {}}
              transition={{ delay: 0.5 + i * 0.6, duration: 0.4 }}
            >
              <motion.div
                className={`w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br ${node.color} flex items-center justify-center shadow-lg relative`}
                animate={active ? { boxShadow: ["0 0 0px rgba(6,182,212,0)", `0 0 30px rgba(6,182,212,0.3)`, "0 0 0px rgba(6,182,212,0)"] } : {}}
                transition={{ delay: 0.5 + i * 0.6, duration: 1.5 }}
              >
                <node.icon className="w-7 h-7 md:w-8 md:h-8 text-white" />
                <motion.div
                  className="absolute -top-1 -right-1"
                  initial={{ scale: 0 }}
                  animate={active ? { scale: 1 } : {}}
                  transition={{ delay: 0.9 + i * 0.6, type: "spring" }}
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 bg-[#0a0a1a] rounded-full" />
                </motion.div>
              </motion.div>
              <motion.span
                className="mt-2 text-xs md:text-sm text-white/60 font-medium"
                initial={{ opacity: 0 }}
                animate={active ? { opacity: 1 } : {}}
                transition={{ delay: 0.7 + i * 0.6 }}
              >
                {node.label}
              </motion.span>
            </motion.div>
            {i < nodes.length - 1 && (
              <motion.div
                className="hidden md:block w-8 h-0.5 bg-gradient-to-r from-cyan-500/60 to-transparent mx-1 mt-[-16px]"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={active ? { scaleX: 1, opacity: 1 } : {}}
                transition={{ delay: 0.9 + i * 0.6, duration: 0.3 }}
                style={{ transformOrigin: "left" }}
              />
            )}
            {i < nodes.length - 1 && (
              <motion.div
                className="md:hidden w-0.5 h-6 bg-gradient-to-b from-cyan-500/60 to-transparent my-1"
                initial={{ scaleY: 0, opacity: 0 }}
                animate={active ? { scaleY: 1, opacity: 1 } : {}}
                transition={{ delay: 0.9 + i * 0.6, duration: 0.3 }}
                style={{ transformOrigin: "top" }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnimatedCounter({ target, active, suffix = "" }: { target: number; active: boolean; suffix?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) { setCount(0); return; }
    let start = 0;
    const duration = 1500;
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [active, target]);

  return <span>{count}{suffix}</span>;
}

function ResultsScene({ active }: { active: boolean }) {
  const metrics = [
    { label: "First Contact", value: 47, suffix: "s", detail: "Average response time", icon: Zap, color: "from-cyan-500 to-blue-500" },
    { label: "Lead Captured", value: 100, suffix: "%", detail: "Automatic CRM entry", icon: Users, color: "from-emerald-500 to-teal-500" },
    { label: "Follow-up", value: 24, suffix: "hrs", detail: "Auto-scheduled callback", icon: Clock, color: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4" data-testid="scene-results">
      <motion.div
        className="mb-10 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={active ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
          <BarChart3 className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-300">Results Dashboard</span>
        </div>
        <h2 className="text-2xl md:text-4xl font-bold text-white" data-testid="text-results-title">Mission Complete</h2>
        <p className="text-white/50 mt-2">From detection to lead capture — fully automated</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl">
        {metrics.map((metric, i) => (
          <motion.div
            key={i}
            className="relative p-6 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center overflow-hidden"
            initial={{ opacity: 0, y: 30 }}
            animate={active ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.3 + i * 0.2, duration: 0.5 }}
            data-testid={`metric-result-${i}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${metric.color} opacity-[0.04]`} />
            <div className="relative z-10">
              <metric.icon className="w-8 h-8 text-cyan-400 mx-auto mb-3" />
              <div className="text-4xl md:text-5xl font-bold text-white mb-1">
                <AnimatedCounter target={metric.value} active={active} suffix={metric.suffix} />
              </div>
              <div className="text-sm font-semibold text-white/70 mb-1">{metric.label}</div>
              <div className="text-xs text-white/40">{metric.detail}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function CTASection() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-20 px-4 text-center"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.6 }}
      data-testid="section-cta"
    >
      <div className="relative">
        <div className="absolute -inset-20 bg-gradient-to-r from-cyan-500/10 via-indigo-500/10 to-violet-500/10 blur-3xl rounded-full" />
        <div className="relative z-10 space-y-6">
          <h2 className="text-3xl md:text-5xl font-bold text-white" data-testid="text-cta-title">
            Ready to automate your business?
          </h2>
          <p className="text-lg text-white/50 max-w-md mx-auto">
            Stop chasing leads manually. Let Apex detect, engage, and convert — on autopilot.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/pricing">
              <Button size="lg" className="bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white px-8 py-6 text-lg rounded-xl shadow-lg shadow-cyan-500/20" data-testid="button-view-pricing">
                View Pricing
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-white/10 text-white hover:bg-white/5 px-8 py-6 text-lg rounded-xl" data-testid="button-sign-up">
                Sign Up Free
                <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const SCENE_LABELS = ["Sentinel Detection", "AI Orchestrator", "Workflow Execution", "Results"];

export default function NexusDemo() {
  const [currentScene, setCurrentScene] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || currentScene >= TOTAL_SCENES) return;
    const timer = setTimeout(() => {
      setCurrentScene(prev => prev + 1);
    }, SCENE_DURATION);
    return () => clearTimeout(timer);
  }, [currentScene, paused]);

  const goTo = (scene: number) => {
    setPaused(true);
    setCurrentScene(scene);
  };

  const goNext = () => {
    setPaused(true);
    setCurrentScene(prev => Math.min(prev + 1, TOTAL_SCENES));
  };

  const goPrev = () => {
    setPaused(true);
    setCurrentScene(prev => Math.max(prev - 1, 0));
  };

  return (
    <div className="min-h-screen bg-[#06060f] text-white overflow-x-hidden" data-testid="demo-page">
      {currentScene < TOTAL_SCENES && (
        <div className="fixed top-0 left-0 right-0 z-50" data-testid="progress-bar">
          <div className="flex">
            {SCENE_LABELS.map((label, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className="flex-1 group relative"
                data-testid={`progress-segment-${i}`}
              >
                <div className="h-1 bg-white/[0.06]">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-400 to-indigo-400"
                    initial={{ width: "0%" }}
                    animate={{
                      width: i < currentScene ? "100%" : i === currentScene ? "100%" : "0%",
                    }}
                    transition={{
                      duration: i === currentScene ? SCENE_DURATION / 1000 : 0.3,
                      ease: i === currentScene ? "linear" : "easeOut",
                    }}
                  />
                </div>
                <div className="hidden md:flex items-center justify-center py-2 bg-[#06060f]/80 backdrop-blur-sm">
                  <span className={`text-xs font-medium transition-colors ${i <= currentScene ? "text-cyan-400" : "text-white/30"}`}>
                    {label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`${currentScene < TOTAL_SCENES ? "pt-6 md:pt-12" : ""}`}>
        <AnimatePresence mode="wait">
          {currentScene === 0 && (
            <motion.div
              key="sentinel"
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ duration: 0.5 }}
            >
              <SentinelScene active={currentScene === 0} />
            </motion.div>
          )}
          {currentScene === 1 && (
            <motion.div
              key="orchestrator"
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ duration: 0.5 }}
            >
              <OrchestratorScene active={currentScene === 1} />
            </motion.div>
          )}
          {currentScene === 2 && (
            <motion.div
              key="workflow"
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ duration: 0.5 }}
            >
              <WorkflowScene active={currentScene === 2} />
            </motion.div>
          )}
          {currentScene === 3 && (
            <motion.div
              key="results"
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -60 }}
              transition={{ duration: 0.5 }}
            >
              <ResultsScene active={currentScene === 3} />
            </motion.div>
          )}
          {currentScene >= TOTAL_SCENES && (
            <motion.div
              key="cta"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <CTASection />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {currentScene < TOTAL_SCENES && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3" data-testid="scene-controls">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentScene === 0}
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-20 rounded-full px-4"
            data-testid="button-prev"
          >
            ←
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused(p => !p)}
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5 rounded-full px-4 min-w-[72px]"
            data-testid="button-pause"
          >
            {paused ? "▶ Play" : "❚❚ Pause"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5 rounded-full px-4"
            data-testid="button-next"
          >
            →
          </Button>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-indigo-500/[0.03] rounded-full blur-[120px]" />
      </div>
    </div>
  );
}
