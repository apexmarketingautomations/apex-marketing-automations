import { useState, useCallback } from "react";
import { Brain, X, Bell, TrendingUp, Terminal, Crosshair, Factory, Bot, BookOpen, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { useDraggable } from "@/hooks/use-draggable";
import { useResizable } from "@/hooks/use-resizable";
import { CommandTab, InsightsTab, NudgesTab, IndustryTab, TrendsTab, ChatTab, AgentTab, MemoryTab } from "./intelligence";
import type { TabId, HealthScore } from "./intelligence";

const TABS: { id: TabId; label: string; icon: typeof Brain }[] = [
  { id: "command", label: "Command", icon: Terminal },
  { id: "insights", label: "Strategy", icon: Crosshair },
  { id: "nudges", label: "Nudges", icon: Bell },
  { id: "industry", label: "Industry", icon: Factory },
  { id: "trends", label: "Trends", icon: TrendingUp },
  { id: "chat", label: "Operator", icon: Brain },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "memory", label: "Memory", icon: BookOpen },
];

export interface ApexIntelligenceProps {
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "inline";
  defaultOpen?: boolean;
  accountId?: number;
  showToggle?: boolean;
  className?: string;
  panelWidth?: number;
  panelHeight?: number;
}

const POSITION_CLASSES: Record<string, string> = {
  "bottom-left": "fixed bottom-6 left-6 md:left-[304px] z-50",
  "bottom-right": "fixed bottom-6 right-6 z-50",
  "top-left": "fixed top-20 left-6 md:left-[304px] z-50",
  "top-right": "fixed top-20 right-6 z-50",
  "inline": "relative z-10",
};

