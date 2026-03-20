import { PlanGate } from "@/components/plan-gate";
import { useState, useCallback, useMemo } from "react";
import { Clock, MessageSquare, GitFork, MoreHorizontal, PlayCircle, CheckCircle2, AlertCircle, AlertTriangle, Sparkles, Loader2, Code2, Trash2, BookOpen, Target, Mail, UserPlus, TrendingUp, Bell, Globe, Zap, Terminal, Cpu, Brain, ChevronDown, Eye, Power, Archive, ShoppingCart, Volume2, MessageCircle, BarChart3, Undo2, Wand2, ArrowDown, Activity, FileText, Search, LayoutGrid, Star, RefreshCw, Layers, Phone, X } from "lucide-react";
import { WORKFLOW_TEMPLATES, TEMPLATE_CATEGORIES, type WorkflowTemplate, type TemplateCategory, type ChannelType } from "@/data/workflow-templates";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import type { Workflow, LiveAutomation } from "@shared/schema";
import { WorkflowCompilerVisualizer, type Manifest } from "@/components/workflow-compiler-visualizer";
import { useStreamingResponse } from "@/hooks/use-streaming";

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
    case "SendWhatsApp": return <MessageCircle className="h-5 w-5 text-green-500" />;
    case "VapiCall": return <Volume2 className="h-5 w-5 text-orange-500" />;
    case "SendBookingLink": return <BookOpen className="h-5 w-5 text-teal-500" />;
    case "AIQualify": return <Sparkles className="h-5 w-5 text-violet-500" />;
    case "SendFacebookDM": return <MessageCircle className="h-5 w-5 text-blue-500" />;
    case "SendFormLink": return <FileText className="h-5 w-5 text-emerald-500" />;
    case "Wait": return <Clock className="h-5 w-5 text-amber-500" />;
    default: return <CheckCircle2 className="h-5 w-5 text-gray-400" />;
  }
};

