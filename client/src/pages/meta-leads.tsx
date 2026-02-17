import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Users, RefreshCw, UserPlus, Mail, Phone, CheckCircle2, Clock, ArrowRight, FileText } from "lucide-react";
import { format } from "date-fns";

interface MetaLead {
  id: number;
  subAccountId: number;
  metaFormId: string | null;
  formName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  customFields: any;
  syncedToCrm: boolean;
  contactId: number | null;
  campaignId: number | null;
  createdAt: string;
}

interface MetaConfig {
  hasAccessToken: boolean;
  hasAdAccountId: boolean;
  hasPageId: boolean;
  hasAppId: boolean;
}

export default function MetaLeadsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 1;
  const [filter, setFilter] = useState<"all" | "synced" | "unsynced">("all");

  const { data: leads = [], isLoading } = useQuery<MetaLead[]>({
    queryKey: ["/api/meta/leads", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/meta/leads/${subAccountId}`);
      return res.json();
    },
  });

  const { data: config } = useQuery<MetaConfig>({
    queryKey: ["/api/meta/config"],
    queryFn: async () => {
      const res = await fetch("/api/meta/config");
      return res.json();
    },
  });

  const syncFromMetaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/meta/leads/sync/${subAccountId}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/leads"] });
      toast({ title: data.synced ? `Synced ${data.count} leads from Facebook` : "Sync skipped", description: data.message });
    },
  });

  const syncToCrmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/meta/leads/${id}/to-crm`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/leads"] });
      toast({ title: "Lead added to CRM" });
    },
  });

  const syncAllToCrmMutation = useMutation({
    mutationFn: async () => {
      const unsynced = leads.filter(l => !l.syncedToCrm);
      for (const lead of unsynced) {
        await apiRequest("POST", `/api/meta/leads/${lead.id}/to-crm`, {});
      }
      return unsynced.length;
    },
    onSuccess: (count: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/leads"] });
      toast({ title: `${count} leads synced to CRM` });
    },
  });

  const filteredLeads = leads.filter(l => {
    if (filter === "synced") return l.syncedToCrm;
    if (filter === "unsynced") return !l.syncedToCrm;
    return true;
  });

  const unsyncedCount = leads.filter(l => !l.syncedToCrm).length;
  const syncedCount = leads.filter(l => l.syncedToCrm).length;
  const formNames = Array.from(new Set(leads.map(l => l.formName).filter(Boolean)));

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-meta-leads-title">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Users size={20} className="text-white" />
            </div>
            Facebook Lead Forms
          </h1>
          <p className="text-slate-400 mt-1">Capture and sync leads from your Facebook lead generation ads</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => syncFromMetaMutation.mutate()} disabled={syncFromMetaMutation.isPending} variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10" data-testid="button-sync-from-meta">
            <RefreshCw size={16} className={`mr-2 ${syncFromMetaMutation.isPending ? "animate-spin" : ""}`} />
            {syncFromMetaMutation.isPending ? "Syncing..." : "Sync from Facebook"}
          </Button>
          {unsyncedCount > 0 && (
            <Button onClick={() => syncAllToCrmMutation.mutate()} disabled={syncAllToCrmMutation.isPending} className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700" data-testid="button-sync-all-crm">
              <UserPlus size={16} className="mr-2" />
              {syncAllToCrmMutation.isPending ? "Syncing..." : `Sync All to CRM (${unsyncedCount})`}
            </Button>
          )}
        </div>
      </div>

      {!config?.hasAccessToken && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-yellow-300 text-sm" data-testid="text-meta-leads-warning">
          Meta API keys not configured. Add META_ACCESS_TOKEN and META_PAGE_ID to enable automatic lead syncing from Facebook.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center"><Users size={20} className="text-blue-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Total Leads</p>
              <p className="text-xl font-bold text-white" data-testid="text-total-leads">{leads.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center"><CheckCircle2 size={20} className="text-green-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Synced to CRM</p>
              <p className="text-xl font-bold text-green-400" data-testid="text-synced-count">{syncedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center"><Clock size={20} className="text-yellow-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Pending Sync</p>
              <p className="text-xl font-bold text-yellow-400" data-testid="text-unsynced-count">{unsyncedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center"><FileText size={20} className="text-purple-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Lead Forms</p>
              <p className="text-xl font-bold text-purple-400" data-testid="text-form-count">{formNames.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        {(["all", "unsynced", "synced"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} className={filter === f ? "bg-blue-600" : "border-white/10 text-slate-400"} data-testid={`button-filter-${f}`}>
            {f === "all" ? "All" : f === "unsynced" ? "Pending" : "Synced"}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400">Loading leads...</div>
      ) : filteredLeads.length === 0 ? (
        <div className="text-center py-20 bg-black/20 border border-white/5 rounded-2xl">
          <Users size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 text-lg">No leads found</p>
          <p className="text-slate-500 text-sm mt-1">
            {leads.length === 0 ? "Click \"Sync from Facebook\" to pull your lead form submissions" : "No leads match the current filter"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map((lead) => (
            <motion.div key={lead.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-black/40 border border-white/10 rounded-xl p-4 flex items-center justify-between" data-testid={`card-lead-${lead.id}`}>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  {lead.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold">{lead.name}</p>
                  <div className="flex items-center gap-3 text-sm text-slate-400">
                    {lead.email && <span className="flex items-center gap-1"><Mail size={12} /> {lead.email}</span>}
                    {lead.phone && <span className="flex items-center gap-1"><Phone size={12} /> {lead.phone}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {lead.formName && <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">{lead.formName}</Badge>}
                    <span className="text-xs text-slate-500">{format(new Date(lead.createdAt), "MMM d, yyyy h:mm a")}</span>
                  </div>
                </div>
              </div>
              <div>
                {lead.syncedToCrm ? (
                  <Badge className="bg-green-500/20 text-green-400"><CheckCircle2 size={14} className="mr-1" /> In CRM</Badge>
                ) : (
                  <Button size="sm" onClick={() => syncToCrmMutation.mutate(lead.id)} disabled={syncToCrmMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white" data-testid={`button-sync-to-crm-${lead.id}`}>
                    <ArrowRight size={14} className="mr-1" /> Add to CRM
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
