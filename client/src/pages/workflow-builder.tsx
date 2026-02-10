import { useState } from "react";
import { Clock, MessageSquare, GitFork, MoreHorizontal, Plus, PlayCircle, CheckCircle2, AlertCircle, Sparkles, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Initial Empty State or Default Workflow
const DEFAULT_WORKFLOW = {
  trigger: "manual_trigger",
  steps: []
};

// The "AI Generated" Workflow (simulating the Python script output)
const GENERATED_WORKFLOW = {
  trigger: "facebook_form_submit",
  steps: [
    { action_type: "WAIT", params: { duration_minutes: 5 } },
    { action_type: "SMS", params: { body: "Hey" } },
    { action_type: "CONDITION", params: { check: "has_replied" } },
    { action_type: "ALERT", params: { user_id: "admin" } }
  ]
};

const StepIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "WAIT": return <Clock className="h-5 w-5 text-amber-500" />;
    case "SMS": return <MessageSquare className="h-5 w-5 text-blue-500" />;
    case "CONDITION": return <GitFork className="h-5 w-5 text-purple-500" />;
    case "ALERT": return <AlertCircle className="h-5 w-5 text-red-500" />;
    default: return <CheckCircle2 className="h-5 w-5 text-gray-400" />;
  }
};

const StepCard = ({ step, index, onClick }: { step: any, index: number, onClick: () => void }) => {
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
      <Card className="border-border shadow-sm hover:shadow-md transition-shadow duration-200">
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
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Connector Line */}
      <div className="absolute left-8 top-full h-8 w-0.5 bg-border -z-10 group-last:hidden" />
    </motion.div>
  );
};

export default function WorkflowBuilder() {
  const [workflow, setWorkflow] = useState<any>(GENERATED_WORKFLOW);
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [prompt, setPrompt] = useState("When a lead fills the Facebook form, wait 5 mins, then SMS them 'Hey'. If they reply, alert me.");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    setWorkflow(GENERATED_WORKFLOW);
    setIsGenerating(false);
    setIsAiDialogOpen(false);
    setSelectedStep(null);
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workflow Editor</h1>
          <p className="text-muted-foreground mt-1">
            Visualizing trigger: <code className="text-xs bg-muted px-1 py-0.5 rounded text-primary">{workflow.trigger}</code>
          </p>
        </div>
        <div className="flex gap-3">
          <Dialog open={isAiDialogOpen} onOpenChange={setIsAiDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0">
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
                  Describe your automation in plain English, and our AI will build the workflow structure for you.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[120px] resize-none text-base"
                  placeholder="e.g. When a user signs up, wait 1 day and send a welcome email..."
                />
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setIsAiDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating Plan...
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
          
          <Button variant="outline">Discard</Button>
          <Button variant="secondary">
            <PlayCircle className="mr-2 h-4 w-4" />
            Publish
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Canvas Area */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Trigger Block */}
          <div className="flex justify-center mb-8">
            <div className="bg-foreground text-background px-6 py-3 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 animate-in zoom-in duration-300">
              <PlayCircle className="h-4 w-4" />
              Trigger: {workflow.trigger}
            </div>
          </div>
          
          {/* Steps Flow */}
          <div className="space-y-4 max-w-md mx-auto relative pb-20">
            {/* Connecting line for the whole flow background */}
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border/50 -z-20" />

            <AnimatePresence mode="popLayout">
              {workflow.steps.map((step: any, index: number) => (
                <StepCard 
                  key={index} 
                  step={step} 
                  index={index}
                  onClick={() => setSelectedStep(step)} 
                />
              ))}
            </AnimatePresence>

            {workflow.steps.length === 0 && (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                <p>No steps yet. Use AI generation or add manually.</p>
              </div>
            )}

            {/* Add Step Button */}
            <div className="flex justify-center pt-4">
              <Button variant="outline" size="sm" className="rounded-full h-8 w-8 p-0 bg-background hover:bg-muted">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Inspector Panel */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6 border-border h-[calc(100vh-8rem)]">
            <CardContent className="p-6 h-full flex flex-col">
              {selectedStep ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300" key={JSON.stringify(selectedStep)}>
                  <div className="flex items-center gap-3 border-b border-border pb-4">
                    <div className="p-2 bg-secondary rounded-md">
                      <StepIcon type={selectedStep.action_type} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{selectedStep.action_type} Step</h3>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedStep.action_type === "WAIT" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Duration (Minutes)</label>
                        <div className="flex items-center gap-2 p-3 border border-border rounded-md bg-muted/20">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm">{selectedStep.params.duration_minutes}</span>
                        </div>
                      </div>
                    )}

                    {selectedStep.action_type === "SMS" && (
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Message Body</label>
                         <div className="p-3 border border-border rounded-md bg-muted/20 min-h-[100px] text-sm">
                           {selectedStep.params.body}
                         </div>
                      </div>
                    )}

                    {selectedStep.action_type === "CONDITION" && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Condition Check</label>
                          <div className="p-2 border border-border rounded bg-muted/20 text-sm font-mono">{selectedStep.params.check}</div>
                        </div>
                      </div>
                    )}

                    {selectedStep.action_type === "ALERT" && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">User ID</label>
                          <div className="p-2 border border-border rounded bg-muted/20 text-sm font-mono">{selectedStep.params.user_id}</div>
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
                    <p className="text-sm mt-1">Click on a step in the workflow<br/>to view its properties.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
