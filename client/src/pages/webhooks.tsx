import { PlanGate } from "@/components/plan-gate";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Webhook, Plus, Trash2, TestTube, Copy, Shield, Zap, ExternalLink, ChevronDown, ChevronUp, Clock, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

const AVAILABLE_EVENTS = [
  "contact.created",
  "contact.updated",
  "deal.created",
  "deal.moved",
  "deal.closed",
  "appointment.created",
  "appointment.cancelled",
  "message.received",
  "message.sent",
  "campaign.sent",
];

interface WebhookData {
  id: number;
  subAccountId: number;
  name: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  lastTriggeredAt?: string;
  failCount?: number;
}

interface DeliveryLog {
  id: number;
  webhookId: number;
  targetUrl: string;
  eventType: string;
  statusCode: number | null;
  responseBody: string | null;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

interface TestResult {
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  responseBody?: string;
  error?: string;
}

function WebhooksPageInner() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookData | null>(null);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<number>>(new Set());
  const [expandedDeliveries, setExpandedDeliveries] = useState<Set<number>>(new Set());
  const [urlError, setUrlError] = useState("");

  const { data: webhooks = [], isLoading } = useQuery<WebhookData[]>({
    queryKey: ["/api/webhooks", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/webhooks/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { subAccountId: number; name: string; url: string; events: string[]; active: boolean }) => {
      const res = await apiRequest("POST", "/api/webhooks", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.error === "string" ? err.error : "Failed to create webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook Created", description: "Your webhook has been created successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", subAccountId] });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name: string; url: string; events: string[]; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/webhooks/${id}`, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(typeof err.error === "string" ? err.error : "Failed to update webhook");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook Updated", description: "Your webhook has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", subAccountId] });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/webhooks/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Webhook Deleted", description: "The webhook has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/webhooks/test/${id}`);
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (data: TestResult, webhookId: number) => {
      if (data.success) {
        toast({
          title: "Test Successful",
          description: `Endpoint responded with ${data.statusCode} in ${data.latencyMs}ms.`,
        });
      } else {
        toast({
          title: "Test Failed",
          description: data.error
            ? `Connection error: ${data.error}`
            : `Endpoint returned HTTP ${data.statusCode} in ${data.latencyMs}ms.`,
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks/deliveries", webhookId] });
    },
    onError: (err: Error) => {
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    },
  });

  function validateUrl(url: string): string {
    if (!url.trim()) return "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "URL must use HTTPS";
      return "";
    } catch {
      return "Invalid URL format";
    }
  }

  function openCreateDialog() {
    setEditingWebhook(null);
    setFormName("");
    setFormUrl("");
    setFormEvents([]);
    setFormActive(true);
    setUrlError("");
    setDialogOpen(true);
  }

  function openEditDialog(wh: WebhookData) {
    setEditingWebhook(wh);
    setFormName(wh.name);
    setFormUrl(wh.url);
    setFormEvents(wh.events || []);
    setFormActive(wh.active);
    setUrlError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingWebhook(null);
  }

  function handleSave() {
    if (!formName.trim() || !formUrl.trim()) {
      toast({ title: "Validation Error", description: "Name and URL are required.", variant: "destructive" });
      return;
    }
    const err = validateUrl(formUrl);
    if (err) {
      setUrlError(err);
      return;
    }
    if (editingWebhook) {
      updateMutation.mutate({ id: editingWebhook.id, name: formName, url: formUrl, events: formEvents, active: formActive });
    } else {
      createMutation.mutate({ subAccountId: subAccountId ?? 0, name: formName, url: formUrl, events: formEvents, active: formActive });
    }
  }

