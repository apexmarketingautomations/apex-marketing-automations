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
import { Plus, Trash2, GripVertical, Users, Loader2, Layers, Info } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { PIPELINE_STEPS } from "@/components/tutorial-steps";


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
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
}

const DEFAULT_STAGES = [
  { name: "New Lead", color: "#06b6d4", position: 0 },
  { name: "Contacted", color: "#818cf8", position: 1 },
  { name: "Qualified", color: "#a78bfa", position: 2 },
  { name: "Closed Won", color: "#34d399", position: 3 },
];

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

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
    enabled: !!subAccountId,
  });

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
    return contact?.name || null;
  };

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const isLoading = stagesLoading || dealsLoading;

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
      <div className="max-w-full mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <Layers size={12} /> CRM PIPELINE
          </div>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-pipeline-title">
                <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Pipeline</span>
              </h1>
              <button onClick={startTutorial} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5" data-testid="button-start-tutorial"><Info size={14} className="mr-1" /> Tutorial</button>
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
                          <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
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
            onClick={() => setActiveTab("contacts")}
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
                <p className="text-slate-400 text-sm mb-6">Get started by creating your pipeline stages</p>
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
              <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
                {sortedStages.map((stage) => {
                  const stageDeals = deals.filter((d) => d.stageId === stage.id);
                  return (
                    <motion.div
                      key={stage.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="min-w-[280px] w-[280px] flex-shrink-0"
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
                          <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full" data-testid={`stage-count-${stage.id}`}>
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
                                      <p className="text-xs text-slate-500 mt-1 truncate" data-testid={`deal-contact-${deal.id}`}>
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
              <CardHeader>
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Users size={18} className="text-indigo-400" />
                  Contacts ({contacts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {contacts.length === 0 ? (
                  <div className="text-center py-10">
                    <Users size={48} className="mx-auto mb-4 text-white/10" />
                    <p className="text-slate-400 text-sm">No contacts yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-3 px-3 text-slate-400 font-medium">Name</th>
                          <th className="text-left py-3 px-3 text-slate-400 font-medium">Email</th>
                          <th className="text-left py-3 px-3 text-slate-400 font-medium">Phone</th>
                          <th className="text-left py-3 px-3 text-slate-400 font-medium">Company</th>
                          <th className="text-left py-3 px-3 text-slate-400 font-medium">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contacts.map((contact) => (
                          <tr key={contact.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors" data-testid={`contact-row-${contact.id}`}>
                            <td className="py-3 px-3 text-white font-medium" data-testid={`contact-name-${contact.id}`}>{contact.name}</td>
                            <td className="py-3 px-3 text-slate-400" data-testid={`contact-email-${contact.id}`}>{contact.email}</td>
                            <td className="py-3 px-3 text-slate-400" data-testid={`contact-phone-${contact.id}`}>{contact.phone || "—"}</td>
                            <td className="py-3 px-3 text-slate-400" data-testid={`contact-company-${contact.id}`}>{contact.company || "—"}</td>
                            <td className="py-3 px-3">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" data-testid={`contact-source-${contact.id}`}>
                                {contact.source || "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
      </div>
      {showTutorial && <TutorialOverlay steps={PIPELINE_STEPS} storageKey="apex_pipeline_tutorial_completed" onClose={closeTutorial} accentColor="purple" finishLabel="Start Closing" />}
    </div>
  );
}
