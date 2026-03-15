import { useState } from "react";
import { Brain, X, Loader2, Sparkles, AlertTriangle, CheckCircle2, Zap, Eye, Clock, Bot, Settings2, Power, Shield, FileEdit, Search, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  crm: { label: "CRM", color: "text-blue-400" },
  messaging: { label: "Messaging", color: "text-green-400" },
  workflow: { label: "Workflows", color: "text-amber-400" },
  appointment: { label: "Appointments", color: "text-pink-400" },
  campaign: { label: "Campaigns", color: "text-orange-400" },
  creative: { label: "Creative", color: "text-purple-400" },
  review: { label: "Reviews", color: "text-yellow-400" },
  intelligence: { label: "Intelligence", color: "text-cyan-400" },
  integration: { label: "Integrations", color: "text-teal-400" },
  site: { label: "Sites", color: "text-indigo-400" },
  system: { label: "System", color: "text-slate-400" },
  diagnostics: { label: "Diagnostics", color: "text-red-400" },
};

function AutonomyBadge({ level }: { level: string }) {
  if (level === "observe") return <span className="text-[7px] px-1 py-px rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold" data-testid="badge-observe"><Search size={6} className="inline mr-0.5" />observe</span>;
  if (level === "draft") return <span className="text-[7px] px-1 py-px rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-semibold" data-testid="badge-draft"><FileEdit size={6} className="inline mr-0.5" />draft</span>;
  return <span className="text-[7px] px-1 py-px rounded bg-red-500/15 text-red-400 border border-red-500/20 font-semibold" data-testid="badge-execute"><Zap size={6} className="inline mr-0.5" />execute</span>;
}

function ApprovalBadge({ required }: { required: boolean }) {
  if (!required) return null;
  return <span className="text-[7px] px-1 py-px rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-semibold" data-testid="badge-approval"><Shield size={6} className="inline mr-0.5" />approval</span>;
}

