import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useActiveSubAccountId } from "@/components/account-required";
import { useAuth } from "@/hooks/use-auth";
import {
  Activity, AlertTriangle, Brain, CheckCircle2, Code2,
  Eye, EyeOff, FileText, Globe, Layers, Lock, RefreshCw,
  Save, Settings, Shield, Sliders, ToggleLeft, ToggleRight,
  MousePointerClick, Scroll
} from "lucide-react";
import { Link } from "wouter";

const ALL_EVENT_FAMILIES = [
  { id: "page_view", label: "Page Views", icon: Eye, description: "Track when visitors view pages", color: "#06b6d4" },
  { id: "scroll_depth", label: "Scroll Depth", icon: Scroll, description: "Track scroll milestones (25%, 50%, 75%, 90%)", color: "#8b5cf6" },
  { id: "click", label: "Clicks", icon: MousePointerClick, description: "Track general link and button clicks", color: "#f59e0b" },
  { id: "cta_click", label: "CTA Clicks", icon: MousePointerClick, description: "Track call-to-action button clicks", color: "#10b981" },
  { id: "form_start", label: "Form Start", icon: FileText, description: "Track when visitors begin filling out forms", color: "#3b82f6" },
  { id: "form_fill", label: "Form Fill", icon: FileText, description: "Track form field interactions", color: "#6366f1" },
  { id: "form_submit", label: "Form Submit", icon: CheckCircle2, description: "Track form submission events", color: "#22c55e" },
  { id: "form_abandon", label: "Form Abandon", icon: AlertTriangle, description: "Track when visitors leave forms incomplete", color: "#ef4444" },
  { id: "quiz_answer", label: "Quiz Answers", icon: FileText, description: "Track quiz/survey responses", color: "#f97316" },
  { id: "chat_interaction", label: "Chat", icon: Activity, description: "Track chatbot interactions", color: "#ec4899" },
  { id: "booking_action", label: "Booking", icon: Activity, description: "Track booking and calendar actions", color: "#14b8a6" },
  { id: "calendar_selection", label: "Calendar", icon: Activity, description: "Track calendar date selections", color: "#a855f7" },
  { id: "funnel_step", label: "Funnel Steps", icon: Layers, description: "Track progression through funnels", color: "#eab308" },
  { id: "checkout_step", label: "Checkout Steps", icon: Activity, description: "Track checkout progression", color: "#84cc16" },
  { id: "content_engagement", label: "Content Engagement", icon: Eye, description: "Track video/media engagement", color: "#0ea5e9" },
];

const DATA_RETENTION_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days (recommended)" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
];

