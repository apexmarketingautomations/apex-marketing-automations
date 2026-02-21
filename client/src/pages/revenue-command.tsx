import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Megaphone, Loader2, Zap, ArrowUpRight, Calendar, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface ProfitReport {
  totalRevenue: number;
  markupProfit: number;
  adRevenue: number;
  activeSponsorCount: number;
  totalTransactions: number;
  weeklyTrend: { date: string; markup: number; ads: number; total: number }[];
  recentProfits: { id: number; source: string; amount: number; description: string; createdAt: string }[];
}

export default function RevenueCommand() {
  const { data, isLoading } = useQuery<ProfitReport>({
    queryKey: ["/api/admin/profit-report"],
    queryFn: async () => {
      const res = await fetch("/api/admin/profit-report");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-emerald-400" size={32} /></div>
    );
  }

  const report = data || { totalRevenue: 0, markupProfit: 0, adRevenue: 0, activeSponsorCount: 0, totalTransactions: 0, weeklyTrend: [], recentProfits: [] };

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 mb-4">
            <DollarSign size={12} /> REVENUE COMMAND
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-revenue-title">
            Revenue <span className="bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">Command</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Real-time platform profit from markups and native ads</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
          <Card className="border-white/10 p-0 overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.08), rgba(99,102,241,0.05))" }} data-testid="revenue-hero">
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={16} className="text-emerald-400" />
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Platform Profit</span>
              </div>
              <div className="text-5xl md:text-6xl font-black text-white mb-3" data-testid="text-total-revenue">
                ${report.totalRevenue.toFixed(2)}
              </div>
              <div className="flex gap-8 text-xs">
                <div>
                  <span className="text-slate-500">Markup Spread</span>
                  <div className="text-lg font-bold text-cyan-400">${report.markupProfit.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-slate-500">Ad Revenue</span>
                  <div className="text-lg font-bold text-purple-400">${report.adRevenue.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-slate-500">Active Sponsors</span>
                  <div className="text-lg font-bold text-indigo-400">{report.activeSponsorCount}</div>
                </div>
                <div>
                  <span className="text-slate-500">Transactions</span>
                  <div className="text-lg font-bold text-white">{report.totalTransactions}</div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[
            { label: "SMS/Voice Markup", desc: "Passive income from API spread", icon: Zap, color: "text-cyan-400", value: `$${report.markupProfit.toFixed(2)}` },
            { label: "Native Ad Clicks", desc: "Revenue from sponsored actions", icon: Megaphone, color: "text-purple-400", value: `$${report.adRevenue.toFixed(2)}` },
            { label: "Weekly Volume", desc: "Transactions this week", icon: BarChart3, color: "text-indigo-400", value: report.weeklyTrend.reduce((s, d) => s + d.total, 0).toFixed(2) },
          ].map((card, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
              <Card className="bg-white/5 border-white/10 p-5" data-testid={`revenue-card-${i}`}>
                <div className="flex items-center gap-2 mb-2"><card.icon size={16} className={card.color} /><span className="text-xs text-slate-500 uppercase">{card.label}</span></div>
                <div className="text-2xl font-black text-white mb-1">{card.value}</div>
                <div className="text-[10px] text-slate-600">{card.desc}</div>
              </Card>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-8">
          <Card className="bg-white/5 border-white/10 p-5" data-testid="revenue-chart">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <Calendar size={14} className="text-cyan-400" /> 7-Day Revenue Trend
            </h3>
            {report.weeklyTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={report.weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                    labelStyle={{ color: "#fff", fontSize: 12 }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`]}
                  />
                  <Bar dataKey="markup" name="Markup" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ads" name="Ad Clicks" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-10 text-slate-500 text-sm">No revenue data for the past week</div>
            )}
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="bg-white/5 border-white/10 p-5" data-testid="profit-feed">
            <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
              <ArrowUpRight size={14} className="text-emerald-400" /> Recent Profit Events
            </h3>
            {report.recentProfits.length === 0 ? (
              <div className="text-center py-10">
                <DollarSign size={48} className="mx-auto mb-4 text-white/10" />
                <p className="text-slate-400 text-sm">No profit events yet</p>
                <p className="text-slate-600 text-xs mt-1">Revenue will appear here as users consume services</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {report.recentProfits.map((p: any, i: number) => (
                  <div key={p.id || i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`profit-row-${p.id || i}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.source === "markup" ? "bg-cyan-500/20 text-cyan-400" : "bg-purple-500/20 text-purple-400"}`}>
                      {p.source === "markup" ? <Zap size={14} /> : <Megaphone size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{p.description}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-emerald-400">+${p.amount.toFixed(4)}</div>
                      <Badge className={`text-[10px] ${p.source === "markup" ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" : "bg-purple-500/20 text-purple-400 border-purple-500/30"}`}>
                        {p.source === "markup" ? "Markup" : "Ad Click"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