const StepCard = ({ step, index, onClick, isSelected, onMoveUp, onMoveDown, onDelete, totalSteps }: {
  step: any, index: number, onClick: () => void, isSelected: boolean,
  onMoveUp?: () => void, onMoveDown?: () => void, onDelete?: () => void, totalSteps?: number
}) => {
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
          <div className="flex flex-col items-center gap-1">
            <div className="p-2 rounded-lg bg-secondary/50 group-hover:bg-secondary transition-colors">
              <StepIcon type={step.action_type} />
            </div>
            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {onMoveUp && index > 0 && (
                <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground" data-testid={`button-move-up-${index}`}
                  onClick={(e) => { e.stopPropagation(); onMoveUp(); }}>
                  <ChevronDown className="h-3 w-3 rotate-180" />
                </button>
              )}
              {onMoveDown && totalSteps && index < totalSteps - 1 && (
                <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground" data-testid={`button-move-down-${index}`}
                  onClick={(e) => { e.stopPropagation(); onMoveDown(); }}>
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
            </div>
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
                  {step.action_type === "SendWhatsApp" && <span className="text-green-400">{step.params.template_name || step.params.body?.slice(0, 30) || "WhatsApp"}</span>}
                  {step.action_type === "VapiCall" && <span className="text-orange-400">AI Call → {step.params.first_message?.slice(0, 30) || "Outbound"}</span>}
                  {step.action_type === "SendBookingLink" && <span className="text-teal-400">Booking SMS</span>}
                  {step.action_type === "AIQualify" && <span className="text-violet-400">AI Qualify Lead</span>}
                  {step.action_type === "SendFacebookDM" && <span className="text-blue-400">{step.params.body?.slice(0, 40) || "Facebook DM"}</span>}
                  {step.action_type === "SendFormLink" && <span className="text-emerald-400">Form Link</span>}
                  {step.action_type === "UpdateDeal" && <span className="text-orange-400">→ {step.params.stage || "Update Deal"}</span>}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                {onDelete && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 hover:bg-red-500/10" data-testid={`button-delete-step-${index}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
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

  const { startStream } = useStreamingResponse();
  const [streamingSteps, setStreamingSteps] = useState<any[]>([]);
  const [planInterpretation, setPlanInterpretation] = useState<string>("");

  const handleOrchestrate = useCallback(async () => {
    if (!command.trim()) return;
    setIsProcessing(true);
    setExecutionResult(null);
    setStreamingSteps([]);
    setPlanInterpretation("");

    try {
      await startStream("/api/v1/orchestrate/ai/stream", {
        command,
        autoExecute: true,
      }, {
        onStep: (step) => {
          setStreamingSteps(prev => {
            const existing = prev.findIndex(s => s.stepId === step.stepId);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { ...updated[existing], status: step.status, detail: step.detail };
              return updated;
            }
            return [...prev, { stepId: step.stepId, label: step.label, status: step.status, detail: step.detail }];
          });
        },
        onResult: (data) => {
          if (data.interpretation) {
            setPlanInterpretation(data.interpretation);
          }
        },
        onDone: (_fullText, rawData) => {
          if (rawData) {
            setExecutionResult(rawData);
            const successCount = rawData.successCount || 0;
            const totalSteps = rawData.totalSteps || 0;
            toast({
              title: successCount === totalSteps ? "All actions completed" : `${successCount}/${totalSteps} actions completed`,
              description: rawData.summary || rawData.interpretation,
            });
          }
          setIsProcessing(false);
          setStreamingSteps([]);
        },
        onError: (error) => {
          toast({ variant: "destructive", title: "Orchestration failed", description: error });
          setIsProcessing(false);
          setStreamingSteps([]);
        },
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Orchestration failed", description: err.message });
      setIsProcessing(false);
      setStreamingSteps([]);
    }
  }, [command, startStream, toast]);

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
          className="border border-cyan-500/20 rounded-xl bg-black/30 p-4 space-y-3"
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
              <p className="text-sm text-cyan-400 font-medium">
                {streamingSteps.length > 0 ? "Executing plan..." : "Apex is thinking..."}
              </p>
              <p className="text-[10px] text-white/30">
                {planInterpretation || "AI is analyzing your command and building an execution plan"}
              </p>
            </div>
          </div>

          {streamingSteps.length > 0 && (
            <div className="space-y-1.5 pl-11">
              {streamingSteps.map((step, i) => (
                <motion.div
                  key={step.stepId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-2 text-[11px]"
                >
                  {step.status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : step.status === "error" ? (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" />
                  )}
                  <span className={step.status === "done" ? "text-emerald-400/80" : step.status === "error" ? "text-red-400/80" : "text-white/60"}>
                    {step.label}
                  </span>
                  {step.detail && step.status !== "running" && (
                    <span className="text-white/20 text-[9px]">— {step.detail}</span>
                  )}
                </motion.div>
              ))}
            </div>
          )}
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

function WorkflowAnalyticsPanel({ workflowId, workflowName }: { workflowId?: number; workflowName?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["/api/workflows/analytics", workflowId],
    queryFn: () => workflowId ? api.getWorkflowAnalytics(workflowId, true) : null,
    enabled: !!workflowId,
  });

  const { data: optimizationLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["/api/workflows/optimization-log", workflowId],
    queryFn: () => workflowId ? api.getOptimizationLog(workflowId) : [],
    enabled: !!workflowId,
  });

  const optimizeMutation = useMutation({
    mutationFn: () => api.runAutoOptimize(workflowId!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows/analytics", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflows/optimization-log", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({
        title: data.changesApplied > 0 ? "Optimizations applied" : "No optimizations needed",
        description: data.changesApplied > 0
          ? `${data.changesApplied} change(s) applied to improve workflow performance.`
          : "Workflow is performing well or needs more execution data.",
      });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Optimization failed", description: err.message });
    },
  });

  const revertMutation = useMutation({
    mutationFn: (logId: number) => api.revertOptimization(workflowId!, logId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows/optimization-log", workflowId] });
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Change reverted" });
    },
  });

  if (!workflowId) {
    return (
      <div className="text-center py-12 text-muted-foreground border border-dashed border-white/10 rounded-xl" data-testid="analytics-no-workflow">
        <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm">No workflow selected.</p>
        <p className="text-xs mt-1">Create or select a workflow to see analytics.</p>
      </div>
    );
  }

  if (analyticsLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    );
  }

  const funnelSteps = analytics?.steps || [];
  const maxExec = Math.max(1, ...funnelSteps.map((s: any) => s.executionCount));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2" data-testid="text-analytics-title">
            <BarChart3 className="h-5 w-5 text-orange-400" />
            Workflow Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {workflowName || "Workflow"} — {analytics?.totalExecutions || 0} total executions
          </p>
        </div>
        <Button
          data-testid="button-auto-optimize"
          onClick={() => optimizeMutation.mutate()}
          disabled={optimizeMutation.isPending || (analytics?.totalExecutions || 0) < 10}
          className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white border-0"
          size="sm"
        >
          {optimizeMutation.isPending ? (
            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Optimizing...</>
          ) : (
            <><Wand2 className="mr-1.5 h-3.5 w-3.5" />Auto-Optimize</>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground" data-testid="text-total-executions">{analytics?.totalExecutions || 0}</p>
            <p className="text-xs text-muted-foreground">Total Executions</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground" data-testid="text-completion-rate">{analytics?.overallCompletionRate || 0}%</p>
            <p className="text-xs text-muted-foreground">Completion Rate</p>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground" data-testid="text-bottleneck-count">{analytics?.bottleneckSteps?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Bottlenecks</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-orange-400" />
            Step Funnel
          </h3>
          {funnelSteps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-metrics">No execution data yet. Run the workflow to see analytics.</p>
          ) : (
            <div className="space-y-3" data-testid="funnel-steps">
              {funnelSteps.map((step: any, i: number) => {
                const barWidth = maxExec > 0 ? Math.max(5, (step.executionCount / maxExec) * 100) : 5;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="space-y-1"
                    data-testid={`funnel-step-${i}`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-muted-foreground">Step {i + 1}</span>
                        <StepIcon type={step.stepType} />
                        <span className="font-medium text-foreground">{step.stepType}</span>
                        {step.isBottleneck && (
                          <Badge variant="outline" className="text-[8px] border-red-500/30 text-red-400">BOTTLENECK</Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground">{step.executionCount} exec</span>
                    </div>
                    <div className="relative h-7 rounded-md bg-secondary/30 overflow-hidden">
                      <motion.div
                        className={`absolute inset-y-0 left-0 rounded-md ${step.isBottleneck ? 'bg-gradient-to-r from-red-500/60 to-red-400/40' : 'bg-gradient-to-r from-orange-500/60 to-amber-400/40'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ duration: 0.6, delay: i * 0.1 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-between px-3 text-[10px]">
                        <span className="text-foreground/70 font-medium">
                          {step.successRate}% success
                          {step.responseRate > 0 && ` | ${step.responseRate}% response`}
                        </span>
                        {step.dropOffRate > 0 && i < funnelSteps.length - 1 && (
                          <span className="text-red-400 flex items-center gap-0.5">
                            <ArrowDown className="h-2.5 w-2.5" />{step.dropOffRate}% drop-off
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {((analytics?.suggestions && analytics.suggestions.length > 0) || (analytics?.aiSuggestions && analytics.aiSuggestions.length > 0)) && (
        <Card className="border-border">
          <CardContent className="p-5">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Optimization Suggestions
            </h3>
            <div className="space-y-2" data-testid="optimization-suggestions">
              {(analytics.suggestions || []).map((s: any, i: number) => (
                <div
                  key={`rule-${i}`}
                  className={`p-3 rounded-lg border ${
                    s.priority >= 85 ? 'border-red-500/20 bg-red-500/5' :
                    s.priority >= 70 ? 'border-amber-500/20 bg-amber-500/5' :
                    'border-white/10 bg-white/5'
                  }`}
                  data-testid={`suggestion-${i}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                      s.priority >= 85 ? 'text-red-400' : s.priority >= 70 ? 'text-amber-400' : 'text-white/40'
                    }`} />
                    <div>
                      <p className="text-xs font-medium text-foreground">{s.issue}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{s.suggestion}</p>
                      <Badge variant="outline" className="text-[8px] mt-1 border-white/10 text-muted-foreground">{s.category}</Badge>
                    </div>
                  </div>
                </div>
              ))}
              {(analytics.aiSuggestions || []).map((s: any, i: number) => (
                <div
                  key={`ai-${i}`}
                  className="p-3 rounded-lg border border-violet-500/20 bg-violet-500/5"
                  data-testid={`ai-suggestion-${i}`}
                >
                  <div className="flex items-start gap-2">
                    <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-400" />
                    <div>
                      <p className="text-xs font-medium text-foreground">{s.issue || s.suggestion}</p>
                      {s.issue && <p className="text-[11px] text-muted-foreground mt-0.5">{s.suggestion}</p>}
                      <Badge variant="outline" className="text-[8px] mt-1 border-violet-500/20 text-violet-400">AI Insight</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardContent className="p-5">
          <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-400" />
            Optimization Change Log
          </h3>
          {logsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>
          ) : optimizationLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-optimization-logs">
              No optimization changes yet. Use Auto-Optimize to let the agent improve your workflow.
            </p>
          ) : (
            <div className="space-y-2" data-testid="optimization-logs">
              {optimizationLogs.map((log: any) => (
                <div
                  key={log.id}
                  className={`p-3 rounded-lg border ${log.reverted ? 'border-white/5 bg-white/2 opacity-60' : 'border-violet-500/20 bg-violet-500/5'}`}
                  data-testid={`optimization-log-${log.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[8px] border-violet-500/30 text-violet-400">{log.changeType}</Badge>
                        {log.stepIndex !== null && (
                          <span className="text-[10px] text-muted-foreground">Step {log.stepIndex + 1}</span>
                        )}
                        {log.reverted && (
                          <Badge variant="outline" className="text-[8px] border-white/20 text-white/40">REVERTED</Badge>
                        )}
                      </div>
                      <p className="text-xs text-foreground mt-1">{log.reason}</p>
                      {log.previousValue && log.newValue && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Changed: {JSON.stringify(log.previousValue)} &rarr; {JSON.stringify(log.newValue)}
                        </p>
                      )}
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {new Date(log.createdAt).toLocaleString()} by {log.appliedBy}
                      </p>
                    </div>
                    {!log.reverted && log.changeType === 'timing_adjustment' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-white/40 hover:text-red-400 shrink-0"
                        onClick={() => revertMutation.mutate(log.id)}
                        disabled={revertMutation.isPending}
                        data-testid={`button-revert-${log.id}`}
                      >
                        <Undo2 className="h-3 w-3 mr-1" /> Revert
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const CHANNEL_ICONS: Record<ChannelType, { icon: React.ReactNode; label: string; color: string }> = {
  sms: { icon: <MessageSquare className="h-3 w-3" />, label: "SMS", color: "text-blue-400" },
  email: { icon: <Mail className="h-3 w-3" />, label: "Email", color: "text-cyan-400" },
  whatsapp: { icon: <MessageCircle className="h-3 w-3" />, label: "WhatsApp", color: "text-green-400" },
  dm: { icon: <MessageCircle className="h-3 w-3" />, label: "DM", color: "text-blue-500" },
  voice: { icon: <Phone className="h-3 w-3" />, label: "Voice", color: "text-orange-400" },
  ad: { icon: <Target className="h-3 w-3" />, label: "Ad", color: "text-pink-400" },
};

const COMPLEXITY_COLORS = {
  simple: "border-emerald-500/30 text-emerald-400",
  moderate: "border-amber-500/30 text-amber-400",
  advanced: "border-red-500/30 text-red-400",
};

function TemplatesGalleryPanel({ onUseTemplate }: { onUseTemplate: (template: WorkflowTemplate) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | "all">("all");
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | "all">("all");
  const [selectedTrigger, setSelectedTrigger] = useState<string>("all");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("all");
  const [selectedObjective, setSelectedObjective] = useState<string>("all");
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplate | null>(null);

  const allTriggers = useMemo(() => [...new Set(WORKFLOW_TEMPLATES.map(t => t.trigger))].sort(), []);
  const allIndustries = useMemo(() => [...new Set(WORKFLOW_TEMPLATES.flatMap(t => t.industryTags))].sort(), []);
  const allObjectives = useMemo(() => {
    const objectives = WORKFLOW_TEMPLATES.map(t => {
      const outcome = t.businessOutcome.toLowerCase();
      if (outcome.includes("speed") || outcome.includes("response time")) return "Speed to Lead";
      if (outcome.includes("book") || outcome.includes("appointment")) return "Book Appointments";
      if (outcome.includes("review")) return "Get Reviews";
      if (outcome.includes("recover") || outcome.includes("reactivat") || outcome.includes("re-engag")) return "Recover Lost Leads";
      if (outcome.includes("close") || outcome.includes("deal") || outcome.includes("pipeline") || outcome.includes("revenue")) return "Close More Deals";
      if (outcome.includes("cart") || outcome.includes("purchase") || outcome.includes("repeat")) return "Drive Sales";
      if (outcome.includes("no-show") || outcome.includes("show rate")) return "Reduce No-Shows";
      if (outcome.includes("contact") || outcome.includes("engagement")) return "Maximize Contact Rate";
      return "Other";
    });
    return [...new Set(objectives)].sort();
  }, []);

  const filteredTemplates = useMemo(() => {
    return WORKFLOW_TEMPLATES.filter(t => {
      if (selectedCategory !== "all" && t.category !== selectedCategory) return false;
      if (selectedChannel !== "all" && !t.channelMix.includes(selectedChannel)) return false;
      if (selectedTrigger !== "all" && t.trigger !== selectedTrigger) return false;
      if (selectedIndustry !== "all" && !t.industryTags.includes(selectedIndustry)) return false;
      if (selectedObjective !== "all") {
        const outcome = t.businessOutcome.toLowerCase();
        const objMap: Record<string, string[]> = {
          "Speed to Lead": ["speed", "response time"],
          "Book Appointments": ["book", "appointment"],
          "Get Reviews": ["review"],
          "Recover Lost Leads": ["recover", "reactivat", "re-engag"],
          "Close More Deals": ["close", "deal", "pipeline", "revenue"],
          "Drive Sales": ["cart", "purchase", "repeat"],
          "Reduce No-Shows": ["no-show", "show rate"],
          "Maximize Contact Rate": ["contact", "engagement"],
        };
        const keywords = objMap[selectedObjective] || [];
        if (keywords.length > 0 && !keywords.some(kw => outcome.includes(kw))) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.businessOutcome.toLowerCase().includes(q) ||
          t.industryTags.some(tag => tag.includes(q))
        );
      }
      return true;
    });
  }, [searchQuery, selectedCategory, selectedChannel, selectedTrigger, selectedIndustry, selectedObjective]);

  const categories = Object.entries(TEMPLATE_CATEGORIES) as [TemplateCategory, typeof TEMPLATE_CATEGORIES[TemplateCategory]][];
  const hasActiveFilters = selectedCategory !== "all" || selectedChannel !== "all" || selectedTrigger !== "all" || selectedIndustry !== "all" || selectedObjective !== "all" || searchQuery;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-template-search"
            placeholder="Search templates by name, objective, or industry..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-9 text-sm"
          />
        </div>
        <Select value={selectedCategory} onValueChange={(val) => setSelectedCategory(val as TemplateCategory | "all")}>
          <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="select-template-category">
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(([key, cat]) => (
              <SelectItem key={key} value={key}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedChannel} onValueChange={(val) => setSelectedChannel(val as ChannelType | "all")}>
          <SelectTrigger className="w-[140px] h-9 text-xs" data-testid="select-template-channel">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="dm">DM</SelectItem>
            <SelectItem value="voice">Voice</SelectItem>
          </SelectContent>
        </Select>
        <Select value={selectedTrigger} onValueChange={setSelectedTrigger}>
          <SelectTrigger className="w-[170px] h-9 text-xs" data-testid="select-template-trigger">
            <Zap className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Trigger" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Triggers</SelectItem>
            {allTriggers.map(trig => (
              <SelectItem key={trig} value={trig}>{trig.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
          <SelectTrigger className="w-[150px] h-9 text-xs" data-testid="select-template-industry">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {allIndustries.map(ind => (
              <SelectItem key={ind} value={ind}>{ind.replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedObjective} onValueChange={setSelectedObjective}>
          <SelectTrigger className="w-[180px] h-9 text-xs" data-testid="select-template-objective">
            <Target className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Objective" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Objectives</SelectItem>
            {allObjectives.map(obj => (
              <SelectItem key={obj} value={obj}>{obj}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground" data-testid="text-template-count">
          {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""}
        </p>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" data-testid="button-clear-filters"
            onClick={() => { setSelectedCategory("all"); setSelectedChannel("all"); setSelectedTrigger("all"); setSelectedIndustry("all"); setSelectedObjective("all"); setSearchQuery(""); }}>
            <X className="h-3 w-3 mr-1" /> Clear filters
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${previewTemplate ? "lg:col-span-2" : "lg:col-span-3"} space-y-3`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredTemplates.map((template) => {
              const catInfo = TEMPLATE_CATEGORIES[template.category];
              const isSelected = previewTemplate?.id === template.id;
              return (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  className="cursor-pointer"
                  onClick={() => setPreviewTemplate(isSelected ? null : template)}
                  data-testid={`card-template-${template.id}`}
                >
                  <Card className={`border-border hover:shadow-md transition-all duration-200 h-full ${isSelected ? "ring-2 ring-primary border-primary/50" : "hover:border-primary/30"}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm text-foreground leading-tight" data-testid={`text-template-name-${template.id}`}>
                            {template.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-[9px] ${catInfo.color}`}>
                          {catInfo.label}
                        </Badge>
                        <Badge variant="outline" className={`text-[9px] ${COMPLEXITY_COLORS[template.complexityLevel]}`}>
                          {template.complexityLevel}
                        </Badge>
                        {template.industryTags.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="outline" className="text-[9px] border-white/10 text-muted-foreground capitalize">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {template.channelMix.map((ch) => {
                            const chInfo = CHANNEL_ICONS[ch];
                            return (
                              <span key={ch} className={`${chInfo.color}`} title={chInfo.label}>
                                {chInfo.icon}
                              </span>
                            );
                          })}
                        </div>
                        <span className="text-[10px] text-muted-foreground">•</span>
                        <span className="text-[10px] text-muted-foreground">{template.steps.length} steps</span>
                        <span className="text-[10px] text-muted-foreground">•</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{template.trigger.replace(/_/g, " ")}</span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
          {filteredTemplates.length === 0 && (
            <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-xl" data-testid="text-no-templates">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No templates match your filters.</p>
              <p className="text-xs mt-1">Try broadening your search or clearing filters.</p>
            </div>
          )}
        </div>

        <AnimatePresence>
          {previewTemplate && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="lg:col-span-1"
            >
              <Card className="sticky top-6 border-border" data-testid="template-preview-panel">
                <CardContent className="p-5 space-y-4 max-h-[calc(100vh-14rem)] overflow-y-auto">
                  <div className="flex items-start justify-between">
                    <h3 className="font-bold text-base text-foreground leading-tight" data-testid="text-preview-name">
                      {previewTemplate.name}
                    </h3>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setPreviewTemplate(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">{previewTemplate.description}</p>

                  <div className="p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
                    <p className="text-xs font-medium text-primary" data-testid="text-preview-outcome">
                      {previewTemplate.businessOutcome}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={`text-[9px] ${TEMPLATE_CATEGORIES[previewTemplate.category].color}`}>
                      {TEMPLATE_CATEGORIES[previewTemplate.category].label}
                    </Badge>
                    <Badge variant="outline" className={`text-[9px] ${COMPLEXITY_COLORS[previewTemplate.complexityLevel]}`}>
                      {previewTemplate.complexityLevel}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] border-white/20 text-muted-foreground capitalize">
                      {previewTemplate.trigger.replace(/_/g, " ")}
                    </Badge>
                    {previewTemplate.industryTags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[9px] border-white/10 text-muted-foreground capitalize" data-testid={`badge-industry-${tag}`}>
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {previewTemplate.channelMix.map((ch) => {
                      const chInfo = CHANNEL_ICONS[ch];
                      return (
                        <div key={ch} className={`flex items-center gap-1 text-[10px] ${chInfo.color}`}>
                          {chInfo.icon}
                          <span>{chInfo.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Step Sequence</h4>
                    <div className="space-y-2 mt-2">
                      {previewTemplate.steps.map((step, i) => (
                        <div key={i} className="flex items-start gap-2 group" data-testid={`preview-step-${i}`}>
                          <div className="flex flex-col items-center">
                            <div className="p-1 rounded bg-secondary/50">
                              <StepIcon type={step.action_type} />
                            </div>
                            {i < previewTemplate.steps.length - 1 && (
                              <div className="w-0.5 h-4 bg-border mt-1" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <p className="text-[11px] font-medium text-foreground">{step.action_type.replace(/([A-Z])/g, " $1").trim()}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                              {step.action_type === "WAIT" && `Wait ${step.params.duration_minutes >= 1440 ? `${Math.round(step.params.duration_minutes / 1440)} day(s)` : step.params.duration_minutes >= 60 ? `${Math.round(step.params.duration_minutes / 60)} hour(s)` : `${step.params.duration_minutes} min`}`}
                              {(step.action_type === "SMS" || step.action_type === "SendFacebookDM" || step.action_type === "SendBookingLink" || step.action_type === "SendFormLink") && step.params.body}
                              {step.action_type === "SendWhatsApp" && step.params.body}
                              {step.action_type === "SendEmail" && (<><span className="font-medium">Subject:</span> {step.params.subject}{step.params.body && (<><br /><span className="font-medium">Body:</span> {step.params.body}</>)}</>)}
                              {step.action_type === "CONDITION" && `Check: ${step.params.check}`}
                              {step.action_type === "ALERT" && `Alert: ${step.params.user_id || "team"}`}
                              {step.action_type === "AIQualify" && `Qualify: ${step.params.check}`}
                              {step.action_type === "VapiCall" && step.params.first_message}
                              {step.action_type === "UpdateDeal" && `Update deal stage`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {previewTemplate.industryTags.length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Industries</h4>
                      <div className="flex flex-wrap gap-1">
                        {previewTemplate.industryTags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[9px] capitalize">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    data-testid="button-use-template"
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white border-0"
                    onClick={() => onUseTemplate(previewTemplate)}
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    Use This Template
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
  const [prompt, setPrompt] = useState("When a Facebook form is submitted, wait 30 seconds, send a personalized SMS introducing our services, then immediately trigger an AI call to qualify the lead and book an appointment.");
  const [activeTab, setActiveTab] = useState("editor");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWfName, setNewWfName] = useState("New Workflow");
  const [newWfTrigger, setNewWfTrigger] = useState("manual_trigger");

  const TRIGGERS = [
    { value: "manual_trigger", label: "Manual Trigger" },
    { value: "facebook_form_submit", label: "Facebook Form Submit" },
    { value: "new_lead", label: "New Lead" },
    { value: "missed_call", label: "Missed Call" },
    { value: "appointment_booked", label: "Appointment Booked" },
    { value: "review_received", label: "Review Received" },
    { value: "sms_reply", label: "SMS Reply" },
    { value: "shopify_abandoned_cart", label: "Shopify Abandoned Cart" },
    { value: "shopify_order_fulfilled", label: "Shopify Order Fulfilled" },
  ];

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["/api/workflows"],
    queryFn: api.getWorkflows,
  });

  const currentWorkflow = selectedWorkflowId
    ? workflows.find((w) => w.id === selectedWorkflowId) || (workflows.length > 0 ? workflows[0] : null)
    : workflows.length > 0 ? workflows[0] : null;
  const displayWorkflow = currentWorkflow ?? DEFAULT_WORKFLOW;
  const steps = Array.isArray(displayWorkflow.steps) ? displayWorkflow.steps : [];
  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;

  const createMutation = useMutation({
    mutationFn: (data: { name: string; trigger: string; steps: any; subAccountId?: number | null }) =>
      api.createWorkflow(data),
    onSuccess: (newWf: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      if (newWf?.id) setSelectedWorkflowId(newWf.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<{ name: string; trigger: string; steps: any }> }) =>
      api.updateWorkflow(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/workflows/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setSelectedWorkflowId(null);
      setSelectedStepIndex(null);
      toast({ title: "Workflow deleted" });
    },
  });

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    try {
      const res = await apiRequest("POST", "/api/workflows/generate", { prompt });
      const wf = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      if (wf?.id) setSelectedWorkflowId(wf.id);
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
    if (currentWorkflow) {
      updateMutation.mutate({ id: currentWorkflow.id, data: { steps: [] } });
    }
    setSelectedStepIndex(null);
  };

  const handleChangeTrigger = (newTrigger: string) => {
    if (!currentWorkflow) return;
    updateMutation.mutate({ id: currentWorkflow.id, data: { trigger: newTrigger } });
  };

  const handleRenameSave = () => {
    if (!currentWorkflow || !nameValue.trim()) return;
    updateMutation.mutate({ id: currentWorkflow.id, data: { name: nameValue.trim() } });
    setEditingName(false);
    toast({ title: "Workflow renamed" });
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    if (!currentWorkflow) return;
    const newSteps = [...steps];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    updateMutation.mutate({ id: currentWorkflow.id, data: { steps: newSteps } });
    setSelectedStepIndex(targetIndex);
  };

  const handleCreateWorkflow = () => {
    createMutation.mutate({ name: newWfName, trigger: newWfTrigger, steps: [] });
    setIsCreateDialogOpen(false);
    setNewWfName("New Workflow");
    setNewWfTrigger("manual_trigger");
    setSelectedStepIndex(null);
    toast({ title: "Workflow created", description: `"${newWfName}" is ready to build.` });
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
      VapiCall: { action_type: "VapiCall", params: { first_message: "Hey {{leadName}}, this is Apex — you just filled out a form, I wanted to follow up real quick.", assistantId: "" } },
      SendBookingLink: { action_type: "SendBookingLink", params: { body: "Hey {{leadName}}! Here's our calendar to book a time: {{bookingLink}}" } },
      AIQualify: { action_type: "AIQualify", params: { check: "interest_level", pass_action: "continue", fail_action: "skip" } },
      SendFacebookDM: { action_type: "SendFacebookDM", params: { body: "Hey {{leadName}}! Thanks for reaching out — how can we help you today?" } },
      SendFormLink: { action_type: "SendFormLink", params: { body: "Hey {{leadName}}, fill out this quick form so we can get you started: {{formLink}}", form_url: "" } },
      UpdateDeal: { action_type: "UpdateDeal", params: { stage: "qualified", value: 0, notes: "" } },
      SendWhatsApp: { action_type: "SendWhatsApp", params: { body: "Hey {{leadName}}, this is {{businessName}}.", message_type: "text" } },
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
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Workflow Command Center</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Build, wire, and deploy intelligent automations
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {workflows.length > 0 && (
            <Select value={String(currentWorkflow?.id || "")} onValueChange={(val) => { setSelectedWorkflowId(parseInt(val)); setSelectedStepIndex(null); }}>
              <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="select-workflow">
                <SelectValue placeholder="Select workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((wf) => (
                  <SelectItem key={wf.id} value={String(wf.id)} data-testid={`select-workflow-${wf.id}`}>
                    {wf.name || `Workflow #${wf.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-new-workflow" className="gap-1">
                <Zap className="h-3 w-3" /> New
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
              <DialogHeader>
                <DialogTitle>Create New Workflow</DialogTitle>
                <DialogDescription>Name your workflow and pick a trigger.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Workflow Name</label>
                  <Input data-testid="input-new-wf-name" value={newWfName} onChange={(e) => setNewWfName(e.target.value)} placeholder="e.g. Facebook Lead Follow-Up" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Trigger</label>
                  <Select value={newWfTrigger} onValueChange={setNewWfTrigger}>
                    <SelectTrigger data-testid="select-new-wf-trigger"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
                <Button data-testid="button-create-wf-submit" onClick={handleCreateWorkflow} disabled={!newWfName.trim()}>Create Workflow</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
          <Button data-testid="button-discard" variant="outline" size="sm" onClick={handleDiscard}>Clear Steps</Button>
          {currentWorkflow && (
            <Button data-testid="button-delete-workflow" variant="outline" size="sm" className="text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => { if (confirm("Delete this workflow?")) deleteMutation.mutate(currentWorkflow.id); }}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete
            </Button>
          )}
          <Button data-testid="button-publish" variant="secondary" size="sm" onClick={handlePublish} disabled={!currentWorkflow || updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}
            Save
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
          <TabsTrigger value="templates" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400 gap-1.5" data-testid="tab-templates">
            <LayoutGrid className="h-3.5 w-3.5" /> Templates
          </TabsTrigger>
          <TabsTrigger value="analytics" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400 gap-1.5" data-testid="tab-analytics">
            <BarChart3 className="h-3.5 w-3.5" /> Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {currentWorkflow && (
                <div className="flex items-center gap-3 mb-2">
                  {editingName ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input data-testid="input-workflow-name" className="h-8 text-sm font-semibold max-w-[250px]" value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleRenameSave(); if (e.key === "Escape") setEditingName(false); }}
                        autoFocus />
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleRenameSave}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setEditingName(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <button className="text-lg font-semibold text-foreground hover:text-primary transition-colors cursor-pointer flex items-center gap-1.5"
                      onClick={() => { setNameValue(currentWorkflow.name || ""); setEditingName(true); }}
                      data-testid="button-rename-workflow">
                      {currentWorkflow.name || "Untitled Workflow"}
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center">
                <div className="flex justify-center flex-1">
                  <div className="flex items-center gap-2">
                    <Select value={displayWorkflow.trigger || "manual_trigger"} onValueChange={handleChangeTrigger} disabled={!currentWorkflow}>
                      <SelectTrigger className="bg-foreground text-background px-4 py-2 rounded-full text-sm font-medium shadow-lg border-0 h-auto gap-2 min-w-[220px]" data-testid="select-trigger">
                        {displayWorkflow.trigger?.startsWith("shopify_") ? (
                          <ShoppingCart className="h-4 w-4 text-green-400" />
                        ) : (
                          <PlayCircle className="h-4 w-4" />
                        )}
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRIGGERS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                      onMoveUp={() => handleMoveStep(index, "up")}
                      onMoveDown={() => handleMoveStep(index, "down")}
                      onDelete={() => handleDeleteStep(index)}
                      totalSteps={steps.length}
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
                      { type: "SendWhatsApp", label: "WhatsApp", icon: <MessageCircle className="h-3 w-3" />, color: "text-green-500 border-green-500/30 hover:bg-green-500/10" },
                      { type: "VapiCall", label: "AI Call", icon: <Volume2 className="h-3 w-3" />, color: "text-orange-500 border-orange-500/30 hover:bg-orange-500/10" },
                      { type: "SendBookingLink", label: "Booking SMS", icon: <BookOpen className="h-3 w-3" />, color: "text-teal-500 border-teal-500/30 hover:bg-teal-500/10" },
                      { type: "AIQualify", label: "AI Qualify", icon: <Sparkles className="h-3 w-3" />, color: "text-violet-500 border-violet-500/30 hover:bg-violet-500/10" },
                      { type: "SendFacebookDM", label: "Facebook DM", icon: <MessageCircle className="h-3 w-3" />, color: "text-blue-400 border-blue-400/30 hover:bg-blue-400/10" },
                      { type: "SendFormLink", label: "Form Link", icon: <FileText className="h-3 w-3" />, color: "text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10" },
                      { type: "UpdateDeal", label: "Update Deal", icon: <TrendingUp className="h-3 w-3" />, color: "text-orange-400 border-orange-400/30 hover:bg-orange-400/10" },
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

                        {selectedStep.action_type === "SendWhatsApp" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">To (phone with country code)</label>
                              <Input data-testid="input-whatsapp-to" value={selectedStep.params.to || ""}
                                placeholder="+1234567890"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, to: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Message Type</label>
                              <Select value={selectedStep.params.message_type || "text"} onValueChange={(val) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, message_type: val } })}>
                                <SelectTrigger data-testid="select-whatsapp-type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="text">Text Message</SelectItem>
                                  <SelectItem value="template">Template Message</SelectItem>
                                  <SelectItem value="interactive_buttons">Interactive (Buttons)</SelectItem>
                                  <SelectItem value="interactive_list">Interactive (List)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {(selectedStep.params.message_type === "template") && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Template Name</label>
                                <Input data-testid="input-whatsapp-template" value={selectedStep.params.template_name || ""}
                                  placeholder="e.g. appointment_reminder"
                                  onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, template_name: e.target.value } })} />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Message Body</label>
                              <Textarea data-testid="input-whatsapp-body" value={selectedStep.params.body || ""} className="min-h-[80px]"
                                placeholder="Hello {{1}}, your appointment is on {{2}}"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                            {(selectedStep.params.message_type === "interactive_buttons") && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">Buttons (comma-separated)</label>
                                <Input data-testid="input-whatsapp-buttons" value={selectedStep.params.buttons || ""}
                                  placeholder="Confirm, Reschedule, Cancel"
                                  onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, buttons: e.target.value } })} />
                              </div>
                            )}
                            {(selectedStep.params.message_type === "interactive_list") && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium">List Items (comma-separated)</label>
                                <Input data-testid="input-whatsapp-list" value={selectedStep.params.list_items || ""}
                                  placeholder="Option A, Option B, Option C"
                                  onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, list_items: e.target.value } })} />
                              </div>
                            )}
                          </>
                        )}

                        {selectedStep.action_type === "VapiCall" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">First Message</label>
                              <Textarea data-testid="input-vapi-message" value={selectedStep.params.first_message || ""} className="min-h-[80px]"
                                placeholder="Hey {{leadName}}, this is Apex — wanted to follow up on your inquiry..."
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, first_message: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Assistant ID (optional — uses default outbound specialist)</label>
                              <Input data-testid="input-vapi-assistant" value={selectedStep.params.assistantId || ""}
                                placeholder="e30434f7-e7e0-4be7-8b89-40c384a52b4a"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, assistantId: e.target.value } })} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">Triggers an AI voice call via Vapi to the lead's phone. Uses the Outbound Specialist by default.</p>
                          </>
                        )}

                        {selectedStep.action_type === "SendBookingLink" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Booking SMS Body</label>
                              <Textarea data-testid="input-booking-body" value={selectedStep.params.body || ""} className="min-h-[80px]"
                                placeholder="Hey {{leadName}}! Book a time with us: {{bookingLink}}"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">Sends an SMS with the booking link. Use {"{{bookingLink}}"} to auto-inject the calendar URL.</p>
                          </>
                        )}

                        {selectedStep.action_type === "AIQualify" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Qualification Check</label>
                              <Select value={selectedStep.params.check || "interest_level"} onValueChange={(val) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, check: val } })}>
                                <SelectTrigger data-testid="select-qualify-check">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="interest_level">Interest Level (AI)</SelectItem>
                                  <SelectItem value="has_replied">Has Replied</SelectItem>
                                  <SelectItem value="budget_qualified">Budget Qualified</SelectItem>
                                  <SelectItem value="service_match">Service Match</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <p className="text-[10px] text-muted-foreground">AI analyzes the lead and determines qualification. Qualified leads continue the flow; unqualified are flagged for review.</p>
                          </>
                        )}

                        {selectedStep.action_type === "SendFacebookDM" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">DM Message</label>
                              <Textarea data-testid="input-fbdm-body" value={selectedStep.params.body || ""} className="min-h-[80px]"
                                placeholder="Hey {{leadName}}, thanks for reaching out!"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">Sends a Facebook/Instagram DM to the lead. Use {"{{leadName}}"} for personalization.</p>
                          </>
                        )}

                        {selectedStep.action_type === "SendFormLink" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Message Body</label>
                              <Textarea data-testid="input-formlink-body" value={selectedStep.params.body || ""} className="min-h-[80px]"
                                placeholder="Fill out this form to get started: {{formLink}}"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, body: e.target.value } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Form URL</label>
                              <Input data-testid="input-formlink-url" value={selectedStep.params.form_url || ""}
                                placeholder="https://forms.example.com/intake"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, form_url: e.target.value } })} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">Sends the lead a link to fill out a form. Use {"{{formLink}}"} in the body.</p>
                          </>
                        )}

                        {selectedStep.action_type === "UpdateDeal" && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Deal Stage</label>
                              <Select value={selectedStep.params.stage || "qualified"} onValueChange={(val) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, stage: val } })}>
                                <SelectTrigger data-testid="select-deal-stage"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">New</SelectItem>
                                  <SelectItem value="qualified">Qualified</SelectItem>
                                  <SelectItem value="proposal">Proposal</SelectItem>
                                  <SelectItem value="negotiation">Negotiation</SelectItem>
                                  <SelectItem value="won">Won</SelectItem>
                                  <SelectItem value="lost">Lost</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Deal Value ($)</label>
                              <Input data-testid="input-deal-value" type="number" value={selectedStep.params.value || 0}
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, value: parseFloat(e.target.value) || 0 } })} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium">Notes</label>
                              <Textarea data-testid="input-deal-notes" value={selectedStep.params.notes || ""} className="min-h-[60px]"
                                onChange={(e) => handleUpdateStep(selectedStepIndex, { ...selectedStep, params: { ...selectedStep.params, notes: e.target.value } })} />
                            </div>
                            <p className="text-[10px] text-muted-foreground">Updates the deal stage and value in the pipeline.</p>
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

        <TabsContent value="templates">
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-purple-400" />
                Workflow Templates
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Proven, production-ready automations — deploy in one click
              </p>
            </div>
            <TemplatesGalleryPanel onUseTemplate={(template) => {
              createMutation.mutate({
                name: template.name,
                trigger: template.trigger,
                steps: template.steps,
              });
              setActiveTab("editor");
              toast({
                title: "Template applied",
                description: `"${template.name}" created with ${template.steps.length} steps. Customize it in the editor.`,
              });
            }} />
          </div>
        </TabsContent>

        <TabsContent value="live">
          <div className="max-w-3xl mx-auto">
            <LiveAutomationsPanel />
          </div>
        </TabsContent>

        <TabsContent value="analytics">
          <div className="max-w-4xl mx-auto">
            <WorkflowAnalyticsPanel workflowId={currentWorkflow?.id} workflowName={currentWorkflow?.name} />
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
