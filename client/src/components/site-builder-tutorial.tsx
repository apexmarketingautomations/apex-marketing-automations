import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronRight, ChevronLeft, Sparkles, Send, Palette, Monitor,
  Smartphone, Eye, Save, Globe, GripVertical, Plus, Rocket, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  fallbackDescription?: string;
  icon: React.ComponentType<any>;
  targetSelector?: string;
  position: "center" | "bottom-left" | "bottom-right" | "top-center" | "top-right";
  action?: string;
  tip?: string;
  requiresTarget?: boolean;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Site Architect",
    description: "This tutorial will walk you through building your first website in under 2 minutes. You'll learn how to generate, customize, and publish a professional site using AI.",
    icon: Sparkles,
    position: "center",
  },
  {
    id: "prompt",
    title: "Step 1: Describe Your Site",
    description: "Type a description of the website you want to build. Be specific — mention your business type, style preferences, and key sections you need. For example: \"A modern dental clinic website with booking, services, and team sections.\"",
    icon: Send,
    targetSelector: "[data-testid='input-prompt']",
    position: "bottom-left",
    tip: "The more detail you give, the better the AI generates your site.",
  },
  {
    id: "generate",
    title: "Step 2: Generate",
    description: "Click the send button (or press Enter) to generate your website. The AI will create a complete multi-section site with your theme, content, and layout in seconds.",
    icon: Rocket,
    targetSelector: "[data-testid='button-generate']",
    position: "bottom-left",
    action: "Click Generate after typing your prompt",
  },
  {
    id: "templates",
    title: "Or Start from a Template",
    description: "Don't want to start from scratch? Browse the Template Gallery for pre-built designs across industries like fitness, law, restaurants, and more. Pick one and customize it.",
    icon: Palette,
    targetSelector: "[data-testid='button-open-templates']",
    position: "bottom-left",
    tip: "Templates are fully editable — use them as starting points.",
  },
  {
    id: "preview",
    title: "Step 3: Preview Your Site",
    description: "Once generated, your full website appears in the preview panel on the right. Scroll through to see every section the AI built for you.",
    fallbackDescription: "After you generate a site, it will appear in the preview panel on the right. You'll be able to scroll through every section the AI built.",
    icon: Monitor,
    targetSelector: "[data-testid='preview-canvas']",
    position: "top-center",
  },
  {
    id: "responsive",
    title: "Check Mobile View",
    description: "Switch between desktop and mobile previews to see how your site looks on different devices. Every generated site is automatically responsive.",
    icon: Smartphone,
    targetSelector: "[data-testid='button-view-mobile']",
    position: "top-center",
    tip: "Always check mobile view — most visitors browse on phones.",
  },
  {
    id: "edit-mode",
    title: "Step 4: Edit Mode",
    description: "Click 'Edit Mode' to unlock section-level editing. You can drag sections to reorder them, edit content inline, delete sections you don't need, or add new ones.",
    fallbackDescription: "After generating a site, an 'Edit Mode' button appears in the toolbar. It unlocks section-level editing — drag to reorder, edit inline, delete, or add new sections.",
    icon: Eye,
    targetSelector: "[data-testid='button-toggle-edit-mode']",
    position: "top-center",
    action: "Turn on Edit Mode to customize sections",
  },
  {
    id: "drag-sections",
    title: "Drag to Reorder",
    description: "In Edit Mode, grab any section by its handle and drag it to a new position. Build the exact page flow you want — hero first, then features, testimonials, pricing, and contact.",
    icon: GripVertical,
    position: "center",
    tip: "Common order: Hero → Features → Testimonials → Pricing → Contact",
  },
  {
    id: "add-sections",
    title: "Add New Sections",
    description: "Click the '+' button at the bottom of your site in Edit Mode to add new sections: Hero, Features, Testimonials, Pricing, Stats, FAQ, Gallery, Contact, and more.",
    icon: Plus,
    position: "center",
  },
  {
    id: "save",
    title: "Step 5: Save Your Work",
    description: "Click 'Save' to store your design. You can name it, create multiple versions, and come back to edit anytime from 'My Designs'.",
    icon: Save,
    targetSelector: "[data-testid='button-save-design']",
    position: "top-right",
    tip: "Every save creates a version — you can rollback to any previous version.",
  },
  {
    id: "publish",
    title: "Step 6: Publish",
    description: "When you're happy with your site, click 'Publish' to make it live. You can connect a custom domain from the Domains page for a professional URL.",
    icon: Globe,
    targetSelector: "[data-testid='button-publish']",
    position: "top-right",
  },
  {
    id: "done",
    title: "You're Ready!",
    description: "That's everything you need to build professional websites with AI. Start by describing your business in the prompt box — your first site is just one sentence away.",
    icon: CheckCircle2,
    position: "center",
  },
];

const STORAGE_KEY = "apex_site_tutorial_completed";

