import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Shield, TrendingUp, Users, MessageSquare, GitFork, Zap, Star, DollarSign, Activity, BarChart3, RotateCcw, CheckSquare, Square, BookOpen, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { SnapshotVersion } from "@shared/schema";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { COMMAND_CENTER_STEPS } from "@/components/tutorial-steps";

export default function CommandCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_command_center");
  const [showBulkRollback, setShowBulkRollback] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferAccountId, setTransferAccountId] = useState<number | null>(null);
  const [transferUserId, setTransferUserId] = useState("");

  const { data: metrics, isLoading } = useQuery<any>({
    queryKey: ["/api/command-center"],
  });

  const { data: allVersions = [] } = useQuery<SnapshotVersion[]>({
    queryKey: ["/api/snapshots"],
    queryFn: async () => {
      const accounts = metrics?.accounts || [];
      const all: SnapshotVersion[] = [];
      for (const acc of accounts.slice(0, 10)) {
        try {
          const res = await fetch(`/api/versions/${acc.id}`);
          const versions = await res.json();
          all.push(...versions);
        } catch {}
      }
      return all;
    },
    enabled: !!metrics?.accounts?.length,
  });

  const bulkRollbackMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/versions/bulk-rollback", {
        versionId: selectedVersion,
        subAccountIds: selectedAccounts,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Bulk rollback complete!", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/command-center"] });
      setShowBulkRollback(false);
      setSelectedAccounts([]);
      setSelectedVersion(null);
    },
    onError: () => {
      toast({ title: "Bulk rollback failed", variant: "destructive" });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/transfer-account", {
        subAccountId: transferAccountId,
        newOwnerUserId: transferUserId.trim(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Account Transferred!", description: `${data.account?.name || "Account"} transferred to user ${transferUserId}` });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/command-center"] });
      setShowTransfer(false);
      setTransferAccountId(null);
      setTransferUserId("");
    },
    onError: () => {
      toast({ title: "Transfer failed", variant: "destructive" });
    },
  });

  const toggleAccount = (id: number) => {
    setSelectedAccounts(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white/5 rounded-2xl animate-pulse border border-white/10" />
          ))}
        </div>
      </div>
    );
  }

  const topPerformers = [...(metrics?.accounts || [])]
    .sort((a: any, b: any) => b.revenue - a.revenue)
    .slice(0, 5);

  const atRisk = (metrics?.accounts || []).filter((a: any) => a.avgRating > 0 && a.avgRating < 3);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Shield size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white" data-testid="text-command-center-title">Agency Command Center</h1>
              <p className="text-slate-400 text-sm">Fleet health, revenue, and global metrics at a glance</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-black/40 backdrop-blur-md border border-cyan-500/30 p-5 rounded-2xl shadow-[0_0_15px_rgba(0,243,255,0.1)]"
          data-testid="card-total-revenue"
        >
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={14} className="text-cyan-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Portfolio MRR</p>
          </div>
          <p className="text-3xl font-black text-white">${metrics?.totalRevenue?.toFixed(2) || "0.00"}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-black/40 backdrop-blur-md border border-purple-500/30 p-5 rounded-2xl"
          data-testid="card-total-accounts"
        >
          <div className="flex items-center gap-2 mb-2">
            <Users size={14} className="text-purple-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Sub-Accounts</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalAccounts || 0}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-black/40 backdrop-blur-md border border-green-500/30 p-5 rounded-2xl"
          data-testid="card-total-leads"
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-green-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Total Leads</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalLeads || 0}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-black/40 backdrop-blur-md border border-amber-500/30 p-5 rounded-2xl"
          data-testid="card-total-messages"
        >
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare size={14} className="text-amber-400" />
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Messages</p>
          </div>
          <p className="text-3xl font-black text-white">{metrics?.totalMessages || 0}</p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <Zap size={20} className="text-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Active Workflows</p>
            <p className="text-2xl font-black text-white">{metrics?.totalWorkflows || 0}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <Activity size={20} className="text-cyan-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Plan Tier</p>
            <p className="text-2xl font-black text-white capitalize">{metrics?.planTier?.replace("_", " ") || "Free"}</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-black/40 backdrop-blur-md border border-white/10 p-5 rounded-2xl flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
            <BarChart3 size={20} className="text-green-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">AI Credits</p>
            <p className="text-2xl font-black text-white">${(metrics?.aiCredits || 0).toFixed(2)}</p>
          </div>
        </motion.div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-6 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-cyan-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-cyan-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <TrendingUp size={14} /> Phase 1: Neural Intake
          </h3>
          {(metrics?.accounts || []).slice(0, 5).map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-cyan-500/50 transition-all">
              <p className="text-white font-bold text-sm">{account.name}</p>
              <p className="text-xs text-gray-400">{account.newLeads} new leads detected</p>
              <div className="w-full bg-gray-800 h-1 mt-2 rounded-full overflow-hidden">
                <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${Math.min(100, (account.newLeads / Math.max(1, metrics?.totalLeads || 1)) * 300)}%` }} />
              </div>
            </div>
          ))}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-purple-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-purple-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <Zap size={14} /> Phase 2: Active Workflows
          </h3>
          {(metrics?.accounts || []).filter((a: any) => a.workflowCount > 0).slice(0, 5).map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-purple-500/50 transition-all">
              <p className="text-white font-bold text-sm">{account.name}</p>
              <p className="text-xs text-gray-400">{account.workflowCount} active workflows</p>
              <p className="text-xs text-purple-400 mt-1">{account.messageCount} messages processed</p>
            </div>
          ))}
          {(metrics?.accounts || []).filter((a: any) => a.workflowCount > 0).length === 0 && (
            <p className="text-slate-600 text-sm text-center py-4">No active workflows yet</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="min-w-[320px] bg-black/40 backdrop-blur-md border-t-2 border-green-500 p-5 rounded-b-xl flex-1"
        >
          <h3 className="text-green-400 font-black uppercase tracking-widest text-sm mb-4 flex items-center gap-2">
            <DollarSign size={14} /> Phase 3: Revenue Capture
          </h3>
          {topPerformers.map((account: any) => (
            <div key={account.id} className="bg-white/5 p-3 rounded-lg mb-2 border border-white/10 hover:border-green-500/50 transition-all">
              <div className="flex items-center justify-between">
                <p className="text-white font-bold text-sm">{account.name}</p>
                <p className="text-green-400 font-bold text-sm">${account.revenue.toFixed(2)}</p>
              </div>
              <p className="text-xs text-gray-400">{account.reviewCount} reviews ({account.avgRating} avg)</p>
            </div>
          ))}
          {topPerformers.length === 0 && (
            <p className="text-slate-600 text-sm text-center py-4">No revenue data yet</p>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}
        className="mb-8"
      >
        <div className="flex gap-3 flex-wrap">
          <Button
            onClick={() => setShowBulkRollback(true)}
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold gap-2"
            data-testid="button-bulk-rollback"
          >
            <RotateCcw size={16} /> Bulk Rollback Accounts
          </Button>
          <Button
            onClick={() => setShowTransfer(true)}
            className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold gap-2"
            data-testid="button-transfer-account"
          >
            <ArrowRightLeft size={16} /> Transfer Account
          </Button>
        </div>
      </motion.div>

      <Dialog open={showBulkRollback} onOpenChange={setShowBulkRollback}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <RotateCcw size={20} /> Bulk Rollback
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Select Checkpoint</label>
              {allVersions.length === 0 ? (
                <p className="text-slate-500 text-sm">No checkpoints found. Create checkpoints from the Snapshots page first.</p>
              ) : (
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {allVersions.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersion(v.id)}
                      className={`w-full text-left p-3 rounded-lg border text-sm transition-all ${selectedVersion === v.id ? "border-amber-500/50 bg-amber-500/10 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}
                      data-testid={`button-select-version-${v.id}`}
                    >
                      <span className="font-bold">{v.versionName}</span>
                      <span className="text-xs text-slate-500 ml-2">Account #{v.subAccountId}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Apply To Accounts</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {(metrics?.accounts || []).map((acc: any) => (
                  <button
                    key={acc.id}
                    onClick={() => toggleAccount(acc.id)}
                    className={`w-full text-left p-3 rounded-lg border text-sm flex items-center gap-2 transition-all ${selectedAccounts.includes(acc.id) ? "border-cyan-500/50 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                    data-testid={`button-select-account-${acc.id}`}
                  >
                    {selectedAccounts.includes(acc.id) ? <CheckSquare size={14} className="text-cyan-400" /> : <Square size={14} className="text-slate-500" />}
                    <span className="text-white">{acc.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkRollback(false)} className="border-white/10 text-white hover:bg-white/10">
              Cancel
            </Button>
            <Button
              onClick={() => bulkRollbackMutation.mutate()}
              disabled={!selectedVersion || selectedAccounts.length === 0 || bulkRollbackMutation.isPending}
              className="bg-amber-500 text-black font-bold gap-2"
              data-testid="button-confirm-bulk-rollback"
            >
              {bulkRollbackMutation.isPending ? "Rolling back..." : <>
                <RotateCcw size={14} /> Rollback {selectedAccounts.length} Account{selectedAccounts.length !== 1 ? "s" : ""}
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-cyan-400">
              <ArrowRightLeft size={20} /> Transfer Account Ownership
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Select Account</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(metrics?.accounts || []).map((acc: any) => (
                  <button
                    key={acc.id}
                    onClick={() => setTransferAccountId(acc.id)}
                    className={`w-full text-left p-3 rounded-lg border text-sm transition-all ${transferAccountId === acc.id ? "border-cyan-500/50 bg-cyan-500/10 text-white" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}
                    data-testid={`button-transfer-select-${acc.id}`}
                  >
                    <span className="font-bold text-white">{acc.name}</span>
                    <span className="text-xs text-slate-500 ml-2">ID #{acc.id}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">New Owner's Replit User ID</label>
              <Input
                value={transferUserId}
                onChange={(e) => setTransferUserId(e.target.value)}
                placeholder="e.g. 53528927"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-transfer-user-id"
              />
              <p className="text-[10px] text-slate-600 mt-1">Find this in server logs when the user logs in, or ask them for their Replit profile URL</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransfer(false)} className="border-white/10 text-white hover:bg-white/10">
              Cancel
            </Button>
            <Button
              onClick={() => transferMutation.mutate()}
              disabled={!transferAccountId || !transferUserId.trim() || transferMutation.isPending}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold gap-2"
              data-testid="button-confirm-transfer"
            >
              {transferMutation.isPending ? "Transferring..." : <>
                <ArrowRightLeft size={14} /> Transfer Account
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {atRisk.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
          className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6"
        >
          <h3 className="text-red-400 font-bold mb-3 flex items-center gap-2">
            <Shield size={16} /> Accounts At Risk
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {atRisk.map((account: any) => (
              <div key={account.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                <div>
                  <p className="text-white font-bold text-sm">{account.name}</p>
                  <p className="text-xs text-red-400">Avg Rating: {account.avgRating}/5</p>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={12} className={s <= account.avgRating ? "text-amber-400 fill-amber-400" : "text-slate-700"} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
      {showTutorial && <TutorialOverlay steps={COMMAND_CENTER_STEPS} storageKey="apex_tutorial_command_center" onClose={closeTutorial} accentColor="indigo" />}
    </div>
  );
}
