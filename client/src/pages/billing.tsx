import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Phone, MessageSquare, Sparkles, Loader2, Save, Clock, TrendingUp, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const SUB_ACCOUNT_ID = 1;

const TYPE_META: Record<string, { label: string; icon: typeof Phone; color: string; badgeClass: string }> = {
  VOICE_MINUTE: { label: "Voice Minutes", icon: Phone, color: "text-cyan-400", badgeClass: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  SMS_SEGMENT: { label: "SMS Segments", icon: MessageSquare, color: "text-indigo-400", badgeClass: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  AI_IMAGE_GEN: { label: "AI Image Gen", icon: Sparkles, color: "text-purple-400", badgeClass: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  AI_CHAT: { label: "AI Chat", icon: Zap, color: "text-emerald-400", badgeClass: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  AI_STREAM: { label: "AI Stream", icon: Zap, color: "text-emerald-400", badgeClass: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
};

function formatCost(cost: number) {
  return `$${cost.toFixed(2)}`;
}

export default function Billing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ownerPhone, setOwnerPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);

  const { data, isLoading } = useQuery<{ logs: any[]; summary: any[] }>({
    queryKey: ["/api/usage", SUB_ACCOUNT_ID],
    queryFn: async () => {
      const res = await fetch(`/api/usage/${SUB_ACCOUNT_ID}`);
      if (!res.ok) throw new Error("Failed to fetch usage data");
      return res.json();
    },
  });

  const { data: account } = useQuery<any>({
    queryKey: ["/api/accounts", SUB_ACCOUNT_ID],
    queryFn: async () => {
      const res = await fetch(`/api/accounts`);
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const accounts = await res.json();
      return accounts.find((a: any) => a.id === SUB_ACCOUNT_ID) || null;
    },
    onSuccess: (acc: any) => {
      if (!phoneLoaded && acc) {
        setOwnerPhone(acc.ownerPhone || "");
        setPhoneLoaded(true);
      }
    },
  } as any);

  const savePhoneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/accounts/${SUB_ACCOUNT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPhone }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Owner phone number updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", SUB_ACCOUNT_ID] });
    },
  });

  const logs = data?.logs || [];
  const summary = data?.summary || [];

  const totalSpend = summary.reduce((sum: number, s: any) => sum + (s.totalCost || 0), 0);
  const voiceSummary = summary.find((s: any) => s.type === "VOICE_MINUTE");
  const smsSummary = summary.find((s: any) => s.type === "SMS_SEGMENT");
  const aiImageSummary = summary.find((s: any) => s.type === "AI_IMAGE_GEN");
  const aiChatSummary = summary.find((s: any) => s.type === "AI_CHAT");
  const aiOps = (aiImageSummary?.count || 0) + (aiChatSummary?.count || 0);

  const recentLogs = logs.slice(0, 50);

  const MARKUP_RATES = [
    { type: "SMS", rate: "$2.00/segment", desc: "Twilio", color: "text-indigo-400" },
    { type: "Voice", rate: "$1.50/min", desc: "Vapi", color: "text-cyan-400" },
    { type: "AI Image", rate: "$0.25/image", desc: "Google Gemini", color: "text-purple-400" },
    { type: "AI Chat", rate: "$0.03/call", desc: "Gemini 2.5 Flash", color: "text-emerald-400" },
    { type: "AI Stream", rate: "$0.03/call", desc: "Gemini 2.5 Flash", color: "text-emerald-400" },
  ];

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <DollarSign size={12} /> USAGE & BILLING
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-billing-title">
            Usage & <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Billing</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Track your platform usage and costs in real-time</p>
        </motion.div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="stats-row">
              {[
                { label: "Total Spend", value: formatCost(totalSpend), icon: DollarSign, color: "text-cyan-400" },
                { label: "Voice Minutes", value: voiceSummary?.totalAmount?.toFixed(1) || "0", icon: Phone, color: "text-indigo-400" },
                { label: "SMS Segments", value: smsSummary?.count || 0, icon: MessageSquare, color: "text-purple-400" },
                { label: "AI Operations", value: aiOps, icon: Sparkles, color: "text-emerald-400" },
              ].map((stat, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                  <Card className="bg-white/5 border-white/10 p-4" data-testid={`stat-card-${i}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <stat.icon size={16} className={stat.color} />
                      <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                    </div>
                    <div className="text-2xl font-black text-white" data-testid={`stat-value-${i}`}>{stat.value}</div>
                  </Card>
                </motion.div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card className="bg-white/5 border-white/10 p-5" data-testid="usage-breakdown">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <TrendingUp size={14} className="text-indigo-400" /> Usage Breakdown
                  </h3>
                  {summary.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-6">No usage data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {summary.map((s: any, i: number) => {
                        const meta = TYPE_META[s.type] || { label: s.type, icon: Zap, color: "text-slate-400", badgeClass: "bg-white/10 text-slate-400 border-white/10" };
                        const Icon = meta.icon;
                        return (
                          <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`breakdown-row-${i}`}>
                            <div className="flex items-center gap-3">
                              <Icon size={16} className={meta.color} />
                              <div>
                                <div className="text-sm font-semibold text-white">{meta.label}</div>
                                <div className="text-xs text-slate-500">{s.count} operations</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold text-white" data-testid={`breakdown-cost-${i}`}>{formatCost(s.totalCost || 0)}</div>
                              <div className="text-xs text-slate-500">{(s.totalAmount || 0).toFixed(1)} units</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </motion.div>

              <div className="space-y-6">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                  <Card className="bg-white/5 border-white/10 p-5" data-testid="markup-rates">
                    <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                      <DollarSign size={14} className="text-cyan-400" /> Per-Unit Pricing
                    </h3>
                    <div className="space-y-2">
                      {MARKUP_RATES.map((r, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0" data-testid={`rate-row-${i}`}>
                          <div className="flex flex-col">
                            <span className={`text-sm font-medium ${r.color}`}>{r.type}</span>
                            <span className="text-[10px] text-slate-500">{r.desc}</span>
                          </div>
                          <span className="text-sm font-bold text-white">{r.rate}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                  <Card className="bg-white/5 border-white/10 p-5" data-testid="owner-phone-config">
                    <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <Phone size={14} className="text-cyan-400" /> Owner Phone (SMS Alerts)
                    </h3>
                    <div className="flex gap-2">
                      <Input
                        value={ownerPhone}
                        onChange={(e) => setOwnerPhone(e.target.value)}
                        placeholder="+1234567890"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20 flex-1"
                        data-testid="input-owner-phone"
                      />
                      <Button
                        onClick={() => savePhoneMutation.mutate()}
                        disabled={savePhoneMutation.isPending}
                        className="bg-indigo-600 hover:bg-indigo-500"
                        data-testid="button-save-phone"
                      >
                        {savePhoneMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      </Button>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-2">Receive SMS alerts for negative reviews</p>
                  </Card>
                </motion.div>
              </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <Card className="bg-white/5 border-white/10 p-5" data-testid="activity-feed">
                <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                  <Clock size={14} className="text-indigo-400" /> Recent Activity
                </h3>
                {recentLogs.length === 0 ? (
                  <div className="text-center py-10">
                    <DollarSign size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-slate-400 text-sm">No usage activity yet</p>
                    <p className="text-slate-600 text-xs mt-1">Usage logs will appear here as services are consumed</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {recentLogs.map((log: any, i: number) => {
                      const meta = TYPE_META[log.type] || { label: log.type, icon: Zap, color: "text-slate-400", badgeClass: "bg-white/10 text-slate-400 border-white/10" };
                      const Icon = meta.icon;
                      return (
                        <div key={log.id || i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors" data-testid={`activity-row-${log.id || i}`}>
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 ${meta.color}`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white truncate" data-testid={`activity-desc-${log.id || i}`}>{log.description || meta.label}</div>
                            <div className="text-xs text-slate-500">
                              {new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-white" data-testid={`activity-cost-${log.id || i}`}>{formatCost(log.cost || 0)}</div>
                            <Badge className={`text-[10px] ${meta.badgeClass}`} data-testid={`activity-badge-${log.id || i}`}>{meta.label}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