export function SiteBuilderTutorial({ onClose }: { onClose: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [targetFound, setTargetFound] = useState(false);
  const hasScrolledRef = useRef(false);

  const step = TUTORIAL_STEPS[currentStep];
  const totalSteps = TUTORIAL_STEPS.length;
  const progress = ((currentStep + 1) / totalSteps) * 100;

  useEffect(() => {
    hasScrolledRef.current = false;

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
        const rect = el.getBoundingClientRect();
        setHighlightRect(rect);
        setTargetFound(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleResize = () => findTarget();
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [currentStep, step.targetSelector]);

  const displayDescription = (!targetFound && step.fallbackDescription)
    ? step.fallbackDescription
    : step.description;

  const next = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      complete();
    }
  };

  const prev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const complete = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    onClose();
  };

  const getPopoverPosition = (): React.CSSProperties => {
    if (step.position === "center" || !highlightRect || !targetFound) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const padding = 16;
    const cardWidth = 400;
    const cardHeight = 280;

    switch (step.position) {
      case "bottom-left":
        return {
          top: Math.min(highlightRect.bottom + padding, window.innerHeight - cardHeight - padding),
          left: Math.max(highlightRect.left, padding),
          maxWidth: cardWidth,
        };
      case "bottom-right":
        return {
          top: Math.min(highlightRect.bottom + padding, window.innerHeight - cardHeight - padding),
          left: Math.min(highlightRect.right - cardWidth, window.innerWidth - cardWidth - padding),
          maxWidth: cardWidth,
        };
      case "top-center":
        return {
          top: Math.max(highlightRect.top - cardHeight - padding, padding),
          left: Math.max(highlightRect.left + (highlightRect.width / 2) - (cardWidth / 2), padding),
          maxWidth: cardWidth,
        };
      case "top-right":
        return {
          top: Math.max(highlightRect.top - cardHeight - padding, padding),
          right: padding,
          maxWidth: cardWidth,
        };
      default:
        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
  };

  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 z-[9999]" data-testid="tutorial-overlay">
      <div
        className="absolute inset-0"
        style={{
          background: (highlightRect && targetFound)
            ? undefined
            : "rgba(0, 0, 0, 0.75)",
        }}
      />

      {highlightRect && targetFound && (
        <>
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <defs>
              <mask id="tutorial-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={highlightRect.left - 6}
                  y={highlightRect.top - 6}
                  width={highlightRect.width + 12}
                  height={highlightRect.height + 12}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0" y="0" width="100%" height="100%"
              fill="rgba(0,0,0,0.75)"
              mask="url(#tutorial-mask)"
            />
          </svg>

          <motion.div
            key={`highlight-${currentStep}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute pointer-events-none"
            style={{
              left: highlightRect.left - 6,
              top: highlightRect.top - 6,
              width: highlightRect.width + 12,
              height: highlightRect.height + 12,
              border: "2px solid rgba(99, 102, 241, 0.8)",
              borderRadius: 8,
              boxShadow: "0 0 20px rgba(99, 102, 241, 0.3), 0 0 40px rgba(99, 102, 241, 0.1)",
              zIndex: 2,
            }}
          />
        </>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="absolute"
          style={{ ...getPopoverPosition(), zIndex: 10 }}
          data-testid={`tutorial-step-${step.id}`}
        >
          <div className="bg-neutral-950 border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-500/10 overflow-hidden w-[400px]">
            <div className="h-1 bg-neutral-800">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>

            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                    <StepIcon size={20} className="text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                      Step {currentStep + 1} of {totalSteps}
                    </p>
                    <h3 className="text-white font-bold text-sm">{step.title}</h3>
                  </div>
                </div>
                <button
                  onClick={complete}
                  className="text-slate-500 hover:text-white transition-colors p-1"
                  data-testid="button-tutorial-close"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-slate-400 text-sm leading-relaxed mb-3">
                {displayDescription}
              </p>

              {step.tip && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-indigo-300">
                    <span className="font-bold">Pro tip:</span> {step.tip}
                  </p>
                </div>
              )}

              {step.action && targetFound && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                  <p className="text-xs text-amber-300">
                    <span className="font-bold">Try it:</span> {step.action}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={prev}
                  disabled={currentStep === 0}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
                  data-testid="button-tutorial-prev"
                >
                  <ChevronLeft size={14} /> Back
                </button>

                <div className="flex items-center gap-1.5">
                  {TUTORIAL_STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentStep(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-all ${
                        i === currentStep
                          ? "bg-indigo-500 w-4"
                          : i < currentStep
                          ? "bg-indigo-500/50"
                          : "bg-white/10"
                      }`}
                      data-testid={`button-tutorial-dot-${i}`}
                    />
                  ))}
                </div>

                <Button
                  size="sm"
                  onClick={next}
                  className="bg-indigo-600 hover:bg-indigo-500 text-xs h-8 px-4"
                  data-testid="button-tutorial-next"
                >
                  {currentStep === totalSteps - 1 ? (
                    "Start Building"
                  ) : (
                    <>
                      Next <ChevronRight size={14} />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <button
          onClick={complete}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2"
          data-testid="button-tutorial-skip"
        >
          Skip Tutorial
        </button>
      </div>
    </div>
  );
}

export function useSiteBuilderTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      const timer = setTimeout(() => setShowTutorial(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  return {
    showTutorial,
    startTutorial: () => setShowTutorial(true),
    closeTutorial: () => setShowTutorial(false),
  };
}
