import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useActiveSubAccountId } from "@/components/account-required";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Megaphone, Plus, Trash2, RefreshCw, Rocket, Eye, MousePointerClick, DollarSign, Users, TrendingUp, BarChart3, Target, AlertTriangle, Info } from "lucide-react";

interface MetaAdCampaign {
  id: number;
  subAccountId: number;
  metaCampaignId: string | null;
  name: string;
  objective: string;
  status: string;
  dailyBudget: number;
  totalSpend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpc: number;
  ctr: number;
  startDate: string | null;
  endDate: string | null;
  targeting: any;
  creativeUrl: string | null;
  adText: string | null;
  createdAt: string;
}

interface MetaConfig {
  hasAccessToken: boolean;
  hasAdAccountId: boolean;
  hasPageId: boolean;
  hasAppId: boolean;
}

const OBJECTIVES = [
  { value: "LEAD_GENERATION", label: "Lead Generation" },
  { value: "TRAFFIC", label: "Website Traffic" },
  { value: "CONVERSIONS", label: "Conversions" },
  { value: "BRAND_AWARENESS", label: "Brand Awareness" },
  { value: "REACH", label: "Reach" },
  { value: "ENGAGEMENT", label: "Engagement" },
  { value: "VIDEO_VIEWS", label: "Video Views" },
  { value: "MESSAGES", label: "Messages" },
];

