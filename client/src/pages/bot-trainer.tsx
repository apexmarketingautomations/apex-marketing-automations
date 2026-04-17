import { PlanGate } from "@/components/plan-gate";
import { useState, useEffect } from "react";
import { 
  Bot, 
  Globe, 
  Database, 
  Sparkles, 
  MessageSquare, 
  ArrowRight, 
  BrainCircuit, 
  Calendar,
  Loader2,
  ExternalLink,
  BookOpen,
  Link2,
  Plus,
  Trash2,
  Settings2,
  Save
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { BOT_TRAINER_STEPS } from "@/components/tutorial-steps";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/hooks/use-account";
import { api } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";

const DEFAULT_PERSONA = `You are a friendly, knowledgeable assistant for a premium fitness studio called Forge Fitness.

You can help with:
- Answering questions about membership plans, pricing, and class schedules
- Booking appointments and consultations
- Providing information about trainers and facilities

You have access to these tools:
- check_calendar_availability: Check available appointment slots
- book_appointment: Book an appointment for a client

Keep responses concise (1-3 sentences). Be warm, professional, and always try to guide the conversation toward booking.`;

interface LinkItem {
  label: string;
  url: string;
}

interface DmAgentConfig {
  formLinks: LinkItem[];
  offerUrls: LinkItem[];
  servicePageUrls: LinkItem[];
  brandVoice: string;
  escalationInfo: string;
  bookingLink: string;
}

function LinkListEditor({ 
  items, 
  onChange, 
  labelPlaceholder,
  urlPlaceholder,
  testIdPrefix
}: { 
  items: LinkItem[]; 
  onChange: (items: LinkItem[]) => void;
  labelPlaceholder: string;
  urlPlaceholder: string;
  testIdPrefix: string;
}) {
  const addItem = () => onChange([...items, { label: "", url: "" }]);
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: "label" | "url", value: string) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            data-testid={`input-${testIdPrefix}-label-${i}`}
            value={item.label}
            onChange={(e) => updateItem(i, "label", e.target.value)}
            placeholder={labelPlaceholder}
            className="flex-1"
          />
          <Input
            data-testid={`input-${testIdPrefix}-url-${i}`}
            value={item.url}
            onChange={(e) => updateItem(i, "url", e.target.value)}
            placeholder={urlPlaceholder}
            className="flex-1"
          />
          <Button
            data-testid={`button-remove-${testIdPrefix}-${i}`}
            variant="ghost"
            size="icon"
            onClick={() => removeItem(i)}
            className="shrink-0 text-red-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        data-testid={`button-add-${testIdPrefix}`}
        variant="outline"
        size="sm"
        onClick={addItem}
        className="w-full"
      >
        <Plus className="h-3 w-3 mr-1" /> Add
      </Button>
    </div>
  );
}

