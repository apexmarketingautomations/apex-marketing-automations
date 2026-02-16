import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Store, Download, GitFork, Star, Search, Package, ArrowRight, Sparkles, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Snapshot } from "@shared/schema";

const industries = [
  "All", "Medical/Health", "Home Services", "Professional", "Lifestyle/Beauty", "Hospitality", "Creators", "Tech", "Fitness"
];

export default function Marketplace() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("All");
  const [forkSnapshot, setForkSnapshot] = useState<Snapshot | null>(null);
  const [businessName, setBusinessName] = useState("");

  const { data: snapshots = [], isLoading } = useQuery<Snapshot[]>({
    queryKey: ["/api/snapshots/marketplace"],
  });

  const forkMutation = useMutation({
    mutationFn: async ({ snapshotId, businessName }: { snapshotId: number; businessName: string }) => {
      const res = await apiRequest("POST", `/api/snapshots/${snapshotId}/fork`, { businessName });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Snapshot installed!", description: "Your new sub-account has been created from this snapshot." });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/snapshots/marketplace"] });
      setForkSnapshot(null);
      setBusinessName("");
    },
    onError: () => {
      toast({ title: "Fork failed", description: "Could not install this snapshot.", variant: "destructive" });
    },
  });

  const filtered = snapshots.filter((s: Snapshot) => {
    const matchesSearch = !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesIndustry = selectedIndustry === "All" || s.industry?.toLowerCase().includes(selectedIndustry.toLowerCase());
    return matchesSearch && matchesIndustry;
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Store size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white" data-testid="text-marketplace-title">Snapshot Marketplace</h1>
            <p className="text-slate-400 text-sm">Install pre-built business templates in one click</p>
          </div>
        </div>
      </motion.div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search snapshots..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-white/5 border-white/10 text-white"
            data-testid="input-marketplace-search"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {industries.map((ind) => (
            <button
              key={ind}
              onClick={() => setSelectedIndustry(ind)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedIndustry === ind
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
              }`}
              data-testid={`button-filter-${ind.toLowerCase().replace(/\//g, "-")}`}
            >
              {ind}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-white/5 rounded-2xl animate-pulse border border-white/10" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
          <Package size={48} className="mx-auto text-slate-600 mb-4" />
          <h3 className="text-white font-bold text-xl mb-2">No Snapshots Found</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            {snapshots.length === 0
              ? "The marketplace is empty. Be the first to publish a snapshot from your sub-account!"
              : "No snapshots match your search. Try adjusting your filters."}
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((snapshot: Snapshot, i: number) => (
            <motion.div
              key={snapshot.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-6 hover:border-purple-500/30 transition-all group"
              data-testid={`card-snapshot-${snapshot.id}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-white text-xs font-black">
                    {snapshot.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm">{snapshot.name}</h3>
                    {snapshot.industry && (
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{snapshot.industry}</span>
                    )}
                  </div>
                </div>
                {(snapshot.price ?? 0) > 0 ? (
                  <span className="text-amber-400 font-bold text-sm">${snapshot.price}</span>
                ) : (
                  <span className="text-green-400 font-bold text-xs uppercase">Free</span>
                )}
              </div>

              {snapshot.description && (
                <p className="text-slate-400 text-sm mb-4 line-clamp-2">{snapshot.description}</p>
              )}

              <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Download size={12} /> {snapshot.downloads || 0}</span>
                <span className="flex items-center gap-1"><GitFork size={12} /> {snapshot.forkCount || 0}</span>
                {(snapshot.rating ?? 0) > 0 && (
                  <span className="flex items-center gap-1"><Star size={12} className="text-amber-500" /> {snapshot.rating}</span>
                )}
              </div>

              {snapshot.creatorName && (
                <p className="text-[10px] text-slate-600 mb-4">by @{snapshot.creatorName}</p>
              )}

              <button
                onClick={() => { setForkSnapshot(snapshot); setBusinessName(""); }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold text-sm flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-90"
                data-testid={`button-install-snapshot-${snapshot.id}`}
              >
                <Sparkles size={14} /> Install Snapshot <ArrowRight size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={!!forkSnapshot} onOpenChange={() => setForkSnapshot(null)}>
        <DialogContent className="bg-neutral-950 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork size={20} className="text-purple-400" />
              Install "{forkSnapshot?.name}"
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {forkSnapshot?.creatorName && (
              <p className="text-xs text-slate-500">Created by @{forkSnapshot.creatorName}</p>
            )}
            {forkSnapshot?.description && (
              <p className="text-sm text-slate-400">{forkSnapshot.description}</p>
            )}
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Your Business Name</label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g., Brian's Bar & Grill"
                className="bg-white/5 border-white/10 text-white"
                data-testid="input-fork-business-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForkSnapshot(null)} className="border-white/10 text-white hover:bg-white/10">
              Cancel
            </Button>
            <Button
              onClick={() => forkSnapshot && forkMutation.mutate({ snapshotId: forkSnapshot.id, businessName })}
              disabled={!businessName.trim() || forkMutation.isPending}
              className="bg-gradient-to-r from-purple-500 to-pink-500 text-white"
              data-testid="button-confirm-fork"
            >
              {forkMutation.isPending ? "Installing..." : "Install & Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
