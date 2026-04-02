import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Plus, Trash2, Bot, Code, ExternalLink, Eye,
  CheckCircle2, Loader2, RefreshCw, Copy, Check, Paintbrush,
  MessageSquare, Settings, Zap, ChevronRight, AlertTriangle, BookOpen,
  ShieldCheck, XCircle, Clock, FileWarning
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { WEBSITE_INTEGRATION_STEPS } from "@/components/tutorial-steps";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";
import type { ClientWebsite } from "@shared/schema";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    draft: { color: "bg-slate-500/20 text-slate-400 border-slate-500/30", label: "Draft" },
    training: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Training AI..." },
    trained: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "AI Trained" },
    install_pending: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Install Pending" },
    verified: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Verified & Live" },
    error: { color: "bg-red-500/20 text-red-400 border-red-500/30", label: "Error" },
    disconnected: { color: "bg-gray-500/20 text-gray-400 border-gray-500/30", label: "Disconnected" },
    connected: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Connected" },
  };
  const s = map[status] || map.draft;
  return <Badge variant="outline" className={`${s.color} text-xs`} data-testid={`badge-status-${status}`}>{s.label}</Badge>;
}

export default function WebsiteIntegration() {
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_website_integration");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeAccountId } = useAccount();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [selectedSite, setSelectedSite] = useState<ClientWebsite | null>(null);
  const [activeTab, setActiveTab] = useState("sites");
  const [embedCode, setEmbedCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; reason: string; message: string } | null>(null);
  const [widgetSettings, setWidgetSettings] = useState({
    color: "#6366f1",
    greeting: "Hi there! How can I help you today?",
    position: "bottom-right",
    enabled: false,
  });

  const { data: sites = [], isLoading } = useQuery<ClientWebsite[]>({
    queryKey: ["/api/client-websites", activeAccountId],
    queryFn: async () => {
      if (!activeAccountId) return [];
      const res = await apiRequest("GET", `/api/client-websites/${activeAccountId}`);
      return res.json();
    },
    enabled: !!activeAccountId,
  });

  useEffect(() => {
    if (selectedSite) {
      setWidgetSettings({
        color: selectedSite.widgetColor || "#6366f1",
        greeting: selectedSite.widgetGreeting || "Hi there! How can I help you today?",
        position: selectedSite.widgetPosition || "bottom-right",
        enabled: selectedSite.widgetEnabled || false,
      });
      setVerifyResult(null);
    }
  }, [selectedSite]);

  useEffect(() => {
    if (selectedSite && sites.length > 0) {
      const updated = sites.find(s => s.id === selectedSite.id);
      if (updated && (
        updated.status !== selectedSite.status ||
        updated.verificationAttempts !== selectedSite.verificationAttempts ||
        updated.lastError !== selectedSite.lastError ||
        updated.installVerifiedAt !== selectedSite.installVerifiedAt ||
        updated.pagesCrawled !== selectedSite.pagesCrawled ||
        updated.scrapedAt !== selectedSite.scrapedAt
      )) {
        setSelectedSite(updated);
      }
    }
  }, [sites]);

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/client-websites", {
        subAccountId: activeAccountId,
        url: newUrl,
        name: newName,
      });
      return res.json();
    },
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-websites"] });
      setShowAddDialog(false);
      setNewUrl("");
      setNewName("");
      setSelectedSite(site);
      setActiveTab("manage");
      toast({ title: "Website added", description: `${site.name} has been added — train the AI to get started.` });
    },
    onError: () => toast({ title: "Failed to add website", variant: "destructive" }),
  });

  const scrapeMutation = useMutation({
    mutationFn: async (siteId: number) => {
      const res = await apiRequest("POST", `/api/client-websites/${siteId}/scrape`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "AI Training Started", description: "Scraping website content and training the AI. This may take a moment." });
      const pollInterval = setInterval(async () => {
        try {
          const res = await apiRequest("GET", `/api/jobs/${data.jobId}`);
          const job = await res.json();
          if (job.state === "completed" || job.state === "failed") {
            clearInterval(pollInterval);
            queryClient.invalidateQueries({ queryKey: ["/api/client-websites"] });
            if (job.state === "completed") {
              toast({ title: "Training Complete", description: "AI chatbot trained successfully. You can now generate the embed code." });
            } else {
              toast({ title: "Training Failed", description: "Something went wrong during training. Check the error details.", variant: "destructive" });
            }
          }
        } catch {
          clearInterval(pollInterval);
        }
      }, 2000);
    },
    onError: () => toast({ title: "Training failed", description: "Could not start the training process.", variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async (siteId: number) => {
      const res = await apiRequest("POST", `/api/client-websites/${siteId}/verify-install`, {});
      return res.json();
    },
    onSuccess: (data) => {
      setVerifyResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/client-websites"] });
      if (data.verified) {
        toast({ title: "Installation Verified", description: "Widget is live on your website!" });
      } else {
        toast({ title: "Verification Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Verification failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (siteId: number) => {
      await apiRequest("DELETE", `/api/client-websites/${siteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-websites"] });
      setSelectedSite(null);
      setActiveTab("sites");
      toast({ title: "Website removed" });
    },
  });

  const updateWidgetMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/client-websites/${id}`, data);
      return res.json();
    },
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-websites"] });
      setSelectedSite(site);
      toast({ title: "Widget settings saved" });
    },
  });

  const fetchEmbedCode = async (siteId: number) => {
    const res = await apiRequest("GET", `/api/client-websites/${siteId}/embed-code`);
    const data = await res.json();
    setEmbedCode(data.embedCode);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  if (!activeAccountId) {
    return (
      <div className="p-10 text-center">
        <Globe className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Select an Account</h2>
        <p className="text-slate-400">Choose a sub-account from the sidebar to manage website integrations.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3" data-testid="text-page-title">
            <Globe className="h-8 w-8 text-cyan-500" />
            Website Integration
          </h1>
          <p className="text-slate-400 mt-1">
            Add websites, train AI chatbots on their content, and embed chat widgets via a JavaScript snippet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
          <Button
            onClick={() => setShowAddDialog(true)}
            className="bg-cyan-600 hover:bg-cyan-500 text-white"
            data-testid="button-add-website"
          >
            <Plus className="w-4 h-4 mr-2" /> Add Website
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800/50 border border-slate-700/50">
          <TabsTrigger value="sites" className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white">
            <Globe className="w-4 h-4 mr-2" /> Sites
          </TabsTrigger>
          <TabsTrigger value="manage" disabled={!selectedSite} className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white">
            <Settings className="w-4 h-4 mr-2" /> Manage
          </TabsTrigger>
          <TabsTrigger value="widget" disabled={!selectedSite} className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white">
            <Code className="w-4 h-4 mr-2" /> Embed Widget
          </TabsTrigger>
          <TabsTrigger value="preview" disabled={!selectedSite} className="data-[state=active]:bg-cyan-600 data-[state=active]:text-white">
            <Eye className="w-4 h-4 mr-2" /> Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="mt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
            </div>
          ) : sites.length === 0 ? (
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardContent className="py-16 text-center">
                <Globe className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2" data-testid="text-empty-title">No Websites Added</h3>
                <p className="text-slate-400 mb-6 max-w-md mx-auto">
                  Add a website to train an AI chatbot on its content, then embed a chat widget with a simple JavaScript snippet. No DNS or domain changes required.
                </p>
                <Button onClick={() => setShowAddDialog(true)} className="bg-cyan-600 hover:bg-cyan-500" data-testid="button-add-first-website">
                  <Plus className="w-4 h-4 mr-2" /> Add Your First Website
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {sites.map((site) => (
                <motion.div
                  key={site.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="cursor-pointer"
                  onClick={() => { setSelectedSite(site); setActiveTab("manage"); }}
                >
                  <Card className={`bg-slate-800/40 border-slate-700/50 hover:border-cyan-500/30 transition-all ${selectedSite?.id === site.id ? "border-cyan-500/50 ring-1 ring-cyan-500/20" : ""}`} data-testid={`card-site-${site.id}`}>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/20 flex items-center justify-center">
                            <Globe className="w-6 h-6 text-cyan-400" />
                          </div>
                          <div>
                            <h3 className="text-white font-semibold text-base" data-testid={`text-site-name-${site.id}`}>{site.name}</h3>
                            <p className="text-slate-400 text-sm flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> {site.url}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusBadge status={site.status} />
                          {site.pagesCrawled && site.pagesCrawled > 0 && (
                            <Badge variant="outline" className="bg-slate-700/30 text-slate-300 border-slate-600 text-xs" data-testid={`badge-pages-${site.id}`}>
                              {site.pagesCrawled} content blocks
                            </Badge>
                          )}
                          {site.status === "verified" && site.widgetEnabled && (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                              <MessageSquare className="w-3 h-3 mr-1" /> Widget Live
                            </Badge>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="manage" className="mt-6">
          {selectedSite && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-slate-800/40 border-slate-700/50">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Bot className="w-5 h-5 text-indigo-400" /> AI Chatbot Training
                    </CardTitle>
                    <CardDescription>
                      Scrape the website content and train an AI chatbot that can answer visitor questions.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-900/50 border border-slate-700/30">
                      <Globe className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-white font-medium">{selectedSite.url}</p>
                        <p className="text-xs text-slate-400">
                          {selectedSite.scrapedAt
                            ? `Last scraped: ${new Date(selectedSite.scrapedAt).toLocaleDateString()}`
                            : "Not yet scraped"
                          }
                        </p>
                      </div>
                      <StatusBadge status={selectedSite.status} />
                    </div>

                    {selectedSite.status === "draft" && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-500/10 border border-slate-500/20">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-300" data-testid="text-draft-hint">
                          This website hasn't been trained yet. Click the button below to scrape its content and train the AI.
                        </span>
                      </div>
                    )}

                    {(selectedSite.status === "trained" || selectedSite.status === "install_pending" || selectedSite.status === "verified") && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm text-emerald-300" data-testid="text-trained-status">
                          AI chatbot trained on {selectedSite.pagesCrawled || 0} content blocks. {selectedSite.status === "verified" ? "Widget verified and live." : "Ready for embedding."}
                        </span>
                      </div>
                    )}

                    {selectedSite.status === "training" && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                        <span className="text-sm text-amber-300" data-testid="text-training-status">
                          Training in progress — scraping content and building the knowledge base...
                        </span>
                      </div>
                    )}

                    {selectedSite.status === "error" && (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                        <div className="flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-400" />
                          <span className="text-sm text-red-300 font-medium" data-testid="text-error-title">Training or verification failed</span>
                        </div>
                        {selectedSite.lastError && (
                          <p className="text-xs text-red-400/80 ml-6" data-testid="text-error-detail">{selectedSite.lastError}</p>
                        )}
                        <p className="text-xs text-slate-400 ml-6">Try re-training the website or check that the URL is accessible.</p>
                      </div>
                    )}

                    <Button
                      onClick={() => scrapeMutation.mutate(selectedSite.id)}
                      disabled={scrapeMutation.isPending || selectedSite.status === "training"}
                      className="w-full bg-indigo-600 hover:bg-indigo-500"
                      data-testid="button-train-bot"
                    >
                      {scrapeMutation.isPending || selectedSite.status === "training" ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Training...</>
                      ) : ["trained", "install_pending", "verified"].includes(selectedSite.status) ? (
                        <><RefreshCw className="w-4 h-4 mr-2" /> Re-train Chatbot</>
                      ) : (
                        <><Zap className="w-4 h-4 mr-2" /> Scrape &amp; Train AI Chatbot</>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {["trained", "install_pending", "verified", "error"].includes(selectedSite.status) && (
                  <Card className="bg-slate-800/40 border-slate-700/50">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-cyan-400" /> Verify Installation
                      </CardTitle>
                      <CardDescription>
                        After placing the embed code on your website, verify that the widget script is detected.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {selectedSite.status === "verified" && selectedSite.installVerifiedAt && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm text-emerald-300" data-testid="text-verified-status">
                            Widget verified on {new Date(selectedSite.installVerifiedAt).toLocaleString()}
                          </span>
                        </div>
                      )}

                      {verifyResult && !verifyResult.verified && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400" />
                            <span className="text-sm text-red-300 font-medium" data-testid="text-verify-fail-title">Verification failed</span>
                          </div>
                          <p className="text-xs text-red-400/80 ml-6" data-testid="text-verify-fail-detail">{verifyResult.message}</p>
                        </div>
                      )}

                      {verifyResult && verifyResult.verified && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm text-emerald-300" data-testid="text-verify-success">{verifyResult.message}</span>
                        </div>
                      )}

                      <Button
                        onClick={() => verifyMutation.mutate(selectedSite.id)}
                        disabled={verifyMutation.isPending}
                        className="w-full bg-cyan-600 hover:bg-cyan-500"
                        data-testid="button-verify-install"
                      >
                        {verifyMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</>
                        ) : (
                          <><ShieldCheck className="w-4 h-4 mr-2" /> Verify Installation</>
                        )}
                      </Button>

                      {selectedSite.verificationAttempts != null && selectedSite.verificationAttempts > 0 && (
                        <p className="text-xs text-slate-500 text-center" data-testid="text-verify-attempts">
                          {selectedSite.verificationAttempts} verification attempt{selectedSite.verificationAttempts !== 1 ? "s" : ""}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card className="bg-slate-800/40 border-slate-700/50">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Paintbrush className="w-5 h-5 text-purple-400" /> Widget Appearance
                    </CardTitle>
                    <CardDescription>Customize how the chat widget looks on the website.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-slate-300">Widget Color</Label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={widgetSettings.color}
                            onChange={(e) => setWidgetSettings(s => ({ ...s, color: e.target.value }))}
                            className="w-10 h-10 rounded border border-slate-600 cursor-pointer"
                            data-testid="input-widget-color"
                          />
                          <Input
                            value={widgetSettings.color}
                            onChange={(e) => setWidgetSettings(s => ({ ...s, color: e.target.value }))}
                            className="bg-slate-900 border-slate-700 text-white font-mono text-sm"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-300">Position</Label>
                        <Select
                          value={widgetSettings.position}
                          onValueChange={(v) => setWidgetSettings(s => ({ ...s, position: v }))}
                        >
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-white" data-testid="select-widget-position">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bottom-right">Bottom Right</SelectItem>
                            <SelectItem value="bottom-left">Bottom Left</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300">Greeting Message</Label>
                      <Textarea
                        value={widgetSettings.greeting}
                        onChange={(e) => setWidgetSettings(s => ({ ...s, greeting: e.target.value }))}
                        className="bg-slate-900 border-slate-700 text-white"
                        rows={2}
                        data-testid="input-widget-greeting"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/30">
                      <div>
                        <p className="text-sm text-white font-medium">Enable Widget</p>
                        <p className="text-xs text-slate-400">Make the chat widget active and embeddable</p>
                      </div>
                      <Switch
                        checked={widgetSettings.enabled}
                        onCheckedChange={(v) => setWidgetSettings(s => ({ ...s, enabled: v }))}
                        data-testid="switch-widget-enabled"
                      />
                    </div>
                    <Button
                      onClick={() => updateWidgetMutation.mutate({
                        id: selectedSite.id,
                        data: {
                          widgetColor: widgetSettings.color,
                          widgetGreeting: widgetSettings.greeting,
                          widgetPosition: widgetSettings.position,
                          widgetEnabled: widgetSettings.enabled,
                        }
                      })}
                      className="w-full bg-purple-600 hover:bg-purple-500"
                      disabled={updateWidgetMutation.isPending}
                      data-testid="button-save-widget"
                    >
                      {updateWidgetMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                      Save Widget Settings
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="bg-slate-800/40 border-slate-700/50">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Site Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Status</span>
                      <StatusBadge status={selectedSite.status} />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Content Blocks</span>
                      <span className="text-white font-mono" data-testid="text-page-count">{selectedSite.pagesCrawled || 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Widget</span>
                      <span className={selectedSite.widgetEnabled ? "text-emerald-400" : "text-slate-500"}>
                        {selectedSite.widgetEnabled ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Install Verified</span>
                      <span className={selectedSite.installVerifiedAt ? "text-emerald-400" : "text-slate-500"} data-testid="text-install-verified">
                        {selectedSite.installVerifiedAt ? new Date(selectedSite.installVerifiedAt).toLocaleDateString() : "Not yet"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Added</span>
                      <span className="text-white text-xs">{new Date(selectedSite.createdAt).toLocaleDateString()}</span>
                    </div>
                    {selectedSite.lastError && (
                      <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                        <p className="text-xs text-red-400 flex items-start gap-1">
                          <FileWarning className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span data-testid="text-last-error">{selectedSite.lastError}</span>
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-slate-800/40 border-slate-700/50">
                  <CardContent className="pt-6">
                    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700/30 mb-4">
                      <p className="text-xs text-slate-400 flex items-start gap-2">
                        <Code className="w-3 h-3 mt-0.5 flex-shrink-0 text-cyan-400" />
                        <span>This integration uses a <strong className="text-slate-300">JavaScript embed snippet</strong>. No DNS, CNAME, or domain changes are required.</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-red-500/5 border-red-500/20">
                  <CardContent className="pt-6">
                    <Button
                      variant="outline"
                      className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => {
                        if (confirm("Remove this website? This will delete the AI training data and widget.")) {
                          deleteMutation.mutate(selectedSite.id);
                        }
                      }}
                      data-testid="button-delete-site"
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Remove Website
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="widget" className="mt-6">
          {selectedSite && (
            <div className="space-y-6">
              {!["trained", "install_pending", "verified"].includes(selectedSite.status) && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-amber-300 font-medium">Train the AI first</p>
                    <p className="text-xs text-amber-400/70">Go to the Manage tab and train the AI chatbot before embedding the widget. The widget needs trained content to provide useful responses.</p>
                  </div>
                </div>
              )}

              <Card className="bg-slate-800/40 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Code className="w-5 h-5 text-cyan-400" /> Embed Code
                  </CardTitle>
                  <CardDescription>
                    Copy this JavaScript snippet and paste it just before the closing &lt;/body&gt; tag on your website. No DNS or domain setup needed.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!embedCode ? (
                    <Button
                      onClick={() => fetchEmbedCode(selectedSite.id)}
                      className="bg-cyan-600 hover:bg-cyan-500"
                      data-testid="button-generate-embed"
                    >
                      <Code className="w-4 h-4 mr-2" /> Generate Embed Code
                    </Button>
                  ) : (
                    <>
                      <div className="relative">
                        <pre className="bg-slate-950 border border-slate-700 rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto max-h-[300px]" data-testid="text-embed-code">
                          {embedCode}
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          className="absolute top-3 right-3 border-slate-600"
                          onClick={handleCopy}
                          data-testid="button-copy-embed"
                        >
                          {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                          {copied ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                      <div className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-4 space-y-3">
                        <h4 className="text-sm font-medium text-white">Installation Steps:</h4>
                        <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside">
                          <li>Copy the embed code above</li>
                          <li>Open the website's HTML file or CMS editor</li>
                          <li>Paste the code just before the closing <code className="text-cyan-400 bg-slate-800 px-1 rounded">&lt;/body&gt;</code> tag</li>
                          <li>Save and publish the page</li>
                          <li>Return here and click <strong className="text-white">Verify Installation</strong> in the Manage tab to confirm the widget is detected</li>
                        </ol>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-800/40 border-slate-700/50">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Widget Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-white rounded-xl overflow-hidden border border-slate-300 relative" style={{ minHeight: "300px" }}>
                    <div className="p-6 bg-slate-100">
                      <div className="h-4 w-48 bg-slate-300 rounded mb-3" />
                      <div className="h-3 w-full bg-slate-200 rounded mb-2" />
                      <div className="h-3 w-3/4 bg-slate-200 rounded mb-2" />
                      <div className="h-3 w-5/6 bg-slate-200 rounded" />
                    </div>
                    <div className="absolute bottom-4 right-4">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
                        style={{ backgroundColor: widgetSettings.color }}
                      >
                        <MessageSquare className="w-6 h-6 text-white" />
                      </div>
                    </div>
                    <div className="absolute bottom-20 right-4 w-[280px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
                      <div className="p-3 text-white text-sm font-semibold flex justify-between items-center" style={{ backgroundColor: widgetSettings.color }}>
                        <span className="flex items-center gap-2"><span className="w-2 h-2 bg-green-400 rounded-full" /> AI Assistant</span>
                      </div>
                      <div className="p-3 bg-slate-50">
                        <div className="bg-white border border-slate-200 rounded-xl rounded-bl-none p-3 text-xs text-slate-700 shadow-sm">
                          {widgetSettings.greeting}
                        </div>
                      </div>
                      <div className="p-2 border-t border-slate-100 flex gap-2">
                        <div className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-400">Type a message...</div>
                        <div className="px-3 py-2 rounded-lg text-white text-xs" style={{ backgroundColor: widgetSettings.color }}>Send</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="preview" className="mt-6">
          {selectedSite && (
            <Card className="bg-slate-800/40 border-slate-700/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Eye className="w-5 h-5 text-cyan-400" /> {selectedSite.name}
                    </CardTitle>
                    <CardDescription>Live preview of the website</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300"
                    onClick={() => window.open(selectedSite.url, "_blank")}
                    data-testid="button-open-external"
                  >
                    <ExternalLink className="w-4 h-4 mr-1" /> Open in New Tab
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl overflow-hidden border border-slate-700/50 bg-white" style={{ height: "600px" }}>
                  <iframe
                    src={selectedSite.url}
                    className="w-full h-full"
                    title={`Preview of ${selectedSite.name}`}
                    sandbox="allow-scripts allow-same-origin allow-popups"
                    data-testid="iframe-site-preview"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-3 text-center">
                  Some websites may block being embedded in iframes. Use "Open in New Tab" if the preview doesn't load.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-cyan-400" /> Add a Website
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 space-y-2">
              <p className="text-xs text-slate-300 font-medium">How it works:</p>
              <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                <li>Add your website URL below</li>
                <li>Train the AI by scraping the site content</li>
                <li>Embed the chat widget with a JavaScript snippet and verify</li>
              </ol>
              <p className="text-xs text-slate-500 mt-1">No DNS or domain changes needed — just a JS embed.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Website Name</Label>
              <Input
                placeholder="e.g. Forge Fitness"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                data-testid="input-new-site-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Website URL</Label>
              <Input
                placeholder="https://example.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
                data-testid="input-new-site-url"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-slate-600 text-slate-300">
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!newUrl || !newName || addMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500"
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add Website
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showTutorial && <TutorialOverlay steps={WEBSITE_INTEGRATION_STEPS} storageKey="apex_tutorial_website_integration" onClose={closeTutorial} accentColor="cyan" />}
    </div>
  );
}