export default function MetaAdsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const subAccountId = useActiveSubAccountId();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("LEAD_GENERATION");
  const [dailyBudget, setDailyBudget] = useState("");
  const [adText, setAdText] = useState("");

  const { data: campaigns = [], isLoading } = useQuery<MetaAdCampaign[]>({
    queryKey: ["/api/meta/campaigns", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/meta/campaigns/${subAccountId}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: config } = useQuery<MetaConfig>({
    queryKey: ["/api/meta/config"],
    queryFn: async () => {
      const res = await fetch("/api/meta/config");
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/meta/campaigns", {
        subAccountId,
        name,
        objective,
        dailyBudget: parseFloat(dailyBudget) || 0,
        adText,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/campaigns"] });
      setDialogOpen(false);
      setName("");
      setObjective("LEAD_GENERATION");
      setDailyBudget("");
      setAdText("");
      toast({ title: "Campaign created" });
    },
    onError: (err: Error) => {
      toast({ title: "Create Failed", description: err.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/meta/campaigns/${id}/publish`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/campaigns"] });
      toast({ title: "Published to Meta", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Publish Failed", description: err.message, variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/meta/campaigns/${id}/sync`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/campaigns"] });
      toast({ title: "Insights synced" });
    },
    onError: (err: Error) => {
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/meta/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meta/campaigns"] });
      toast({ title: "Campaign deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  const totalSpend = campaigns.reduce((s, c) => s + (c.totalSpend || 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + (c.leads || 0), 0);

  const statusColor: Record<string, string> = {
    draft: "bg-gray-500/20 text-gray-300",
    active: "bg-green-500/20 text-green-400",
    paused: "bg-yellow-500/20 text-yellow-400",
    completed: "bg-blue-500/20 text-blue-400",
  };

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-meta-ads-title">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Megaphone size={20} className="text-white" />
            </div>
            Meta Ad Campaigns
          </h1>
          <p className="text-slate-400 mt-1">Create and manage Facebook & Instagram ad campaigns</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700" data-testid="button-create-campaign">
              <Plus size={16} className="mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-neutral-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">Create Ad Campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-slate-300">Campaign Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Sale Campaign" className="bg-white/5 border-white/10 text-white" data-testid="input-campaign-name" />
              </div>
              <div>
                <Label className="text-slate-300">Objective</Label>
                <Select value={objective} onValueChange={setObjective}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white" data-testid="select-objective">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-900 border-white/10">
                    {OBJECTIVES.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-white">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300">Daily Budget ($)</Label>
                <Input type="number" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="50.00" className="bg-white/5 border-white/10 text-white" data-testid="input-daily-budget" />
              </div>
              <div>
                <Label className="text-slate-300">Ad Text</Label>
                <textarea value={adText} onChange={(e) => setAdText(e.target.value)} placeholder="Write compelling ad copy..." className="w-full bg-white/5 border border-white/10 rounded-md p-3 text-white text-sm min-h-[100px]" data-testid="input-ad-text" />
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full bg-blue-600 hover:bg-blue-700" data-testid="button-save-campaign">
                {createMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {config && (!config.hasAccessToken || !config.hasAdAccountId || !config.hasPageId) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3" data-testid="banner-meta-config">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-semibold">Meta API Not Connected</p>
              <p className="text-slate-400 text-sm mt-1">Campaigns are saved locally. Connect your Meta Business account to publish ads to Facebook & Instagram.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 ml-8">
            <Badge variant="outline" className={config.hasAccessToken ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}>
              {config.hasAccessToken ? "✓" : "✗"} META_ACCESS_TOKEN
            </Badge>
            <Badge variant="outline" className={config.hasAdAccountId ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}>
              {config.hasAdAccountId ? "✓" : "✗"} META_AD_ACCOUNT_ID
            </Badge>
            <Badge variant="outline" className={config.hasPageId ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}>
              {config.hasPageId ? "✓" : "✗"} META_PAGE_ID
            </Badge>
            <Badge variant="outline" className={config.hasAppId ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}>
              {config.hasAppId ? "✓" : "✗"} META_APP_ID
            </Badge>
          </div>
          <p className="text-slate-500 text-xs ml-8">Add these as secrets in your project settings to enable live Meta integration.</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center"><DollarSign size={20} className="text-green-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Total Spend</p>
              <p className="text-xl font-bold text-white" data-testid="text-total-spend">${totalSpend.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center"><Eye size={20} className="text-blue-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Impressions</p>
              <p className="text-xl font-bold text-white" data-testid="text-total-impressions">{totalImpressions.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center"><MousePointerClick size={20} className="text-purple-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Clicks</p>
              <p className="text-xl font-bold text-white" data-testid="text-total-clicks">{totalClicks.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center"><Users size={20} className="text-cyan-400" /></div>
            <div>
              <p className="text-xs text-slate-400">Leads</p>
              <p className="text-xl font-bold text-white" data-testid="text-total-leads">{totalLeads.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-20 bg-black/20 border border-white/5 rounded-2xl">
          <Megaphone size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 text-lg">No campaigns yet</p>
          <p className="text-slate-500 text-sm mt-1">Create your first Meta ad campaign to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((campaign) => (
            <motion.div key={campaign.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-black/40 border border-white/10 rounded-xl p-5" data-testid={`card-campaign-${campaign.id}`}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-white">{campaign.name}</h3>
                    <Badge className={statusColor[campaign.status] || statusColor.draft}>{campaign.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-400">
                    <Target size={14} className="inline mr-1" />
                    {OBJECTIVES.find(o => o.value === campaign.objective)?.label || campaign.objective}
                    {campaign.dailyBudget > 0 && <span className="ml-3"><DollarSign size={14} className="inline mr-1" />${campaign.dailyBudget}/day</span>}
                  </p>
                  {campaign.adText && <p className="text-sm text-slate-500 mt-2 line-clamp-2">{campaign.adText}</p>}
                </div>
                <div className="flex gap-2">
                  {campaign.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => publishMutation.mutate(campaign.id)} disabled={publishMutation.isPending} className="border-green-500/30 text-green-400 hover:bg-green-500/10" data-testid={`button-publish-${campaign.id}`}>
                      <Rocket size={14} className="mr-1" /> Publish
                    </Button>
                  )}
                  {campaign.metaCampaignId && (
                    <Button size="sm" variant="outline" onClick={() => syncMutation.mutate(campaign.id)} disabled={syncMutation.isPending} className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10" data-testid={`button-sync-${campaign.id}`}>
                      <RefreshCw size={14} className="mr-1" /> Sync
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(campaign.id)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10" data-testid={`button-delete-campaign-${campaign.id}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Impressions</p>
                  <p className="text-lg font-bold text-white">{(campaign.impressions || 0).toLocaleString()}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Clicks</p>
                  <p className="text-lg font-bold text-white">{(campaign.clicks || 0).toLocaleString()}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">CTR</p>
                  <p className="text-lg font-bold text-cyan-400">{(campaign.ctr || 0).toFixed(2)}%</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">CPC</p>
                  <p className="text-lg font-bold text-green-400">${(campaign.cpc || 0).toFixed(2)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Leads</p>
                  <p className="text-lg font-bold text-purple-400">{(campaign.leads || 0).toLocaleString()}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
