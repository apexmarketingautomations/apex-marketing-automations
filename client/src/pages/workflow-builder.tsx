import { PlanGate } from "@/components/plan-gate";
import { useState } from "react";
import { Clock, MessageSquare, GitFork, MoreHorizontal, PlayCircle, CheckCircle2, AlertCircle, AlertTriangle, Sparkles, Loader2, Code2, Trash2, BookOpen, Target, Mail, UserPlus, TrendingUp, Bell, Globe, Zap, Terminal, Cpu, Brain, ChevronDown, Eye, Power, Archive, ShoppingCart, Volume2 } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { WORKFLOW_STEPS } from "@/components/tutorial-steps";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import type { Workflow, LiveAutomation } from "@shared/schema";
import { WorkflowCompilerVisualizer, type Manifest } from "@/components/workflow-compiler-visualizer";

const DEFAULT_WORKFLOW = {
  trigger: "manual_trigger",
  steps: [] as any[]
};

const StepIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "WAIT": return <Clock className="h-5 w-5 text-amber-500" />;
    case "SMS": return <MessageSquare className="h-5 w-5 text-blue-500" />;
    case "SendTwilioSMS": return <MessageSquare className="h-5 w-5 text-blue-500" />;
    case "CONDITION": return <GitFork className="h-5 w-5 text-purple-500" />;
    case "Condition": return <GitFork className="h-5 w-5 text-purple-500" />;
    case "ALERT": return <AlertCircle className="h-5 w-5 text-red-500" />;
    case "AlertTeam": return <Bell className="h-5 w-5 text-red-500" />;
    case "CODE": return <Code2 className="h-5 w-5 text-emerald-500" />;
    case "DeployMetaAd": return <Target className="h-5 w-5 text-pink-500" />;
    case "SendEmail": return <Mail className="h-5 w-5 text-cyan-500" />;
    case "CreateContact": return <UserPlus className="h-5 w-5 text-emerald-500" />;
    case "UpdateDeal": return <TrendingUp className="h-5 w-5 text-orange-500" />;
    case "WebhookCall": return <Globe className="h-5 w-5 text-indigo-500" />;
    case "AIGenerate": return <Sparkles className="h-5 w-5 text-violet-500" />;
    case "ElevenLabsTTS": return <Volume2 className="h-5 w-5 text-fuchsia-500" />;
    case "Wait": return <Clock className="h-5 w-5 text-amber-500" />;
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
          <div className="p-2 rounded-lg bg-secondary/50 group-hover:bg-secondary transition-colors">
            <StepIcon type={step.action_type} />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-semibold text-sm text-foreground">{label}</h4>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {step.action_type === "WAIT" && `${step.params.duration_minutes} min`}
                  {step.action_type === "Wait" && `${step.params.duration_minutes} min`}
                  {(step.action_type === "SMS" || step.action_type === "SendTwilioSMS") && `"${(step.params.body || "").slice(0, 50)}"`}
                  {(step.action_type === "CONDITION" || step.action_type === "Condition") && `Check: ${step.params.check}`}
                  {(step.action_type === "ALERT" || step.action_type === "AlertTeam") && `Notify: ${step.params.user_id || step.params.message?.slice(0, 30) || "team"}`}
                  {step.action_type === "CODE" && <span className="text-emerald-400">Custom Code</span>}
                  {step.action_type === "DeployMetaAd" && <span className="text-pink-400">{step.params.campaign_name || "Geo Ad"}</span>}
                  {step.action_type === "SendEmail" && <span className="text-cyan-400">{step.params.subject || "Email"}</span>}
                  {step.action_type === "CreateContact" && <span className="text-emerald-400">{step.params.first_name || "Contact"}</span>}
                  {step.action_type === "WebhookCall" && <span className="text-indigo-400">{step.params.url?.slice(0, 30) || "Webhook"}</span>}
                  {step.action_type === "AIGenerate" && <span className="text-violet-400">AI Generate</span>}
                  {step.action_type === "ElevenLabsTTS" && <span className="text-fuchsia-400">{step.params.text?.slice(0, 40) || "Voice Message"}</span>}
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

