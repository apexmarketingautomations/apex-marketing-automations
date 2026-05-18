/**
 * client/src/components/card-identity/IdentityPromptPanel.tsx
 *
 * AI Identity prompt panel — similar to PromptDesignPanel but for cards.
 * Generates and patches IdentityVisualDNA from user prompts.
 */

import React, { useState, useRef, useCallback } from "react";
import { Sparkles, Zap, RotateCcw, RotateCw, ChevronDown, ChevronUp, Loader2, Check, AlertCircle } from "lucide-react";
import type { IdentityVisualDNA } from "@/lib/card-identity/schema";
import { localPatchDNA } from "@/lib/card-identity/identityPatchEngine";

const EXAMPLE_PROMPTS = [
  "Luxury AI founder with holographic blue particles",
  "Cyberpunk DJ with neon rain and electric nightclub energy",
  "Warm family law attorney with soft purples and trust signals",
  "High-end realtor with gold reflections and luxury animations",
  "Pet grooming studio with playful floating paw prints",
  "Fitness coach with explosive energy and neon green",
  "Med spa with rose gold particles and cinematic lighting",
  "Tech startup founder with minimal dark aesthetic",
];

const QUICK_CHIPS = [
  { label: "More luxury",      prompt: "more luxury" },
  { label: "Add glow",         prompt: "add glow" },
  { label: "Reduce motion",    prompt: "reduce motion" },
  { label: "Darker",           prompt: "darker" },
  { label: "More cinematic",   prompt: "more cinematic" },
  { label: "Playful",          prompt: "playful" },
  { label: "Minimal",          prompt: "minimal" },
  { label: "More particles",   prompt: "more particles" },
];

const MAX_UNDO = 15;

export interface IdentityPromptPanelProps {
  currentDna: IdentityVisualDNA | null;
  onDnaUpdate: (dna: IdentityVisualDNA) => void;
  profileContext?: {
    name?: string;
    title?: string;
    company?: string;
    bio?: string;
    niche?: string;
  };
  isAdmin?: boolean;
}

export function IdentityPromptPanel({ currentDna, onDnaUpdate, profileContext, isAdmin }: IdentityPromptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // Undo/redo stacks
  const [undoStack, setUndoStack] = useState<IdentityVisualDNA[]>([]);
  const [redoStack, setRedoStack] = useState<IdentityVisualDNA[]>([]);

  const pushToUndo = useCallback((dna: IdentityVisualDNA) => {
    setUndoStack(prev => [...prev.slice(-(MAX_UNDO - 1)), dna]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    if (currentDna) setRedoStack(s => [...s, currentDna]);
    onDnaUpdate(prev);
  }, [undoStack, currentDna, onDnaUpdate]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(s => s.slice(0, -1));
    if (currentDna) setUndoStack(s => [...s, currentDna]);
    onDnaUpdate(next);
  }, [redoStack, currentDna, onDnaUpdate]);

  const applyDna = useCallback((dna: IdentityVisualDNA) => {
    if (currentDna) pushToUndo(currentDna);
    onDnaUpdate(dna);
    setStatus("success");
    setStatusMsg("Identity applied!");
    setTimeout(() => setStatus("idle"), 2000);
  }, [currentDna, onDnaUpdate, pushToUndo]);

  const generate = useCallback(async (p: string) => {
    const clean = p.trim();
    if (!clean) return;
    setLoading(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/card-identity/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: clean, profileContext }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { dna } = await res.json();
      applyDna(dna);
    } catch (err: unknown) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Generation failed");
      setTimeout(() => setStatus("idle"), 3000);
    } finally {
      setLoading(false);
    }
  }, [profileContext, applyDna]);

  const patch = useCallback(async (p: string) => {
    const clean = p.trim();
    if (!clean) return;

    // Try local patch first
    if (currentDna) {
      const local = localPatchDNA(currentDna, clean);
      if (local) {
        applyDna(local);
        return;
      }
    }

    // Fall back to server patch
    setLoading(true);
    setStatus("idle");
    try {
      const body = currentDna
        ? { prompt: clean, existingDna: currentDna }
        : { prompt: clean };

      const endpoint = currentDna ? "/api/card-identity/patch" : "/api/card-identity/generate";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const { dna } = await res.json();
      applyDna(dna);
    } catch (err: unknown) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Patch failed");
      setTimeout(() => setStatus("idle"), 3000);
    } finally {
      setLoading(false);
    }
  }, [currentDna, profileContext, applyDna]);

  const rotatePlaceholder = () => {
    setPlaceholderIdx(i => (i + 1) % EXAMPLE_PROMPTS.length);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <Sparkles size={15} className="text-indigo-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">AI Identity Engine</h3>
          <p className="text-[10px] text-slate-500">Describe your brand vibe — AI generates a cinematic 3D identity</p>
        </div>
      </div>

      {/* Prompt textarea */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void generate(prompt);
            }
          }}
          placeholder={EXAMPLE_PROMPTS[placeholderIdx]}
          rows={3}
          maxLength={1000}
          className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 resize-none outline-none focus:border-indigo-500/50 focus:bg-white/[0.06] transition-all"
        />
        <button
          onClick={rotatePlaceholder}
          className="absolute right-3 top-3 text-slate-600 hover:text-slate-400 transition-colors text-[10px]"
          title="Show another example"
        >
          try another
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => void generate(prompt)}
          disabled={loading || !prompt.trim()}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:from-indigo-500 hover:to-purple-500 transition-all"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? "Generating…" : "Generate Identity"}
        </button>

        {currentDna && (
          <button
            onClick={() => void patch(prompt || "refine")}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-slate-300 text-sm font-medium disabled:opacity-40 hover:bg-white/[0.1] transition-all"
            title="Apply incremental changes to existing identity"
          >
            <Zap size={14} className="text-cyan-400" />
            Apply
          </button>
        )}

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/10 text-slate-500 disabled:opacity-30 hover:text-slate-300 hover:bg-white/[0.08] transition-all"
          title="Undo"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/10 text-slate-500 disabled:opacity-30 hover:text-slate-300 hover:bg-white/[0.08] transition-all"
          title="Redo"
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* Status message */}
      {status === "success" && (
        <div className="flex items-center gap-2 text-green-400 text-xs">
          <Check size={12} /> {statusMsg}
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-2 text-red-400 text-xs">
          <AlertCircle size={12} /> {statusMsg}
        </div>
      )}

      {/* Quick chips */}
      {currentDna && (
        <div>
          <p className="text-[10px] text-slate-600 uppercase font-bold tracking-wider mb-2">Quick Adjustments</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CHIPS.map(chip => (
              <button
                key={chip.label}
                onClick={() => void patch(chip.prompt)}
                disabled={loading}
                className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/[0.05] border border-white/10 text-slate-400 hover:text-white hover:bg-white/[0.1] hover:border-white/20 transition-all disabled:opacity-40"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Admin debug panel */}
      {isAdmin && currentDna && (
        <div>
          <button
            onClick={() => setShowDebug(d => !d)}
            className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            {showDebug ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            Debug DNA JSON
          </button>
          {showDebug && (
            <pre className="mt-2 text-[9px] text-slate-500 bg-black/40 rounded-lg p-3 overflow-auto max-h-60 border border-white/5">
              {JSON.stringify(currentDna, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
