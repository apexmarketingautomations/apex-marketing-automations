import { PlanGate } from "@/components/plan-gate";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Mail, Send, Clock, Eye, MousePointerClick, Plus, Trash2, Edit } from "lucide-react";
import { format } from "date-fns";


interface EmailCampaign {
  id: number;
  subAccountId: number;
  name: string;
  subject: string;
  body: string;
  status: string;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  scheduled: { label: "Scheduled", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  sending: { label: "Sending", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  sent: { label: "Sent", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
};

const TEMPLATES = [
  {
    name: "Welcome",
    subject: "Welcome to Our Platform!",
    body: `<h1>Welcome Aboard!</h1>
<p>We're thrilled to have you join our community. Here's what you can expect:</p>
<ul>
<li>Personalized recommendations</li>
<li>Exclusive member benefits</li>
<li>Priority support</li>
</ul>
<p>Get started by exploring your dashboard today.</p>
<p>Best regards,<br/>The Team</p>`,
  },
  {
    name: "Newsletter",
    subject: "Your Monthly Update",
    body: `<h1>Monthly Newsletter</h1>
<p>Here's what's new this month:</p>
<h2>Featured Updates</h2>
<p>We've launched exciting new features to help you grow your business faster than ever.</p>
<h2>Tips & Tricks</h2>
<p>Discover the top 5 strategies our most successful users employ daily.</p>
<h2>Upcoming Events</h2>
<p>Join us for our next webinar on growth strategies.</p>
<p>Stay tuned for more updates!</p>`,
  },
  {
    name: "Promotion",
    subject: "Limited Time Offer - Don't Miss Out!",
    body: `<h1>🔥 Exclusive Offer Just for You!</h1>
<p>For a limited time, enjoy <strong>50% off</strong> our premium plan.</p>
<p>What you'll get:</p>
<ul>
<li>Unlimited campaigns</li>
<li>Advanced analytics</li>
<li>Priority support</li>
<li>Custom branding</li>
</ul>
<p><strong>Use code: SAVE50</strong></p>
<p>Offer expires in 48 hours. Don't miss out!</p>`,
  },
];

function EmailCampaignsPageInner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const subAccountId = useActiveSubAccountId();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formRecipientCount, setFormRecipientCount] = useState("");
  const [formScheduledAt, setFormScheduledAt] = useState("");

  const { data: campaigns = [], isLoading } = useQuery<EmailCampaign[]>({
    queryKey: ["/api/email-campaigns", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/email-campaigns/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch campaigns");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        subAccountId,
        name: formName,
        subject: formSubject,
        body: formBody,
      };
      if (formRecipientCount) payload.recipientCount = parseInt(formRecipientCount, 10);
      if (formScheduledAt) payload.scheduledAt = formScheduledAt;
      return apiRequest("POST", "/api/email-campaigns", payload);
    },
    onSuccess: () => {
      toast({ title: "Campaign Created", description: "Your campaign has been saved as a draft." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", subAccountId] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create campaign.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingCampaign) return;
      const payload: any = {
        name: formName,
        subject: formSubject,
        body: formBody,
      };
      if (formRecipientCount) payload.recipientCount = parseInt(formRecipientCount, 10);
      if (formScheduledAt) payload.scheduledAt = formScheduledAt;
      return apiRequest("PATCH", `/api/email-campaigns/${editingCampaign.id}`, payload);
    },
    onSuccess: () => {
      toast({ title: "Campaign Updated", description: "Your changes have been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", subAccountId] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update campaign.", variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/email-campaigns/${id}/send`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || "Failed to send");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign Sent", description: "Your campaign is being sent." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", subAccountId] });
      setConfirmSendId(null);
    },
    onError: (err: any) => {
      toast({ title: "Email Service Needed", description: err.message || "Connect an email service (SendGrid, Mailgun, or SMTP) to send real emails.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/email-campaigns/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Campaign Deleted", description: "The campaign has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/email-campaigns", subAccountId] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete campaign.", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingCampaign(null);
    setFormName("");
    setFormSubject("");
    setFormBody("");
    setFormRecipientCount("");
    setFormScheduledAt("");
    setDialogOpen(true);
  }

  function openEdit(campaign: EmailCampaign) {
    setEditingCampaign(campaign);
    setFormName(campaign.name);
    setFormSubject(campaign.subject);
    setFormBody(campaign.body);
    setFormRecipientCount(campaign.recipientCount ? String(campaign.recipientCount) : "");
    setFormScheduledAt(campaign.scheduledAt ? campaign.scheduledAt.slice(0, 16) : "");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingCampaign(null);
  }

  function applyTemplate(template: typeof TEMPLATES[0]) {
    setFormSubject(template.subject);
    setFormBody(template.body);
    if (!formName) setFormName(template.name + " Campaign");
    toast({ title: "Template Applied", description: `${template.name} template loaded.` });
  }

  function handleSave() {
    if (!formName.trim() || !formSubject.trim()) {
      toast({ title: "Validation Error", description: "Name and subject are required.", variant: "destructive" });
      return;
    }
    if (editingCampaign) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.filter((c) => c.status === "sent").length;
  const totalOpens = campaigns.reduce((sum, c) => sum + (c.openCount || 0), 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + (c.clickCount || 0), 0);

  const stats = [
    { label: "Total Campaigns", value: totalCampaigns, icon: Mail, color: "text-cyan-400" },
    { label: "Total Sent", value: totalSent, icon: Send, color: "text-indigo-400" },
    { label: "Total Opens", value: totalOpens, icon: Eye, color: "text-purple-400" },
    { label: "Total Clicks", value: totalClicks, icon: MousePointerClick, color: "text-emerald-400" },
  ];

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
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
              <Mail size={12} /> EMAIL CAMPAIGNS
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-email-campaigns-title">
              Email <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Campaigns</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">Create, manage, and send email campaigns</p>
          </div>
          <Button onClick={openCreate} className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold" data-testid="button-new-campaign">
            <Plus size={16} className="mr-2" /> New Campaign
          </Button>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="stats-row">
          {stats.map((stat, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className="bg-white/5 border-white/10 p-4" data-testid={`stat-card-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={16} className={stat.color} />
                  <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                </div>
                <div className="text-2xl font-black text-white" data-testid={`stat-value-${i}`}>{stat.value}</div>
              </Card>
            </motion.div>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin text-indigo-400">
              <Mail size={32} />
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="bg-white/5 border-white/10 p-10 text-center" data-testid="empty-state">
              <Mail size={48} className="mx-auto mb-4 text-white/10" />
              <p className="text-slate-400 text-sm">No campaigns yet</p>
              <p className="text-slate-600 text-xs mt-1">Create your first email campaign to get started</p>
              <Button onClick={openCreate} className="mt-4 bg-indigo-600 hover:bg-indigo-500" data-testid="button-create-first">
                <Plus size={16} className="mr-2" /> Create Campaign
              </Button>
            </Card>
          </motion.div>
        ) : (
          <div className="space-y-4" data-testid="campaign-list">
            {campaigns.map((campaign, i) => {
              const statusStyle = STATUS_STYLES[campaign.status] || STATUS_STYLES.draft;
              const openRate = campaign.recipientCount > 0 ? ((campaign.openCount / campaign.recipientCount) * 100).toFixed(1) : "0.0";
              const clickRate = campaign.recipientCount > 0 ? ((campaign.clickCount / campaign.recipientCount) * 100).toFixed(1) : "0.0";

              return (
                <motion.div key={campaign.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="bg-white/5 border-white/10 p-5 hover:bg-white/[0.07] transition-colors" data-testid={`card-campaign-${campaign.id}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold text-white truncate" data-testid={`text-campaign-name-${campaign.id}`}>{campaign.name}</h3>
                          <Badge className={`text-xs ${statusStyle.className}`} data-testid={`badge-status-${campaign.id}`}>{statusStyle.label}</Badge>
                        </div>
                        <p className="text-sm text-slate-400 truncate mb-3" data-testid={`text-campaign-subject-${campaign.id}`}>{campaign.subject}</p>
                        <div className="flex items-center gap-6 text-xs text-slate-500">
                          <span className="flex items-center gap-1" data-testid={`text-recipients-${campaign.id}`}>
                            <Mail size={12} /> {campaign.recipientCount || 0} recipients
                          </span>
                          <span className="flex items-center gap-1" data-testid={`text-open-rate-${campaign.id}`}>
                            <Eye size={12} /> {openRate}% opens
                          </span>
                          <span className="flex items-center gap-1" data-testid={`text-click-rate-${campaign.id}`}>
                            <MousePointerClick size={12} /> {clickRate}% clicks
                          </span>
                          {campaign.scheduledAt && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} /> {format(new Date(campaign.scheduledAt), "MMM d, yyyy h:mm a")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {campaign.status === "draft" && (
                          <Button
                            size="sm"
                            onClick={() => setConfirmSendId(campaign.id)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                            data-testid={`button-send-${campaign.id}`}
                          >
                            <Send size={14} className="mr-1" /> Send
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(campaign)}
                          className="text-slate-400 hover:text-white hover:bg-white/10"
                          data-testid={`button-edit-${campaign.id}`}
                        >
                          <Edit size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(campaign.id)}
                          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          data-testid={`button-delete-${campaign.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}

        <Dialog open={confirmSendId !== null} onOpenChange={() => setConfirmSendId(null)}>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">Confirm Send</DialogTitle>
            </DialogHeader>
            <p className="text-slate-400 text-sm">Are you sure you want to send this campaign? This action cannot be undone.</p>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="ghost" onClick={() => setConfirmSendId(null)} className="text-slate-400 hover:text-white" data-testid="button-cancel-send">
                Cancel
              </Button>
              <Button
                onClick={() => confirmSendId && sendMutation.mutate(confirmSendId)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={sendMutation.isPending}
                data-testid="button-confirm-send"
              >
                <Send size={14} className="mr-2" /> {sendMutation.isPending ? "Sending..." : "Send Now"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="bg-slate-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white" data-testid="text-dialog-title">
                {editingCampaign ? "Edit Campaign" : "New Campaign"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Campaign Name</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Email Campaign"
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                  data-testid="input-campaign-name"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Subject Line</label>
                <Input
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  placeholder="Your email subject..."
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                  data-testid="input-campaign-subject"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Email Body</label>
                <Textarea
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Write your email content..."
                  rows={10}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/20 font-mono text-sm"
                  data-testid="input-campaign-body"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Recipient Count</label>
                  <Input
                    type="number"
                    value={formRecipientCount}
                    onChange={(e) => setFormRecipientCount(e.target.value)}
                    placeholder="0"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                    data-testid="input-recipient-count"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Schedule (Optional)</label>
                  <Input
                    type="datetime-local"
                    value={formScheduledAt}
                    onChange={(e) => setFormScheduledAt(e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20"
                    data-testid="input-scheduled-at"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-2 block">Templates</label>
                <div className="grid grid-cols-3 gap-3" data-testid="template-gallery">
                  {TEMPLATES.map((template) => (
                    <button
                      key={template.name}
                      onClick={() => applyTemplate(template)}
                      className="p-3 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-cyan-500/30 transition-all text-left group"
                      data-testid={`button-template-${template.name.toLowerCase()}`}
                    >
                      <div className="text-sm font-semibold text-white group-hover:text-cyan-400 transition-colors">{template.name}</div>
                      <div className="text-xs text-slate-500 mt-1 truncate">{template.subject}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={closeDialog} className="text-slate-400 hover:text-white" data-testid="button-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-campaign"
                >
                  {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingCampaign ? "Update Campaign" : "Create Campaign"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default function EmailCampaignsPage() {
  return <PlanGate feature="email_campaigns"><EmailCampaignsPageInner /></PlanGate>;
}