export default function ApexTrackingSettings() {
  const { user } = useAuth();
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.isAdmin === "true" || (user as any)?.role === "DEV_ADMIN";

  const [enabledFamilies, setEnabledFamilies] = useState<Set<string>>(
    new Set(["page_view", "scroll_depth", "click", "cta_click", "form_start", "form_fill", "form_submit", "form_abandon", "booking_action", "funnel_step"])
  );
  const [consentRequired, setConsentRequired] = useState(false);
  const [dataRetentionDays, setDataRetentionDays] = useState(90);
  const [activeTab, setActiveTab] = useState<"events" | "privacy" | "snippet">("events");

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ["/api/apex/tracking-settings", subAccountId],
    queryFn: async () => {
      if (!subAccountId) return null;
      const r = await fetch(`/api/apex/tracking-settings/${subAccountId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!subAccountId,
  });

  useEffect(() => {
    if (settingsData?.settings) {
      const s = settingsData.settings;
      if (s.enabledEventFamilies) setEnabledFamilies(new Set(s.enabledEventFamilies));
      if (typeof s.consentRequired === "boolean") setConsentRequired(s.consentRequired);
      if (s.dataRetentionDays) setDataRetentionDays(s.dataRetentionDays);
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!subAccountId) throw new Error("No account selected");
      const r = await fetch(`/api/apex/tracking-settings/${subAccountId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledEventFamilies: Array.from(enabledFamilies),
          consentRequired,
          dataRetentionDays,
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/apex/tracking-settings", subAccountId] });
      toast({ title: "Tracking settings saved", description: "Configuration updated successfully." });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const toggleFamily = (familyId: string) => {
    setEnabledFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  };

  const enableAll = () => setEnabledFamilies(new Set(ALL_EVENT_FAMILIES.map((f) => f.id)));
  const disableAll = () => setEnabledFamilies(new Set());

  const snippetCode = subAccountId
    ? `<!-- Apex Intelligence Tracking SDK -->
<script>
(function(){
  var VISITOR_KEY='apex_visitor_id',SESSION_KEY='apex_session_id',SESSION_EXP_KEY='apex_session_expiry';
  var SESSION_EXP=30*60*1000,batchTimer=null,queue=[];
  var subAccountId=${subAccountId};
  var siteId=null;
  /* ... full SDK auto-injected for Liquid/Apex sites */
  /* For external sites, call: apexInit({ subAccountId: ${subAccountId} }) */
  window.apexInit=function(cfg){subAccountId=cfg.subAccountId;siteId=cfg.siteId||null;};
  window.apexTrack=function(type,payload){queue.push({eventType:type,payload:payload||{},clientTimestamp:new Date().toISOString(),sessionId:getOrCreate(SESSION_KEY),visitorId:getOrCreate(VISITOR_KEY),page:location.href,referrer:document.referrer});if(queue.length>500)queue=queue.slice(-500);schedBatch();};
})();
</script>`
    : "Select an account to see your tracking snippet.";

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #06b6d4, #4f46e5)" }}>
            <Settings className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Tracking Settings</h1>
            <p className="text-xs text-slate-400">Configure data capture for account #{subAccountId ?? "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/apex-command-center">
            <Button size="sm" variant="outline" className="border-white/10 text-white/50 hover:text-white text-xs">
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              Command Center
            </Button>
          </Link>
          <Button
            data-testid="button-save-tracking-settings"
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !subAccountId}
            className="text-white border-0 text-xs"
            style={{ background: "linear-gradient(to right, #06b6d4, #4f46e5)" }}
          >
            {saveMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Save Settings
          </Button>
        </div>
      </motion.div>

      <div className="flex gap-2">
        {(["events", "privacy", "snippet"] as const).map((tab) => (
          <button
            key={tab}
            data-testid={`tab-settings-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
            }`}
          >
            {tab === "events" ? "Event Families" : tab === "privacy" ? "Privacy & Retention" : "Tracking Snippet"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-white/[0.02] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === "events" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/40">
                  {enabledFamilies.size} of {ALL_EVENT_FAMILIES.length} event families enabled
                </p>
                <div className="flex gap-2">
                  <button data-testid="button-enable-all-events" onClick={enableAll} className="text-xs text-cyan-400 hover:text-cyan-300">Enable all</button>
                  <span className="text-white/20">·</span>
                  <button data-testid="button-disable-all-events" onClick={disableAll} className="text-xs text-white/30 hover:text-white/50">Disable all</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {ALL_EVENT_FAMILIES.map((family) => {
                  const enabled = enabledFamilies.has(family.id);
                  const Icon = family.icon;
                  return (
                    <button
                      key={family.id}
                      data-testid={`toggle-event-${family.id}`}
                      onClick={() => toggleFamily(family.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        enabled
                          ? "border-white/15 bg-white/[0.04]"
                          : "border-white/5 bg-white/[0.01] opacity-50 hover:opacity-70"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: family.color + "20" }}>
                        <Icon className="w-4 h-4" style={{ color: family.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white">{family.label}</p>
                        <p className="text-[10px] text-white/40 truncate">{family.description}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {enabled
                          ? <ToggleRight className="w-5 h-5 text-emerald-400" />
                          : <ToggleLeft className="w-5 h-5 text-white/20" />
                        }
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === "privacy" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.3)" }}>
                <CardContent className="p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                      <Lock className="w-4 h-4 text-amber-400" />
                      Consent Gate
                    </h3>
                    <p className="text-xs text-white/40 mb-3">When enabled, tracking only begins after the visitor provides consent.</p>
                    <button
                      data-testid="toggle-consent-required"
                      onClick={() => setConsentRequired(!consentRequired)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                        consentRequired ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-white/10 bg-white/[0.02] text-white/40"
                      }`}
                    >
                      {consentRequired ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      {consentRequired ? "Consent required" : "No consent gate"}
                    </button>
                  </div>
                  <div className="pt-4 border-t border-white/5">
                    <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-400" />
                      Data Retention
                    </h3>
                    <p className="text-xs text-white/40 mb-3">Events older than this period are automatically purged.</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {DATA_RETENTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          data-testid={`retention-${opt.value}`}
                          onClick={() => setDataRetentionDays(opt.value)}
                          className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                            dataRetentionDays === opt.value
                              ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                              : "border-white/5 bg-white/[0.02] text-white/40 hover:text-white/60"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/5 border-dashed" style={{ background: "rgba(0,0,0,0.2)" }}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-white/70 mb-1">GDPR & Privacy Compliance</p>
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        All data is stored server-side and never shared with third parties. Visitor IDs are pseudonymous identifiers.
                        Enable consent gate to comply with GDPR, CCPA, and other privacy regulations in your region.
                        Contact support to request data deletion for specific visitors.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeTab === "snippet" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <Card className="border-white/5" style={{ background: "rgba(0,0,0,0.3)" }}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Code2 className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-white">External Site Tracking Snippet</h3>
                  </div>
                  <p className="text-xs text-white/40 mb-4">
                    For Liquid-built sites, tracking is auto-injected. For external sites, paste this snippet into your &lt;head&gt; tag.
                  </p>
                  <div className="relative">
                    <pre
                      className="text-[11px] text-emerald-300/80 bg-black/60 border border-white/10 rounded-xl p-4 overflow-x-auto font-mono whitespace-pre-wrap leading-relaxed"
                      data-testid="code-tracking-snippet"
                    >
                      {snippetCode}
                    </pre>
                    <button
                      data-testid="button-copy-snippet"
                      onClick={() => {
                        navigator.clipboard.writeText(snippetCode).catch(() => {});
                        toast({ title: "Copied to clipboard" });
                      }}
                      className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[10px] text-white/50 hover:text-white transition-all"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-4 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                    <p className="text-[11px] text-white/40 leading-relaxed">
                      <strong className="text-white/60">Auto-injected into:</strong> All Liquid Website Builder published sites and Apex site properties served via <code className="text-cyan-400">/live/:siteId</code>.
                      No manual configuration needed for Apex-hosted sites.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