  function toggleEvent(event: string) {
    setFormEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  function toggleSecretReveal(id: number) {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDeliveries(id: number) {
    setExpandedDeliveries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Secret copied to clipboard." });
  }

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
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
                <Zap size={12} /> WEBHOOKS
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-webhooks-title">
                Web<span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">hooks</span>
              </h1>
            </div>
            <Button
              onClick={openCreateDialog}
              className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold"
              data-testid="button-add-webhook"
            >
              <Plus size={16} className="mr-2" /> Add Webhook
            </Button>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="bg-indigo-500/10 border-indigo-500/20 mb-8" data-testid="info-banner">
            <CardContent className="p-4 flex items-center gap-3">
              <ExternalLink size={18} className="text-indigo-400 shrink-0" />
              <p className="text-sm text-slate-300">
                Connect your account to external tools like <span className="text-indigo-400 font-semibold">Zapier</span>, <span className="text-cyan-400 font-semibold">Make.com</span>, and more. Webhooks send real-time data to your endpoints when events occur.
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin text-indigo-400">
              <Zap size={32} />
            </div>
          </div>
        ) : webhooks.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="text-center py-20" data-testid="empty-state">
              <Webhook size={48} className="mx-auto mb-4 text-white/10" />
              <p className="text-slate-400 text-sm">No webhooks configured yet</p>
              <p className="text-slate-600 text-xs mt-1">Click "Add Webhook" to get started</p>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-4" data-testid="webhook-list">
            {webhooks.map((wh, i) => (
              <motion.div
                key={wh.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                <Card className="bg-white/5 border-white/10 hover:bg-white/[0.07] transition-colors" data-testid={`card-webhook-${wh.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-base font-bold text-white truncate" data-testid={`text-webhook-name-${wh.id}`}>{wh.name}</h3>
                          <Badge
                            className={wh.active ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}
                            data-testid={`badge-webhook-status-${wh.id}`}
                          >
                            {wh.active ? "Active" : "Inactive"}
                          </Badge>
                          {(wh.failCount || 0) > 0 && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30" data-testid={`badge-webhook-fail-${wh.id}`}>
                              {wh.failCount} failures
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate" data-testid={`text-webhook-url-${wh.id}`}>{wh.url}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                          onClick={() => testMutation.mutate(wh.id)}
                          disabled={testMutation.isPending}
                          data-testid={`button-test-webhook-${wh.id}`}
                        >
                          <TestTube size={14} className="mr-1" /> Test
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                          onClick={() => openEditDialog(wh)}
                          data-testid={`button-edit-webhook-${wh.id}`}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => deleteMutation.mutate(wh.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-webhook-${wh.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>

                    {wh.events && wh.events.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3" data-testid={`events-list-${wh.id}`}>
                        {wh.events.map((event) => (
                          <Badge key={event} className="bg-white/5 text-slate-400 border-white/10 text-[10px]" data-testid={`badge-event-${wh.id}-${event}`}>
                            {event}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {wh.secret && (
                          <div className="flex items-center gap-2">
                            <Shield size={12} className="text-indigo-400" />
                            <span className="text-xs text-slate-500 font-mono" data-testid={`text-webhook-secret-${wh.id}`}>
                              {revealedSecrets.has(wh.id) ? wh.secret : "••••••••••••"}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-slate-500 hover:text-slate-300"
                              onClick={() => toggleSecretReveal(wh.id)}
                              data-testid={`button-reveal-secret-${wh.id}`}
                            >
                              {revealedSecrets.has(wh.id) ? "Hide" : "Show"}
                            </Button>
                            {revealedSecrets.has(wh.id) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-slate-500 hover:text-slate-300"
                                onClick={() => copyToClipboard(wh.secret!)}
                                data-testid={`button-copy-secret-${wh.id}`}
                              >
                                <Copy size={12} />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {wh.lastTriggeredAt && (
                        <span className="text-[10px] text-slate-600" data-testid={`text-webhook-last-triggered-${wh.id}`}>
                          Last triggered: {new Date(wh.lastTriggeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/5">
                      <button
                        onClick={() => toggleDeliveries(wh.id)}
                        className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
                        data-testid={`button-toggle-deliveries-${wh.id}`}
                      >
                        <Clock size={12} />
                        <span>Delivery History</span>
                        {expandedDeliveries.has(wh.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <AnimatePresence>
                        {expandedDeliveries.has(wh.id) && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <DeliveryHistory webhookId={wh.id} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg" data-testid="dialog-webhook-form">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold" data-testid="text-dialog-title">
                {editingWebhook ? "Edit Webhook" : "Create Webhook"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="text-xs text-slate-400 font-medium mb-1 block">Name</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Webhook"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                  data-testid="input-webhook-name"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium mb-1 block">URL (HTTPS required)</label>
                <Input
                  value={formUrl}
                  onChange={(e) => {
                    setFormUrl(e.target.value);
                    setUrlError(validateUrl(e.target.value));
                  }}
                  placeholder="https://example.com/webhook"
                  className={`bg-white/5 border-white/10 text-white placeholder:text-white/20 ${urlError ? "border-red-500/50" : ""}`}
                  data-testid="input-webhook-url"
                />
                {urlError && (
                  <p className="text-xs text-red-400 mt-1" data-testid="text-url-error">{urlError}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium mb-2 block">Events</label>
                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1" data-testid="events-checkboxes">
                  {AVAILABLE_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={formEvents.includes(event)}
                        onChange={() => toggleEvent(event)}
                        className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500"
                        data-testid={`checkbox-event-${event}`}
                      />
                      <span className="text-xs text-slate-300">{event}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
                <span className="text-sm text-slate-300">Active</span>
                <Switch
                  checked={formActive}
                  onCheckedChange={setFormActive}
                  data-testid="switch-webhook-active"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={closeDialog}
                  className="text-slate-400 hover:text-white"
                  data-testid="button-cancel-webhook"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold"
                  data-testid="button-save-webhook"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingWebhook ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function DeliveryHistory({ webhookId }: { webhookId: number }) {
  const { data: deliveries = [], isLoading } = useQuery<DeliveryLog[]>({
    queryKey: ["/api/webhooks/deliveries", webhookId],
    queryFn: async () => {
      const res = await fetch(`/api/webhooks/${webhookId}/deliveries`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return <p className="text-xs text-slate-600 mt-2">Loading delivery history...</p>;
  }

  if (deliveries.length === 0) {
    return <p className="text-xs text-slate-600 mt-2" data-testid={`text-no-deliveries-${webhookId}`}>No deliveries recorded yet.</p>;
  }

  return (
    <div className="mt-2 space-y-1.5" data-testid={`delivery-list-${webhookId}`}>
      {deliveries.map((log) => (
        <div
          key={log.id}
          className={`p-2 rounded-lg text-xs ${
            log.success ? "bg-emerald-500/5 border border-emerald-500/10" : "bg-red-500/5 border border-red-500/10"
          }`}
          data-testid={`delivery-log-${log.id}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {log.success ? (
                <CheckCircle size={12} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={12} className="text-red-400 shrink-0" />
              )}
              <span className="text-slate-400 shrink-0">{log.eventType}</span>
              {log.statusCode !== null && (
                <Badge className={`text-[9px] px-1.5 py-0 shrink-0 ${
                  log.success ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-red-500/15 text-red-400 border-red-500/20"
                }`} data-testid={`badge-status-code-${log.id}`}>
                  {log.statusCode}
                </Badge>
              )}
              {log.errorMessage && (
                <span className="text-red-400 truncate max-w-[200px]" title={log.errorMessage} data-testid={`text-error-${log.id}`}>{log.errorMessage}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-slate-600 shrink-0">
              {log.latencyMs !== null && <span data-testid={`text-latency-${log.id}`}>{log.latencyMs}ms</span>}
              <span>{new Date(log.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          {log.targetUrl && (
            <p className="text-[10px] text-slate-600 truncate mt-1 ml-5" data-testid={`text-target-url-${log.id}`}>{log.targetUrl}</p>
          )}
          {log.responseBody && (
            <p className="text-[10px] text-slate-600 font-mono bg-black/20 rounded px-2 py-1 truncate max-w-full mt-1 ml-5" title={log.responseBody} data-testid={`text-response-${log.id}`}>
              {log.responseBody.substring(0, 200)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function WebhooksPage() {
  return <PlanGate feature="webhooks"><WebhooksPageInner /></PlanGate>;
}
