import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, GripVertical, Users, Loader2, Layers, Info, ChevronUp, ChevronDown, ChevronsUpDown, Search, Phone, MapPin, Filter, X, EyeOff } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { PIPELINE_STEPS } from "@/components/tutorial-steps";
import { AddressAutocomplete, type AddressData } from "@/components/address-autocomplete";


interface PipelineStage {
  id: number;
  subAccountId: number;
  name: string;
  color: string;
  position: number;
}

interface Deal {
  id: number;
  subAccountId: number;
  stageId: number;
  title: string;
  value: number;
  contactId?: number | null;
}

interface Contact {
  id: number;
  subAccountId: number;
  firstName: string;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  smsOptOut?: boolean;
  emailOptOut?: boolean;
  channel?: string | null;
}

const DEFAULT_STAGES = [
  { name: "New Lead", color: "#06b6d4", position: 0 },
  { name: "Contacted", color: "#818cf8", position: 1 },
  { name: "Qualified", color: "#a78bfa", position: 2 },
  { name: "Closed Won", color: "#34d399", position: 3 },
];

/** Returns page numbers to render, inserting "…" gaps for large ranges */
function buildPageRange(current: number, total: number): (number | "…")[] {
  if (total <= 10) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set<number>();
  // Always show first 2 and last 2
  [1, 2, total - 1, total].forEach(p => p > 0 && p <= total && set.add(p));
  // Show a window of ±2 around current
  for (let p = Math.max(1, current - 2); p <= Math.min(total, current + 2); p++) set.add(p);
  const sorted = Array.from(set).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}

