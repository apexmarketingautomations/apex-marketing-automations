import { useState } from "react";
import { Clock, MessageSquare, GitFork, MoreHorizontal, Plus, PlayCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Replicating the user's snapshot structure
const MOCK_WORKFLOW = {
  id: "wf_123",
  trigger: "form_submission",
  steps: [
    {
      id: "step_1",
      type: "WAIT",
      duration: 300000, // 5 minutes
      meta: { label: "Wait for 5 minutes" }
    },
    {
      id: "step_2",
      type: "CONDITION",
      check: "has_tag",
      value: "vip_customer",
      true_next: "step_3",
      false_next: "step_4",
      meta: { label: "Check if VIP" }
    },
    {
      id: "step_3",
      type: "SMS",
      body: "Hey VIP! Here is your discount.",
      meta: { label: "Send VIP Offer" }
    },
    {
      id: "step_4", // Inferred "False" branch step
      type: "SMS",
      body: "Thanks for signing up! Check out our deals.",
      meta: { label: "Send Standard Welcome" }
    }
  ]
};

const StepIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "WAIT": return <Clock className="h-5 w-5 text-amber-500" />;
    case "SMS": return <MessageSquare className="h-5 w-5 text-blue-500" />;
    case "CONDITION": return <GitFork className="h-5 w-5 text-purple-500" />;
    default: return <CheckCircle2 className="h-5 w-5 text-gray-400" />;
  }
};

const StepCard = ({ step, onClick }: { step: any, onClick: () => void }) => {
  return (
    <motion.div 
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="relative group cursor-pointer"
      onClick={onClick}
    >
      <Card className="border-border shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardContent className="p-4 flex items-start gap-4">
          <div className={`p-2 rounded-lg bg-secondary/50 group-hover:bg-secondary transition-colors`}>
            <StepIcon type={step.type} />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-semibold text-sm text-foreground">{step.type}</h4>
                <p className="text-xs text-muted-foreground mt-1">{step.meta?.label || "Configure step"}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Step Details Preview */}
            <div className="mt-3 text-xs bg-muted/50 p-2 rounded border border-border/50 font-mono text-muted-foreground truncate">
              {step.type === "WAIT" && `Duration: ${(step.duration / 60000)}m`}
              {step.type === "CONDITION" && `Check: ${step.check} == ${step.value}`}
              {step.type === "SMS" && `"${step.body}"`}
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
  const [selectedStep, setSelectedStep] = useState<any>(null);

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Workflow Editor</h1>
          <p className="text-muted-foreground mt-1">Visualizing snapshot: <code className="text-xs bg-muted px-1 py-0.5 rounded text-primary">{MOCK_WORKFLOW.id}</code></p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">Discard</Button>
          <Button>
            <PlayCircle className="mr-2 h-4 w-4" />
            Publish Workflow
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Canvas Area */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Trigger Block */}
          <div className="flex justify-center mb-8">
            <div className="bg-foreground text-background px-6 py-3 rounded-full text-sm font-medium shadow-lg flex items-center gap-2">
              <PlayCircle className="h-4 w-4" />
              Trigger: Form Submission
            </div>
          </div>
          
          {/* Steps Flow */}
          <div className="space-y-4 max-w-md mx-auto relative pb-20">
            {/* Connecting line for the whole flow background */}
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border/50 -z-20" />

            {/* Step 1: WAIT */}
            <StepCard step={MOCK_WORKFLOW.steps[0]} onClick={() => setSelectedStep(MOCK_WORKFLOW.steps[0])} />

            {/* Step 2: CONDITION */}
            <StepCard step={MOCK_WORKFLOW.steps[1]} onClick={() => setSelectedStep(MOCK_WORKFLOW.steps[1])} />

            {/* Branching Visualization */}
            <div className="relative pl-8 pt-4 pb-4">
              {/* Branch Lines */}
              <div className="absolute left-8 top-0 h-full w-0.5 bg-border -z-10" />
              <div className="absolute left-8 top-8 w-8 h-0.5 bg-border" />
              
              {/* True Branch */}
              <div className="ml-12 mb-8 relative">
                 <Badge className="absolute -left-16 -top-3 bg-green-100 text-green-700 hover:bg-green-100 border-green-200">True</Badge>
                 <StepCard step={MOCK_WORKFLOW.steps[2]} onClick={() => setSelectedStep(MOCK_WORKFLOW.steps[2])} />
              </div>

              {/* False Branch (Implied) */}
              <div className="ml-12 relative">
                 <Badge className="absolute -left-16 -top-3 bg-red-100 text-red-700 hover:bg-red-100 border-red-200">False</Badge>
                 <StepCard step={MOCK_WORKFLOW.steps[3]} onClick={() => setSelectedStep(MOCK_WORKFLOW.steps[3])} />
              </div>
            </div>

            {/* Add Step Button */}
            <div className="flex justify-center pt-4">
              <Button variant="outline" size="sm" className="rounded-full h-8 w-8 p-0">
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
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center gap-3 border-b border-border pb-4">
                    <div className="p-2 bg-secondary rounded-md">
                      <StepIcon type={selectedStep.type} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{selectedStep.type} Step</h3>
                      <code className="text-xs text-muted-foreground">{selectedStep.id}</code>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedStep.type === "WAIT" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Duration (ms)</label>
                        <div className="flex items-center gap-2 p-3 border border-border rounded-md bg-muted/20">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm">{selectedStep.duration}</span>
                        </div>
                      </div>
                    )}

                    {selectedStep.type === "SMS" && (
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Message Body</label>
                         <div className="p-3 border border-border rounded-md bg-muted/20 min-h-[100px] text-sm">
                           {selectedStep.body}
                         </div>
                      </div>
                    )}

                    {selectedStep.type === "CONDITION" && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Condition Check</label>
                          <div className="p-2 border border-border rounded bg-muted/20 text-sm font-mono">{selectedStep.check}</div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Expected Value</label>
                          <div className="p-2 border border-border rounded bg-muted/20 text-sm font-mono">{selectedStep.value}</div>
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
