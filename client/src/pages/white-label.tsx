import { PlanGate } from "@/components/plan-gate";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Palette, Globe, Image, Type, Eye } from "lucide-react";

interface WhiteLabelSettings {
  userId: string;
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  customDomain: string;
  favicon: string;
  footerText: string;
  hideApexBranding: boolean;
}

function WhiteLabelPageInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [brandName, setBrandName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [favicon, setFavicon] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#06b6d4");
  const [accentColor, setAccentColor] = useState("#6366f1");
  const [customDomain, setCustomDomain] = useState("");
  const [footerText, setFooterText] = useState("");
  const [hideApexBranding, setHideApexBranding] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading } = useQuery<WhiteLabelSettings | null>({
    queryKey: ["/api/white-label", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await fetch(`/api/white-label/${user.id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Failed to fetch white-label settings");
      }
      return res.json();
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (data && !initialized) {
      setBrandName(data.brandName || "");
      setLogoUrl(data.logoUrl || "");
      setFavicon(data.favicon || "");
      setPrimaryColor(data.primaryColor || "#06b6d4");
      setAccentColor(data.accentColor || "#6366f1");
      setCustomDomain(data.customDomain || "");
      setFooterText(data.footerText || "");
      setHideApexBranding(data.hideApexBranding || false);
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/white-label", {
        userId: user?.id,
        brandName,
        logoUrl,
        primaryColor,
        accentColor,
        customDomain,
        favicon,
        footerText,
        hideApexBranding,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "White-label settings updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/white-label", user?.id] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save white-label settings.", variant: "destructive" });
    },
  });

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <Palette size={12} /> WHITE LABEL
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-white-label-title">
            White <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Label</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Customize your platform branding for a seamless client experience</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-white/5 border-white/10" data-testid="card-white-label-form">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Type size={18} className="text-cyan-400" />
                  Brand Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                    <Image size={14} className="text-indigo-400" /> Brand Identity
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1.5 block">Brand Name</Label>
                      <Input
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                        placeholder="Your Agency Name"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                        data-testid="input-brand-name"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1.5 block">Logo URL</Label>
                      <Input
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        placeholder="https://example.com/logo.png"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                        data-testid="input-logo-url"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1.5 block">Favicon URL</Label>
                      <Input
                        value={favicon}
                        onChange={(e) => setFavicon(e.target.value)}
                        placeholder="https://example.com/favicon.ico"
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                        data-testid="input-favicon"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                    <Palette size={14} className="text-purple-400" /> Color Scheme
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1.5 block">Primary Color</Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                          data-testid="input-primary-color"
                        />
                        <Input
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="bg-white/5 border-white/10 text-white font-mono text-sm flex-1"
                          data-testid="input-primary-color-text"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1.5 block">Accent Color</Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={accentColor}
                          onChange={(e) => setAccentColor(e.target.value)}
                          className="w-10 h-10 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                          data-testid="input-accent-color"
                        />
                        <Input
                          value={accentColor}
                          onChange={(e) => setAccentColor(e.target.value)}
                          className="bg-white/5 border-white/10 text-white font-mono text-sm flex-1"
                          data-testid="input-accent-color-text"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                    <Globe size={14} className="text-cyan-400" /> Custom Domain
                  </h3>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1.5 block">Domain</Label>
                    <Input
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      placeholder="app.youragency.com"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                      data-testid="input-custom-domain"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                    <Type size={14} className="text-indigo-400" /> Footer
                  </h3>
                  <div>
                    <Label className="text-xs text-slate-400 mb-1.5 block">Footer Text</Label>
                    <Input
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                      placeholder="© 2026 Your Agency. All rights reserved."
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                      data-testid="input-footer-text"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="flex items-center gap-3">
                    <Eye size={16} className="text-cyan-400" />
                    <div>
                      <Label className="text-sm font-semibold text-white cursor-pointer" htmlFor="hide-branding">
                        Hide Apex Branding
                      </Label>
                      <p className="text-xs text-slate-500">Remove all Apex branding from the platform</p>
                    </div>
                  </div>
                  <Switch
                    id="hide-branding"
                    checked={hideApexBranding}
                    onCheckedChange={setHideApexBranding}
                    data-testid="switch-hide-branding"
                  />
                </div>

                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || isLoading}
                  className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold py-3"
                  data-testid="button-save-white-label"
                >
                  {saveMutation.isPending ? "Saving..." : "Save White Label Settings"}
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="bg-white/5 border-white/10 sticky top-6" data-testid="card-live-preview">
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Eye size={18} className="text-indigo-400" />
                  Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="rounded-xl overflow-hidden border border-white/10"
                  data-testid="preview-container"
                >
                  <div
                    className="p-4 flex items-center gap-3"
                    style={{ backgroundColor: primaryColor + "20" }}
                  >
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        className="w-8 h-8 rounded-lg object-cover"
                        data-testid="preview-logo"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: primaryColor }}
                        data-testid="preview-logo-placeholder"
                      >
                        {brandName ? brandName.charAt(0).toUpperCase() : "A"}
                      </div>
                    )}
                    <span className="text-white font-bold text-sm" data-testid="preview-brand-name">
                      {brandName || "Your Brand"}
                    </span>
                  </div>

                  <div className="bg-[#0a0a1a] p-3 space-y-2">
                    {["Dashboard", "Contacts", "Campaigns", "Analytics"].map((item, i) => (
                      <div
                        key={item}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                        style={{
                          backgroundColor: i === 0 ? primaryColor + "20" : "transparent",
                          color: i === 0 ? primaryColor : "#94a3b8",
                        }}
                        data-testid={`preview-nav-item-${i}`}
                      >
                        <div
                          className="w-4 h-4 rounded"
                          style={{
                            backgroundColor: i === 0 ? primaryColor : "#334155",
                          }}
                        />
                        {item}
                      </div>
                    ))}
                  </div>

                  <div className="p-3 border-t border-white/5 bg-[#0a0a1a]">
                    <div
                      className="w-full py-2 rounded-lg text-center text-xs font-bold text-white"
                      style={{ backgroundColor: accentColor }}
                      data-testid="preview-accent-button"
                    >
                      + New Campaign
                    </div>
                  </div>

                  {footerText && (
                    <div className="px-3 py-2 border-t border-white/5 bg-[#0a0a1a]">
                      <p className="text-[10px] text-slate-600 text-center" data-testid="preview-footer-text">
                        {footerText}
                      </p>
                    </div>
                  )}

                  {!hideApexBranding && (
                    <div className="px-3 py-1.5 border-t border-white/5 bg-[#0a0a1a]">
                      <p className="text-[9px] text-slate-700 text-center" data-testid="preview-apex-branding">
                        Powered by Apex
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Primary</span>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: primaryColor }} />
                      <span className="text-slate-400 font-mono">{primaryColor}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Accent</span>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: accentColor }} />
                      <span className="text-slate-400 font-mono">{accentColor}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Domain</span>
                    <span className="text-slate-400">{customDomain || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Apex Branding</span>
                    <span className={hideApexBranding ? "text-red-400" : "text-emerald-400"}>
                      {hideApexBranding ? "Hidden" : "Visible"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default function WhiteLabelPage() {
  return <PlanGate feature="white_label"><WhiteLabelPageInner /></PlanGate>;
}