function BotTrainerInner() {
  const [url, setUrl] = useState("https://forge-fitness.com");
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("train");
  const { toast } = useToast();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_bot_trainer");
  const { activeAccountId } = useAccount();
  
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: string; content: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [trainingJobId, setTrainingJobId] = useState<number | null>(null);

  const [dmConfig, setDmConfig] = useState<DmAgentConfig>({
    formLinks: [],
    offerUrls: [],
    servicePageUrls: [],
    brandVoice: "",
    escalationInfo: "",
    bookingLink: "",
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    if (!activeAccountId) return;
    const loadConfig = async () => {
      try {
        const res = await apiRequest("GET", `/api/accounts/${activeAccountId}/dm-config`);
        const data = await res.json();
        setDmConfig({
          formLinks: data.formLinks || [],
          offerUrls: data.offerUrls || [],
          servicePageUrls: data.servicePageUrls || [],
          brandVoice: data.brandVoice || "",
          escalationInfo: data.escalationInfo || "",
          bookingLink: data.bookingLink || "",
        });
        setConfigLoaded(true);
      } catch {
        setConfigLoaded(true);
      }
    };
    loadConfig();
  }, [activeAccountId]);

  const handleSaveConfig = async () => {
    if (!activeAccountId) {
      toast({ variant: "destructive", title: "No account selected", description: "Please select an account first." });
      return;
    }
    setIsSavingConfig(true);
    try {
      const cleanLinks = (links: LinkItem[]) => links.filter(l => l.label.trim() && l.url.trim());
      const payload = {
        ...dmConfig,
        formLinks: cleanLinks(dmConfig.formLinks),
        offerUrls: cleanLinks(dmConfig.offerUrls),
        servicePageUrls: cleanLinks(dmConfig.servicePageUrls),
      };
      await apiRequest("PUT", `/api/accounts/${activeAccountId}/dm-config`, payload);
      toast({ title: "DM Agent config saved", description: "Your settings will apply to new DM conversations." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err.message || "Could not save config" });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTrain = async () => {
    setIsTraining(true);
    setLogs([]);
    setTrainingProgress(5);

    try {
      const { jobId } = await api.startTraining(url, persona);
      setTrainingJobId(jobId);

      const interval = setInterval(async () => {
        try {
          const statusData = await api.getTrainingJob(jobId);

          if (statusData.logs && statusData.logs.length > 0) {
            setLogs(statusData.logs);
          }

          if (statusData.progress > 0) {
            setTrainingProgress(statusData.progress);
          }

          if (statusData.state === 'completed') {
            clearInterval(interval);
            setIsTraining(false);
            setTrainingProgress(100);
            if (statusData.generatedPersona) {
              setPersona(statusData.generatedPersona);
            }
            toast({
              title: "Training complete",
              description: "Your bot is ready to test. Switch to the Test Agent tab.",
            });
            setTimeout(() => setActiveTab("test"), 1000);
          }
        } catch (pollError) {
          clearInterval(interval);
          setLogs(prev => [...prev, "Error polling training status"]);
          setIsTraining(false);
        }
      }, 1500);

    } catch (error) {
        setLogs(prev => [...prev, "Error connecting to Training Engine"]);
        setIsTraining(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    try {
      const res = await apiRequest("POST", "/api/bot/chat", {
        message: userMsg,
        persona,
        conversationHistory: chatHistory,
        ...(trainingJobId ? { trainingJobId } : {}),
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err: any) {
      setChatHistory(prev => [...prev, { role: "assistant", content: "Sorry, I'm having trouble connecting right now. Please try again." }]);
      toast({
        variant: "destructive",
        title: "Chat error",
        description: err.message || "Failed to get AI response",
      });
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Bot className="h-8 w-8 text-indigo-500" />
            AI Bot Trainer
          </h1>
          <p className="text-muted-foreground mt-1">
            Train your AI agent with a knowledge base, then test it with real conversations.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white" data-testid="button-start-tutorial">
          <BookOpen size={16} className="mr-1" /> Tutorial
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="train">1. Train</TabsTrigger>
          <TabsTrigger value="test">2. Test Agent</TabsTrigger>
          <TabsTrigger value="dm-config">3. DM Config</TabsTrigger>
        </TabsList>

        <TabsContent value="train" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            <div className="space-y-8">
              <Card>
                <CardHeader>
                  <CardTitle>Source Material</CardTitle>
                  <CardDescription>Enter a URL to scrape and vectorize.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input 
                        data-testid="input-training-url"
                        value={url} 
                        onChange={(e) => setUrl(e.target.value)} 
                        className="pl-9" 
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>
                  
                  <div className="rounded-lg bg-muted/50 p-4 border border-border">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                      <Database className="h-3 w-3" />
                      Configuration
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Chunk Size:</span>
                        <span className="font-mono">1000 chars</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Overlap:</span>
                        <span className="font-mono">200 chars</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Model:</span>
                        <span className="font-mono text-indigo-500">GPT-4o</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Bot Persona</CardTitle>
                  <CardDescription>Define the system prompt for the AI agent.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea 
                    data-testid="input-bot-persona"
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                    className="min-h-[150px] font-mono text-sm"
                    placeholder="Enter system prompt..."
                  />
                </CardContent>
                <CardFooter>
                  <Button data-testid="button-start-training" onClick={handleTrain} disabled={isTraining} className="w-full bg-indigo-600 hover:bg-indigo-700">
                    {isTraining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {isTraining ? "Training..." : "Start Training"}
                  </Button>
                </CardFooter>
              </Card>
            </div>

            <Card className="bg-slate-950 border-slate-800 text-slate-50 flex flex-col h-full min-h-[500px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono text-slate-400">Terminal Output</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto font-mono text-xs space-y-2 pt-2">
                <AnimatePresence>
                  {logs.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2"
                    >
                      <span className="text-slate-500">{new Date().toLocaleTimeString()}</span>
                      <span>{log}</span>
                    </motion.div>
                  ))}
                  {isTraining && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-1 items-center text-indigo-400">
                      <span className="animate-pulse">_</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {!isTraining && logs.length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-slate-400">
                     <BrainCircuit className="h-12 w-12 mb-2 opacity-20" />
                     <p>Ready to train</p>
                   </div>
                )}
              </CardContent>
              {isTraining && <div className="h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${trainingProgress}%` }} />}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="test" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[600px]">
            
            <Card className="lg:col-span-2 flex flex-col shadow-lg border-indigo-100 dark:border-indigo-900/20">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                    <Bot className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Agent Preview</CardTitle>
                    <CardDescription className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Online — Powered by GPT-4o
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              
              <ScrollArea className="flex-1 p-4 bg-slate-50/50 dark:bg-slate-950/50">
                <div className="space-y-6">
                  {chatHistory.length === 0 && (
                    <div className="text-center text-muted-foreground py-10">
                      <Bot className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">Start a conversation</p>
                      <p className="text-sm mt-1">Messages are powered by real AI using your persona prompt above.</p>
                    </div>
                  )}
                  
                  {chatHistory.map((msg, i) => (
                    <motion.div 
                      key={i} 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm whitespace-pre-wrap break-words ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 border border-border rounded-bl-none'
                      }`}>
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}

                  {isTyping && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="bg-white dark:bg-slate-800 border border-border rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2 shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                        <span className="text-xs text-muted-foreground">AI is thinking...</span>
                      </div>
                    </motion.div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-4 bg-background border-t">
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                  className="flex gap-2"
                >
                  <Input 
                    data-testid="input-bot-chat"
                    placeholder="Type a message..." 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1"
                  />
                  <Button data-testid="button-bot-send" type="submit" disabled={!chatInput.trim() || isTyping}>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </Card>

            <Card className="bg-slate-50 dark:bg-slate-900 border-l-4 border-l-indigo-500 overflow-hidden flex flex-col">
              <CardHeader className="bg-muted/30 pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-indigo-500" />
                  Agent Config
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-0">
                <div className="p-4 space-y-6">

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Bot className="h-3 w-3" />
                      System Prompt
                    </h4>
                    <div className="bg-slate-950 text-slate-300 p-3 rounded text-[10px] font-mono border border-slate-800 max-h-[200px] overflow-y-auto">
                      {persona}
                    </div>
                  </div>

                  <Separator />
                  
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Database className="h-3 w-3" />
                      Model Info
                    </h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between p-2 bg-white dark:bg-black border rounded">
                        <span className="text-muted-foreground">Model</span>
                        <Badge variant="outline" className="text-[10px]">GPT-4o</Badge>
                      </div>
                      <div className="flex justify-between p-2 bg-white dark:bg-black border rounded">
                        <span className="text-muted-foreground">Temperature</span>
                        <span className="font-mono">0.7</span>
                      </div>
                      <div className="flex justify-between p-2 bg-white dark:bg-black border rounded">
                        <span className="text-muted-foreground">Max Tokens</span>
                        <span className="font-mono">300</span>
                      </div>
                      <div className="flex justify-between p-2 bg-white dark:bg-black border rounded">
                        <span className="text-muted-foreground">Messages</span>
                        <span className="font-mono">{chatHistory.length}</span>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Calendar className="h-3 w-3" />
                      Usage
                    </h4>
                    <div className="text-xs text-muted-foreground p-2 border rounded bg-white dark:bg-black">
                      Each message costs ~$0.10 and is logged to your billing dashboard.
                    </div>
                  </div>

                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="dm-config" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-indigo-500" />
                    Booking Link
                  </CardTitle>
                  <CardDescription>Primary booking/scheduling URL shared with leads.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Input
                    data-testid="input-dm-booking-link"
                    value={dmConfig.bookingLink}
                    onChange={(e) => setDmConfig(prev => ({ ...prev, bookingLink: e.target.value }))}
                    placeholder="https://calendly.com/your-business"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-indigo-500" />
                    Forms
                  </CardTitle>
                  <CardDescription>Forms the DM agent can share (intake forms, contact forms, etc.)</CardDescription>
                </CardHeader>
                <CardContent>
                  <LinkListEditor
                    items={dmConfig.formLinks}
                    onChange={(items) => setDmConfig(prev => ({ ...prev, formLinks: items }))}
                    labelPlaceholder="e.g. Intake Form"
                    urlPlaceholder="https://..."
                    testIdPrefix="form-link"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5 text-indigo-500" />
                    Offer URLs
                  </CardTitle>
                  <CardDescription>Special offers, promotions, or landing pages.</CardDescription>
                </CardHeader>
                <CardContent>
                  <LinkListEditor
                    items={dmConfig.offerUrls}
                    onChange={(items) => setDmConfig(prev => ({ ...prev, offerUrls: items }))}
                    labelPlaceholder="e.g. Spring Sale"
                    urlPlaceholder="https://..."
                    testIdPrefix="offer-url"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-indigo-500" />
                    Service Page URLs
                  </CardTitle>
                  <CardDescription>Links to specific service pages on your website.</CardDescription>
                </CardHeader>
                <CardContent>
                  <LinkListEditor
                    items={dmConfig.servicePageUrls}
                    onChange={(items) => setDmConfig(prev => ({ ...prev, servicePageUrls: items }))}
                    labelPlaceholder="e.g. Botox Page"
                    urlPlaceholder="https://..."
                    testIdPrefix="service-url"
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-indigo-500" />
                    Brand Voice
                  </CardTitle>
                  <CardDescription>Describe how the DM agent should sound. This shapes tone and personality across all DM replies.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    data-testid="input-dm-brand-voice"
                    value={dmConfig.brandVoice}
                    onChange={(e) => setDmConfig(prev => ({ ...prev, brandVoice: e.target.value }))}
                    placeholder="e.g. Warm and approachable, like a friendly receptionist. Use casual language, avoid corporate jargon. Upbeat but not over-the-top."
                    className="min-h-[100px]"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5 text-indigo-500" />
                    Escalation Instructions
                  </CardTitle>
                  <CardDescription>How the agent should hand off to a human. Include a phone number, email, or instructions.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    data-testid="input-dm-escalation"
                    value={dmConfig.escalationInfo}
                    onChange={(e) => setDmConfig(prev => ({ ...prev, escalationInfo: e.target.value }))}
                    placeholder="e.g. Transfer to Sarah at (555) 123-4567. Business hours are M-F 9am-5pm EST."
                    className="min-h-[80px]"
                  />
                </CardContent>
              </Card>

              <Card className="border-indigo-200 dark:border-indigo-900/30 bg-indigo-50/30 dark:bg-indigo-950/20">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-indigo-500" />
                    How it works
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <p>These settings are injected into every DM conversation on Facebook and Instagram. The agent uses them to:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Share the right links at the right time</li>
                    <li>Match your brand's voice and tone</li>
                    <li>Know when and how to escalate to a human</li>
                    <li>Adapt behavior based on conversation stage (new lead, qualifying, warm, ready-to-book, existing customer)</li>
                  </ul>
                  <p>The agent also pulls from your trained knowledge base and generated persona automatically.</p>
                </CardContent>
              </Card>

              <Button
                data-testid="button-save-dm-config"
                onClick={handleSaveConfig}
                disabled={isSavingConfig || !activeAccountId}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                size="lg"
              >
                {isSavingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isSavingConfig ? "Saving..." : "Save DM Agent Config"}
              </Button>

              {!activeAccountId && (
                <p className="text-xs text-amber-500 text-center">Select an account to save DM agent configuration.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      {showTutorial && <TutorialOverlay steps={BOT_TRAINER_STEPS} storageKey="apex_tutorial_bot_trainer" onClose={closeTutorial} accentColor="purple" />}
    </div>
  );
}

export default function BotTrainer() {
  return <PlanGate feature="ai_bots"><BotTrainerInner /></PlanGate>;
}