export function ApexIntelligence({
  position = "bottom-left",
  defaultOpen = false,
  accountId,
  showToggle = true,
  className = "",
  panelWidth = 420,
  panelHeight = 620,
}: ApexIntelligenceProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TabId>("command");
  const { activeAccountId } = useAccount();
  const subAccountId = accountId ?? activeAccountId;
  const { offset, onPointerDown, resetOffset, wasDragged } = useDraggable();
  const { size, onResizeStart } = useResizable(panelWidth, panelHeight);

  const handleToggle = useCallback(() => {
    if (wasDragged()) return;
    if (isOpen) resetOffset();
    setIsOpen(!isOpen);
  }, [isOpen, resetOffset]);

  const { data: nudgeData } = useQuery<{ nudges: any[] }>({
    queryKey: ["/api/operator/cognitive/nudges/pending", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/nudges/${subAccountId}/pending`);
      if (!res.ok) return { nudges: [] };
      return res.json();
    },
    enabled: !!subAccountId && !isOpen,
    staleTime: 120000,
    refetchInterval: 3_600_000,
  });

  const { data: healthData } = useQuery<HealthScore>({
    queryKey: ["/api/operator/cognitive/health", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/operator/cognitive/health/${subAccountId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!subAccountId && !isOpen,
    staleTime: 120000,
  });

  const nudgeCount = nudgeData?.nudges?.length || 0;
  const healthScore = healthData?.overall;

  const isInline = position === "inline";
  const positionClass = POSITION_CLASSES[position] || POSITION_CLASSES["bottom-left"];

  return (
    <>
      {isOpen && !isInline && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:bg-transparent"
          onClick={handleToggle}
          data-testid="intel-backdrop"
        />
      )}
    <div
      className={`${positionClass} ${isInline ? "flex flex-col" : "flex flex-col items-start"} ${className}`}
      style={!isInline ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={isInline ? undefined : { opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={isInline ? undefined : { opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`${isInline ? "" : "mb-4"} rounded-2xl overflow-hidden flex flex-col`}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: isInline ? "100%" : `min(${size.width}px, 92vw)`,
              maxHeight: isInline ? undefined : `min(${size.height}px, calc(100vh - 120px))`,
              height: isInline ? undefined : `${size.height}px`,
              background: "linear-gradient(180deg, rgba(8,8,24,0.99) 0%, rgba(6,6,18,0.995) 100%)",
              boxShadow: isInline
                ? "0 0 0 1px rgba(139,92,246,0.12)"
                : "0 0 0 1px rgba(139,92,246,0.12), 0 25px 60px -12px rgba(0,0,0,0.85), 0 0 100px rgba(139,92,246,0.06), 0 0 160px rgba(6,182,212,0.03)",
              backdropFilter: "blur(24px)",
            }}
            data-testid="panel-apex-intelligence"
          >
            <div
              className={`relative px-4 pt-4 pb-2 ${!isInline ? "cursor-grab active:cursor-grabbing" : ""}`}
              {...(!isInline ? {
                onMouseDown: onPointerDown as any,
                onTouchStart: onPointerDown as any,
              } : {})}
              data-testid="handle-intel-drag"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-violet-600/[0.06] via-transparent to-cyan-600/[0.06]" />
              <div className="absolute inset-0 overflow-hidden">
                <motion.div
                  className="absolute w-[200px] h-[200px] rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)", top: "-100px", left: "-50px" }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              {!isInline && (
                <div className="flex justify-center mb-2">
                  <div className="w-10 h-1 rounded-full bg-white/[0.12] hover:bg-white/[0.2] transition-colors" />
                </div>
              )}
              <div className="relative flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-500/20 flex items-center justify-center border border-violet-500/25">
                      <Brain size={20} className="text-violet-400" />
                    </div>
                    <motion.span
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#080818]"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white tracking-tight leading-none">Apex Intelligence</p>
                    <p className="text-[10px] text-violet-400/60 mt-0.5 font-medium tracking-widest uppercase">Autonomous Operator</p>
                  </div>
                </div>
                {showToggle && (
                  <button
                    onClick={handleToggle}
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    className="p-2.5 rounded-xl hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                    data-testid="button-intel-close"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>

              <div className="relative flex mt-3 gap-0.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04] overflow-x-auto scrollbar-none" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                {TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  const TabIcon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative flex-1 min-w-0 flex items-center justify-center gap-0.5 py-1.5 px-1 rounded-md text-[8px] font-semibold tracking-wide transition-all whitespace-nowrap ${
                        isActive ? "text-white" : "text-slate-600 hover:text-slate-400"
                      }`}
                      data-testid={`tab-intel-${tab.id}`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeIntelTab"
                          className="absolute inset-0 rounded-md bg-gradient-to-r from-violet-500/15 to-cyan-500/15 border border-violet-500/20"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                        />
                      )}
                      <span className="relative flex items-center gap-0.5">
                        <TabIcon size={10} className="shrink-0" />
                        {tab.label}
                        {tab.id === "nudges" && nudgeCount > 0 && (
                          <span className="w-3.5 h-3.5 rounded-full bg-violet-500 text-white text-[7px] font-bold flex items-center justify-center shrink-0">{nudgeCount}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/15 to-transparent" />

            <div className="flex-1 flex flex-col overflow-hidden">
              {!subAccountId ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center space-y-3">
                    <Shield size={28} className="mx-auto text-slate-600" />
                    <p className="text-xs text-slate-500">Select an account to activate intelligence</p>
                  </div>
                </div>
              ) : (
                <>
                  {activeTab === "command" && <CommandTab subAccountId={subAccountId} />}
                  {activeTab === "insights" && <InsightsTab subAccountId={subAccountId} />}
                  {activeTab === "nudges" && <NudgesTab subAccountId={subAccountId} />}
                  {activeTab === "industry" && <IndustryTab subAccountId={subAccountId} />}
                  {activeTab === "trends" && <TrendsTab subAccountId={subAccountId} />}
                  {activeTab === "chat" && <ChatTab subAccountId={subAccountId} />}
                  {activeTab === "agent" && <AgentTab subAccountId={subAccountId} />}
                  {activeTab === "memory" && <MemoryTab subAccountId={subAccountId} />}
                </>
              )}
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-[9px] text-slate-600 font-medium">Apex Intelligence — Autonomous Operator</span>
              </div>
              <span className="text-[9px] text-slate-700">{subAccountId ? `Account #${subAccountId}` : ""}</span>
            </div>

            {!isInline && (
              <div
                className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize group/resize touch-none"
                onMouseDown={onResizeStart as any}
                onTouchStart={onResizeStart as any}
                data-testid="handle-intel-resize"
              >
                <svg viewBox="0 0 20 20" className="w-full h-full text-slate-700 group-hover/resize:text-violet-400 transition-colors">
                  <line x1="14" y1="20" x2="20" y2="14" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="10" y1="20" x2="20" y2="10" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="6" y1="20" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {showToggle && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleToggle}
          onMouseDown={onPointerDown as any}
          onTouchStart={onPointerDown as any}
          className="group relative w-20 h-20 rounded-3xl flex items-center justify-center transition-all touch-none select-none"
          style={{
            background: isOpen
              ? "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(6,182,212,0.15))"
              : "linear-gradient(135deg, rgba(10,10,26,0.95), rgba(15,15,35,0.95))",
            boxShadow: isOpen
              ? "0 0 0 1px rgba(139,92,246,0.3), 0 8px 32px rgba(139,92,246,0.15)"
              : "0 0 0 1px rgba(139,92,246,0.15), 0 12px 40px rgba(0,0,0,0.5), 0 0 80px rgba(139,92,246,0.1), 0 0 120px rgba(139,92,246,0.05)",
            backdropFilter: "blur(16px)",
          }}
          data-testid="button-intel-toggle"
        >
          <AnimatePresence mode="wait">
            {isOpen ? (
              <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                <X size={32} className="text-violet-400" />
              </motion.div>
            ) : (
              <motion.div
                key="brain"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [1, 1.15, 1], opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.15 } }}
                className="relative"
                style={{ filter: "drop-shadow(0 0 12px rgba(139,92,246,0.5))" }}
              >
                <Brain size={40} className="text-violet-400 group-hover:text-violet-300 transition-colors" />
                {healthScore !== undefined && healthScore !== null && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[8px] font-black bg-black/80 border border-violet-500/30 text-violet-300" data-testid="text-btn-health-score">
                    {healthScore}
                  </span>
                )}
                {nudgeCount > 0 && (
                  <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center shadow-lg shadow-violet-500/40">
                    {nudgeCount > 9 ? "9+" : nudgeCount}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!isOpen && (
            <>
              <span className="absolute inset-0 rounded-3xl border border-violet-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="absolute inset-[-4px] rounded-[22px] border border-violet-400/15 animate-pulse" />
              <span className="absolute inset-[-8px] rounded-[26px] border border-violet-400/5 animate-pulse" style={{ animationDelay: "0.5s" }} />
            </>
          )}
        </motion.button>
      )}
    </div>
    </>
  );
}
