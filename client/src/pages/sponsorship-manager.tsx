import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Loader2, MapPin, MousePointerClick, Eye, DollarSign, Check, Pause, Clock, X, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Sponsorship {
  id: number;
  sponsorName: string;
  businessName: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  headline: string;
  description: string | null;
  bidPerClick: number;
  totalBudget: number;
  spent: number;
  targetLat: number;
  targetLon: number;
  targetRadiusMeters: number;
  status: string;
  impressions: number;
  clicks: number;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  approved: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Active" },
  pending: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Pending" },
  paused: { bg: "bg-slate-500/20", text: "text-slate-400", label: "Paused" },
  exhausted: { bg: "bg-red-500/20", text: "text-red-400", label: "Budget Used" },
  rejected: { bg: "bg-red-500/20", text: "text-red-400", label: "Rejected" },
};

export default function SponsorshipManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    sponsorName: "", businessName: "", headline: "", description: "",
    imageUrl: "", linkUrl: "", bidPerClick: "0.50", totalBudget: "100",
    targetLat: "26.142", targetLon: "-81.795", targetRadiusMeters: "80467",
  });

  const { data: sponsorships = [], isLoading } = useQuery<Sponsorship[]>({
    queryKey: ["/api/sponsorships"],
    queryFn: async () => {
      const res = await fetch("/api/sponsorships");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sponsorships", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorName: form.sponsorName, businessName: form.businessName || null,
          headline: form.headline, description: form.description || null,
          imageUrl: form.imageUrl || null, linkUrl: form.linkUrl || null,
          bidPerClick: parseFloat(form.bidPerClick), totalBudget: parseFloat(form.totalBudget),
          targetLat: parseFloat(form.targetLat), targetLon: parseFloat(form.targetLon),
          targetRadiusMeters: parseFloat(form.targetRadiusMeters),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Created", description: "Sponsorship submitted for approval." });
      queryClient.invalidateQueries({ queryKey: ["/api/sponsorships"] });
      setShowForm(false);
      setForm({ sponsorName: "", businessName: "", headline: "", description: "", imageUrl: "", linkUrl: "", bidPerClick: "0.50", totalBudget: "100", targetLat: "26.142", targetLon: "-81.795", targetRadiusMeters: "80467" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/sponsorships/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sponsorships"] });
      toast({ title: "Updated" });
    },
  });

  const totalRevenue = sponsorships.reduce((s, sp) => s + sp.spent, 0);
  const totalClicks = sponsorships.reduce((s, sp) => s + sp.clicks, 0);
  const totalImpressions = sponsorships.reduce((s, sp) => s + sp.impressions, 0);
  const activeCount = sponsorships.filter(s => s.status === "approved").length;

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-purple-500/30 bg-purple-500/10 text-purple-400 mb-4">
            <Megaphone size={12} /> SPONSORSHIP ENGINE
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-sponsor-title">
                Native <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">Ads</span>
              </h1>
              <p className="text-slate-400 text-sm mt-1">Manage geo-targeted native sponsorships</p>
            </div>
            <Button onClick={() => setShowForm(!showForm)} className="bg-purple-600 hover:bg-purple-500" data-testid="button-new-sponsor">
              <Plus size={16} className="mr-1" /> New Sponsorship
            </Button>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Ad Revenue", value: `$${totalRevenue.toFixed(2)}`, icon: DollarSign, color: "text-emerald-400" },
            { label: "Total Clicks", value: totalClicks, icon: MousePointerClick, color: "text-cyan-400" },
            { label: "Impressions", value: totalImpressions, icon: Eye, color: "text-indigo-400" },
            { label: "Active Ads", value: activeCount, icon: Megaphone, color: "text-purple-400" },
          ].map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="bg-white/5 border-white/10 p-4" data-testid={`sponsor-stat-${i}`}>
                <div className="flex items-center gap-2 mb-1"><stat.icon size={14} className={stat.color} /><span className="text-[10px] text-slate-500 uppercase">{stat.label}</span></div>
                <div className="text-2xl font-black text-white">{stat.value}</div>
              </Card>
            </motion.div>
          ))}
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-8">
              <Card className="bg-white/5 border-white/10 p-6" data-testid="sponsor-form">
                <h3 className="text-sm font-bold text-slate-300 mb-4">Create Native Ad</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input placeholder="Sponsor Name *" value={form.sponsorName} onChange={e => setForm({...form, sponsorName: e.target.value})}
                    className="bg-white/5 border-white/10 text-white" data-testid="input-sponsor-name" />
                  <Input placeholder="Business Name" value={form.businessName} onChange={e => setForm({...form, businessName: e.target.value})}
                    className="bg-white/5 border-white/10 text-white" data-testid="input-business-name" />
                  <Input placeholder="Headline *" value={form.headline} onChange={e => setForm({...form, headline: e.target.value})}
                    className="bg-white/5 border-white/10 text-white md:col-span-2" data-testid="input-headline" />
                  <Input placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                    className="bg-white/5 border-white/10 text-white md:col-span-2" data-testid="input-description" />
                  <Input placeholder="Image URL" value={form.imageUrl} onChange={e => setForm({...form, imageUrl: e.target.value})}
                    className="bg-white/5 border-white/10 text-white" data-testid="input-image-url" />
                  <Input placeholder="Link URL" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})}
                    className="bg-white/5 border-white/10 text-white" data-testid="input-link-url" />
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Bid/Click ($)" value={form.bidPerClick} onChange={e => setForm({...form, bidPerClick: e.target.value})}
                      className="bg-white/5 border-white/10 text-white flex-1" data-testid="input-bid" />
                    <Input type="number" placeholder="Total Budget ($)" value={form.totalBudget} onChange={e => setForm({...form, totalBudget: e.target.value})}
                      className="bg-white/5 border-white/10 text-white flex-1" data-testid="input-budget" />
                  </div>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Lat" value={form.targetLat} onChange={e => setForm({...form, targetLat: e.target.value})}
                      className="bg-white/5 border-white/10 text-white flex-1" data-testid="input-lat" />
                    <Input type="number" placeholder="Lon" value={form.targetLon} onChange={e => setForm({...form, targetLon: e.target.value})}
                      className="bg-white/5 border-white/10 text-white flex-1" data-testid="input-lon" />
                    <Input type="number" placeholder="Radius (m)" value={form.targetRadiusMeters} onChange={e => setForm({...form, targetRadiusMeters: e.target.value})}
                      className="bg-white/5 border-white/10 text-white flex-1" data-testid="input-radius" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="ghost" onClick={() => setShowForm(false)} className="text-slate-400">Cancel</Button>
                  <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.sponsorName || !form.headline}
                    className="bg-purple-600 hover:bg-purple-500" data-testid="button-submit-sponsor">
                    {createMutation.isPending ? <Loader2 size={16} className="animate-spin mr-1" /> : <Plus size={16} className="mr-1" />} Create
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-purple-400" size={32} /></div>
        ) : sponsorships.length === 0 ? (
          <Card className="bg-white/5 border-white/10 p-10 text-center">
            <Megaphone size={48} className="mx-auto mb-4 text-white/10" />
            <p className="text-slate-400 text-sm">No sponsorships yet</p>
            <p className="text-slate-600 text-xs mt-1">Create your first native ad to start earning</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {sponsorships.map((sp, i) => {
              const st = STATUS_STYLES[sp.status] || STATUS_STYLES.pending;
              const budgetPct = sp.totalBudget > 0 ? Math.min(100, (sp.spent / sp.totalBudget) * 100) : 0;
              const ctr = sp.impressions > 0 ? ((sp.clicks / sp.impressions) * 100).toFixed(1) : "0.0";
              return (
                <motion.div key={sp.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="bg-white/5 border-white/10 p-4 hover:bg-white/[0.07] transition-colors" data-testid={`sponsor-card-${sp.id}`}>
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base font-bold text-white truncate">{sp.headline}</span>
                          <Badge className={`${st.bg} ${st.text} border-transparent text-[10px]`}>{st.label}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>{sp.sponsorName}</span>
                          {sp.businessName && <span>• {sp.businessName}</span>}
                          <span className="flex items-center gap-0.5"><MapPin size={10} /> {sp.targetLat.toFixed(2)}, {sp.targetLon.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs shrink-0">
                        <div className="text-center"><div className="text-slate-500 mb-0.5">Clicks</div><div className="text-white font-bold text-sm">{sp.clicks}</div></div>
                        <div className="text-center"><div className="text-slate-500 mb-0.5">Views</div><div className="text-white font-bold text-sm">{sp.impressions}</div></div>
                        <div className="text-center"><div className="text-slate-500 mb-0.5">CTR</div><div className="text-white font-bold text-sm">{ctr}%</div></div>
                        <div className="text-center"><div className="text-slate-500 mb-0.5">Spent</div><div className="text-emerald-400 font-bold text-sm">${sp.spent.toFixed(2)}</div></div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-24">
                          <div className="flex justify-between text-[10px] text-slate-500 mb-1"><span>Budget</span><span>{budgetPct.toFixed(0)}%</span></div>
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full" style={{ width: `${budgetPct}%` }} />
                          </div>
                        </div>

                        {sp.status === "pending" && (
                          <>
                            <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-8 px-2"
                              onClick={() => statusMutation.mutate({ id: sp.id, status: "approved" })} data-testid={`approve-${sp.id}`}>
                              <Check size={14} />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-8 px-2"
                              onClick={() => statusMutation.mutate({ id: sp.id, status: "rejected" })} data-testid={`reject-${sp.id}`}>
                              <X size={14} />
                            </Button>
                          </>
                        )}
                        {sp.status === "approved" && (
                          <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 h-8 px-2"
                            onClick={() => statusMutation.mutate({ id: sp.id, status: "paused" })} data-testid={`pause-${sp.id}`}>
                            <Pause size={14} />
                          </Button>
                        )}
                        {sp.status === "paused" && (
                          <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-8 px-2"
                            onClick={() => statusMutation.mutate({ id: sp.id, status: "approved" })} data-testid={`resume-${sp.id}`}>
                            <Check size={14} />
                          </Button>
                        )}
                        {sp.linkUrl && (
                          <a href={sp.linkUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