export function AgentTab({ subAccountId }: { subAccountId: number }) {
  const queryClient = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [showToolkit, setShowToolkit] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/agent/stats", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/stats/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 15000,
  });

  const { data: tasksData } = useQuery({
    queryKey: ["/api/agent/tasks", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/tasks/${subAccountId}?limit=20`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    refetchInterval: 15000,
  });

  const { data: briefingData } = useQuery({
    queryKey: ["/api/agent/briefings", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/briefings/${subAccountId}`);
      if (!res.ok) return { briefings: [] };
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 60000,
  });

  const { data: outcomes } = useQuery({
    queryKey: ["/api/agent/outcomes", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/outcomes/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId,
    staleTime: 120000,
  });

  const { data: toolsData } = useQuery({
    queryKey: ["/api/agent/tools"],
    queryFn: async () => {
      const res = await fetch("/api/agent/tools");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 300000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agent/scan/${subAccountId}`, { method: "POST" });
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/stats", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/tasks", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/briefings", subAccountId] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch(`/api/agent/config/${subAccountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Config update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/stats", subAccountId] });
    },
  });

  const dismissBriefing = useMutation({
    mutationFn: async (briefingId: number) => {
      await fetch(`/api/agent/briefings/${briefingId}/seen`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/briefings", subAccountId] });
    },
  });

  const isEnabled = stats?.config?.enabled !== false;
  const tasks = tasksData?.tasks || [];
  const briefings = briefingData?.briefings || [];

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle2 size={12} className="text-emerald-400" />;
    if (status === "failed") return <AlertTriangle size={12} className="text-red-400" />;
    if (status === "running") return <Loader2 size={12} className="text-cyan-400 animate-spin" />;
    return <Clock size={12} className="text-slate-500" />;
  };

  const priorityColor = (p: number) => {
    if (p >= 90) return "text-red-400";
    if (p >= 70) return "text-amber-400";
    if (p >= 40) return "text-cyan-400";
    return "text-slate-500";
  };

  const hasAIReasoning = (desc: string) => desc?.includes("AI Reasoning:");

  if (statsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="panel-agent-tab">
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <motion.div
            className={`w-2 h-2 rounded-full ${isEnabled ? "bg-emerald-400" : "bg-slate-600"}`}
            animate={isEnabled ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {isEnabled ? "AI Active" : "Paused"}
          </span>
          {stats && (
            <span className="text-[9px] text-slate-600">
              {stats.todayCount}/{stats.config?.maxTasksPerDay || 10} today
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleMutation.mutate(!isEnabled)}
            className={`p-1 rounded transition-colors ${isEnabled ? "text-emerald-400 hover:bg-emerald-400/10" : "text-slate-600 hover:bg-white/5"}`}
            title={isEnabled ? "Pause Agent" : "Enable Agent"}
            data-testid="button-agent-toggle"
          >
            <Power size={12} />
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            data-testid="button-agent-settings"
          >
            <Settings2 size={12} />
          </button>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-gradient-to-r from-violet-500/20 to-cyan-500/20 text-violet-400 border border-violet-500/20 hover:from-violet-500/30 hover:to-cyan-500/30 transition-all disabled:opacity-50"
            data-testid="button-agent-scan"
          >
            {scanMutation.isPending ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            AI Scan
          </button>
        </div>
      </div>

      <AnimatePresence>
        {briefings.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {briefings.slice(0, 1).map((b: any) => (
              <div key={b.id} className="px-3 py-2.5 bg-gradient-to-r from-cyan-500/[0.06] to-violet-500/[0.06] border-b border-cyan-500/10" data-testid="agent-briefing-banner">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Eye size={10} className="text-cyan-400" />
                      <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider">While you were away</span>
                      <span className="text-[8px] text-slate-600">
                        {b.tasksCompleted} done {b.tasksFailed > 0 ? `· ${b.tasksFailed} failed` : ""}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">{b.summary}</p>
                  </div>
                  <button
                    onClick={() => dismissBriefing.mutate(b.id)}
                    className="p-0.5 rounded text-slate-600 hover:text-slate-400 transition-colors shrink-0"
                    data-testid="button-dismiss-briefing"
                  >
                    <X size={10} />
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/[0.04]"
          >
            <div className="p-3 space-y-2 bg-violet-500/[0.03]">
              {stats?.config && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Autonomy</span>
                    <span className="text-[10px] text-violet-400 font-medium capitalize">{stats.config.autonomyLevel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Scan Interval</span>
                    <span className="text-[10px] text-slate-400">{stats.config.scanIntervalMinutes}min</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Max Tasks/Day</span>
                    <span className="text-[10px] text-slate-400">{stats.config.maxTasksPerDay}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Last Scan</span>
                    <span className="text-[10px] text-slate-400">{stats.config.lastScanAt ? new Date(stats.config.lastScanAt).toLocaleTimeString() : "Never"}</span>
                  </div>
                </>
              )}
              {outcomes && outcomes.totalTasks > 0 && (
                <>
                  <div className="h-px bg-white/[0.04] my-1" />
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain size={9} className="text-violet-400" />
                    <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider">Learning Stats</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Success Rate</span>
                    <span className={`text-[10px] font-medium ${outcomes.successRate >= 80 ? "text-emerald-400" : outcomes.successRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{outcomes.successRate}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Best Streak</span>
                    <span className="text-[10px] text-slate-400">{outcomes.streaks?.longestSuccess || 0} tasks</span>
                  </div>
                  {outcomes.topSuccessTypes?.slice(0, 2).map((t: { type: string; count: number }) => (
                    <div key={t.type} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 truncate">{t.type}</span>
                      <span className="text-[10px] text-emerald-400/70">{t.count}x</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {stats && (
        <div className="px-3 py-2 grid grid-cols-4 gap-1 border-b border-white/[0.04]">
          {[
            { label: "Total", value: stats.totalTasks, color: "text-white" },
            { label: "Done", value: stats.completed, color: "text-emerald-400" },
            { label: "Failed", value: stats.failed, color: "text-red-400" },
            { label: "Queued", value: stats.queued + stats.running, color: "text-cyan-400" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-sm font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[8px] text-slate-600 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {toolsData && (
        <div className="border-b border-white/[0.04]">
          <button
            onClick={() => setShowToolkit(!showToolkit)}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            data-testid="button-toggle-toolkit"
          >
            <div className="flex items-center gap-1.5">
              <Zap size={10} className="text-violet-400" />
              <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wider">Toolkit</span>
              <span className="text-[8px] text-slate-600">{toolsData.totalTools} tools</span>
            </div>
            {showToolkit ? <ChevronDown size={10} className="text-slate-600" /> : <ChevronRight size={10} className="text-slate-600" />}
          </button>
          <AnimatePresence>
            {showToolkit && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-2 space-y-1" data-testid="panel-toolkit">
                  {toolsData.categories?.map((cat: any) => {
                    const catInfo = CATEGORY_LABELS[cat.category] || { label: cat.category, color: "text-slate-400" };
                    const isExpanded = expandedCategory === cat.category;
                    return (
                      <div key={cat.category}>
                        <button
                          onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
                          className="w-full flex items-center justify-between py-1 hover:bg-white/[0.02] rounded px-1 transition-colors"
                          data-testid={`category-${cat.category}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-semibold ${catInfo.color}`}>{catInfo.label}</span>
                            <span className="text-[8px] text-slate-700">{cat.count}</span>
                          </div>
                          {isExpanded ? <ChevronDown size={8} className="text-slate-600" /> : <ChevronRight size={8} className="text-slate-600" />}
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pl-3 space-y-0.5 pb-1">
                                {toolsData.tools
                                  .filter((t: any) => t.category === cat.category)
                                  .map((tool: any) => (
                                    <div key={tool.name} className="flex items-center justify-between py-0.5" data-testid={`tool-${tool.name}`}>
                                      <span className="text-[9px] text-slate-400 truncate max-w-[140px]">{tool.name}</span>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <AutonomyBadge level={tool.autonomyRequired} />
                                        <ApprovalBadge required={tool.requiresApproval} />
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin" data-testid="list-agent-tasks">
        {tasks.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-2">
              <Bot size={28} className="mx-auto text-slate-700" />
              <p className="text-[11px] text-slate-600">No tasks yet</p>
              <p className="text-[9px] text-slate-700">Click "AI Scan" to let the agent analyze your account</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.03]">
            {tasks.map((task: any) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="px-3 py-2 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                data-testid={`task-item-${task.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">{statusIcon(task.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] text-white font-medium truncate">{task.title}</p>
                      <span className={`text-[8px] font-bold ${priorityColor(task.priority)}`}>P{task.priority}</span>
                      {hasAIReasoning(task.description) && (
                        <span className="text-[7px] px-1 py-px rounded bg-violet-500/15 text-violet-400 border border-violet-500/20 font-semibold">AI</span>
                      )}
                    </div>
                    {task.description && (
                      <p className={`text-[9px] text-slate-500 mt-0.5 ${expandedTask === task.id ? "" : "line-clamp-2"}`}>
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[8px] text-slate-700">{new Date(task.createdAt).toLocaleTimeString()}</span>
                      {task.toolUsed && (
                        <span className="text-[8px] text-violet-500/60 flex items-center gap-0.5">
                          <Zap size={7} /> {task.toolUsed}
                        </span>
                      )}
                      {task.triggeredBy === "autonomous-agent" && (
                        <span className="text-[8px] text-cyan-500/40 flex items-center gap-0.5">
                          <Bot size={7} /> auto
                        </span>
                      )}
                      {task.status === "failed" && task.error && (
                        <span className="text-[8px] text-red-400/60 truncate max-w-[150px]">{task.error}</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
