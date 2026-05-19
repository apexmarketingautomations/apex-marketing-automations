/**
 * client/src/components/dynamic-pages/PromptDesignPanel.tsx
 *
 * The prompt-driven design panel for the Apex Dynamic Pages builder.
 * Users type a prompt → Apex generates a full page schema → live preview updates.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, RefreshCw, ChevronRight, Clock, Undo2, Redo2,
  Code, Eye, EyeOff, Loader2, CheckCircle, AlertCircle,
  Wand2, Zap, RotateCcw,
  Image,
  Box,
} from "lucide-react";
import type { DynamicPageSchema } from "@/lib/dynamic-pages/schema";
import { applyLocalPromptPatch } from "@/lib/dynamic-pages/promptPatchEngine";

const EXAMPLE_PROMPTS = [
  "Make this a luxury med spa funnel with pink glassmorphism and floating Botox particles",
  "Turn this into a cyberpunk personal injury law firm with neon rain and electric blue",
  "A giraffe in outer space wearing a hat and sunglasses with starfield particles",
  "Make the hero a roofing storm damage emergency funnel with dark blues and urgency",
  "Luxury real estate with gold particles, cinematic lighting, and slow orbit camera",
  "Tech startup with holographic orbs, neon green accents, and fast particle field",
  "Warm family law practice with soft purples, gentle animations, and trust signals",
  "Dental office with clean whites, sky blues, and professional minimal design",
];

const INCREMENTAL_PROMPTS = [
  "Make it more cinematic", "Reduce motion", "Add glow to CTA",
  "Make it darker", "Add more particles", "Make it mobile friendly",
  "Change to neon colors", "Make it more premium",
];

interface Props {
  currentSchema: DynamicPageSchema | null;
  onSchemaUpdate: (schema: DynamicPageSchema) => void;
  subAccountId?: number;
  isAdmin?: boolean;
}

// [FIX 2026-05-18] HISTORY_KEY is now computed per-account to prevent cross-account localStorage leakage
// in shared browser sessions. Never use a global key for tenant-scoped data.
const MAX_HISTORY = 10;
const MAX_UNDO = 20;

function getHistoryKey(subAccountId?: number): string {
  // Namespace by subAccountId so different tenant sessions never share prompt history.
  // Falls back to "global" only for standalone/unauthenticated use (e.g. public card builder).
  return subAccountId ? `apex-dp-prompt-history-acct${subAccountId}` : "apex-dp-prompt-history-anon";
}

export function PromptDesignPanel({ currentSchema, onSchemaUpdate, subAccountId, isAdmin }: Props) {
  const { user } = useAuth();
  const showDebug = isAdmin || user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  // Derive the localStorage key once so the history state initializer uses the right namespace
  const HISTORY_KEY = getHistoryKey(subAccountId);

  const [prompt, setPrompt] = useState("");
  const [placeholder, setPlaceholder] = useState(EXAMPLE_PROMPTS[0]);
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
  });
  const [undoStack, setUndoStack] = useState<DynamicPageSchema[]>([]);
  const [redoStack, setRedoStack] = useState<DynamicPageSchema[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [lastAction, setLastAction] = useState<"generate" | "patch" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Rotate example prompts
  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholder(EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)]);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Push to undo stack before any update
  const pushUndo = useCallback((schema: DynamicPageSchema) => {
    setUndoStack(s => [...s.slice(-(MAX_UNDO - 1)), schema]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0 || !currentSchema) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(r => [currentSchema, ...r.slice(0, MAX_UNDO - 1)]);
    onSchemaUpdate(prev);
  }, [undoStack, redoStack, currentSchema, onSchemaUpdate]);

  const redo = useCallback(() => {
    if (redoStack.length === 0 || !currentSchema) return;
    const next = redoStack[0];
    setRedoStack(r => r.slice(1));
    setUndoStack(s => [...s, currentSchema]);
    onSchemaUpdate(next);
  }, [redoStack, undoStack, currentSchema, onSchemaUpdate]);

  const saveToHistory = (p: string) => {
    const next = [p, ...history.filter(h => h !== p)].slice(0, MAX_HISTORY);
    setHistory(next);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
  };

  // ── Generate (full schema from prompt) ───────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/dynamic-pages/generate", { prompt: p, subAccountId });
      const data = await res.json();
      if (!data.schema) throw new Error(data.error ?? "Generation failed");
      return data.schema as DynamicPageSchema;
    },
    onSuccess: (schema) => {
      if (currentSchema) pushUndo(currentSchema);
      onSchemaUpdate(schema);
      setLastAction("generate");
    },
  });

  // ── Patch (incremental AI edit) ───────────────────────────────────────────

  const patchMutation = useMutation({
    mutationFn: async (p: string) => {
      if (!currentSchema) throw new Error("No schema to patch");

      // Fast local patch for simple commands
      const localPatch = applyLocalPromptPatch(currentSchema, p);
      if (JSON.stringify(localPatch) !== JSON.stringify(currentSchema)) {
        return localPatch;
      }

      // Full AI patch for complex edits
      const res = await apiRequest("POST", "/api/dynamic-pages/patch", { prompt: p, existingSchema: currentSchema, subAccountId });
      const data = await res.json();
      if (!data.schema) throw new Error(data.error ?? "Patch failed");
      return data.schema as DynamicPageSchema;
    },
    onSuccess: (schema) => {
      if (currentSchema) pushUndo(currentSchema);
      onSchemaUpdate(schema);
      setLastAction("patch");
    },
  });

  const imageMutation = useMutation({
    mutationFn: async (p: string) => {
      if (!currentSchema) throw new Error("No schema to attach image to");
      const res = await apiRequest("POST", "/api/dynamic-pages/generate-image", {
        prompt: p,
        niche: currentSchema?.meta?.niche,
        businessType: (currentSchema?.meta as any)?.businessType,
        style: (currentSchema?.meta as any)?.style,
      });
      const data = await res.json();
      if (!data.imageUrl) throw new Error(data.error ?? "Image generation failed");
      return data.imageUrl as string;
    },
    onSuccess: (imageUrl) => {
      if (!currentSchema) return;
      pushUndo(currentSchema);
      onSchemaUpdate({
        ...currentSchema,
        scene: { ...currentSchema.scene, fallbackImage: imageUrl },
      });
      setLastAction("patch");
    },
  });

  const sceneMutation = useMutation({
    mutationFn: async (p: string) => {
      if (!currentSchema) throw new Error("No schema to attach scene to");
      const res = await apiRequest("POST", "/api/dynamic-pages/generate-scene", { prompt: p, subAccountId });
      const data = await res.json();
      if (!data.scene) throw new Error(data.error ?? "Scene generation failed");
      return data.scene as any;
    },
    onSuccess: (scene) => {
      if (!currentSchema) return;
      pushUndo(currentSchema);
      onSchemaUpdate({
        ...currentSchema,
        scene: {
          ...currentSchema.scene,
          ...scene,
          // Preserve an existing fallback image unless the generator returned one.
          fallbackImage: scene?.fallbackImage ?? currentSchema.scene?.fallbackImage,
        },
      });
      setLastAction("patch");
    },
  });

  const isLoading = generateMutation.isPending || patchMutation.isPending || imageMutation.isPending || sceneMutation.isPending;
  const error = generateMutation.error ?? patchMutation.error ?? imageMutation.error ?? sceneMutation.error;

  const handleGenerate = () => {
    const p = prompt.trim();
    if (!p || isLoading) return;
    saveToHistory(p);
    generateMutation.mutate(p);
  };

  const handleApplyChanges = () => {
    const p = prompt.trim();
    if (!p || isLoading || !currentSchema) return;
    saveToHistory(p);
    patchMutation.mutate(p);
  };

  const handleGenerateHeroImage = () => {
    const p = (prompt.trim() || currentSchema?.meta?.prompt || "").trim();
    if (!p || isLoading || !currentSchema) return;
    saveToHistory(p);
    imageMutation.mutate(p);
  };

  const handleGenerateScene = () => {
    const p = (prompt.trim() || currentSchema?.meta?.prompt || "").trim();
    if (!p || isLoading || !currentSchema) return;
    saveToHistory(p);
    sceneMutation.mutate(p);
  };

  const handleQuickPrompt = (p: string) => {
    setPrompt(p);
    if (currentSchema) {
      saveToHistory(p);
      patchMutation.mutate(p);
    } else {
      generateMutation.mutate(p);
    }
  };

  return (
    <div className="space-y-4">
      {/* Main prompt input */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Wand2 size={16} className="text-violet-400" />
          <span className="text-sm font-semibold text-white">Describe your page</span>
          {currentSchema && (
            <Badge className="text-xs bg-violet-500/20 text-violet-300 border-violet-500/30">
              {currentSchema.meta.niche.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={placeholder}
          className="bg-slate-800/50 border-slate-600 text-white placeholder:text-slate-500 resize-none min-h-[100px] text-sm rounded-xl focus:border-violet-500 transition-colors"
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              currentSchema ? handleApplyChanges() : handleGenerate();
            }
          }}
        />

        {isLoading && (
          <div className="absolute inset-0 rounded-xl bg-slate-900/60 backdrop-blur-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-violet-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm font-medium">
                {lastAction === "patch" ? "Applying changes..." : "Generating page..."}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isLoading}
          className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold rounded-xl"
        >
          <Sparkles size={15} className="mr-2" />
          Generate
        </Button>

        <Button
          onClick={handleApplyChanges}
          disabled={!prompt.trim() || !currentSchema || isLoading}
          variant="outline"
          className="flex-1 border-violet-500/50 text-violet-300 hover:bg-violet-500/10 rounded-xl"
        >
          <Zap size={15} className="mr-2" />
          Apply Changes
        </Button>

        <Button
          onClick={handleGenerateHeroImage}
          disabled={!currentSchema || isLoading}
          variant="outline"
          className="border-slate-600 text-slate-300 hover:bg-white/5 rounded-xl"
          title="Generate an AI hero image backdrop (renders behind the 3D scene)"
        >
          <Image size={15} className="mr-2" />
          Hero Image
        </Button>

        <Button
          onClick={handleGenerateScene}
          disabled={!currentSchema || isLoading}
          variant="outline"
          className="border-slate-600 text-slate-300 hover:bg-white/5 rounded-xl"
          title="Regenerate only the WebGL 3D scene from your prompt"
        >
          <Box size={15} className="mr-2" />
          3D Scene
        </Button>

        {currentSchema && (
          <Button
            onClick={() => { saveToHistory(prompt || "Regenerate"); generateMutation.mutate(prompt || currentSchema.meta.prompt); }}
            disabled={isLoading}
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-white rounded-xl"
            title="Regenerate"
          >
            <RefreshCw size={15} />
          </Button>
        )}

        <Button onClick={undo} disabled={undoStack.length === 0} variant="ghost" size="icon" className="text-slate-400 hover:text-white rounded-xl" title="Undo">
          <Undo2 size={15} />
        </Button>
        <Button onClick={redo} disabled={redoStack.length === 0} variant="ghost" size="icon" className="text-slate-400 hover:text-white rounded-xl" title="Redo">
          <Redo2 size={15} />
        </Button>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle size={14} />
            {error instanceof Error ? error.message : "Generation failed — try again"}
          </motion.div>
        )}
        {(generateMutation.isSuccess || patchMutation.isSuccess || imageMutation.isSuccess || sceneMutation.isSuccess) && !isLoading && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            <CheckCircle size={14} />
            {lastAction === "patch" ? "Changes applied!" : "Page generated!"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick incremental edits */}
      {currentSchema && (
        <div>
          <p className="text-xs text-slate-500 mb-2">Quick edits:</p>
          <div className="flex flex-wrap gap-2">
            {INCREMENTAL_PROMPTS.map(p => (
              <button key={p} onClick={() => handleQuickPrompt(p)} disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded-full border border-slate-600 text-slate-400 hover:text-white hover:border-violet-500/50 hover:bg-violet-500/10 transition-all disabled:opacity-50">
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompt history */}
      {history.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
            <Clock size={11} /> Recent prompts
          </p>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {history.slice(0, 5).map((h, i) => (
              <button key={i} onClick={() => setPrompt(h)} disabled={isLoading}
                className="w-full text-left text-xs p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors flex items-center gap-2 group">
                <ChevronRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                <span className="truncate">{h}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Admin schema debug */}
      {showDebug && currentSchema && (
        <div>
          <button onClick={() => setShowDebugPanel(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            <Code size={12} />
            Schema Debug
            {showDebugPanel ? <EyeOff size={10} /> : <Eye size={10} />}
          </button>
          <AnimatePresence>
            {showDebugPanel && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="mt-2 overflow-hidden">
                <pre className="text-xs bg-slate-900 rounded-xl p-4 overflow-auto max-h-64 text-slate-300 border border-slate-700">
                  {JSON.stringify(currentSchema, null, 2)}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <p className="text-xs text-slate-600 text-center">⌘+Enter to generate · Shift+Enter for new line</p>
    </div>
  );
}
