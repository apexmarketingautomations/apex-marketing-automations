import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAccount } from "@/hooks/use-account";
import { useToast } from "@/hooks/use-toast";
import { History, Save, RotateCcw, Upload, Clock, ChevronRight, AlertTriangle, CheckCircle2, Package, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { SubAccount, SnapshotVersion } from "@shared/schema";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { SNAPSHOTS_STEPS } from "@/components/tutorial-steps";

export default function Snapshots() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_snapshots");
  const { activeAccountId } = useAccount();
  const [checkpointName, setCheckpointName] = useState("");
  const [showPublish, setShowPublish] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishDesc, setPublishDesc] = useState("");
  const [publishPrice, setPublishPrice] = useState("0");
  const [rollbackTarget, setRollbackTarget] = useState<SnapshotVersion | null>(null);

  const { data: accounts = [] } = useQuery<SubAccount[]>({ queryKey: ["/api/accounts"] });
  const currentAccount = accounts.find(a => a.id === activeAccountId) || accounts[0];

  const { data: versions = [], isLoading } = useQuery<SnapshotVersion[]>({
    queryKey: ["/api/versions", currentAccount?.id],
    enabled: !!currentAccount?.id,
    queryFn: async () => {
      const res = await fetch(`/api/versions/${currentAccount!.id}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
  });

  const checkpointMutation = useMutation({
    mutationFn: async (versionName: string) => {
      const res = await apiRequest("POST", "/api/versions/checkpoint", {
        subAccountId: currentAccount!.id,
        versionName,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Checkpoint saved!", description: "Your account configuration has been snapshotted." });
      queryClient.invalidateQueries({ queryKey: ["/api/versions", currentAccount?.id] });
      setCheckpointName("");
    },
    onError: () => {
      toast({ title: "Failed to save checkpoint", variant: "destructive" });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (versionId: number) => {
      const res = await apiRequest("POST", `/api/versions/${versionId}/rollback`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Rollback complete!", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setRollbackTarget(null);
    },
    onError: () => {
      toast({ title: "Rollback failed", variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/snapshots/publish", {
        subAccountId: currentAccount!.id,
        name: publishName,
        description: publishDesc,
        price: parseFloat(publishPrice) || 0,
        isPublic: true,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Published to Marketplace!", description: "Your snapshot is now available for others to install." });
      setShowPublish(false);
      setPublishName("");
      setPublishDesc("");
      setPublishPrice("0");
    },
    onError: () => {
      toast({ title: "Publish failed", variant: "destructive" });
    },
  });

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <History size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white" data-testid="text-snapshots-title">Snapshot Manager</h1>
              <p className="text-slate-400 text-sm">
                {currentAccount ? `Versioning for "${currentAccount.name}"` : "Select a sub-account to manage versions"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
              <BookOpen size={16} className="mr-1" /> Tutorial
            </Button>
            <Button
              onClick={() => { setShowPublish(true); setPublishName(currentAccount?.name || ""); }}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold gap-2"
              disabled={!currentAccount}
              data-testid="button-publish-snapshot"
            >
              <Upload size={16} /> Publish to Marketplace
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-black/40 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-6 mb-8 shadow-[0_0_15px_rgba(0,243,255,0.1)]"
      >
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Save size={16} className="text-cyan-400" /> Create Checkpoint
        </h3>
        <p className="text-slate-400 text-sm mb-4">
          Save the current state of your account configuration, workflows, and settings. You can restore to this point at any time.
        </p>
        <div className="flex gap-3">
          <Input
            placeholder="Checkpoint name, e.g. 'Before redesign' or 'v2.1 stable'"
            value={checkpointName}
            onChange={(e) => setCheckpointName(e.target.value)}
            className="bg-white/5 border-white/10 text-white flex-1"
            data-testid="input-checkpoint-name"
          />
          <Button
            onClick={() => checkpointName.trim() && checkpointMutation.mutate(checkpointName.trim())}
            disabled={!checkpointName.trim() || checkpointMutation.isPending || !currentAccount}
            className="bg-cyan-500 text-black font-bold gap-2 hover:bg-cyan-400"
            data-testid="button-save-checkpoint"
          >
            {checkpointMutation.isPending ? "Saving..." : <>
              <Save size={14} /> Save
            </>}
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-purple-400" /> Version History
        </h3>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse border border-white/10" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-16 bg-black/20 rounded-2xl border border-white/5">
            <Package size={48} className="mx-auto text-slate-600 mb-4" />
            <h3 className="text-white font-bold text-lg mb-2">No Checkpoints Yet</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Create your first checkpoint above to start tracking versions of your account configuration.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version, i) => (
              <motion.div
                key={version.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-4 flex items-center justify-between hover:border-purple-500/30 transition-all group"
                data-testid={`card-version-${version.id}`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 font-bold text-sm">
                    v{versions.length - i}
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm">{version.versionName}</p>
                    <p className="text-slate-500 text-xs flex items-center gap-1">
                      <Clock size={10} /> {formatDate(version.createdAt as unknown as string)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRollbackTarget(version)}
                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid={`button-rollback-${version.id}`}
                >
                  <RotateCcw size={14} /> Restore
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      <Dialog open={!!rollbackTarget} onOpenChange={() => setRollbackTarget(null)}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={20} /> Confirm Rollback
            </DialogTitle>
          </DialogHeader>
          <p className="text-slate-400 text-sm">
            This will restore <strong className="text-white">"{currentAccount?.name}"</strong> to the checkpoint <strong className="text-white">"{rollbackTarget?.versionName}"</strong>.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Current settings (theme, config, industry) will be overwritten. Create a new checkpoint first if you want to preserve the current state.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)} className="border-white/10 text-white hover:bg-white/10">
              Cancel
            </Button>
            <Button
              onClick={() => rollbackTarget && rollbackMutation.mutate(rollbackTarget.id)}
              disabled={rollbackMutation.isPending}
              className="bg-amber-500 text-black font-bold gap-2"
              data-testid="button-confirm-rollback"
            >
              {rollbackMutation.isPending ? "Restoring..." : <>
                <RotateCcw size={14} /> Restore Checkpoint
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPublish} onOpenChange={setShowPublish}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload size={20} className="text-purple-400" /> Publish to Marketplace
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Share your account configuration as a reusable template. Others can install it to create new accounts with your setup.
            </p>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Snapshot Name</label>
              <Input
                value={publishName}
                onChange={(e) => setPublishName(e.target.value)}
                placeholder="e.g., Elite Gym CRM Setup"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-publish-name"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Description</label>
              <Textarea
                value={publishDesc}
                onChange={(e) => setPublishDesc(e.target.value)}
                placeholder="Describe what's included: workflows, templates, settings..."
                className="bg-white/5 border-white/10 text-white min-h-[80px]"
                data-testid="input-publish-description"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Price ($0 = Free)</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={publishPrice}
                onChange={(e) => setPublishPrice(e.target.value)}
                className="bg-white/5 border-white/10 text-white w-32"
                data-testid="input-publish-price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPublish(false)} className="border-white/10 text-white hover:bg-white/10">
              Cancel
            </Button>
            <Button
              onClick={() => publishMutation.mutate()}
              disabled={!publishName.trim() || publishMutation.isPending}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold gap-2"
              data-testid="button-confirm-publish"
            >
              {publishMutation.isPending ? "Publishing..." : <>
                <CheckCircle2 size={14} /> Publish Snapshot
              </>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showTutorial && <TutorialOverlay steps={SNAPSHOTS_STEPS} storageKey="apex_tutorial_snapshots" onClose={closeTutorial} accentColor="purple" />}
    </div>
  );
}
