import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlanGate } from "@/components/plan-gate";
import { ContactRound, Phone, Mail, Globe, Star, MessageSquare, Save, Eye, Copy, QrCode, ExternalLink, Plus, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface CardConfig {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  bio: string;
  photoUrl: string;
  googleReviewLink: string;
  slug: string;
  links: { label: string; url: string; type: string }[];
  theme: string;
}

const THEMES = [
  { id: "midnight", label: "Midnight", bg: "from-gray-900 to-black", accent: "cyan" },
  { id: "sunset", label: "Sunset", bg: "from-orange-900 to-rose-950", accent: "amber" },
  { id: "ocean", label: "Ocean", bg: "from-blue-900 to-indigo-950", accent: "blue" },
  { id: "forest", label: "Forest", bg: "from-green-900 to-emerald-950", accent: "emerald" },
  { id: "royal", label: "Royal", bg: "from-purple-900 to-violet-950", accent: "purple" },
];

function DigitalCardBuilderInner() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const { data: cardConfig, isLoading } = useQuery<CardConfig>({
    queryKey: ["/api/digital-card", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/digital-card/${subAccountId}`);
      if (!res.ok) {
        return {
          name: "", title: "", company: "", phone: "", email: "", website: "",
          bio: "", photoUrl: "", googleReviewLink: "", slug: "",
          links: [], theme: "midnight",
        };
      }
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const [form, setForm] = useState<CardConfig | null>(null);
  const config = form || cardConfig;

  const saveMutation = useMutation({
    mutationFn: async (data: CardConfig) => {
      await apiRequest("POST", `/api/digital-card/${subAccountId}`, data);
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Your digital card has been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/digital-card", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !config) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>;
  }

  const update = (key: keyof CardConfig, value: any) => {
    setForm({ ...config, [key]: value });
  };

  const addLink = () => {
    setForm({ ...config, links: [...(config.links || []), { label: "", url: "", type: "link" }] });
  };

  const removeLink = (idx: number) => {
    const links = [...(config.links || [])];
    links.splice(idx, 1);
    setForm({ ...config, links });
  };

  const updateLink = (idx: number, key: string, value: string) => {
    const links = [...(config.links || [])];
    links[idx] = { ...links[idx], [key]: value };
    setForm({ ...config, links });
  };

  const cardUrl = config.slug
    ? `${window.location.origin}/card/${config.slug}`
    : "";

  const copyLink = () => {
    if (cardUrl) {
      navigator.clipboard.writeText(cardUrl);
      toast({ title: "Copied", description: "Card link copied to clipboard." });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2" data-testid="text-page-title">
            <ContactRound className="text-cyan-400" /> Digital Business Card
          </h1>
          <p className="text-slate-400 mt-1">Create a shareable digital card with QR code and NFC support</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-white/10 text-slate-300"
            onClick={() => setShowPreview(!showPreview)}
            data-testid="button-preview"
          >
            <Eye size={16} className="mr-1" /> Preview
          </Button>
          <Button
            className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold"
            onClick={() => saveMutation.mutate(config)}
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            <Save size={16} className="mr-1" /> {saveMutation.isPending ? "Saving..." : "Save Card"}
          </Button>
        </div>
      </div>

      {cardUrl && (
        <Card className="bg-emerald-500/10 border-emerald-500/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ExternalLink size={16} className="text-emerald-400" />
              <span className="text-emerald-300 text-sm font-medium">Your card is live at:</span>
              <a href={cardUrl} target="_blank" className="text-emerald-400 underline text-sm" data-testid="link-card-url">{cardUrl}</a>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-emerald-400" onClick={copyLink} data-testid="button-copy-link">
                <Copy size={14} className="mr-1" /> Copy
              </Button>
              <Button size="sm" variant="ghost" className="text-emerald-400" onClick={() => setShowQR(!showQR)} data-testid="button-show-qr">
                <QrCode size={14} className="mr-1" /> QR
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showQR && cardUrl && (
        <Card className="bg-black/40 border-white/10">
          <CardContent className="p-6 flex flex-col items-center gap-4">
            <QRCodeSVG value={cardUrl} size={200} bgColor="transparent" fgColor="#22d3ee" level="H" />
            <p className="text-slate-400 text-sm">Scan to view your digital card. Print this on business cards, stickers, or flyers.</p>
          </CardContent>
        </Card>
      )}

      <div className={`grid ${showPreview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"} gap-6`}>
        <div className="space-y-6">
          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Personal Info</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300">Full Name</Label>
                  <Input value={config.name} onChange={e => update("name", e.target.value)} placeholder="John Smith" className="bg-white/5 border-white/10 text-white" data-testid="input-name" />
                </div>
                <div>
                  <Label className="text-slate-300">Title / Role</Label>
                  <Input value={config.title} onChange={e => update("title", e.target.value)} placeholder="CEO & Founder" className="bg-white/5 border-white/10 text-white" data-testid="input-title" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300">Company</Label>
                  <Input value={config.company} onChange={e => update("company", e.target.value)} placeholder="Apex Marketing" className="bg-white/5 border-white/10 text-white" data-testid="input-company" />
                </div>
                <div>
                  <Label className="text-slate-300">Card URL Slug</Label>
                  <Input value={config.slug} onChange={e => update("slug", e.target.value)} placeholder="john-smith" className="bg-white/5 border-white/10 text-white" data-testid="input-slug" />
                  <p className="text-xs text-slate-500 mt-1">Your card will be at /card/{config.slug || "slug"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Contact Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300"><Phone size={14} className="inline mr-1" />Phone</Label>
                  <Input value={config.phone} onChange={e => update("phone", e.target.value)} placeholder="(239) 555-0123" className="bg-white/5 border-white/10 text-white" data-testid="input-phone" />
                </div>
                <div>
                  <Label className="text-slate-300"><Mail size={14} className="inline mr-1" />Email</Label>
                  <Input value={config.email} onChange={e => update("email", e.target.value)} placeholder="you@company.com" className="bg-white/5 border-white/10 text-white" data-testid="input-email" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300"><Globe size={14} className="inline mr-1" />Website</Label>
                  <Input value={config.website} onChange={e => update("website", e.target.value)} placeholder="https://yoursite.com" className="bg-white/5 border-white/10 text-white" data-testid="input-website" />
                </div>
                <div>
                  <Label className="text-slate-300"><Star size={14} className="inline mr-1" />Google Review Link</Label>
                  <Input value={config.googleReviewLink} onChange={e => update("googleReviewLink", e.target.value)} placeholder="https://g.page/r/..." className="bg-white/5 border-white/10 text-white" data-testid="input-review-link" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Bio & Photo</h2>
              <div>
                <Label className="text-slate-300">Photo URL</Label>
                <Input value={config.photoUrl} onChange={e => update("photoUrl", e.target.value)} placeholder="https://example.com/photo.jpg" className="bg-white/5 border-white/10 text-white" data-testid="input-photo" />
              </div>
              <div>
                <Label className="text-slate-300">Bio</Label>
                <Textarea value={config.bio} onChange={e => update("bio", e.target.value)} placeholder="A short description about you and your business..." className="bg-white/5 border-white/10 text-white min-h-[100px]" data-testid="input-bio" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Custom Links</h2>
                <Button size="sm" variant="ghost" className="text-cyan-400" onClick={addLink} data-testid="button-add-link">
                  <Plus size={14} className="mr-1" /> Add Link
                </Button>
              </div>
              {(config.links || []).map((link, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-slate-300 text-xs">Label</Label>
                    <Input value={link.label} onChange={e => updateLink(idx, "label", e.target.value)} placeholder="Instagram" className="bg-white/5 border-white/10 text-white" data-testid={`input-link-label-${idx}`} />
                  </div>
                  <div className="flex-[2]">
                    <Label className="text-slate-300 text-xs">URL</Label>
                    <Input value={link.url} onChange={e => updateLink(idx, "url", e.target.value)} placeholder="https://..." className="bg-white/5 border-white/10 text-white" data-testid={`input-link-url-${idx}`} />
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-400" onClick={() => removeLink(idx)} data-testid={`button-remove-link-${idx}`}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/10">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">Theme</h2>
              <div className="grid grid-cols-5 gap-3">
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => update("theme", t.id)}
                    className={`p-3 rounded-xl bg-gradient-to-br ${t.bg} border-2 transition-all ${config.theme === t.id ? "border-cyan-400 scale-105" : "border-white/10"}`}
                    data-testid={`button-theme-${t.id}`}
                  >
                    <span className="text-white text-xs font-bold">{t.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {showPreview && (
          <div className="sticky top-6">
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              <CardContent className="p-0">
                <div className={`bg-gradient-to-br ${THEMES.find(t => t.id === config.theme)?.bg || THEMES[0].bg} p-8 min-h-[600px]`}>
                  {config.photoUrl && (
                    <div className="w-24 h-24 rounded-full mx-auto mb-4 overflow-hidden border-2 border-white/20">
                      <img src={config.photoUrl} alt={config.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="text-center mb-6">
                    <h2 className="text-2xl font-bold text-white">{config.name || "Your Name"}</h2>
                    <p className="text-slate-300">{config.title || "Your Title"}</p>
                    <p className="text-cyan-400 text-sm">{config.company || "Your Company"}</p>
                  </div>
                  {config.bio && <p className="text-slate-300 text-sm text-center mb-6">{config.bio}</p>}
                  <div className="space-y-2">
                    {config.phone && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Phone size={16} className="text-green-400" />
                        <span className="text-white text-sm">{config.phone}</span>
                      </div>
                    )}
                    {config.email && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Mail size={16} className="text-purple-400" />
                        <span className="text-white text-sm">{config.email}</span>
                      </div>
                    )}
                    {config.website && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Globe size={16} className="text-cyan-400" />
                        <span className="text-white text-sm">{config.website}</span>
                      </div>
                    )}
                    {config.googleReviewLink && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Star size={16} className="text-yellow-400" />
                        <span className="text-white text-sm">Leave a Review</span>
                      </div>
                    )}
                    {(config.links || []).map((link, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                        <ExternalLink size={16} className="text-slate-400" />
                        <span className="text-white text-sm">{link.label || link.url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DigitalCardBuilder() {
  return (
    <PlanGate feature="digital_card" pageName="Digital Business Card">
      <DigitalCardBuilderInner />
    </PlanGate>
  );
}