function AiArchitectPanel({ onAutomationCreated }: { onAutomationCreated: (automation: any) => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [builtManifest, setBuiltManifest] = useState<Manifest | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const EXAMPLE_PROMPTS = [
    "When a Big Rig crash is detected near Fort Myers, SMS the PI attorney team, wait 5 minutes, check if the lead was claimed, then deploy a geo-targeted Meta ad around the crash site.",
    "When a new lead fills out a form, wait 2 minutes, send a welcome SMS, then check if they replied. If yes, create a deal. If no, wait 1 hour and send a follow-up.",
    "When a review is received, alert the team via SMS. If rating is below 3, escalate to manager. Otherwise, send a thank you email.",
    "When a Shopify cart is abandoned, wait 30 minutes, then send an SMS with their cart recovery link. If no purchase after 2 hours, send a follow-up email with a discount code.",
    "When a Shopify order is fulfilled, wait 7 days then send a review request email to the customer.",
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsBuilding(true);
    setBuiltManifest(null);
    setIsAnimating(false);

    try {
      const result = await api.generateAutomation({ prompt });
      const manifest = result.manifest as Manifest;
      setBuiltManifest(manifest);
      setIsAnimating(true);

      toast({
        title: "Automation compiled",
        description: `"${result.name}" built with ${result.stepCount} steps.`,
      });
      onAutomationCreated(result);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Build failed",
        description: err.message || "AI could not compile the automation.",
      });
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border border-cyan-500/20 rounded-xl bg-gradient-to-br from-cyan-500/5 to-indigo-500/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">AI System Architect</h3>
        </div>
        <p className="text-xs text-white/50">
          Describe your automation in plain English. The AI will design, wire, and compile a complete workflow manifest.
        </p>
        <Textarea
          data-testid="input-architect-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. When a Big Rig crash is detected, alert my PI team, wait 5 min, check CRM for claim, then deploy a geo-ad..."
          className="min-h-[100px] bg-black/30 border-white/10 text-white/80 placeholder:text-white/30 resize-none"
        />
        <div className="flex gap-2">
          <Button
            data-testid="button-architect-build"
            onClick={handleGenerate}
            disabled={isBuilding || !prompt.trim()}
            className="bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white border-0"
          >
            {isBuilding ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Compiling...</>
            ) : (
              <><Cpu className="mr-2 h-4 w-4" />Build Automation</>
            )}
          </Button>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-white/30 uppercase tracking-wider">Quick prompts:</p>
          {EXAMPLE_PROMPTS.map((ex, i) => (
            <button
              key={i}
              onClick={() => setPrompt(ex)}
              className="block w-full text-left text-[11px] text-white/40 hover:text-cyan-400 transition-colors truncate py-0.5"
              data-testid={`button-example-prompt-${i}`}
            >
              {ex.slice(0, 100)}...
            </button>
          ))}
        </div>
      </div>

      {builtManifest && (
        <div className="border border-white/10 rounded-xl bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
                {builtManifest.name}
              </span>
            </div>
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
              COMPILED
            </Badge>
          </div>
          {builtManifest.description && (
            <p className="text-[11px] text-white/40">{builtManifest.description}</p>
          )}
          <WorkflowCompilerVisualizer
            manifest={builtManifest}
            isBuilding={isAnimating}
            onComplete={() => setIsAnimating(false)}
          />
        </div>
      )}
    </div>
  );
}

