import { useState } from "react";
import { Brain, Loader2, Eye, Target, Crosshair, Heart, RefreshCw, BookOpen, Trash2, Edit3 } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentMemory } from "./types";

export function MemoryTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const { data, isLoading, refetch } = useQuery<{ memories: AgentMemory[]; total: number }>({
    queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (typeFilter) params.set("memoryType", typeFilter);
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}?${params}`);
      if (!res.ok) return { memories: [], total: 0 };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (memoryId: number) => {
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}/${memoryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter] }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ memoryId, content }: { memoryId: number; content: string }) => {
      const res = await fetch(`/api/operator/cognitive/memories/${subAccountId}/${memoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/operator/cognitive/memories", subAccountId, typeFilter] });
    },
  });

  const memories = data?.memories || [];
  const total = data?.total || 0;

  const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    decision: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/15" },
    outcome: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/15" },
    preference: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/15" },
    observation: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/15" },
  };

  const typeIcons: Record<string, typeof Brain> = {
    decision: Crosshair,
    outcome: Target,
    preference: Heart,
    observation: Eye,
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="memory-loading">
        <div className="text-center space-y-3">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Loading agent memories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="memory-tab">
      <div className="px-3 py-2 border-b border-white/[0.04] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BookOpen size={11} className="text-violet-400" />
            <p className="text-xs font-bold uppercase tracking-widest text-violet-400">{total} Memor{total !== 1 ? "ies" : "y"}</p>
          </div>
          <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors" data-testid="button-refresh-memories">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          {["", "decision", "outcome", "preference", "observation"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300"
              }`}
              data-testid={`button-filter-${t || "all"}`}
            >
              {t || "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="list-memories">
        {memories.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <BookOpen size={28} className="mx-auto text-slate-500" />
              <p className="text-sm text-slate-400">No memories yet</p>
              <p className="text-xs text-slate-500">The agent will learn from decisions, outcomes, and your interactions</p>
            </div>
          </div>
        ) : (
          memories.map((memory, i) => {
            const colors = typeColors[memory.memoryType] || typeColors.observation;
            const MemIcon = typeIcons[memory.memoryType] || Eye;
            const isEditing = editingId === memory.id;

            return (
              <motion.div
                key={memory.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`p-3 rounded-xl ${colors.bg} border ${colors.border} transition-all`}
                data-testid={`memory-card-${memory.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-6 h-6 rounded-lg ${colors.bg} flex items-center justify-center shrink-0 mt-0.5 border ${colors.border}`}>
                    <MemIcon size={11} className={colors.text} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-sm font-bold uppercase tracking-wider ${colors.text}`}>{memory.memoryType}</span>
                      {memory.outcome && (
                        <span className={`text-sm px-1 py-px rounded ${memory.outcome === "success" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                          {memory.outcome}
                        </span>
                      )}
                      <span className="text-sm text-slate-400 ml-auto">
                        {Math.round(memory.relevanceScore * 100)}% relevant
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/40 resize-none"
                          rows={3}
                          data-testid={`input-edit-memory-${memory.id}`}
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateMutation.mutate({ memoryId: memory.id, content: editContent })}
                            disabled={updateMutation.isPending}
                            className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-50"
                            data-testid={`button-save-memory-${memory.id}`}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditContent(""); }}
                            className="px-2 py-0.5 rounded text-xs text-slate-500 hover:text-slate-300 transition-colors"
                            data-testid={`button-cancel-edit-${memory.id}`}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-300 leading-relaxed">{memory.content}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {memory.sourceEvent && (
                        <span className="text-sm text-slate-400">{memory.sourceEvent}</span>
                      )}
                      {memory.createdAt && (
                        <span className="text-sm text-slate-500">
                          {new Date(memory.createdAt).toLocaleDateString()}
                        </span>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(memory.id); setEditContent(memory.content); }}
                          className="p-0.5 rounded text-slate-400 hover:text-slate-400 transition-colors"
                          title="Edit memory"
                          data-testid={`button-edit-memory-${memory.id}`}
                        >
                          <Edit3 size={10} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this memory? This cannot be undone.")) deleteMutation.mutate(memory.id); }}
                          disabled={deleteMutation.isPending}
                          className="p-0.5 rounded text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
                          title="Delete memory"
                          data-testid={`button-delete-memory-${memory.id}`}
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
