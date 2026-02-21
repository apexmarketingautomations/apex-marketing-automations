import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Phone, MessageSquare, Sparkles, Loader2, Save, Clock, TrendingUp, Zap, Wallet, Plus, ArrowDownRight, ArrowUpRight, CreditCard, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useActiveSubAccountId } from "@/components/account-required";

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

const TOP_UP_AMOUNTS = [10, 25, 50, 100, 250, 500];

export default function Billing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const subAccountId = useActiveSubAccountId();
  const [ownerPhone, setOwnerPhone] = useState("");
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"wallet" | "usage">("wallet");

  const { data: wallet, isLoading: walletLoading } = useQuery<any>({
    queryKey: ["/api/wallet", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${subAccountId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: transactions } = useQuery<any[]>({
    queryKey: ["/api/wallet/transactions", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/wallet/${subAccountId}/transactions`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data, isLoading } = useQuery<{ logs: any[]; summary: any[] }>({
    queryKey: ["/api/usage", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/usage/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch usage data");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: account } = useQuery<any>({
    queryKey: ["/api/accounts", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/accounts`);
      if (!res.ok) throw new Error("Failed");
      const accounts = await res.json();
      return accounts.find((a: any) => a.id === subAccountId) || null;
    },
    enabled: !!subAccountId,
    onSuccess: (acc: any) => {
      if (!phoneLoaded && acc) { setOwnerPhone(acc.ownerPhone || ""); setPhoneLoaded(true); }
    },
  } as any);

  const topUpMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAccountId, amount }),
      });
      if (!res.ok) throw new Error("Failed to create checkout");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Error", description: "Could not start checkout. Try again.", variant: "destructive" });
    },
  });

  const savePhoneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/accounts/${subAccountId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerPhone }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Owner phone number updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", subAccountId] });
    },
  });

  const logs = data?.logs || [];
  const summary = data?.summary || [];
  const totalSpend = summary.reduce((sum: number, s: any) => sum + (s.totalCost || 0), 0);
  const txns = transactions || [];
  const balance = wallet?.balance ?? 0;
  const lowBalance = balance < (wallet?.lowBalanceThreshold || 5);

  const MARKUP_RATES = [
    { type: "SMS", rate: "$2.00/segment", desc: "Twilio", color: "text-indigo-400" },
    { type: "Voice", rate: "$1.50/min", desc: "Vapi", color: "text-cyan-400" },
    { type: "AI Image", rate: "$0.25/image", desc: "Google Gemini", color: "text-purple-400" },
    { type: "AI Chat", rate: "$0.03/call", desc: "Gemini 2.5 Flash", color: "text-emerald-400" },
  ];

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <Wallet size={12} /> APEX WALLET
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-billing-title">
            Apex <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Wallet</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage your credits, track usage, and add funds</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
          <Card className="border-white/10 p-0 overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.08), rgba(99,102,241,0.08), rgba(168,85,247,0.08))" }} data-testid="wallet-hero">
            <div className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-end gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard size={16} className="text-cyan-400" />
                    <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Current Balance</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl md:text-6xl font-black text-white" data-testid="text-wallet-balance">${balance.toFixed(2)}</span>
                    {lowBalance && (
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs ml-2">
                        <AlertTriangle size={10} className="mr-1" /> Low Balance
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-6 mt-3 text-xs text-slate-500">
                    <span>Lifetime Added: <span className="text-slate-300 font-semibold">${(wallet?.lifetimeTopUp || 0).toFixed(2)}</span></span>
                    <span>Lifetime Spent: <span className="text-slate-300 font-semibold">${(wallet?.lifetimeSpend || 0).toFixed(2)}</span></span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {TOP_UP_AMOUNTS.map((amt) => (
                    <Button
                      key={amt}
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold"
                      onClick={() => topUpMutation.mutate(amt)}
                      disabled={topUpMutation.isPending}
                      data-testid={`button-topup-${amt}`}
                    >
                      {topUpMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      ${amt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        <div className="flex gap-2 mb-6">
          {(["wallet", "usage"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-400 hover:text-white"}`}
              data-testid={`tab-${tab}`}
            >
              {tab === "wallet" ? "Transactions" : "Usage Breakdown"}
            </button>
          ))}
        </div>

        {activeTab === "wallet" ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="bg-white/5 border-white/10 p-5" data-testid="transactions-list">
              <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                <Clock size={14} className="text-indigo-400" /> Transaction History
              </h3>
              {txns.length === 0 ? (
                <div className="text-center py-10">
                  <Wallet size={48} className="mx-auto mb-4 text-white/10" />
                  <p className="text-slate-400 text-sm">No transactions yet</p>
                  <p className="text-slate-600 text-xs mt-1">Add credits to get started</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {txns.map((tx: any, i: number) => (
                    <div key={tx.id || i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`txn-row-${tx.id || i}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tx.type === "topup" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                        {tx.type === "topup" ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{tx.description || tx.type}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-bold ${tx.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {tx.amount > 0 ? "+" : ""}{formatCost(tx.amount)}
                        </div>
                        <div className="text-[10px] text-slate-500">Bal: {formatCost(tx.balanceAfter)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {isLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-indigo-400" size={32} /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-white/5 border-white/10 p-5" data-testid="usage-breakdown">
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <TrendingUp size={14} className="text-indigo-400" /> Usage Breakdown
                  </h3>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: "Total Spend", value: formatCost(totalSpend), icon: DollarSign, color: "text-cyan-400" },
                      { label: "AI Ops", value: summary.filter((s: any) => s.type.startsWith("AI")).reduce((a: number, s: any) => a + (s.count || 0), 0), icon: Sparkles, color: "text-emerald-400" },
                    ].map((stat, i) => (
                      <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                        <div className="flex items-center gap-1.5 mb-1"><stat.icon size={12} className={stat.color} /><span className="text-[10px] text-slate-500">{stat.label}</span></div>
                        <div className="text-lg font-black text-white">{stat.value}</div>
                      </div>
                    ))}
                  </div>
                  {summary.length > 0 && (
                    <div className="space-y-2">
                      {summary.map((s: any, i: number) => {
                        const meta = TYPE_META[s.type] || { label: s.type, icon: Zap, color: "text-slate-400", badgeClass: "bg-white/10 text-slate-400 border-white/10" };
                        const Icon = meta.icon;
                        return (
                          <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`breakdown-row-${i}`}>
                            <div className="flex items-center gap-2"><Icon size={14} className={meta.color} /><span className="text-sm text-white">{meta.label}</span></div>
                            <div className="text-sm font-bold text-white">{formatCost(s.totalCost || 0)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <div className="space-y-6">
                  <Card className="bg-white/5 border-white/10 p-5" data-testid="markup-rates">
                    <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                      <DollarSign size={14} className="text-cyan-400" /> Per-Unit Pricing
                    </h3>
                    <div className="space-y-2">
                      {MARKUP_RATES.map((r, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                          <div className="flex flex-col">
                            <span className={`text-sm font-medium ${r.color}`}>{r.type}</span>
                            <span className="text-[10px] text-slate-500">{r.desc}</span>
                          </div>
                          <span className="text-sm font-bold text-white">{r.rate}</span>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card className="bg-white/5 border-white/10 p-5" data-testid="owner-phone-config">
                    <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <Phone size={14} className="text-cyan-400" /> Owner Phone (SMS Alerts)
                    </h3>
                    <div className="flex gap-2">
                      <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+1234567890"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20 flex-1" data-testid="input-owner-phone" />
                      <Button onClick={() => savePhoneMutation.mutate()} disabled={savePhoneMutation.isPending}
                        className="bg-indigo-600 hover:bg-indigo-500" data-testid="button-save-phone">
                        {savePhoneMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      </Button>
                    </div>
                  </Card>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