function AiToolbeltPanel() {
  const { toast } = useToast();
  const [command, setCommand] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [showTools, setShowTools] = useState(false);

  const { data: toolsData } = useQuery({
    queryKey: ["/api/v1/tools"],
    queryFn: api.getAiTools,
  });

  const EXAMPLE_COMMANDS = [
    "I just signed a lawyer in Tampa. Set him up with a 50-mile crash geofence and a Vapi intro call for every commercial wreck.",
    "Create a sub-account for Dr. Smith's dental practice, set up a welcome SMS workflow, and provision a 239 area code Vapi line.",
    "Check all active workflows and get the latest crash logs for Lee County.",
    "Deploy a geo-targeted ad around Fort Myers with $50 daily budget for PI leads.",
  ];

  const handleOrchestrate = async () => {
    if (!command.trim()) return;
    setIsProcessing(true);
    setExecutionResult(null);

    try {
      const result = await api.orchestrateAi(command);
      setExecutionResult(result);

      const successCount = result.successCount || 0;
      const totalSteps = result.totalSteps || 0;

      toast({
        title: successCount === totalSteps ? "All actions completed" : `${successCount}/${totalSteps} actions completed`,
        description: result.summary || result.interpretation,
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Orchestration failed", description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDirectAction = async (action: string, payload: any = {}) => {
    setIsProcessing(true);
    try {
      const result = await api.orchestrate(action, payload);
      setExecutionResult({ steps: [{ step: 1, action, status: result.status, result, description: result.message }], summary: result.message, totalSteps: 1, successCount: result.status === "Success" ? 1 : 0 });
      toast({ title: result.message || "Action completed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Action failed", description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const stepStatusIcon = (status: string) => {
    if (status === "Success") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    if (status === "Error") return <AlertCircle className="h-4 w-4 text-red-400" />;
    return <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />;
  };

  return (
    <div className="space-y-4">
      <div className="border border-violet-500/20 rounded-xl bg-gradient-to-br from-violet-950/40 to-indigo-950/40 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20">
            <Terminal className="h-6 w-6 text-violet-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white/90">Global Command Menu</h3>
            <p className="text-xs text-white/40">Tell Apex what to do. It will orchestrate everything automatically.</p>
          </div>
        </div>

        <div className="relative">
          <Textarea
            data-testid="input-global-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder='"Apex, I just signed a lawyer in Tampa. Set him up with a 50-mile crash geofence and a Vapi intro call for every commercial wreck."'
            className="min-h-[80px] bg-black/40 border-white/10 text-white/90 placeholder:text-white/25 resize-none pr-16 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleOrchestrate();
              }
            }}
          />
          <Button
            data-testid="button-orchestrate"
            onClick={handleOrchestrate}
            disabled={isProcessing || !command.trim()}
            className="absolute bottom-2 right-2 bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white border-0 shadow-lg shadow-violet-500/20"
            size="sm"
          >
            {isProcessing ? (
              <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Executing...</>
            ) : (
              <><Zap className="mr-1 h-3.5 w-3.5" />Execute</>
            )}
          </Button>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] text-white/25 uppercase tracking-wider">Try saying:</p>
          {EXAMPLE_COMMANDS.map((ex, i) => (
            <button
              key={i}
              onClick={() => setCommand(ex)}
              className="block w-full text-left text-[11px] text-white/35 hover:text-violet-400 transition-colors py-0.5 leading-relaxed"
              data-testid={`button-example-command-${i}`}
            >
              "{ex.slice(0, 110)}{ex.length > 110 ? '...' : ''}"
            </button>
          ))}
        </div>
      </div>

      {isProcessing && !executionResult && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-cyan-500/20 rounded-xl bg-black/30 p-4"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-8 w-8 rounded-full border-2 border-cyan-500/30 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              </div>
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-cyan-400/20"
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div>
              <p className="text-sm text-cyan-400 font-medium">Apex is thinking...</p>
              <p className="text-[10px] text-white/30">AI is analyzing your command and building an execution plan</p>
            </div>
          </div>
        </motion.div>
      )}

      {executionResult && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-white/10 rounded-xl bg-black/20 overflow-hidden"
          data-testid="orchestration-result"
        >
          <div className="p-3 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold text-white/80 uppercase tracking-wider">Orchestration Complete</span>
              </div>
              <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                {executionResult.successCount ?? 0}/{executionResult.totalSteps ?? 0} OK
              </Badge>
            </div>
            {executionResult.interpretation && (
              <p className="text-[11px] text-white/50 mt-1">{executionResult.interpretation}</p>
            )}
          </div>

          <div className="p-3 space-y-2">
            {executionResult.steps?.map((step: any, i: number) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className={`flex items-start gap-3 p-2.5 rounded-lg border ${
                  step.status === "Success"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-red-500/20 bg-red-500/5"
                }`}
                data-testid={`orchestration-step-${i}`}
              >
                {stepStatusIcon(step.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-white/60 uppercase">{step.action}</span>
                    <Badge variant="outline" className={`text-[8px] ${step.status === "Success" ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400"}`}>
                      {step.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-white/40 mt-0.5">{step.description}</p>
                  {step.result?.message && step.result.message !== step.description && (
                    <p className="text-[10px] text-white/30 mt-0.5 font-mono">{step.result.message}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {executionResult.summary && (
            <div className="px-3 pb-3">
              <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                <p className="text-[11px] text-white/50">
                  <span className="text-cyan-400 font-medium">Apex:</span> {executionResult.summary}
                </p>
              </div>
            </div>
          )}
        </motion.div>
      )}

      <div className="border border-white/10 rounded-xl bg-black/20 overflow-hidden">
        <button
          onClick={() => setShowTools(!showTools)}
          className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
          data-testid="button-toggle-tools"
        >
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-white/30" />
            <span className="text-xs font-medium text-white/50">Direct Actions ({toolsData?.count || 0} tools)</span>
          </div>
          <ChevronDown className={`h-3 w-3 text-white/30 transition-transform ${showTools ? "rotate-180" : ""}`} />
        </button>

        <AnimatePresence>
          {showTools && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-3 border-t border-white/5 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { action: "trigger_geofence", label: "Scan Crashes", icon: <AlertCircle className="h-3 w-3" />, color: "text-red-400 border-red-500/20 hover:bg-red-500/10" },
                    { action: "check_workflow_status", label: "Check Status", icon: <Eye className="h-3 w-3" />, color: "text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/10" },
                    { action: "get_crash_logs", label: "Crash Logs", icon: <AlertTriangle className="h-3 w-3" />, color: "text-amber-400 border-amber-500/20 hover:bg-amber-500/10" },
                    { action: "provision_vapi_line", label: "New Phone Line", icon: <Zap className="h-3 w-3" />, color: "text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10" },
                  ].map(({ action, label, icon, color }) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      className={`justify-start text-xs ${color}`}
                      onClick={() => handleDirectAction(action)}
                      disabled={isProcessing}
                      data-testid={`button-direct-${action}`}
                    >
                      {icon}
                      <span className="ml-1.5">{label}</span>
                    </Button>
                  ))}
                </div>
                {toolsData?.tools && (
                  <div className="grid grid-cols-2 gap-1">
                    {toolsData.tools.map((tool: any) => (
                      <button
                        key={tool.name}
                        onClick={() => handleDirectAction(tool.name.replace(/_/g, "_"), { tool_name: tool.name })}
                        className="text-left p-1.5 rounded-md border border-white/5 hover:border-violet-500/20 hover:bg-violet-500/5 transition-all group"
                        data-testid={`button-tool-${tool.name}`}
                      >
                        <span className="text-[9px] font-mono text-violet-400/70 group-hover:text-violet-300">{tool.name}</span>
                        <p className="text-[8px] text-white/20 mt-0.5 truncate">{tool.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LiveAutomationsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedAutomation, setSelectedAutomation] = useState<LiveAutomation | null>(null);

  const { data: automations = [], isLoading } = useQuery<LiveAutomation[]>({
    queryKey: ["/api/v1/compiler"],
    queryFn: () => api.getLiveAutomations(),
  });

  const activateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.updateLiveAutomation(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/compiler"] });
      toast({ title: "Status updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteLiveAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/compiler"] });
      setSelectedAutomation(null);
      toast({ title: "Automation deleted" });
    },
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-white/30" /></div>;

  return (
    <div className="space-y-3">
      {automations.length === 0 ? (
        <div className="text-center py-8 text-white/30 border border-dashed border-white/10 rounded-xl">
          <Cpu className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No live automations yet.</p>
          <p className="text-xs mt-1">Use the AI Architect to build your first one.</p>
        </div>
      ) : (
        automations.map((auto) => {
          const manifest = auto.manifest as any;
          const isSelected = selectedAutomation?.id === auto.id;
          return (
            <motion.div
              key={auto.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="border border-white/10 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setSelectedAutomation(isSelected ? null : auto)}
                className="w-full text-left p-3 hover:bg-white/5 transition-colors"
                data-testid={`automation-card-${auto.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className={`h-4 w-4 ${auto.status === 'active' ? 'text-emerald-400' : 'text-white/30'}`} />
                    <span className="text-sm font-medium text-white/80">{auto.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        auto.status === 'active' ? 'border-emerald-500/30 text-emerald-400' :
                        auto.status === 'paused' ? 'border-amber-500/30 text-amber-400' :
                        'border-white/20 text-white/40'
                      }`}
                    >
                      {auto.status}
                    </Badge>
                    <ChevronDown className={`h-3 w-3 text-white/30 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                {manifest?.trigger && (
                  <p className="text-[10px] text-white/30 mt-1">
                    Trigger: {manifest.trigger.type} | {manifest.steps?.length || 0} steps
                  </p>
                )}
              </button>

              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-white/10 overflow-hidden"
                  >
                    <div className="p-3 space-y-3">
                      <WorkflowCompilerVisualizer
                        manifest={manifest}
                        isBuilding={false}
                      />
                      <div className="flex gap-2">
                        {auto.status !== "active" && (
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-500 text-xs"
                            onClick={() => activateMutation.mutate({ id: auto.id, status: "active" })}
                            data-testid={`button-activate-${auto.id}`}
                          >
                            <Power className="h-3 w-3 mr-1" /> Activate
                          </Button>
                        )}
                        {auto.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-amber-500/30 text-amber-400"
                            onClick={() => activateMutation.mutate({ id: auto.id, status: "paused" })}
                            data-testid={`button-pause-${auto.id}`}
                          >
                            <Clock className="h-3 w-3 mr-1" /> Pause
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs border-white/10 text-white/40"
                          onClick={() => activateMutation.mutate({ id: auto.id, status: "archived" })}
                          data-testid={`button-archive-${auto.id}`}
                        >
                          <Archive className="h-3 w-3 mr-1" /> Archive
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-red-400 hover:text-red-300 ml-auto"
                          onClick={() => deleteMutation.mutate(auto.id)}
                          data-testid={`button-delete-automation-${auto.id}`}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </div>
                      <details className="text-[10px]">
                        <summary className="text-white/30 cursor-pointer hover:text-white/50">Raw Manifest</summary>
                        <pre className="mt-2 text-[9px] text-white/40 font-mono bg-black/30 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                          {JSON.stringify(manifest, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })
      )}
    </div>
  );
}

function WorkflowBuilderInner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_workflows");
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState("When a lead fills the Facebook form, wait 5 mins, then SMS them 'Hey {{name}}, thanks for your interest!' If they reply, alert me.");
  const [activeTab, setActiveTab] = useState("editor");

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
    createMutation.mutate({ name: "New Workflow", trigger: "manual_trigger", steps: [] });
    setSelectedStepIndex(null);
  };

  const handleAddStep = (type: string) => {
    const stepDefaults: Record<string, any> = {
      WAIT: { action_type: "WAIT", params: { duration_minutes: 5 } },
      SMS: { action_type: "SMS", params: { body: "Hello!" } },
      CONDITION: { action_type: "CONDITION", params: { check: "has_replied" } },
      ALERT: { action_type: "ALERT", params: { user_id: "admin" } },
      CODE: { action_type: "CODE", params: { language: "javascript", code: "// Custom code\nconsole.log('Running...');", description: "Custom code execution" } },
      SendTwilioSMS: { action_type: "SendTwilioSMS", params: { body: "Hello {{lead_name}}!", to_role: "marketer" } },
      Wait: { action_type: "Wait", params: { duration_minutes: 5 } },
      Condition: { action_type: "Condition", params: { check: "lead_claimed", operator: "equals", value: true } },
      DeployMetaAd: { action_type: "DeployMetaAd", params: { campaign_name: "Geo Campaign", radius_miles: 1, budget_daily: 25, use_incident_coords: true } },
      AlertTeam: { action_type: "AlertTeam", params: { message: "New alert!", channel: "sms" } },
      CreateContact: { action_type: "CreateContact", params: { first_name: "", source: "automation" } },
      SendEmail: { action_type: "SendEmail", params: { subject: "Follow Up", body: "Hello!" } },
      WebhookCall: { action_type: "WebhookCall", params: { url: "https://", method: "POST" } },
      AIGenerate: { action_type: "AIGenerate", params: { prompt: "Generate a response", output_field: "ai_message" } },
      ElevenLabsTTS: { action_type: "ElevenLabsTTS", params: { text: "Hello, this is a voice message.", voice_id: "EXAVITQu4vr4xnSDxMaL" } },
    };

    const newStep = stepDefaults[type];
    if (!newStep) return;

    if (currentWorkflow) {
      const newSteps = [...steps, newStep];
      updateMutation.mutate({ id: currentWorkflow.id, data: { steps: newSteps } });
    } else {
      createMutation.mutate({ name: "New Workflow", trigger: "manual_trigger", steps: [newStep] });
    }
  };

  const handleUpdateStep = (index: number, updatedStep: any) => {
    if (!currentWorkflow) return;
    const newSteps = [...steps];
    newSteps[index] = updatedStep;
    updateMutation.mutate({ id: currentWorkflow.id, data: { steps: newSteps } });
  };

  const handleDeleteStep = (index: number) => {
    if (!currentWorkflow) return;
    const newSteps = steps.filter((_: any, i: number) => i !== index);
    updateMutation.mutate({ id: currentWorkflow.id, data: { steps: newSteps } });
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
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workflow Command Center</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Build, wire, and deploy intelligent automations
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
          <Button data-testid="button-discard" variant="outline" size="sm" onClick={handleDiscard}>Discard</Button>
          <Button data-testid="button-publish" variant="secondary" size="sm" onClick={handlePublish} disabled={!currentWorkflow || updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}
            Publish
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-black/30 border border-white/10">
          <TabsTrigger value="editor" className="data-[state=active]:bg-white/10 data-[state=active]:text-white gap-1.5" data-testid="tab-editor">
            <GitFork className="h-3.5 w-3.5" /> Editor
          </TabsTrigger>
          <TabsTrigger value="architect" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 gap-1.5" data-testid="tab-architect">
            <Brain className="h-3.5 w-3.5" /> AI Architect
          </TabsTrigger>
          <TabsTrigger value="toolbelt" className="data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-400 gap-1.5" data-testid="tab-toolbelt">
            <Terminal className="h-3.5 w-3.5" /> Toolbelt
          </TabsTrigger>
          <TabsTrigger value="live" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 gap-1.5" data-testid="tab-live">
            <Zap className="h-3.5 w-3.5" /> Live Automations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center">
                <div className="flex justify-center flex-1">
                  <div className="bg-foreground text-background px-5 py-2.5 rounded-full text-sm font-medium shadow-lg flex items-center gap-2">
                    {displayWorkflow.trigger?.startsWith("shopify_") ? (
                      <ShoppingCart className="h-4 w-4 text-green-400" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                    Trigger: {displayWorkflow.trigger}
                  </div>
                </div>
                <Dialog open={isAiDialogOpen} onOpenChange={setIsAiDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-generate-ai" size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white border-0">
                      <Sparkles className="mr-1 h-3.5 w-3.5" /> AI Generate
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        Generate Workflow
                      </DialogTitle>
                      <DialogDescription>
                        Describe your automation in plain English.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Textarea
                        data-testid="input-ai-prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="min-h-[120px] resize-none"
                        placeholder="e.g. When a user signs up, wait 1 day and send a welcome email..."
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="secondary" onClick={() => setIsAiDialogOpen(false)}>Cancel</Button>
                      <Button data-testid="button-generate-submit" onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}>
                        {isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Building...</> : <><Sparkles className="mr-2 h-4 w-4" />Generate</>}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-4 max-w-md mx-auto relative pb-16">
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
                      { type: "DeployMetaAd", label: "Meta Ad", icon: <Target className="h-3 w-3" />, color: "text-pink-500 border-pink-500/30 hover:bg-pink-500/10" },
                      { type: "SendEmail", label: "Email", icon: <Mail className="h-3 w-3" />, color: "text-cyan-500 border-cyan-500/30 hover:bg-cyan-500/10" },
                      { type: "WebhookCall", label: "Webhook", icon: <Globe className="h-3 w-3" />, color: "text-indigo-500 border-indigo-500/30 hover:bg-indigo-500/10" },
                      { type: "ElevenLabsTTS", label: "Voice TTS", icon: <Volume2 className="h-3 w-3" />, color: "text-fuchsia-500 border-fuchsia-500/30 hover:bg-fuchsia-500/10" },
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
              <Card className="sticky top-6 border-border h-[calc(100vh-12rem)]">
                <CardContent className="p-4 h-full flex flex-col overflow-y-auto">
                  {selectedStep && selectedStepIndex !== null ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300" key={selectedStepIndex}>
                      <div className="flex items-center gap-3 border-b border-border pb-3">
                        <div className="p-2 bg-secondary rounded-md">
                          <StepIcon type={selectedStep.action_type} />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">{selectedStep.action_type} Step</h3>
                        </div>
                        <Button data-testid="button-delete-step" variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => handleDeleteStep(selectedStepIndex)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-3">
                        {(selectedStep.action_type === "WAIT" || selectedStep.action_type === "Wait") && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Duration (Minutes)</label>
                            <Input data-testid="input-wait-duration" type="number" min={1} value={selectedStep.params.duration_minutes}
                              onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, duration_minutes: parseInt(e.target.value) || 1 } })} />
                          </div>
                        )}

                        {(selectedStep.action_type === "SMS" || selectedStep.action_type === "SendTwilioSMS") && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Message Body</label>
                              <Textarea data-testid="input-sms-body" value={selectedStep.params.body} className="min-h-[80px]"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                            {selectedStep.action_type === "SendTwilioSMS" && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">To (role or phone)</label>
                                <Input data-testid="input-sms-to" value={selectedStep.params.to_role || selectedStep.params.to || ""}
                                  onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, to_role: e.target.value } })} />
                              </div>
                            )}
                          </>
                        )}

                        {(selectedStep.action_type === "CONDITION" || selectedStep.action_type === "Condition") && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Condition Check</label>
                            <Input data-testid="input-condition-check" value={selectedStep.params.check}
                              onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, check: e.target.value } })} />
                          </div>
                        )}

                        {(selectedStep.action_type === "ALERT" || selectedStep.action_type === "AlertTeam") && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">{selectedStep.action_type === "AlertTeam" ? "Message" : "User ID"}</label>
                            <Input data-testid="input-alert-user" value={selectedStep.params.message || selectedStep.params.user_id || ""}
                              onChange={(e) => {
                                const key = selectedStep.action_type === "AlertTeam" ? "message" : "user_id";
                                handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, [key]: e.target.value } });
                              }} />
                          </div>
                        )}

                        {selectedStep.action_type === "DeployMetaAd" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Campaign Name</label>
                              <Input data-testid="input-meta-campaign" value={selectedStep.params.campaign_name || ""}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, campaign_name: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Radius (miles)</label>
                              <Input data-testid="input-meta-radius" type="number" value={selectedStep.params.radius_miles || 1}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, radius_miles: parseFloat(e.target.value) || 1 } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Daily Budget ($)</label>
                              <Input data-testid="input-meta-budget" type="number" value={selectedStep.params.budget_daily || 25}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, budget_daily: parseFloat(e.target.value) || 25 } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Ad Copy</label>
                              <Textarea data-testid="input-meta-adcopy" value={selectedStep.params.ad_copy || ""}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, ad_copy: e.target.value } })} />
                            </div>
                          </>
                        )}

                        {selectedStep.action_type === "SendEmail" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Subject</label>
                              <Input data-testid="input-email-subject" value={selectedStep.params.subject || ""}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, subject: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Body</label>
                              <Textarea data-testid="input-email-body" value={selectedStep.params.body || ""} className="min-h-[80px]"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                          </>
                        )}

                        {selectedStep.action_type === "WebhookCall" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">URL</label>
                              <Input data-testid="input-webhook-url" value={selectedStep.params.url || ""}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, url: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Method</label>
                              <Input data-testid="input-webhook-method" value={selectedStep.params.method || "POST"}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, method: e.target.value } })} />
                            </div>
                          </>
                        )}

                        {selectedStep.action_type === "CODE" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Description</label>
                              <Input data-testid="input-code-desc" value={selectedStep.params.description || ""}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, description: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Code</label>
                              <Textarea data-testid="input-code-editor" value={selectedStep.params.code || ""} className="min-h-[160px] font-mono text-xs bg-slate-950 text-emerald-400 border-slate-800"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, code: e.target.value } })} />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="mt-auto pt-4 border-t border-border">
                        <details>
                          <summary className="text-xs text-muted-foreground cursor-pointer">Raw Data</summary>
                          <pre className="text-[10px] bg-slate-950 text-slate-50 p-2 rounded-md overflow-x-auto font-mono mt-2">
                            {JSON.stringify(selectedStep, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-4">
                      <div className="h-16 w-16 rounded-full bg-secondary/50 flex items-center justify-center">
                        <GitFork className="h-8 w-8 opacity-20" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">No Step Selected</h3>
                        <p className="text-sm mt-1">Click on a step to edit its properties.</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="architect">
          <div className="max-w-3xl mx-auto">
            <AiArchitectPanel onAutomationCreated={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/v1/compiler"] });
            }} />
          </div>
        </TabsContent>

        <TabsContent value="toolbelt">
          <div className="max-w-3xl mx-auto">
            <AiToolbeltPanel />
          </div>
        </TabsContent>

        <TabsContent value="live">
          <div className="max-w-3xl mx-auto">
            <LiveAutomationsPanel />
          </div>
        </TabsContent>
      </Tabs>

      {showTutorial && <TutorialOverlay steps={WORKFLOW_STEPS} storageKey="apex_tutorial_workflows" onClose={closeTutorial} accentColor="indigo" />}
    </div>
  );
}

export default function WorkflowBuilder() {
  return <PlanGate feature="workflows"><WorkflowBuilderInner /></PlanGate>;
}