export default function PipelinePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const subAccountId = useActiveSubAccountId();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_pipeline_tutorial_completed");
  const [activeTab, setActiveTab] = useState<"pipeline" | "contacts">("pipeline");

  const [addStageOpen, setAddStageOpen] = useState(false);
  const [addDealOpen, setAddDealOpen] = useState(false);
  const [editDealOpen, setEditDealOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [stageName, setStageName] = useState("");
  const [stageColor, setStageColor] = useState("#06b6d4");
  const [dealTitle, setDealTitle] = useState("");
  const [dealValue, setDealValue] = useState("");
  const [dealStageId, setDealStageId] = useState<number | null>(null);
  const [dealContactId, setDealContactId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [draggedDealId, setDraggedDealId] = useState<number | null>(null);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", address: "", city: "", state: "", zip: "" });
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editContactForm, setEditContactForm] = useState({ firstName: "", lastName: "", email: "", phone: "", company: "", source: "", tags: "" as string, notes: "", address: "", city: "", state: "", zip: "", smsOptOut: false, emailOptOut: false });
  const [deleteContactOpen, setDeleteContactOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [contactsPage, setContactsPage] = useState(1);
  const [sortField, setSortField] = useState<string>("createdAt");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");
  const [contactSearch, setContactSearch] = useState("");
  const [contactSource, setContactSource] = useState("");
  const [contactHasPhone, setContactHasPhone] = useState<"" | "true" | "false">("");
  const [hideUnidentified, setHideUnidentified] = useState(true);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setContactsPage(1);
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ChevronsUpDown size={12} className="ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp size={12} className="ml-1 text-cyan-400" />
      : <ChevronDown size={12} className="ml-1 text-cyan-400" />;
  }

  const { data: stages = [], isLoading: stagesLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline/stages/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch stages");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const { data: contactsResult } = useQuery<{ items: Contact[]; data?: Contact[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey: ["/api/contacts", subAccountId, contactsPage, sortField, sortDir, contactSearch, contactSource, contactHasPhone, hideUnidentified],
    queryFn: async () => {
      const qp = new URLSearchParams({
        limit: "50",
        page: String(contactsPage),
        sortBy: sortField,
        sortDir,
        source: "all",
      });
      if (contactSearch) qp.set("search", contactSearch);
      if (contactSource) qp.set("source", contactSource);
      if (contactHasPhone) qp.set("hasPhone", contactHasPhone);
      const res = await fetch(`/api/contacts/${subAccountId}?${qp.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: !!subAccountId,
  });
  // Use real total from server — never derive count from items.length
  const contacts = contactsResult?.items ?? contactsResult?.data ?? [];
  const contactsTotal  = contactsResult?.total      ?? contacts.length;
  const contactsTotalPages = contactsResult?.totalPages ?? 1;

  const createStageMutation = useMutation({
    mutationFn: async (stage: { name: string; color: string; position: number }) => {
      const res = await apiRequest("POST", "/api/pipeline/stages", {
        subAccountId: subAccountId,
        ...stage,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages", subAccountId] });
      toast({ title: "Stage created" });
    },
  });

  const createDealMutation = useMutation({
    mutationFn: async (deal: { stageId: number; title: string; value: number; contactId?: number }) => {
      const res = await apiRequest("POST", "/api/deals", {
        subAccountId: subAccountId,
        ...deal,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", subAccountId] });
      toast({ title: "Deal created" });
    },
  });

  const updateDealMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; stageId?: number; title?: string; value?: number }) => {
      const res = await apiRequest("PATCH", `/api/deals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", subAccountId] });
    },
  });

  const deleteDealMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/deals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", subAccountId] });
      toast({ title: "Deal deleted" });
    },
  });

  const createContactMutation = useMutation({
    mutationFn: async (data: typeof contactForm) => {
      const res = await apiRequest("POST", "/api/contacts", {
        subAccountId,
        firstName: data.firstName,
        lastName: data.lastName || undefined,
        email: data.email || undefined,
        phone: data.phone || undefined,
        company: data.company || undefined,
        address: data.address || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        zip: data.zip || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Contact created" });
      setContactForm({ firstName: "", lastName: "", email: "", phone: "", company: "", address: "", city: "", state: "", zip: "" });
      setAddContactOpen(false);
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & typeof editContactForm) => {
      const { tags: tagsStr, ...rest } = data;
      const payload = {
        ...rest,
        tags: tagsStr ? tagsStr.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      };
      const res = await apiRequest("PATCH", `/api/contacts/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({ title: "Contact updated" });
      setEditContactOpen(false);
      setSelectedContact(null);
    },
    onError: () => {
      toast({ title: "Failed to update contact", variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/contacts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", subAccountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Contact deleted" });
      setDeleteContactOpen(false);
      setContactToDelete(null);
      setEditContactOpen(false);
      setSelectedContact(null);
    },
    onError: () => {
      toast({ title: "Failed to delete contact", variant: "destructive" });
    },
  });

  const handleCreateDefaultStages = async () => {
    for (const stage of DEFAULT_STAGES) {
      await createStageMutation.mutateAsync(stage);
    }
  };

  const handleAddStage = () => {
    if (!stageName.trim()) return;
    createStageMutation.mutate({ name: stageName, color: stageColor, position: stages.length });
    setStageName("");
    setStageColor("#06b6d4");
    setAddStageOpen(false);
  };

  const handleAddDeal = () => {
    if (!dealTitle.trim() || !dealStageId) return;
    createDealMutation.mutate({
      stageId: dealStageId,
      title: dealTitle,
      value: parseFloat(dealValue) || 0,
      ...(dealContactId ? { contactId: parseInt(dealContactId) } : {}),
    });
    setDealTitle("");
    setDealValue("");
    setDealStageId(null);
    setDealContactId("");
    setAddDealOpen(false);
  };

  const handleEditDeal = () => {
    if (!selectedDeal || !editTitle.trim()) return;
    updateDealMutation.mutate({
      id: selectedDeal.id,
      title: editTitle,
      value: parseFloat(editValue) || 0,
    });
    setEditDealOpen(false);
    setSelectedDeal(null);
  };

  const handleDeleteDeal = () => {
    if (!selectedDeal) return;
    deleteDealMutation.mutate(selectedDeal.id);
    setEditDealOpen(false);
    setSelectedDeal(null);
  };

  const openEditDeal = (deal: Deal) => {
    setSelectedDeal(deal);
    setEditTitle(deal.title);
    setEditValue(String(deal.value));
    setEditDealOpen(true);
  };

  const onDragStart = (e: React.DragEvent, dealId: number) => {
    setDraggedDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDrop = (e: React.DragEvent, stageId: number) => {
    e.preventDefault();
    if (draggedDealId !== null) {
      updateDealMutation.mutate({ id: draggedDealId, stageId });
      setDraggedDealId(null);
    }
  };

  const getContactName = (contactId?: number | null) => {
    if (!contactId) return null;
    const contact = contacts.find((c) => c.id === contactId);
    return contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null : null;
  };

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const isLoading = stagesLoading || dealsLoading;

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-200">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-6 lg:p-10 overflow-y-auto overflow-x-hidden">
      <div className="max-w-full mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <Layers size={12} /> CRM PIPELINE
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-black tracking-tight" data-testid="text-pipeline-title">
                <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Pipeline</span>
              </h1>
              <button onClick={startTutorial} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5" data-testid="button-start-tutorial"><Info size={14} className="mr-1" /> Tutorial</button>
            </div>
            {activeTab === "pipeline" && stages.length > 0 && (
              <div className="flex gap-2">
                <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 text-white" data-testid="button-add-stage">
                      <Plus size={16} className="mr-1" /> Add Stage
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-slate-900 border-white/10">
                    <DialogHeader>
                      <DialogTitle className="text-white">Add Stage</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Input
                        placeholder="Stage name"
                        value={stageName}
                        onChange={(e) => setStageName(e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                        data-testid="input-stage-name"
                      />
                      <div className="flex items-center gap-3">
                        <label className="text-sm text-slate-400">Color</label>
                        <input
                          type="color"
                          value={stageColor}
                          onChange={(e) => setStageColor(e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer bg-transparent border-0"
                          data-testid="input-stage-color"
                        />
                      </div>
                      <Button onClick={handleAddStage} className="w-full bg-indigo-600 hover:bg-indigo-500" data-testid="button-submit-stage">
                        Create Stage
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <Dialog open={addDealOpen} onOpenChange={setAddDealOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-cyan-600 hover:bg-cyan-500 text-white" data-testid="button-add-deal">
                      <Plus size={16} className="mr-1" /> Add Deal
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-slate-900 border-white/10">
                    <DialogHeader>
                      <DialogTitle className="text-white">Add Deal</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                      <Input
                        placeholder="Deal title"
                        value={dealTitle}
                        onChange={(e) => setDealTitle(e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                        data-testid="input-deal-title"
                      />
                      <Input
                        placeholder="Value ($)"
                        type="number"
                        value={dealValue}
                        onChange={(e) => setDealValue(e.target.value)}
                        className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                        data-testid="input-deal-value"
                      />
                      <select
                        value={dealStageId || ""}
                        onChange={(e) => setDealStageId(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full rounded-md bg-white/5 border border-white/10 text-white px-3 py-2 text-sm"
                        data-testid="select-deal-stage"
                      >
                        <option value="" className="bg-slate-900">Select stage</option>
                        {sortedStages.map((s) => (
                          <option key={s.id} value={s.id} className="bg-slate-900">{s.name}</option>
                        ))}
                      </select>
                      <select
                        value={dealContactId}
                        onChange={(e) => setDealContactId(e.target.value)}
                        className="w-full rounded-md bg-white/5 border border-white/10 text-white px-3 py-2 text-sm"
                        data-testid="select-deal-contact"
                      >
                        <option value="" className="bg-slate-900">No contact</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id} className="bg-slate-900">{[c.firstName, c.lastName].filter(Boolean).join(" ")}</option>
                        ))}
                      </select>
                      <Button onClick={handleAddDeal} className="w-full bg-cyan-600 hover:bg-cyan-500" data-testid="button-submit-deal">
                        Create Deal
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </motion.div>

        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setActiveTab("pipeline")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
              activeTab === "pipeline"
                ? "bg-indigo-600 text-white"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
            data-testid="tab-pipeline"
          >
            Pipeline
          </button>
          <button
            onClick={() => { setActiveTab("contacts"); setContactsPage(1); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === "contacts"
                ? "bg-indigo-600 text-white"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
            }`}
            data-testid="tab-contacts"
          >
            <Users size={14} /> Contacts
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        ) : activeTab === "pipeline" ? (
          <>
            {stages.length === 0 ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center py-20">
                <Layers size={64} className="text-white/10 mb-6" />
                <h2 className="text-xl font-bold text-white mb-2" data-testid="text-empty-pipeline">No Pipeline Stages</h2>
                <p className="text-slate-200 text-sm mb-6">Get started by creating your pipeline stages</p>
                <Button
                  onClick={handleCreateDefaultStages}
                  disabled={createStageMutation.isPending}
                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white font-bold px-6 py-3"
                  data-testid="button-create-pipeline"
                >
                  {createStageMutation.isPending ? (
                    <Loader2 size={16} className="animate-spin mr-2" />
                  ) : (
                    <Plus size={16} className="mr-2" />
                  )}
                  Create Your Pipeline
                </Button>
              </motion.div>
            ) : (
              <div className="flex gap-3 md:gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory md:snap-none" data-testid="kanban-board">
                {sortedStages.map((stage) => {
                  const stageDeals = deals.filter((d) => d.stageId === stage.id);
                  return (
                    <motion.div
                      key={stage.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="min-w-[260px] w-[260px] md:min-w-[280px] md:w-[280px] flex-shrink-0 snap-start"
                      onDragOver={onDragOver}
                      onDrop={(e) => onDrop(e, stage.id)}
                      data-testid={`stage-column-${stage.id}`}
                    >
                      <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                        <div className="flex items-center justify-between mb-3 px-1">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                            <span className="text-sm font-bold text-white" data-testid={`stage-name-${stage.id}`}>{stage.name}</span>
                          </div>
                          <span className="text-xs text-slate-300 bg-white/5 px-2 py-0.5 rounded-full" data-testid={`stage-count-${stage.id}`}>
                            {stageDeals.length}
                          </span>
                        </div>
                        <div className="space-y-2 min-h-[100px]">
                          {stageDeals.map((deal) => {
                            const contactName = getContactName(deal.contactId);
                            return (
                              <div
                                key={deal.id}
                                draggable
                                onDragStart={(e) => onDragStart(e, deal.id)}
                                onClick={() => openEditDeal(deal)}
                                className="p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 cursor-grab active:cursor-grabbing transition-colors group"
                                data-testid={`deal-card-${deal.id}`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-white truncate" data-testid={`deal-title-${deal.id}`}>{deal.title}</p>
                                    <p className="text-xs font-bold text-cyan-400 mt-1" data-testid={`deal-value-${deal.id}`}>
                                      ${deal.value.toLocaleString()}
                                    </p>
                                    {contactName && (
                                      <p className="text-xs text-slate-300 mt-1 truncate" data-testid={`deal-contact-${deal.id}`}>
                                        {contactName}
                                      </p>
                                    )}
                                  </div>
                                  <GripVertical size={14} className="text-white/20 group-hover:text-white/40 mt-0.5 flex-shrink-0" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-white/5 border-white/10" data-testid="contacts-table">
              <CardHeader className="flex flex-col gap-3">
                <div className="flex flex-row items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-white text-lg flex items-center gap-2">
                    <Users size={18} className="text-indigo-400" />
                    Contacts ({contactsTotal.toLocaleString()})
                    {contactsTotalPages > 1 && (
                      <span className="text-xs text-slate-400 font-normal ml-1">
                        · page {contactsPage}/{contactsTotalPages}
                      </span>
                    )}
                  </CardTitle>
                  <Button onClick={() => setAddContactOpen(true)} className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs h-8" data-testid="button-add-contact">
                    <Plus size={14} className="mr-1" /> Add Contact
                  </Button>
                </div>

                {/* Filter bar */}
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                      <Input
                        value={contactSearch}
                        onChange={e => { setContactSearch(e.target.value); setContactsPage(1); }}
                        placeholder="Name, phone, email..."
                        className="pl-8 h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-slate-600"
                      />
                      {contactSearch && (
                        <button onClick={() => { setContactSearch(""); setContactsPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                          <X size={11} />
                        </button>
                      )}
                    </div>
                    {/* Source filter */}
                    <select
                      value={contactSource}
                      onChange={e => { setContactSource(e.target.value); setContactsPage(1); }}
                      className="h-8 px-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 text-slate-300 focus:outline-none"
                    >
                      <option value="">All Sources</option>
                      <option value="sentinel_crash">Crash Leads</option>
                      <option value="property_radar">Property Radar</option>
                      <option value="meta_ads">Meta Ads</option>
                      <option value="manual">Manual</option>
                    </select>
                    {/* Has phone filter */}
                    <select
                      value={contactHasPhone}
                      onChange={e => { setContactHasPhone(e.target.value as "" | "true" | "false"); setContactsPage(1); }}
                      className="h-8 px-2 rounded-md text-xs font-medium bg-white/5 border border-white/10 text-slate-300 focus:outline-none"
                    >
                      <option value="">All</option>
                      <option value="true">Has Phone</option>
                      <option value="false">No Phone</option>
                    </select>
                  </div>
                  {/* Hide unidentified toggle */}
                  <button
                    onClick={() => { setHideUnidentified(h => !h); setContactsPage(1); }}
                    className={`flex items-center gap-1.5 text-[11px] font-bold w-fit px-2.5 py-1 rounded-lg border transition-all ${
                      hideUnidentified
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-white/5 text-slate-500 border-white/10"
                    }`}
                  >
                    <EyeOff size={11} />
                    {hideUnidentified ? "Hiding unnamed crash placeholders" : "Show all contacts"}
                  </button>
                </div>
                {contactsTotalPages > 1 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      className="h-7 px-2 rounded text-xs text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setContactsPage(p => Math.max(1, p - 1))}
                      disabled={contactsPage === 1}
                    >‹ Prev</button>
                    {buildPageRange(contactsPage, contactsTotalPages).map((p, i) =>
                      p === "…" ? (
                        <span key={`ellipsis-t-${i}`} className="text-slate-500 text-xs px-1">…</span>
                      ) : (
                        <button
                          key={p}
                          className={`h-7 w-7 rounded text-xs font-medium transition-colors ${
                            p === contactsPage
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-white hover:bg-white/10"
                          }`}
                          onClick={() => setContactsPage(p)}
                        >{p}</button>
                      )
                    )}
                    <button
                      className="h-7 px-2 rounded text-xs text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setContactsPage(p => Math.min(contactsTotalPages, p + 1))}
                      disabled={contactsPage === contactsTotalPages}
                    >Next ›</button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {contacts.length === 0 ? (
                  <div className="text-center py-10">
                    <Users size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-slate-200 text-sm">No contacts yet</p>
                  </div>
                ) : (
                  <div className="space-y-2 md:space-y-0">
                    {/* Desktop table header — hidden on mobile */}
                    <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_40px] gap-3 px-3 py-2 border-b border-white/10 text-xs font-medium text-slate-400">
                      {(["firstName","phone","source","address"] as const).map(field => {
                        const labels: Record<string,string> = { firstName:"Name", phone:"Phone", source:"Source", address:"Address" };
                        const isActive = sortField === field;
                        return (
                          <button key={field} onClick={() => handleSort(field)}
                            className={`flex items-center gap-1 text-left hover:text-white transition-colors ${isActive ? "text-cyan-400" : ""}`}>
                            {labels[field]}<SortIcon field={field} />
                          </button>
                        );
                      })}
                      <span />
                    </div>

                    {contacts
                      .filter(c => !hideUnidentified || !/^Unidentified\b/i.test(c.firstName || ""))
                      .map((contact) => {
                        const isCrashLead = contact.source === "sentinel_crash" || contact.tags?.includes("Crash_Connect_Lead") || contact.tags?.includes("crash-lead");
                        const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
                        const isPlaceholder = /^Unidentified\b/i.test(contact.firstName || "");
                        const displayName = isPlaceholder
                          ? (contact.address || contact.city || "Crash Incident")
                          : (fullName || "—");

                        const openEdit = () => {
                          setSelectedContact(contact);
                          setEditContactForm({
                            firstName: contact.firstName || "",
                            lastName: contact.lastName || "",
                            email: contact.email || "",
                            phone: contact.phone || "",
                            company: contact.company || "",
                            source: contact.source || "",
                            tags: (contact.tags || []).join(", "),
                            notes: contact.notes || "",
                            address: contact.address || "",
                            city: contact.city || "",
                            state: contact.state || "",
                            zip: contact.zip || "",
                            smsOptOut: contact.smsOptOut || false,
                            emailOptOut: contact.emailOptOut || false,
                          });
                          setEditContactOpen(true);
                        };

                        return (
                          <div key={contact.id} data-testid={`contact-row-${contact.id}`}>
                            {/* Mobile card */}
                            <div
                              className={`md:hidden flex items-center justify-between px-3 py-3 rounded-xl border cursor-pointer transition-all ${
                                isCrashLead ? "bg-red-500/5 border-red-500/15 hover:border-red-500/30" : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10"
                              }`}
                              onClick={openEdit}
                            >
                              <div className="min-w-0 flex-1">
                                <p className={`font-bold text-sm truncate ${isPlaceholder ? "text-slate-500 italic" : "text-white"}`}>
                                  {displayName}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {contact.phone ? (
                                    <a href={`tel:${contact.phone}`} onClick={e => e.stopPropagation()}
                                      className="text-green-400 font-mono text-xs font-bold flex items-center gap-1">
                                      <Phone size={10} />{contact.phone}
                                    </a>
                                  ) : (
                                    <span className="text-slate-600 text-xs">No phone</span>
                                  )}
                                  {isCrashLead && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-black">CRASH</span>}
                                  <span className="text-[10px] text-slate-600">{contact.source || ""}</span>
                                </div>
                              </div>
                              <Button variant="ghost" size="sm"
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0 shrink-0 ml-2"
                                onClick={e => { e.stopPropagation(); setContactToDelete(contact); setDeleteContactOpen(true); }}
                                data-testid={`button-row-delete-contact-${contact.id}`}>
                                <Trash2 size={13} />
                              </Button>
                            </div>

                            {/* Desktop row */}
                            <div
                              className={`hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_40px] gap-3 items-center px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors hover:bg-white/[0.03] ${isCrashLead ? "bg-red-500/[0.03]" : ""}`}
                              onClick={openEdit}
                              data-testid={`contact-row-desktop-${contact.id}`}
                            >
                              <div className="min-w-0">
                                <p className={`font-medium text-sm truncate ${isPlaceholder ? "text-slate-500 italic" : "text-white"}`} data-testid={`contact-name-${contact.id}`}>
                                  {displayName}
                                </p>
                                {isCrashLead && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-black">CRASH</span>}
                              </div>
                              <div data-testid={`contact-phone-${contact.id}`}>
                                {contact.phone ? (
                                  <a href={`tel:${contact.phone}`} onClick={e => e.stopPropagation()}
                                    className="text-green-400 font-mono text-sm font-bold hover:text-green-300 flex items-center gap-1">
                                    <Phone size={11} />{contact.phone}
                                  </a>
                                ) : <span className="text-slate-600 text-sm">—</span>}
                                {contact.email && <p className="text-slate-500 text-xs truncate">{contact.email}</p>}
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 w-fit" data-testid={`contact-source-${contact.id}`}>
                                {contact.source || "—"}
                              </span>
                              <p className="text-slate-500 text-xs truncate" data-testid={`contact-address-${contact.id}`}>
                                {contact.city || contact.address || "—"}
                              </p>
                              <Button variant="ghost" size="sm"
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0"
                                onClick={e => { e.stopPropagation(); setContactToDelete(contact); setDeleteContactOpen(true); }}
                                data-testid={`button-row-delete-contact-${contact.id}`}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                        );
                    })}
                  </div>
                )}
                {contactsTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-1 flex-wrap pt-4 pb-1 border-t border-white/5 mt-2">
                    <button
                      className="h-7 px-2 rounded text-xs text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setContactsPage(p => Math.max(1, p - 1))}
                      disabled={contactsPage === 1}
                    >‹ Prev</button>
                    {buildPageRange(contactsPage, contactsTotalPages).map((p, i) =>
                      p === "…" ? (
                        <span key={`ellipsis-b-${i}`} className="text-slate-500 text-xs px-1">…</span>
                      ) : (
                        <button
                          key={p}
                          className={`h-7 w-7 rounded text-xs font-medium transition-colors ${
                            p === contactsPage
                              ? "bg-indigo-600 text-white"
                              : "text-slate-400 hover:text-white hover:bg-white/10"
                          }`}
                          onClick={() => setContactsPage(p)}
                        >{p}</button>
                      )
                    )}
                    <button
                      className="h-7 px-2 rounded text-xs text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setContactsPage(p => Math.min(contactsTotalPages, p + 1))}
                      disabled={contactsPage === contactsTotalPages}
                    >Next ›</button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <Dialog open={editDealOpen} onOpenChange={setEditDealOpen}>
          <DialogContent className="bg-slate-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">Edit Deal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="Deal title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-deal-title"
              />
              <Input
                placeholder="Value ($)"
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-deal-value"
              />
              <div className="flex gap-2">
                <Button onClick={handleEditDeal} className="flex-1 bg-indigo-600 hover:bg-indigo-500" data-testid="button-save-deal">
                  Save Changes
                </Button>
                <Button onClick={handleDeleteDeal} variant="destructive" className="bg-red-600 hover:bg-red-500" data-testid="button-delete-deal">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={addContactOpen} onOpenChange={setAddContactOpen}>
          <DialogContent className="bg-slate-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">Add Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First name *"
                  value={contactForm.firstName}
                  onChange={(e) => setContactForm(f => ({ ...f, firstName: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-contact-first-name"
                />
                <Input
                  placeholder="Last name"
                  value={contactForm.lastName}
                  onChange={(e) => setContactForm(f => ({ ...f, lastName: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-contact-last-name"
                />
              </div>
              <Input
                placeholder="Email"
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm(f => ({ ...f, email: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-contact-email"
              />
              <Input
                placeholder="Phone"
                value={contactForm.phone}
                onChange={(e) => setContactForm(f => ({ ...f, phone: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-contact-phone"
              />
              <Input
                placeholder="Company"
                value={contactForm.company}
                onChange={(e) => setContactForm(f => ({ ...f, company: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-contact-company"
              />
              <AddressAutocomplete
                value={contactForm.address}
                onAddressSelect={(data) => setContactForm(f => ({ ...f, address: data.address, city: data.city, state: data.state, zip: data.zip }))}
                onChange={(val) => setContactForm(f => ({ ...f, address: val }))}
                placeholder="Address"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-contact-address"
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  placeholder="City"
                  value={contactForm.city}
                  onChange={(e) => setContactForm(f => ({ ...f, city: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-contact-city"
                />
                <Input
                  placeholder="State"
                  value={contactForm.state}
                  onChange={(e) => setContactForm(f => ({ ...f, state: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-contact-state"
                />
                <Input
                  placeholder="ZIP"
                  value={contactForm.zip}
                  onChange={(e) => setContactForm(f => ({ ...f, zip: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-contact-zip"
                />
              </div>
              <Button
                onClick={() => { if (contactForm.firstName.trim()) createContactMutation.mutate(contactForm); }}
                disabled={!contactForm.firstName.trim() || createContactMutation.isPending}
                className="w-full bg-cyan-600 hover:bg-cyan-500"
                data-testid="button-submit-contact"
              >
                {createContactMutation.isPending ? "Creating..." : "Create Contact"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={editContactOpen} onOpenChange={setEditContactOpen}>
          <DialogContent className="bg-slate-900 border-white/10 max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white">Edit Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First name"
                  value={editContactForm.firstName}
                  onChange={(e) => setEditContactForm(f => ({ ...f, firstName: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-edit-contact-first-name"
                />
                <Input
                  placeholder="Last name"
                  value={editContactForm.lastName}
                  onChange={(e) => setEditContactForm(f => ({ ...f, lastName: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-edit-contact-last-name"
                />
              </div>
              <Input
                placeholder="Email"
                type="email"
                value={editContactForm.email}
                onChange={(e) => setEditContactForm(f => ({ ...f, email: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-email"
              />
              <Input
                placeholder="Phone"
                value={editContactForm.phone}
                onChange={(e) => setEditContactForm(f => ({ ...f, phone: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-phone"
              />
              <Input
                placeholder="Company"
                value={editContactForm.company}
                onChange={(e) => setEditContactForm(f => ({ ...f, company: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-company"
              />
              <Input
                placeholder="Source (e.g. manual, website, referral)"
                value={editContactForm.source}
                onChange={(e) => setEditContactForm(f => ({ ...f, source: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-source"
              />
              <Input
                placeholder="Tags (comma-separated)"
                value={editContactForm.tags}
                onChange={(e) => setEditContactForm(f => ({ ...f, tags: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-tags"
              />
              <Textarea
                placeholder="Notes"
                value={editContactForm.notes}
                onChange={(e) => setEditContactForm(f => ({ ...f, notes: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 min-h-[80px]"
                data-testid="input-edit-contact-notes"
              />
              <AddressAutocomplete
                value={editContactForm.address}
                onAddressSelect={(data) => setEditContactForm(f => ({ ...f, address: data.address, city: data.city, state: data.state, zip: data.zip }))}
                onChange={(val) => setEditContactForm(f => ({ ...f, address: val }))}
                placeholder="Address"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                data-testid="input-edit-contact-address"
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  placeholder="City"
                  value={editContactForm.city}
                  onChange={(e) => setEditContactForm(f => ({ ...f, city: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-edit-contact-city"
                />
                <Input
                  placeholder="State"
                  value={editContactForm.state}
                  onChange={(e) => setEditContactForm(f => ({ ...f, state: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-edit-contact-state"
                />
                <Input
                  placeholder="ZIP"
                  value={editContactForm.zip}
                  onChange={(e) => setEditContactForm(f => ({ ...f, zip: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  data-testid="input-edit-contact-zip"
                />
              </div>
              <div className="space-y-3 rounded-lg bg-white/5 p-3 border border-white/10">
                <p className="text-sm text-slate-400 font-medium">Opt-out Preferences</p>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sms-opt-out" className="text-sm text-slate-200">SMS Opt Out</Label>
                  <Switch
                    id="sms-opt-out"
                    checked={editContactForm.smsOptOut}
                    onCheckedChange={(checked) => setEditContactForm(f => ({ ...f, smsOptOut: checked }))}
                    data-testid="switch-edit-contact-sms-opt-out"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="email-opt-out" className="text-sm text-slate-200">Email Opt Out</Label>
                  <Switch
                    id="email-opt-out"
                    checked={editContactForm.emailOptOut}
                    onCheckedChange={(checked) => setEditContactForm(f => ({ ...f, emailOptOut: checked }))}
                    data-testid="switch-edit-contact-email-opt-out"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => { if (selectedContact) updateContactMutation.mutate({ id: selectedContact.id, ...editContactForm }); }}
                  disabled={updateContactMutation.isPending}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500"
                  data-testid="button-save-contact"
                >
                  {updateContactMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  onClick={() => {
                    if (selectedContact) {
                      setContactToDelete(selectedContact);
                      setDeleteContactOpen(true);
                    }
                  }}
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-500"
                  data-testid="button-delete-contact"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteContactOpen} onOpenChange={setDeleteContactOpen}>
          <AlertDialogContent className="bg-slate-900 border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Delete Contact</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-white">
                  {[contactToDelete?.firstName, contactToDelete?.lastName].filter(Boolean).join(" ")}
                </span>
                ? This will permanently remove the contact. Any linked deals and appointments will have their contact reference removed, and associated email logs will be deleted. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/5 border-white/10 text-white hover:bg-white/10" data-testid="button-cancel-delete-contact">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => { if (contactToDelete) deleteContactMutation.mutate(contactToDelete.id); }}
                disabled={deleteContactMutation.isPending}
                className="bg-red-600 hover:bg-red-500 text-white"
                data-testid="button-confirm-delete-contact"
              >
                {deleteContactMutation.isPending ? "Deleting..." : "Delete Contact"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {showTutorial && <TutorialOverlay steps={PIPELINE_STEPS} storageKey="apex_pipeline_tutorial_completed" onClose={closeTutorial} accentColor="purple" finishLabel="Start Closing" />}
    </div>
  );
}