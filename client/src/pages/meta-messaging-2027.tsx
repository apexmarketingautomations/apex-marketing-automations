import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquare, Instagram, Facebook, Send, Shield, Settings, Bot,
  CheckCircle2, XCircle, AlertTriangle, Zap, Edit3, Power,
  Clock, ChevronRight, ChevronLeft, Sparkles, Filter, Search,
  Globe, Building2, Palette, Play, Eye, Lock, Unlock,
  Workflow, FileText, Plus, Trash2, RefreshCw, Copy, Check
} from "lucide-react";

const BASE = "/api/meta-messaging/product";

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    fb_dm: { label: "FB DM", cls: "bg-blue-600 text-white border-0", Icon: Facebook },
    ig_dm: { label: "IG DM", cls: "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0", Icon: Instagram },
    fb_comment: { label: "FB Comment", cls: "bg-blue-500/80 text-white border-0", Icon: Facebook },
    ig_comment: { label: "IG Comment", cls: "bg-gradient-to-r from-purple-400 to-pink-400 text-white border-0", Icon: Instagram },
    facebook: { label: "FB", cls: "bg-blue-600 text-white border-0", Icon: Facebook },
    instagram: { label: "IG", cls: "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0", Icon: Instagram },
  };
  const c = map[channel] || { label: channel, cls: "bg-slate-600 text-white border-0", Icon: MessageSquare };
  return (
    <Badge className={`${c.cls} text-xs`} data-testid={`badge-channel-${channel}`}>
      <c.Icon size={10} className="mr-1" /> {c.label}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    normal: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return <Badge className={colors[priority] || colors.normal} data-testid={`badge-priority-${priority}`}>{priority}</Badge>;
}

