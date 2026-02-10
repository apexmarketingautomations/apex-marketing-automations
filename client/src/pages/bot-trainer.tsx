import { useState, useEffect } from "react";
import { 
  Bot, 
  Globe, 
  Database, 
  Sparkles, 
  MessageSquare, 
  ArrowRight, 
  CheckCircle2, 
  BrainCircuit, 
  Calendar,
  Loader2,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

// --- MOCK DATA ---
const TRAINING_LOGS = [
  "🕷️ Scraping https://forge-fitness.com...",
  "📄 Found 12 pages of content",
  "✂️ Splitting text into 48 chunks (1000 chars each)",
  "🧠 Generating embeddings with OpenAI...",
  "💾 Saving to Postgres (PGVector)...",
  "✅ Training Complete. Bot is ready."
];

const KNOWLEDGE_CHUNKS = [
  { id: 1, text: "Forge Fitness is open 24/7 for members. Staffed hours are 8am-8pm daily.", score: 0.92 },
  { id: 2, text: "First class is always free. Just bring a valid ID and a towel.", score: 0.88 },
  { id: 3, text: "Personal training packages start at $400/mo for 4 sessions.", score: 0.85 }
];

const CHAT_SCENARIOS = {
  "availability": {
    user: "Do you have any openings for a PT session tomorrow afternoon?",
    rag_context: "Staffed hours are 8am-8pm daily. PT sessions available by appointment.",
    tool_call: { name: "check_calendar_availability", args: { date: "2026-02-11", time: "afternoon" } },
    bot_response: "I checked our calendar. We have a 4:00 PM and a 5:30 PM slot available tomorrow with Coach Mike. Would you like to grab one?"
  },
  "pricing": {
    user: "How much is the unlimited membership?",
    rag_context: "Unlimited membership is $150/mo. Drop-in is $20.",
    tool_call: null,
    bot_response: "Our Unlimited membership is $150/month, which gives you 24/7 access and all classes. We also have a drop-in rate of $20 if you just want to try it out!"
  }
};

const DEFAULT_PERSONA = "You are a helpful assistant for Forge Fitness. Be concise and friendly.";

export default function BotTrainer() {
  const [url, setUrl] = useState("https://forge-fitness.com");
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("train");
  
  // Chat Simulation State
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentTool, setCurrentTool] = useState<any>(null);
  const [ragContext, setRagContext] = useState<any[]>([]);

  const handleTrain = () => {
    setIsTraining(true);
    setLogs([]);
    setTrainingProgress(0);
    
    let step = 0;
    const interval = setInterval(() => {
      if (step >= TRAINING_LOGS.length) {
        clearInterval(interval);
        setIsTraining(false);
        setActiveTab("test"); // Auto-switch to test tab
        return;
      }
      
      setLogs(prev => [...prev, TRAINING_LOGS[step]]);
      setTrainingProgress(prev => prev + (100 / TRAINING_LOGS.length));
      step++;
    }, 800);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);
    setRagContext([]);
    setCurrentTool(null);

    // Simulate Processing Delay
    await new Promise(r => setTimeout(r, 600));

    // Determine scenario (simple keyword matching for demo)
    const scenario = userMsg.toLowerCase().includes("open") || userMsg.toLowerCase().includes("tomorrow") 
      ? CHAT_SCENARIOS.availability 
      : CHAT_SCENARIOS.pricing;

    // 1. Show RAG step
    setRagContext(KNOWLEDGE_CHUNKS);
    await new Promise(r => setTimeout(r, 800));

    // 2. Show Tool Call (if any)
    if (scenario.tool_call) {
      setCurrentTool(scenario.tool_call);
      await new Promise(r => setTimeout(r, 1200)); // Wait for "DB query"
      setCurrentTool(prev => ({ ...prev, status: "success", result: "Available: 4:00 PM, 5:30 PM" }));
      await new Promise(r => setTimeout(r, 800));
    }

    // 3. Bot Reply
    setIsTyping(false);
    setChatHistory(prev => [...prev, { role: "assistant", content: scenario.bot_response }]);
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Bot className="h-8 w-8 text-indigo-500" />
            AI Bot Trainer
          </h1>
          <p className="text-muted-foreground mt-1">
            Scrape your website, train the RAG knowledge base, and test the agent.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="train">1. Train Knowledge Base</TabsTrigger>
          <TabsTrigger value="test" disabled={logs.length === 0}>2. Test Agent</TabsTrigger>
        </TabsList>

        {/* TAB 1: TRAIN */}
        <TabsContent value="train" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Input Card */}
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
                        <span className="text-muted-foreground">Embedding Model:</span>
                        <span className="font-mono text-indigo-500">text-embedding-3-small</span>
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
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                    className="min-h-[100px] font-mono text-sm"
                    placeholder="Enter system prompt..."
                  />
                </CardContent>
                <CardFooter>
                  <Button onClick={handleTrain} disabled={isTraining} className="w-full bg-indigo-600 hover:bg-indigo-700">
                    {isTraining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {isTraining ? "Training..." : "Start Training"}
                  </Button>
                </CardFooter>
              </Card>
            </div>

            {/* Logs Output */}
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
                   <div className="h-full flex flex-col items-center justify-center text-slate-600">
                     <BrainCircuit className="h-12 w-12 mb-2 opacity-20" />
                     <p>Ready to train</p>
                   </div>
                )}
              </CardContent>
              {isTraining && <div className="h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${trainingProgress}%` }} />}
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: TEST */}
        <TabsContent value="test" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[600px]">
            
            {/* Left: Chat Interface */}
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
                      Online • Using Knowledge Base
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              
              <ScrollArea className="flex-1 p-4 bg-slate-50/50 dark:bg-slate-950/50">
                <div className="space-y-6">
                  {chatHistory.length === 0 && (
                    <div className="text-center text-muted-foreground py-10">
                      <p>Ask me about membership prices or availability!</p>
                    </div>
                  )}
                  
                  {chatHistory.map((msg, i) => (
                    <motion.div 
                      key={i} 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-white dark:bg-slate-800 border border-border rounded-bl-none'
                      }`}>
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}

                  {/* Typing / Thinking Indicator */}
                  {isTyping && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="bg-white dark:bg-slate-800 border border-border rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-2 shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                        <span className="text-xs text-muted-foreground">Thinking...</span>
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
                    placeholder="Type a message..." 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" disabled={!chatInput.trim() || isTyping}>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </Card>

            {/* Right: Debugger Panel */}
            <Card className="bg-slate-50 dark:bg-slate-900 border-l-4 border-l-indigo-500 overflow-hidden flex flex-col">
              <CardHeader className="bg-muted/30 pb-3">
                <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-indigo-500" />
                  Live Debugger
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-0">
                <div className="p-4 space-y-6">

                  {/* System Prompt Section */}
                   <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Bot className="h-3 w-3" />
                      System Prompt
                    </h4>
                    <div className="bg-slate-950 text-slate-300 p-2 rounded text-[10px] font-mono border border-slate-800">
                      {`{"role": "system", "content": "${persona}\\n\\nAnswer using this knowledge:\\n..."}`}
                    </div>
                  </div>

                  <Separator />
                  
                  {/* RAG Section */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Database className="h-3 w-3" />
                      Retrieved Context (RAG)
                    </h4>
                    {ragContext.length > 0 ? (
                      <div className="space-y-2">
                        {ragContext.map((chunk) => (
                          <motion.div 
                            key={chunk.id}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="bg-white dark:bg-black border border-indigo-100 dark:border-indigo-900/30 p-2 rounded text-xs shadow-sm"
                          >
                            <div className="flex justify-between mb-1">
                              <Badge variant="outline" className="text-[10px] py-0 h-4 border-indigo-200 text-indigo-600">
                                Chunk #{chunk.id}
                              </Badge>
                              <span className="text-[10px] text-green-600 font-mono">{(chunk.score * 100).toFixed(0)}% Match</span>
                            </div>
                            <p className="line-clamp-3 text-muted-foreground">{chunk.text}</p>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic p-2 border border-dashed rounded">
                        Waiting for query...
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Tools Section */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2">
                      <Calendar className="h-3 w-3" />
                      Tool Execution
                    </h4>
                    {currentTool ? (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-slate-950 text-slate-50 p-3 rounded-md font-mono text-[10px] space-y-2"
                      >
                        <div className="flex items-center gap-2 text-yellow-400">
                          <Loader2 className={`h-3 w-3 ${!currentTool.result ? 'animate-spin' : ''}`} />
                          <span>function_call: {currentTool.name}</span>
                        </div>
                        <div className="pl-4 border-l border-slate-700 text-slate-400">
                          {JSON.stringify(currentTool.args, null, 2)}
                        </div>
                        {currentTool.result && (
                          <motion.div 
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }}
                            className="text-green-400 pt-2 border-t border-slate-800 mt-2"
                          >
                            ◄ return: {currentTool.result}
                          </motion.div>
                        )}
                      </motion.div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic p-2 border border-dashed rounded">
                        No tools called
                      </div>
                    )}
                  </div>

                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
