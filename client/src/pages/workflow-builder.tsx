import { PlanGate } from "@/components/plan-gate";
import { useState } from "react";
import { Clock, MessageSquare, GitFork, MoreHorizontal, Plus, PlayCircle, CheckCircle2, AlertCircle, Sparkles, Loader2, Code2, Trash2, BookOpen } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { WORKFLOW_STEPS } from "@/components/tutorial-steps";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import type { Workflow } from "@shared/schema";

const DEFAULT_WORKFLOW = {
  trigger: "manual_trigger",
  steps: [] as any[]
};

const StepIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "WAIT": return <Clock className="h-5 w-5 text-amber-500" />;
    case "SMS": return <MessageSquare className="h-5 w-5 text-blue-500" />;
    case "CONDITION": return <GitFork className="h-5 w-5 text-purple-500" />;
    case "ALERT": return <AlertCircle className="h-5 w-5 text-red-500" />;
    case "CODE": return <Code2 className="h-5 w-5 text-emerald-500" />;
    default: return <CheckCircle2 className="h-5 w-5 text-gray-400" />;
  }
};

const StepCard = ({ step, index, onClick, isSelected }: { step: any, index: number, onClick: () => void, isSelected: boolean }) => {
  const label = step.action_type;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="relative group cursor-pointer"
      onClick={onClick}
    >
      <Card className={`border-border shadow-sm hover:shadow-md transition-shadow duration-200 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
        <CardContent className="p-4 flex items-start gap-4">
          <div className={`p-2 rounded-lg bg-secondary/50 group-hover:bg-secondary transition-colors`}>
            <StepIcon type={step.action_type} />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-semibold text-sm text-foreground">{label}</h4>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {step.action_type === "WAIT" && `${step.params.duration_minutes} min`}
                  {step.action_type === "SMS" && `"${step.params.body}"`}
                  {step.action_type === "CONDITION" && `Check: ${step.params.check}`}
                  {step.action_type === "ALERT" && `Notify: ${step.params.user_id}`}
                  {step.action_type === "CODE" && <span className="text-emerald-400">Custom Code</span>}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="absolute left-8 top-full h-8 w-0.5 bg-border -z-10 group-last:hidden" />
    </motion.div>
  );
};

function WorkflowBuilderInner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_workflows");
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("When a lead fills the Facebook form, wait 5 mins, then SMS them 'Hey {{name}}, thanks for your interest!' If they reply, alert me.");

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["/api/workflows"],
    queryFn: api.getWorkflows,
  });

  const currentWorkflow = workflows.length > 0 ? workflows[0] : null;
  const displayWorkflow = currentWorkflow ?? DEFAULT_WORKFLOW;
  const steps = Array.isArray(displayWorkflow.steps) ? displayWorkflow.steps : [];
  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;

  const createMutation = useMutation({
    mutationFn: (data: { name: string; trigger: string; steps: any; subAccountId?: number | null }) =>
      api.createWorkflow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ name: string; trigger: string; steps: any }> }) =>
      api.updateWorkflow(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
  });

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/workflows/generate", { prompt });
      const wf = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setIsAiDialogOpen(false);
      setSelectedStepIndex(null);
      toast({
        title: "Workflow generated",
        description: `"${wf.name}" created with ${Array.isArray(wf.steps) ? wf.steps.length : 0} steps by AI.`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Generation failed",
        description: err.message || "Could not generate workflow. Try again.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = () => {
    if (!currentWorkflow) return;
    updateMutation.mutate({
      id: currentWorkflow.id,
      data: {
        name: currentWorkflow.name,
        trigger: currentWorkflow.trigger,
        steps: currentWorkflow.steps,
      },
    });
    toast({ title: "Workflow saved", description: "Your workflow has been published." });
  };

  const handleDiscard = () => {
    createMutation.mutate({
      name: "New Workflow",
      trigger: "manual_trigger",
      steps: [],
    });
    setSelectedStepIndex(null);
  };

  const handleAddStep = (type: string) => {
    const stepDefaults: Record<string, any> = {
      WAIT: { action_type: "WAIT", params: { duration_minutes: 5 } },
      SMS: { action_type: "SMS", params: { body: "Hello!" } },
      CONDITION: { action_type: "CONDITION", params: { check: "has_replied" } },
      ALERT: { action_type: "ALERT", params: { user_id: "admin" } },
      CODE: { action_type: "CODE", params: { language: "javascript", code: "// Write your custom code here\n// Available variables: contact, workflow, context\n\nconsole.log('Running custom step...');", description: "Custom code execution" } },
    };

    const newStep = stepDefaults[type];
    if (!newStep) return;

    if (currentWorkflow) {
      const newSteps = [...steps, newStep];
      updateMutation.mutate({
        id: currentWorkflow.id,
        data: { steps: newSteps },
      });
    } else {
      createMutation.mutate({
        name: "New Workflow",
        trigger: "manual_trigger",
        steps: [newStep],
      });
    }
  };

  const handleUpdateStep = (index: number, updatedStep: any) => {
    if (!currentWorkflow) return;
    const newSteps = [...steps];
    newSteps[index] = updatedStep;
    updateMutation.mutate({
      id: currentWorkflow.id,
      data: { steps: newSteps },
    });
  };

  const handleDeleteStep = (index: number) => {
    if (!currentWorkflow) return;
    const newSteps = steps.filter((_: any, i: number) => i !== index);
    updateMutation.mutate({
      id: currentWorkflow.id,
      data: { steps: newSteps },
    });
    setSelectedStepIndex(null);
  };

  if (isLoading) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workflow Editor</h1>
          <p className="text-muted-foreground mt-1">
            Visualizing trigger: <code className="text-xs bg-muted px-1 py-0.5 rounded text-primary">{displayWorkflow.trigger}</code>
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
          <Dialog open={isAiDialogOpen} onOpenChange={setIsAiDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-generate-ai" className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0">
                <Sparkles className="mr-2 h-4 w-4" />
                Generate with AI
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  Generate Workflow
                </DialogTitle>
                <DialogDescription>
                  Describe your automation in plain English. AI will build a real workflow with smart steps.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Textarea 
                  data-testid="input-ai-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px] resize-none text-base"
                  placeholder="e.g. When a user signs up, wait 1 day and send a welcome email..."
                />
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setIsAiDialogOpen(false)}>Cancel</Button>
                <Button data-testid="button-generate-submit" onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      AI is building...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <Button data-testid="button-discard" variant="outline" onClick={handleDiscard}>Discard</Button>
          <Button data-testid="button-publish" variant="secondary" onClick={handlePublish} disabled={!currentWorkflow || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Publish
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        <div className="lg:col-span-2 space-y-8">
          
          <div className="flex justify-center mb-8">
            <div className="bg-foreground text-background px-6 py-3 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 animate-in zoom-in duration-300">
              <PlayCircle className="h-4 w-4" />
              Trigger: {displayWorkflow.trigger}
            </div>
          </div>
          
          <div className="space-y-4 max-w-md mx-auto relative pb-20">
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border/50 -z-20" />

            <AnimatePresence mode="popLayout">
              {steps.map((step: any, index: number) => (
                <StepCard 
                  key={`${index}-${step.action_type}`} 
                  step={step} 
                  index={index}
                  isSelected={selectedStepIndex === index}
                  onClick={() => setSelectedStepIndex(index)} 
                />
              ))}
            </AnimatePresence>

            {steps.length === 0 && (
              <div data-testid="text-empty-state" className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                <p>No steps yet. Use AI generation or add manually.</p>
              </div>
            )}

            <div className="flex justify-center pt-4">
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  { type: "WAIT", label: "Wait", icon: <Clock className="h-3 w-3" />, color: "text-amber-500 border-amber-500/30 hover:bg-amber-500/10" },
                  { type: "SMS", label: "SMS", icon: <MessageSquare className="h-3 w-3" />, color: "text-blue-500 border-blue-500/30 hover:bg-blue-500/10" },
                  { type: "CONDITION", label: "Condition", icon: <GitFork className="h-3 w-3" />, color: "text-purple-500 border-purple-500/30 hover:bg-purple-500/10" },
                  { type: "ALERT", label: "Alert", icon: <AlertCircle className="h-3 w-3" />, color: "text-red-500 border-red-500/30 hover:bg-red-500/10" },
                  { type: "CODE", label: "Code", icon: <Code2 className="h-3 w-3" />, color: "text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10" },
                ].map(({ type, label, icon, color }) => (
                  <Button
                    key={type}
                    data-testid={`button-add-step-${type.toLowerCase()}`}
                    variant="outline"
                    size="sm"
                    className={`rounded-full text-xs ${color}`}
                    onClick={() => handleAddStep(type)}
                  >
                    {icon}
                    <span className="ml-1">{label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-6 border-border h-[calc(100vh-8rem)]">
            <CardContent className="p-6 h-full flex flex-col overflow-y-auto">
              {selectedStep && selectedStepIndex !== null ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300" key={selectedStepIndex}>
                  <div className="flex items-center gap-3 border-b border-border pb-4">
                    <div className="p-2 bg-secondary rounded-md">
                      <StepIcon type={selectedStep.action_type} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{selectedStep.action_type} Step</h3>
                    </div>
                    <Button
                      data-testid="button-delete-step"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleDeleteStep(selectedStepIndex)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {selectedStep.action_type === "WAIT" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Duration (Minutes)</label>
                        <Input
                          data-testid="input-wait-duration"
                          type="number"
                          min={1}
                          value={selectedStep.params.duration_minutes}
                          onChange={(e) => {
                            const updated = { ...selectedStep, params: { ...selectedStep.params, duration_minutes: parseInt(e.target.value) || 1 } };
                            handleUpdateStep(selectedStepIndex, updated);
                          }}
                        />
                      </div>
                    )}

                    {selectedStep.action_type === "SMS" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Message Body</label>
                        <Textarea
                          data-testid="input-sms-body"
                          value={selectedStep.params.body}
                          className="min-h-[100px]"
                          onChange={(e) => {
                            const updated = { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } };
                            handleUpdateStep(selectedStepIndex, updated);
                          }}
                        />
                      </div>
                    )}

                    {selectedStep.action_type === "CONDITION" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Condition Check</label>
                        <Input
                          data-testid="input-condition-check"
                          value={selectedStep.params.check}
                          onChange={(e) => {
                            const updated = { ...selectedStep, params: { ...selectedStep.params, check: e.target.value } };
                            handleUpdateStep(selectedStepIndex, updated);
                          }}
                        />
                      </div>
                    )}

                    {selectedStep.action_type === "ALERT" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">User ID</label>
                        <Input
                          data-testid="input-alert-user"
                          value={selectedStep.params.user_id}
                          onChange={(e) => {
                            const updated = { ...selectedStep, params: { ...selectedStep.params, user_id: e.target.value } };
                            handleUpdateStep(selectedStepIndex, updated);
                          }}
                        />
                      </div>
                    )}

                    {selectedStep.action_type === "CODE" && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Description</label>
                          <Input
                            data-testid="input-code-desc"
                            value={selectedStep.params.description || ""}
                            onChange={(e) => {
                              const updated = { ...selectedStep, params: { ...selectedStep.params, description: e.target.value } };
                              handleUpdateStep(selectedStepIndex, updated);
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Code</label>
                          <Textarea
                            data-testid="input-code-editor"
                            value={selectedStep.params.code || ""}
                            className="min-h-[200px] font-mono text-xs bg-slate-950 text-emerald-400 border-slate-800"
                            onChange={(e) => {
                              const updated = { ...selectedStep, params: { ...selectedStep.params, code: e.target.value } };
                              handleUpdateStep(selectedStepIndex, updated);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-auto pt-6 border-t border-border">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Raw Data</h4>
                    <pre className="text-[10px] bg-slate-950 text-slate-50 p-3 rounded-md overflow-x-auto font-mono">
                      {JSON.stringify(selectedStep, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-4">
                  <div className="h-16 w-16 rounded-full bg-secondary/50 flex items-center justify-center">
                    <GitFork className="h-8 w-8 opacity-20" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">No Step Selected</h3>
                    <p className="text-sm mt-1">Click on a step in the workflow<br/>to view and edit its properties.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
      {showTutorial && <TutorialOverlay steps={WORKFLOW_STEPS} storageKey="apex_tutorial_workflows" onClose={closeTutorial} accentColor="indigo" />}
    </div>
  );
}

export default function WorkflowBuilder() {
  return <PlanGate feature="workflows"><WorkflowBuilderInner /></PlanGate>;
}