function OnboardingStepper({ onComplete }: { onComplete: (subAccountId: number) => void }) {
  const [step, setStep] = useState(0);
  const { toast } = useToast();
  const [companyInfo, setCompanyInfo] = useState({ name: "", industry: "", twilioNumber: "" });
  const [oauthStatus, setOauthStatus] = useState<any>(null);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [webhookResult, setWebhookResult] = useState<any>(null);
  const [safetyConfig, setSafetyConfig] = useState({ profanityFilter: true, crisisDetection: true, piiDetection: true, tonePreset: "friendly" });
  const [createdAccountId, setCreatedAccountId] = useState<number | null>(null);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [liveConfirmStep, setLiveConfirmStep] = useState(0);
  const [whiteLabelConfig, setWhiteLabelConfig] = useState({ brandName: "", logoUrl: "", primaryColor: "#6366f1", accentColor: "#06b6d4" });

  const createAccount = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/create-subaccount`, {
      name: companyInfo.name,
      industry: companyInfo.industry,
      twilioNumber: companyInfo.twilioNumber || undefined,
      whiteLabelConfig: whiteLabelConfig.brandName ? whiteLabelConfig : undefined,
    }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setCreatedAccountId(data.subAccount.id);
      toast({ title: "Account created!" });
      setStep(1);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const startOAuth = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/meta/oauth/start`, { subAccountId: createdAccountId }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setOauthStatus(data);
      toast({ title: "OAuth URL generated", description: "Complete authorization in the opened window" });
    },
    onError: (e: any) => toast({ title: "OAuth failed", description: e.message, variant: "destructive" }),
  });

  const simulateCallback = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/meta/oauth/callback`, {
      code: "demo_code",
      subAccountId: createdAccountId,
    }),
    onSuccess: async () => {
      setOauthStatus((prev: any) => ({ ...prev, connected: true }));
      toast({ title: "Meta account connected!" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const testWebhook = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/test-webhook`, { subAccountId: createdAccountId }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setWebhookResult(data);
      toast({ title: "Webhook test complete!" });
    },
    onError: (e: any) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const configureSafety = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/configure-safety`, {
      subAccountId: createdAccountId,
      safetyConfig,
    }),
    onSuccess: () => {
      toast({ title: "Safety configured!" });
      setStep(5);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const createBots = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/bots/create-defaults/${createdAccountId}`),
    onSuccess: () => toast({ title: "Bots initialized!" }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const switchMode = useMutation({
    mutationFn: (m: string) => apiRequest("POST", `${BASE}/mode/${createdAccountId}`, {
      mode: m,
      confirmLive: m === "live" ? true : undefined,
    }),
    onSuccess: async () => {
      toast({ title: `Switched to ${mode} mode` });
    },
  });

  const steps = [
    { label: "Company Info", icon: Building2 },
    { label: "Connect Meta", icon: Globe },
    { label: "Select Pages", icon: Facebook },
    { label: "Test Webhook", icon: Zap },
    { label: "Safety & Tone", icon: Shield },
    { label: "Launch", icon: Play },
  ];

  const handleLaunch = async () => {
    if (createdAccountId) {
      await createBots.mutateAsync();
      onComplete(createdAccountId);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="onboarding-stepper">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-white" data-testid="text-onboarding-title">Meta Messaging 2027 Setup</h2>
        <div className="flex items-center gap-2">
          <Badge className={mode === "demo" ? "bg-amber-500/20 text-amber-400" : "bg-green-500/20 text-green-400"} data-testid="badge-mode">
            {mode === "demo" ? <><Lock size={12} className="mr-1" /> Demo Mode</> : <><Unlock size={12} className="mr-1" /> Live Mode</>}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center flex-1">
            <button
              onClick={() => i <= step && setStep(i)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all w-full justify-center
                ${i === step ? "bg-cyan-600/20 text-cyan-400 border border-cyan-500/30" :
                  i < step ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-pointer" :
                  "bg-slate-800/50 text-slate-500 border border-slate-700/30"}`}
              data-testid={`step-indicator-${i}`}
              disabled={i > step}
            >
              {i < step ? <CheckCircle2 size={12} /> : <s.icon size={12} />}
              <span className="hidden md:inline">{s.label}</span>
              <span className="md:hidden">{i + 1}</span>
            </button>
            {i < steps.length - 1 && <ChevronRight size={14} className="text-slate-600 shrink-0 mx-0.5" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-company-info">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Building2 size={20} className="text-cyan-400" /> Company Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Business Name *</label>
              <Input value={companyInfo.name} onChange={e => setCompanyInfo(p => ({ ...p, name: e.target.value }))}
                placeholder="Your Business Name" className="bg-slate-800 border-slate-700" data-testid="input-company-name" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Industry</label>
              <Select value={companyInfo.industry} onValueChange={v => setCompanyInfo(p => ({ ...p, industry: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-700" data-testid="select-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {["coaching", "real_estate", "dental", "restaurant", "ecommerce", "fitness", "legal", "medical_spa", "home_services", "photography", "other"].map(i => (
                    <SelectItem key={i} value={i}>{i.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t border-slate-700/50 pt-4">
              <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2"><Palette size={14} /> White-Label (Optional)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Brand Name</label>
                  <Input value={whiteLabelConfig.brandName} onChange={e => setWhiteLabelConfig(p => ({ ...p, brandName: e.target.value }))}
                    placeholder="Your Brand" className="bg-slate-800 border-slate-700 text-sm" data-testid="input-brand-name" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Logo URL</label>
                  <Input value={whiteLabelConfig.logoUrl} onChange={e => setWhiteLabelConfig(p => ({ ...p, logoUrl: e.target.value }))}
                    placeholder="https://..." className="bg-slate-800 border-slate-700 text-sm" data-testid="input-logo-url" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Primary Color</label>
                  <div className="flex gap-2">
                    <input type="color" value={whiteLabelConfig.primaryColor} onChange={e => setWhiteLabelConfig(p => ({ ...p, primaryColor: e.target.value }))}
                      className="w-10 h-10 rounded cursor-pointer" data-testid="input-primary-color" />
                    <Input value={whiteLabelConfig.primaryColor} onChange={e => setWhiteLabelConfig(p => ({ ...p, primaryColor: e.target.value }))}
                      className="bg-slate-800 border-slate-700 text-sm flex-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Accent Color</label>
                  <div className="flex gap-2">
                    <input type="color" value={whiteLabelConfig.accentColor} onChange={e => setWhiteLabelConfig(p => ({ ...p, accentColor: e.target.value }))}
                      className="w-10 h-10 rounded cursor-pointer" data-testid="input-accent-color" />
                    <Input value={whiteLabelConfig.accentColor} onChange={e => setWhiteLabelConfig(p => ({ ...p, accentColor: e.target.value }))}
                      className="bg-slate-800 border-slate-700 text-sm flex-1" />
                  </div>
                </div>
              </div>
            </div>
            <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => createAccount.mutate()}
              disabled={!companyInfo.name.trim() || createAccount.isPending} data-testid="button-create-account">
              {createAccount.isPending ? "Creating..." : "Create Account & Continue"}
              <ChevronRight size={16} className="ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-connect-meta">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Globe size={20} className="text-cyan-400" /> Connect Meta Account</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-300">This step generates an OAuth URL for you to authorize your Meta Business account. Click the button below, then complete the authorization in the opened window.</p>
            </div>
            {!oauthStatus?.connected ? (
              <>
                <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => startOAuth.mutate()}
                  disabled={startOAuth.isPending} data-testid="button-start-oauth">
                  <Facebook size={16} className="mr-2" />
                  {startOAuth.isPending ? "Generating..." : "Generate Meta OAuth Link"}
                </Button>
                {oauthStatus?.oauthUrl && (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
                      <p className="text-xs text-slate-400 mb-2">OAuth URL (open in browser):</p>
                      <div className="flex gap-2">
                        <Input value={oauthStatus.oauthUrl} readOnly className="bg-slate-900 border-slate-700 text-xs" data-testid="input-oauth-url" />
                        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(oauthStatus.oauthUrl); toast({ title: "Copied!" }); }}
                          data-testid="button-copy-oauth"><Copy size={14} /></Button>
                      </div>
                    </div>
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => simulateCallback.mutate()}
                      disabled={simulateCallback.isPending} data-testid="button-complete-oauth">
                      <Check size={16} className="mr-2" />
                      {simulateCallback.isPending ? "Connecting..." : "I've Completed Authorization (Demo)"}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3">
                  <CheckCircle2 size={24} className="text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-green-400">Meta Account Connected</p>
                    <p className="text-xs text-slate-400">Token active. Expires: {oauthStatus.tokenExpiry || "60 days"}</p>
                  </div>
                </div>
                <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => setStep(2)} data-testid="button-next-pages">
                  Continue <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-select-pages">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Facebook size={20} className="text-blue-400" /> Select Pages & IG Accounts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">Select the Facebook Pages and Instagram accounts you want to connect for messaging.</p>
            {[
              { id: "demo_page_1", name: "My Business Page", type: "Facebook Page", followers: "12.4K" },
              { id: "demo_page_2", name: "My Brand IG", type: "Instagram Business", followers: "8.2K" },
              { id: "demo_page_3", name: "Secondary Page", type: "Facebook Page", followers: "3.1K" },
            ].map(page => (
              <button key={page.id}
                className={`w-full p-4 rounded-lg border text-left transition-all ${
                  selectedPages.includes(page.id)
                    ? "bg-cyan-500/10 border-cyan-500/30"
                    : "bg-slate-800/50 border-slate-700/30 hover:border-slate-600"
                }`}
                onClick={() => setSelectedPages(prev =>
                  prev.includes(page.id) ? prev.filter(p => p !== page.id) : [...prev, page.id]
                )}
                data-testid={`page-select-${page.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      page.type.includes("Instagram") ? "bg-gradient-to-br from-purple-500 to-pink-500" : "bg-blue-600"
                    }`}>
                      {page.type.includes("Instagram") ? <Instagram size={18} className="text-white" /> : <Facebook size={18} className="text-white" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{page.name}</p>
                      <p className="text-xs text-slate-400">{page.type} · {page.followers} followers</p>
                    </div>
                  </div>
                  {selectedPages.includes(page.id) && <CheckCircle2 size={20} className="text-cyan-400" />}
                </div>
              </button>
            ))}
            <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => setStep(3)}
              disabled={selectedPages.length === 0} data-testid="button-next-webhook">
              Continue with {selectedPages.length} selected <ChevronRight size={16} className="ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-test-webhook">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Zap size={20} className="text-amber-400" /> Test Webhook</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">Send a test webhook event to verify your connection is working properly.</p>
            <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={() => testWebhook.mutate()}
              disabled={testWebhook.isPending} data-testid="button-test-webhook">
              <Zap size={16} className="mr-2" />
              {testWebhook.isPending ? "Testing..." : "Fire Test Webhook"}
            </Button>
            {webhookResult && (
              <div className="space-y-2">
                {webhookResult.results?.map((r: any, i: number) => (
                  <div key={i} className={`p-3 rounded-lg border ${r.success ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"}`}
                    data-testid={`webhook-result-${i}`}>
                    <div className="flex items-center gap-2">
                      {r.success ? <CheckCircle2 size={16} className="text-green-400" /> : <XCircle size={16} className="text-red-400" />}
                      <span className="text-sm text-white">{r.target}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Status: {r.statusCode} · Latency: {r.latencyMs}ms
                      {r.error && <span className="text-red-400"> · {r.error}</span>}
                    </div>
                  </div>
                ))}
                <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => setStep(4)} data-testid="button-next-safety">
                  Continue <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-safety-tone">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Shield size={20} className="text-green-400" /> Safety & Tone Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "profanityFilter", label: "Profanity Filter", desc: "Block messages containing offensive language" },
              { key: "crisisDetection", label: "Crisis Detection", desc: "Flag and escalate self-harm or threat messages" },
              { key: "piiDetection", label: "PII Detection", desc: "Detect and redact personal data in logs" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
                <div>
                  <p className="text-sm text-white">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.desc}</p>
                </div>
                <Switch checked={(safetyConfig as any)[item.key]}
                  onCheckedChange={v => setSafetyConfig(p => ({ ...p, [item.key]: v }))}
                  data-testid={`switch-${item.key}`} />
              </div>
            ))}
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Tone Preset</label>
              <Select value={safetyConfig.tonePreset} onValueChange={v => setSafetyConfig(p => ({ ...p, tonePreset: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-700" data-testid="select-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["friendly", "professional", "casual", "empathetic", "enthusiastic"].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => configureSafety.mutate()}
              disabled={configureSafety.isPending} data-testid="button-save-safety">
              {configureSafety.isPending ? "Saving..." : "Save & Continue"}
              <ChevronRight size={16} className="ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card className="bg-slate-900/80 border-slate-700/50" data-testid="step-launch">
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Play size={20} className="text-green-400" /> Launch</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {steps.slice(0, 5).map((s, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 size={14} className="text-green-400" />
                  <span className="text-xs text-green-300">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/30 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Mode Selection</p>
                  <p className="text-xs text-slate-400">Demo mode is safe for testing. Live mode sends real messages.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${mode === "demo" ? "text-amber-400" : "text-slate-500"}`}>Demo</span>
                  <Switch checked={mode === "live"}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setShowLiveConfirm(true);
                        setLiveConfirmStep(0);
                      } else {
                        setMode("demo");
                        if (createdAccountId) switchMode.mutate("demo");
                      }
                    }}
                    data-testid="switch-mode" />
                  <span className={`text-xs ${mode === "live" ? "text-green-400" : "text-slate-500"}`}>Live</span>
                </div>
              </div>
            </div>
            <Button className="w-full bg-green-600 hover:bg-green-700 text-lg py-6" onClick={handleLaunch}
              disabled={createBots.isPending} data-testid="button-launch">
              <Play size={20} className="mr-2" />
              {createBots.isPending ? "Initializing..." : `Launch ${mode === "demo" ? "Demo" : "Live"}`}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={showLiveConfirm} onOpenChange={setShowLiveConfirm}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={20} /> Switch to Live Mode
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {liveConfirmStep === 0
                ? "Live mode will send real messages to real users via Meta's API. Are you sure?"
                : "This is the final confirmation. Switching to Live mode cannot be undone without manual intervention."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowLiveConfirm(false)} data-testid="button-cancel-live">Cancel</Button>
            {liveConfirmStep === 0 ? (
              <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => setLiveConfirmStep(1)} data-testid="button-confirm-live-1">
                Yes, I understand the risks
              </Button>
            ) : (
              <Button className="bg-red-600 hover:bg-red-700" onClick={() => {
                setMode("live");
                setShowLiveConfirm(false);
                if (createdAccountId) switchMode.mutate("live");
              }} data-testid="button-confirm-live-2">
                Confirm Switch to Live
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnifiedInbox({ subAccountId }: { subAccountId: number }) {
  const [channelFilter, setChannelFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [editText, setEditText] = useState("");
  const [approvalItem, setApprovalItem] = useState<any>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const { data: inboxData, isLoading } = useQuery({
    queryKey: [`${BASE}/inbox`, subAccountId, channelFilter, priorityFilter, unreadOnly, cursor],
    queryFn: async () => {
      const params = new URLSearchParams({ channel: channelFilter, priority: priorityFilter, limit: "50" });
      if (unreadOnly) params.set("unread", "true");
      if (cursor) params.set("cursor", cursor);
      const r = await fetch(`${BASE}/inbox/${subAccountId}?${params}`);
      if (!r.ok) throw new Error("Failed to load inbox");
      return r.json();
    },
  });

  useEffect(() => {
    if (inboxData?.items) {
      if (!cursor) {
        setAllItems(inboxData.items);
      } else {
        setAllItems(prev => [...prev, ...inboxData.items]);
      }
      setHasMore(!!inboxData.nextCursor);
    }
  }, [inboxData]);

  useEffect(() => {
    setAllItems([]);
    setCursor(null);
  }, [channelFilter, priorityFilter, unreadOnly]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100 && inboxData?.nextCursor) {
      setCursor(inboxData.nextCursor);
    }
  }, [hasMore, inboxData?.nextCursor]);

  const approveSend = useMutation({
    mutationFn: async (data: { item: any; editedText?: string }) => {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`${BASE}/approve-send/${subAccountId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          messageId: data.item.aiSuggestion?.id || data.item.id,
          finalText: data.editedText || data.item.aiSuggestion?.text,
          editedText: data.editedText || undefined,
          modelVersion: data.item.aiSuggestion?.modelVersion,
          confidence: data.item.aiSuggestion?.confidence,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Approve failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Message approved & queued!", description: `Trace: ${data.traceId}` });
      setShowApprovalModal(false);
      setApprovalItem(null);

      setAllItems(prev => prev.map(item => {
        if (item.id === selectedItem?.id && item.aiSuggestion) {
          return { ...item, aiSuggestion: { ...item.aiSuggestion, status: "approved" } };
        }
        return item;
      }));
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const openApprovalModal = (item: any) => {
    setApprovalItem(item);
    setEditText(item.aiSuggestion?.text || "");
    setShowApprovalModal(true);
  };

  const filteredItems = search
    ? allItems.filter(i => {
        const name = i.senderName || i.senderId || "";
        const body = i.body || "";
        return name.toLowerCase().includes(search.toLowerCase()) || body.toLowerCase().includes(search.toLowerCase());
      })
    : allItems;

  const channels = ["all", "fb_dm", "ig_dm", "fb_comment", "ig_comment"];

  return (
    <div className="space-y-4" data-testid="unified-inbox">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          {channels.map(ch => (
            <Button key={ch} size="sm" variant={channelFilter === ch ? "default" : "ghost"}
              className={channelFilter === ch ? "bg-cyan-600 text-white text-xs" : "text-slate-400 text-xs"}
              onClick={() => { setChannelFilter(ch); setCursor(null); }}
              data-testid={`filter-channel-${ch}`}>
              {ch === "all" ? "All" : ch.replace("_", " ").toUpperCase()}
            </Button>
          ))}
        </div>
        <Select value={priorityFilter} onValueChange={v => { setPriorityFilter(v); setCursor(null); }}>
          <SelectTrigger className="w-28 h-8 bg-slate-800 border-slate-700 text-xs" data-testid="filter-priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            {["all", "critical", "high", "medium", "normal"].map(p => (
              <SelectItem key={p} value={p}>{p === "all" ? "All Priority" : p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant={unreadOnly ? "default" : "ghost"}
          className={unreadOnly ? "bg-cyan-600 text-white text-xs" : "text-slate-400 text-xs"}
          onClick={() => { setUnreadOnly(!unreadOnly); setCursor(null); }}
          data-testid="filter-unread">
          Unread
        </Button>
        <div className="flex-1 min-w-[150px]">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-7 h-8 text-xs bg-slate-800 border-slate-700" data-testid="input-search-inbox" />
          </div>
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100vh-340px)] min-h-[400px]">
        <div className="w-full lg:w-96 flex flex-col bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll} data-testid="inbox-list">
            {isLoading && allItems.length === 0 ? (
              <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="animate-pulse h-20 bg-slate-800/50 rounded-lg" />)}</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">No conversations found</div>
            ) : (
              filteredItems.map((item: any, i: number) => (
                <button key={item.id || i}
                  className={`w-full text-left p-3 border-b border-slate-800/50 hover:bg-slate-800/50 transition ${selectedItem?.id === item.id ? "bg-slate-800" : ""}`}
                  onClick={() => setSelectedItem(item)}
                  data-testid={`inbox-item-${i}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white truncate flex-1">{item.senderName || item.senderId}</span>
                    <ChannelBadge channel={item.channel} />
                  </div>
                  <div className="text-xs text-slate-400 truncate">{item.body}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {item.priority && item.priority !== "normal" && <PriorityBadge priority={item.priority} />}
                    {item.unread && <span className="w-2 h-2 rounded-full bg-cyan-400" />}
                    {item.safetyFlags?.length > 0 && <AlertTriangle size={12} className="text-amber-400" />}
                    {item.aiSuggestion && (
                      <Badge className="bg-purple-500/20 text-purple-300 text-[10px] py-0 px-1">AI ready</Badge>
                    )}
                  </div>
                </button>
              ))
            )}
            {hasMore && allItems.length > 0 && (
              <div className="p-3 text-center">
                <Button size="sm" variant="ghost" className="text-xs text-slate-400" onClick={() => inboxData?.nextCursor && setCursor(inboxData.nextCursor)}
                  data-testid="button-load-more">Load More</Button>
              </div>
            )}
          </div>
        </div>

        <div className="hidden lg:flex flex-1 flex-col bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden">
          {!selectedItem ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a conversation to view</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{selectedItem.senderName || selectedItem.senderId}</span>
                  <ChannelBadge channel={selectedItem.channel} />
                  {selectedItem.priority && <PriorityBadge priority={selectedItem.priority} />}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="flex justify-start">
                  <div className="max-w-[75%] p-3 rounded-xl text-sm bg-slate-800 text-slate-200 border border-slate-700">
                    <div>{selectedItem.body}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] opacity-50">{new Date(selectedItem.timestamp).toLocaleTimeString()}</span>
                      {selectedItem.safetyFlags?.map((f: any, j: number) => (
                        <Badge key={j} className="bg-amber-500/20 text-amber-400 text-[10px] py-0 px-1">{f.flag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedItem.aiSuggestion && (
                  <Card className="bg-purple-500/5 border-purple-500/20" data-testid="ai-suggestion-card">
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-purple-400" />
                        <span className="text-sm font-medium text-purple-300">AI Suggestion</span>
                        <Badge className="bg-purple-500/20 text-purple-300 text-[10px]">
                          {selectedItem.aiSuggestion.modelVersion}
                        </Badge>
                        <Badge className="bg-blue-500/20 text-blue-300 text-[10px]">
                          {(selectedItem.aiSuggestion.confidence * 100).toFixed(0)}% confidence
                        </Badge>
                      </div>
                      <div className="p-3 rounded-lg bg-purple-500/10 text-sm text-purple-100">
                        {selectedItem.aiSuggestion.text}
                      </div>
                      {selectedItem.aiSuggestion.safetyFlags?.length > 0 && (
                        <div className="flex gap-1">
                          {selectedItem.aiSuggestion.safetyFlags.map((f: any, j: number) => (
                            <Badge key={j} className="bg-amber-500/20 text-amber-400 text-[10px]">{f.flag}</Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 flex-1"
                          onClick={() => openApprovalModal(selectedItem)}
                          data-testid="button-approve">
                          <CheckCircle2 size={14} className="mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 border-slate-600"
                          onClick={() => openApprovalModal(selectedItem)}
                          data-testid="button-edit">
                          <Edit3 size={14} className="mr-1" /> Edit
                        </Button>
                        <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700 flex-1"
                          onClick={() => {
                            approveSend.mutate({ item: selectedItem });
                          }}
                          disabled={approveSend.isPending}
                          data-testid="button-send">
                          <Send size={14} className="mr-1" /> Send
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye size={18} className="text-cyan-400" /> Review & Approve Message
            </DialogTitle>
          </DialogHeader>
          {approvalItem && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Outgoing Text</label>
                <Textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4}
                  className="bg-slate-800 border-slate-700" data-testid="textarea-approve-edit" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2 rounded bg-slate-800/50">
                  <span className="text-[10px] text-slate-500 block">Model Version</span>
                  <span className="text-xs text-white">{approvalItem.aiSuggestion?.modelVersion || "N/A"}</span>
                </div>
                <div className="p-2 rounded bg-slate-800/50">
                  <span className="text-[10px] text-slate-500 block">Confidence</span>
                  <span className="text-xs text-white">{approvalItem.aiSuggestion?.confidence ? `${(approvalItem.aiSuggestion.confidence * 100).toFixed(1)}%` : "N/A"}</span>
                </div>
              </div>
              {approvalItem.aiSuggestion?.safetyFlags?.length > 0 && (
                <div>
                  <span className="text-xs text-slate-400 block mb-1">Safety Flags</span>
                  <div className="flex gap-1">
                    {approvalItem.aiSuggestion.safetyFlags.map((f: any, j: number) => (
                      <Badge key={j} className="bg-amber-500/20 text-amber-400 text-xs">{f.flag} ({f.severity})</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="p-2 rounded bg-slate-800/50">
                <span className="text-[10px] text-slate-500 block">Idempotency Key (auto-generated)</span>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-cyan-300 font-mono" data-testid="text-idempotency-key">
                    {approvalItem._idempotencyKey || crypto.randomUUID()}
                  </code>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowApprovalModal(false)}>Cancel</Button>
            <Button className="bg-green-600 hover:bg-green-700"
              onClick={() => approvalItem && approveSend.mutate({ item: approvalItem, editedText: editText })}
              disabled={approveSend.isPending}
              data-testid="button-confirm-approve">
              <CheckCircle2 size={14} className="mr-1" /> {approveSend.isPending ? "Sending..." : "Approve & Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BotSettings({ subAccountId }: { subAccountId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAutoPublishConfirm, setShowAutoPublishConfirm] = useState<{ botType: string; newValue: boolean } | null>(null);

  const { data: botConfig, isLoading } = useQuery({
    queryKey: [`${BASE}/bots/config`, subAccountId],
    queryFn: () => fetch(`${BASE}/bots/config/${subAccountId}`).then(r => r.json()),
  });

  const updateBot = useMutation({
    mutationFn: (data: { botType: string; settings: any; confirmAutoPublish?: boolean }) =>
      apiRequest("POST", `${BASE}/bots/update/${subAccountId}`, data),
    onSuccess: () => { toast({ title: "Bot settings updated!" }); qc.invalidateQueries({ queryKey: [`${BASE}/bots/config`] }); },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-40 bg-slate-800/50 rounded-xl" /><div className="h-40 bg-slate-800/50 rounded-xl" /></div>;

  const renderBotCard = (type: "dmBot" | "commentBot", label: string, icon: any) => {
    const config = botConfig?.[type] || {};
    const Icon = icon;
    return (
      <Card className="bg-slate-900/80 border-slate-700/50" data-testid={`bot-card-${type}`}>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><Icon size={18} className="text-cyan-400" /> {label}</span>
            <Badge className={config.enabled ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}>
              {config.enabled ? "Active" : "Inactive"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-2 rounded bg-slate-800/50">
              <span className="text-xs text-slate-400 block">Manual Approve</span>
              <span className="text-white">{config.manualApprove || !config.autoApprove ? "Yes" : "No"}</span>
            </div>
            <div className="p-2 rounded bg-slate-800/50">
              <span className="text-xs text-slate-400 block">Safety Level</span>
              <span className="text-white">{config.safety || "conservative"}</span>
            </div>
            <div className="p-2 rounded bg-slate-800/50">
              <span className="text-xs text-slate-400 block">Rate Limit</span>
              <span className="text-white">{config.rateLimit || 1} msg/sec (burst: {config.burst || 5})</span>
            </div>
            <div className="p-2 rounded bg-slate-800/50">
              <span className="text-xs text-slate-400 block">Config Version</span>
              <span className="text-white font-mono text-xs">{config.configVersion || "1.0.0"}</span>
            </div>
            <div className="p-2 rounded bg-slate-800/50">
              <span className="text-xs text-slate-400 block">Model Version</span>
              <span className="text-white font-mono text-xs">{config.modelVersion || "gpt-4o"}</span>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
            <div>
              <p className="text-sm text-white">AutoPublish</p>
              <p className="text-xs text-slate-400">Automatically send approved messages without review</p>
            </div>
            <Switch checked={config.autoPublish || false}
              onCheckedChange={(v) => setShowAutoPublishConfirm({ botType: type, newValue: v })}
              data-testid={`switch-auto-publish-${type}`} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 border-slate-600" data-testid={`button-toggle-${type}`}
              onClick={() => updateBot.mutate({ botType: type, settings: { enabled: !config.enabled } })}>
              <Power size={14} className="mr-1" /> {config.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6" data-testid="bot-settings">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderBotCard("dmBot", "DM Chatbot", Bot)}
        {renderBotCard("commentBot", "Comment Bot", MessageSquare)}
      </div>

      <Dialog open={!!showAutoPublishConfirm} onOpenChange={() => setShowAutoPublishConfirm(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-400">
              <AlertTriangle size={18} /> Toggle AutoPublish
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {showAutoPublishConfirm?.newValue
                ? "Enabling AutoPublish will automatically send AI-generated messages without human review. Are you sure?"
                : "Disabling AutoPublish will require manual approval for all messages."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAutoPublishConfirm(null)}>Cancel</Button>
            <Button className={showAutoPublishConfirm?.newValue ? "bg-amber-600 hover:bg-amber-700" : "bg-cyan-600 hover:bg-cyan-700"}
              onClick={() => {
                if (showAutoPublishConfirm) {
                  updateBot.mutate({
                    botType: showAutoPublishConfirm.botType,
                    settings: { autoPublish: showAutoPublishConfirm.newValue },
                    confirmAutoPublish: true,
                  });
                  setShowAutoPublishConfirm(null);
                }
              }}
              data-testid="button-confirm-auto-publish">
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkflowGenerator({ subAccountId }: { subAccountId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [questionnaire, setQuestionnaire] = useState({
    industry: "",
    tone: "friendly",
    businessHours: "9am-5pm",
    vipList: "",
    bannedWords: "",
  });
  const [editingWf, setEditingWf] = useState<any>(null);

  const { data: wfData } = useQuery({
    queryKey: [`${BASE}/workflows`, subAccountId],
    queryFn: () => fetch(`${BASE}/workflows/${subAccountId}`).then(r => r.json()),
  });

  const generate = useMutation({
    mutationFn: () => apiRequest("POST", `${BASE}/workflows/generate`, {
      subAccountId,
      industry: questionnaire.industry,
      tone: questionnaire.tone,
      businessHours: questionnaire.businessHours,
      vipList: questionnaire.vipList.split(",").map(s => s.trim()).filter(Boolean),
      bannedWords: questionnaire.bannedWords.split(",").map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: () => { toast({ title: "Workflows generated!" }); qc.invalidateQueries({ queryKey: [`${BASE}/workflows`] }); },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const updateWf = useMutation({
    mutationFn: (data: { id: number; name?: string; steps?: any }) =>
      apiRequest("PUT", `${BASE}/workflows/${data.id}`, data),
    onSuccess: () => { toast({ title: "Workflow updated!" }); qc.invalidateQueries({ queryKey: [`${BASE}/workflows`] }); setEditingWf(null); },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const existingWorkflows = wfData?.workflows || [];

  return (
    <div className="space-y-6" data-testid="workflow-generator">
      <Card className="bg-slate-900/80 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles size={20} className="text-purple-400" /> Personalized Workflow Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Industry</label>
              <Select value={questionnaire.industry} onValueChange={v => setQuestionnaire(p => ({ ...p, industry: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-700" data-testid="select-wf-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {["coaching", "real_estate", "dental", "restaurant", "ecommerce", "fitness", "legal", "medical_spa", "home_services", "photography"].map(i => (
                    <SelectItem key={i} value={i}>{i.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Tone</label>
              <Select value={questionnaire.tone} onValueChange={v => setQuestionnaire(p => ({ ...p, tone: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-700" data-testid="select-wf-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["friendly", "professional", "casual", "empathetic", "enthusiastic"].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">Business Hours</label>
              <Input value={questionnaire.businessHours} onChange={e => setQuestionnaire(p => ({ ...p, businessHours: e.target.value }))}
                placeholder="9am-5pm" className="bg-slate-800 border-slate-700" data-testid="input-wf-hours" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">VIP List (comma-separated)</label>
              <Input value={questionnaire.vipList} onChange={e => setQuestionnaire(p => ({ ...p, vipList: e.target.value }))}
                placeholder="user1, user2" className="bg-slate-800 border-slate-700" data-testid="input-wf-vip" />
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Banned Words (comma-separated)</label>
            <Input value={questionnaire.bannedWords} onChange={e => setQuestionnaire(p => ({ ...p, bannedWords: e.target.value }))}
              placeholder="spam, scam, fake" className="bg-slate-800 border-slate-700" data-testid="input-wf-banned" />
          </div>
          <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => generate.mutate()}
            disabled={!questionnaire.industry || generate.isPending} data-testid="button-generate-workflows">
            <Sparkles size={16} className="mr-2" />
            {generate.isPending ? "Generating..." : "Generate Personalized Workflows"}
          </Button>
        </CardContent>
      </Card>

      {existingWorkflows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-medium text-white">Your Workflow Templates ({existingWorkflows.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {existingWorkflows.map((wf: any) => (
              <Card key={wf.id} className="bg-slate-900/80 border-slate-700/50" data-testid={`workflow-card-${wf.id}`}>
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-white">{wf.name}</h4>
                    <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => setEditingWf(wf)}
                      data-testid={`button-edit-workflow-${wf.id}`}>
                      <Edit3 size={14} />
                    </Button>
                  </div>
                  <Badge className="bg-slate-700 text-slate-300 text-xs">{wf.trigger}</Badge>
                  <div className="space-y-1">
                    {(wf.steps || []).map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">{i + 1}</span>
                        {s.type?.replace(/_/g, " ")}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!editingWf} onOpenChange={() => setEditingWf(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Workflow</DialogTitle>
          </DialogHeader>
          {editingWf && (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Name</label>
                <Input value={editingWf.name} onChange={e => setEditingWf((p: any) => ({ ...p, name: e.target.value }))}
                  className="bg-slate-800 border-slate-700" data-testid="input-edit-wf-name" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Steps (JSON)</label>
                <Textarea value={JSON.stringify(editingWf.steps, null, 2)}
                  onChange={e => {
                    try { setEditingWf((p: any) => ({ ...p, steps: JSON.parse(e.target.value) })); } catch {}
                  }}
                  rows={8} className="bg-slate-800 border-slate-700 font-mono text-xs" data-testid="textarea-edit-wf-steps" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingWf(null)}>Cancel</Button>
            <Button className="bg-cyan-600 hover:bg-cyan-700"
              onClick={() => editingWf && updateWf.mutate({ id: editingWf.id, name: editingWf.name, steps: editingWf.steps })}
              disabled={updateWf.isPending}
              data-testid="button-save-workflow">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ActiveView = "onboarding" | "inbox" | "bots" | "workflows";

export default function MetaMessaging2027Page() {
  const [activeView, setActiveView] = useState<ActiveView>("onboarding");
  const [subAccountId, setSubAccountId] = useState<number | null>(null);
  const [whiteLabel, setWhiteLabel] = useState<any>(null);

  const { data: wlData } = useQuery({
    queryKey: [`${BASE}/white-label`],
    queryFn: () => fetch(`${BASE}/white-label`).then(r => r.json()),
  });

  useEffect(() => {
    if (wlData?.settings) setWhiteLabel(wlData.settings);
  }, [wlData]);

  const navItems: { id: ActiveView; label: string; icon: any; needsAccount: boolean }[] = [
    { id: "onboarding", label: "Setup", icon: Settings, needsAccount: false },
    { id: "inbox", label: "Unified Inbox", icon: MessageSquare, needsAccount: true },
    { id: "bots", label: "Bot Settings", icon: Bot, needsAccount: true },
    { id: "workflows", label: "Workflows", icon: Workflow, needsAccount: true },
  ];

  const headerStyle = whiteLabel ? {
    borderColor: whiteLabel.primaryColor || undefined,
  } : {};

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6" data-testid="meta-messaging-2027-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={headerStyle}>
        <div className="flex items-center gap-3">
          {whiteLabel?.logoUrl && (
            <img src={whiteLabel.logoUrl} alt="Logo" className="h-8 w-auto" data-testid="img-white-label-logo" />
          )}
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2" data-testid="text-page-title"
              style={whiteLabel?.primaryColor ? { color: whiteLabel.primaryColor } : {}}>
              <MessageSquare size={28} className="text-cyan-400" />
              {whiteLabel?.brandName || "Meta Messaging 2027"}
            </h1>
            <p className="text-sm text-slate-400 mt-1">Unified inbox, AI bots, and automated workflows for Meta platforms</p>
          </div>
        </div>
        {subAccountId && (
          <Badge className="bg-green-500/20 text-green-400" data-testid="badge-account-id">
            Account #{subAccountId}
          </Badge>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {navItems.map(nav => (
          <Button key={nav.id} size="sm"
            variant={activeView === nav.id ? "default" : "ghost"}
            className={activeView === nav.id ? "bg-cyan-600 text-white" : "text-slate-400"}
            onClick={() => setActiveView(nav.id)}
            disabled={nav.needsAccount && !subAccountId}
            data-testid={`nav-${nav.id}`}>
            <nav.icon size={14} className="mr-1.5" />
            {nav.label}
          </Button>
        ))}
      </div>

      {activeView === "onboarding" && (
        <OnboardingStepper onComplete={(id) => { setSubAccountId(id); setActiveView("inbox"); }} />
      )}
      {activeView === "inbox" && subAccountId && (
        <UnifiedInbox subAccountId={subAccountId} />
      )}
      {activeView === "bots" && subAccountId && (
        <BotSettings subAccountId={subAccountId} />
      )}
      {activeView === "workflows" && subAccountId && (
        <WorkflowGenerator subAccountId={subAccountId} />
      )}
    </div>
  );
}
