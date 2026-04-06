import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, GripHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDraggable } from "@/hooks/use-draggable";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  fallbackDescription?: string;
  icon: React.ComponentType<any>;
  targetSelector?: string;
  position: "center" | "bottom-left" | "bottom-right" | "top-center" | "top-right" | "top-left";
  action?: string;
  tip?: string;
}

interface TutorialOverlayProps {
  steps: TutorialStep[];
  storageKey: string;
  onClose: () => void;
  finishLabel?: string;
  accentColor?: string;
}

export function TutorialOverlay({ steps, storageKey, onClose, finishLabel = "Get Started", accentColor = "indigo" }: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [targetFound, setTargetFound] = useState(false);
  const hasScrolledRef = useRef(false);
  const { offset, onPointerDown, resetOffset } = useDraggable();

  const step = steps[currentStep];
  const totalSteps = steps.length;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const colorMap: Record<string, { bg: string; border: string; text: string; glow: string; ring: string; gradient: string }> = {
    indigo: { bg: "bg-indigo-500/20", border: "border-indigo-500/30", text: "text-indigo-400", glow: "shadow-indigo-500/10", ring: "rgba(99,102,241,0.8)", gradient: "from-indigo-500 to-purple-500" },
    cyan: { bg: "bg-cyan-500/20", border: "border-cyan-500/30", text: "text-cyan-400", glow: "shadow-cyan-500/10", ring: "rgba(6,182,212,0.8)", gradient: "from-cyan-500 to-blue-500" },
    emerald: { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-400", glow: "shadow-emerald-500/10", ring: "rgba(16,185,129,0.8)", gradient: "from-emerald-500 to-teal-500" },
    red: { bg: "bg-red-500/20", border: "border-red-500/30", text: "text-red-400", glow: "shadow-red-500/10", ring: "rgba(239,68,68,0.8)", gradient: "from-red-500 to-orange-500" },
    purple: { bg: "bg-purple-500/20", border: "border-purple-500/30", text: "text-purple-400", glow: "shadow-purple-500/10", ring: "rgba(168,85,247,0.8)", gradient: "from-purple-500 to-pink-500" },
    amber: { bg: "bg-amber-500/20", border: "border-amber-500/30", text: "text-amber-400", glow: "shadow-amber-500/10", ring: "rgba(245,158,11,0.8)", gradient: "from-amber-500 to-orange-500" },
    violet: { bg: "bg-violet-500/20", border: "border-violet-500/30", text: "text-violet-400", glow: "shadow-violet-500/10", ring: "rgba(139,92,246,0.8)", gradient: "from-violet-500 to-fuchsia-500" },
  };
  const c = colorMap[accentColor] || colorMap.indigo;

  useEffect(() => {
    hasScrolledRef.current = false;
    resetOffset();
    if (!step.targetSelector) {
      setHighlightRect(null);
      setTargetFound(false);
      return;
    }
    const findTarget = () => {
      const el = document.querySelector(step.targetSelector!);
      if (el) {
        const rect = el.getBoundingClientRect();
        setHighlightRect(rect);
        setTargetFound(true);
        if (!hasScrolledRef.current) {
          hasScrolledRef.current = true;
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } else {
        setHighlightRect(null);
        setTargetFound(false);
      }
    };
    findTarget();
    const observer = new MutationObserver(() => {
      const el = document.querySelector(step.targetSelector!);
      if (el) {
        setHighlightRect(el.getBoundingClientRect());
        setTargetFound(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const handleLayout = () => findTarget();
    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
    };
  }, [currentStep, step.targetSelector]);

  const displayDescription = (!targetFound && step.fallbackDescription) ? step.fallbackDescription : step.description;

  const next = () => { if (currentStep < totalSteps - 1) setCurrentStep(currentStep + 1); else complete(); };
  const prev = () => { if (currentStep > 0) setCurrentStep(currentStep - 1); };
  const complete = () => { localStorage.setItem(storageKey, "true"); onClose(); };

  const getPopoverPosition = (): React.CSSProperties => {
    const isMobileView = window.innerWidth < 640;
    if (isMobileView) {
      return {
        bottom: 80,
        left: "50%",
        transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`,
        maxWidth: "calc(100vw - 32px)",
        width: "100%",
      };
    }
    if (step.position === "center" || !highlightRect || !targetFound) {
      return { top: "50%", left: "50%", transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` };
    }
    const p = 16, cw = 400, ch = 280;
    let base: React.CSSProperties;
    switch (step.position) {
      case "bottom-left": base = { top: Math.min(highlightRect.bottom + p, window.innerHeight - ch - p), left: Math.max(highlightRect.left, p), maxWidth: cw }; break;
      case "bottom-right": base = { top: Math.min(highlightRect.bottom + p, window.innerHeight - ch - p), left: Math.min(highlightRect.right - cw, window.innerWidth - cw - p), maxWidth: cw }; break;
      case "top-center": base = { top: Math.max(highlightRect.top - ch - p, p), left: Math.max(highlightRect.left + (highlightRect.width / 2) - (cw / 2), p), maxWidth: cw }; break;
      case "top-right": base = { top: Math.max(highlightRect.top - ch - p, p), right: p, maxWidth: cw }; break;
      case "top-left": base = { top: Math.max(highlightRect.top - ch - p, p), left: Math.max(highlightRect.left, p), maxWidth: cw }; break;
      default: base = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    return {
      ...base,
      transform: `translate(${offset.x}px, ${offset.y}px)`,
    };
  };

  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 z-[9999]" data-testid="tutorial-overlay">
      <div className="absolute inset-0" style={{ background: (highlightRect && targetFound) ? undefined : "rgba(0,0,0,0.75)" }} />

      {highlightRect && targetFound && (
        <>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <defs>
              <mask id="tutorial-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect x={highlightRect.left - 6} y={highlightRect.top - 6} width={highlightRect.width + 12} height={highlightRect.height + 12} rx="8" fill="black" />
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask="url(#tutorial-mask)" />
          </svg>
          <motion.div key={`hl-${currentStep}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute pointer-events-none"
            style={{ left: highlightRect.left - 6, top: highlightRect.top - 6, width: highlightRect.width + 12, height: highlightRect.height + 12, border: `2px solid ${c.ring}`, borderRadius: 8, boxShadow: `0 0 20px ${c.ring.replace("0.8", "0.3")}, 0 0 40px ${c.ring.replace("0.8", "0.1")}`, zIndex: 2 }} />
        </>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={currentStep} initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }} transition={{ duration: 0.25 }} className="absolute" style={{ ...getPopoverPosition(), zIndex: 10 }} data-testid={`tutorial-step-${step.id}`}>
          <div className={`bg-neutral-950 border ${c.border} rounded-2xl shadow-2xl ${c.glow} overflow-hidden w-full sm:w-[400px] max-w-[calc(100vw-32px)]`}>
            <div
              className="h-6 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
              onMouseDown={onPointerDown as any}
              onTouchStart={onPointerDown as any}
              data-testid="tutorial-drag-handle"
            >
              <GripHorizontal size={14} className="text-slate-600" />
            </div>
            <div className="h-1 bg-neutral-800 -mt-1">
              <motion.div className={`h-full bg-gradient-to-r ${c.gradient}`} initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
            </div>
            <div className="p-5 pt-3">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${c.bg} ${c.border} border flex items-center justify-center flex-shrink-0`}>
                    <StepIcon size={20} className={c.text} />
                  </div>
                  <div>
                    <p className={`text-[10px] ${c.text} font-bold uppercase tracking-widest`}>Step {currentStep + 1} of {totalSteps}</p>
                    <h3 className="text-white font-bold text-sm">{step.title}</h3>
                  </div>
                </div>
                <button onClick={complete} className="text-slate-500 hover:text-white transition-colors p-1" data-testid="button-tutorial-close"><X size={16} /></button>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed mb-3">{displayDescription}</p>
              {step.tip && (
                <div className={`${c.bg} ${c.border} border rounded-lg px-3 py-2 mb-3`}>
                  <p className={`text-xs ${c.text}`}><span className="font-bold">Pro tip:</span> {step.tip}</p>
                </div>
              )}
              {step.action && targetFound && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-amber-300"><span className="font-bold">Try it:</span> {step.action}</p>
                </div>
              )}
              <div className="flex items-center justify-between pt-2">
                <button onClick={prev} disabled={currentStep === 0} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors" data-testid="button-tutorial-prev">
                  <ChevronLeft size={14} /> Back
                </button>
                <div className="flex items-center gap-1.5">
                  {steps.map((_, i) => (
                    <button key={i} onClick={() => setCurrentStep(i)} className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentStep ? `bg-${accentColor}-500 w-4` : i < currentStep ? `bg-${accentColor}-500/50` : "bg-white/10"}`} data-testid={`button-tutorial-dot-${i}`} />
                  ))}
                </div>
                <Button size="sm" onClick={next} className={`bg-${accentColor}-600 hover:bg-${accentColor}-500 text-xs h-8 px-4`} data-testid="button-tutorial-next">
                  {currentStep === totalSteps - 1 ? finishLabel : (<>Next <ChevronRight size={14} /></>)}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <button onClick={complete} className="text-xs text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2" data-testid="button-tutorial-skip">Skip Tutorial</button>
      </div>
    </div>
  );
}

export function useTutorial(storageKey: string) {
  const [showTutorial, setShowTutorial] = useState(false);
  useEffect(() => {
    const completed = localStorage.getItem(storageKey);
    if (completed) return;

    const allTutorialKeys = [
      "apex_welcome_seen",
      "apex_tutorial_workflows",
      "apex_tutorial_site_builder",
      "apex_tutorial_bot_trainer",
      "apex_tutorial_growth_center",
      "apex_tutorial_inbox",
    ];
    const hasSeenAny = allTutorialKeys.some(k => localStorage.getItem(k) === "true");
    if (hasSeenAny) {
      localStorage.setItem(storageKey, "true");
      return;
    }

    const timer = setTimeout(() => setShowTutorial(true), 1500);
    return () => clearTimeout(timer);
  }, [storageKey]);
  return {
    showTutorial,
    startTutorial: () => setShowTutorial(true),
    closeTutorial: () => setShowTutorial(false),
  };
}
