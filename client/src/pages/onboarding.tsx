import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Building2, Phone, Bot, GitFork, CheckCircle2, ArrowRight, ArrowLeft, Sparkles, Globe, Zap, MessageSquare, Calendar, Star, SkipForward } from "lucide-react";

const STEPS = [
  { id: 1, label: "Business Info", icon: Building2 },
  { id: 2, label: "Phone Number", icon: Phone },
  { id: 3, label: "Train AI Bot", icon: Bot },
  { id: 4, label: "First Workflow", icon: GitFork },
  { id: 5, label: "Complete", icon: CheckCircle2 },
];

const INDUSTRIES = [
  { id: "gym", label: "Gym & Fitness" },
  { id: "real_estate", label: "Real Estate" },
  { id: "dental", label: "Dental & Medical" },
  { id: "contractor", label: "Home Services" },
  { id: "law_firm", label: "Law Firm" },
  { id: "auto_dealer", label: "Auto Dealership" },
  { id: "salon", label: "Salon & Spa" },
  { id: "education", label: "Education & Coaching" },
  { id: "restaurant", label: "Restaurant & Bar" },
  { id: "insurance", label: "Insurance Agency" },
  { id: "medspa", label: "Med Spa & Aesthetics" },
  { id: "property_mgmt", label: "Property Management" },
  { id: "logistics", label: "Logistics & Moving" },
  { id: "veterinary", label: "Veterinary Clinic" },
  { id: "photography", label: "Photography & Video" },
  { id: "nonprofit", label: "Nonprofit & Charity" },
  { id: "auto_repair", label: "Auto Repair Shop" },
  { id: "travel", label: "Travel & Hospitality" },
  { id: "financial", label: "Financial Services" },
];

const PERSONAS = [
  { id: "professional", label: "Professional", description: "Formal and business-oriented tone", emoji: "💼" },
  { id: "friendly", label: "Friendly", description: "Warm, approachable and personable", emoji: "😊" },
  { id: "casual", label: "Casual", description: "Relaxed and conversational style", emoji: "✌️" },
];

const WORKFLOW_TEMPLATES = [
  {
    id: "lead_response",
    title: "New Lead Auto-Response",
    description: "Automatically reply to new leads within seconds of them reaching out",
    icon: MessageSquare,
    color: "from-blue-500 to-cyan-500",
    badge: "Most Popular",
  },
  {
    id: "appointment_reminder",
    title: "Appointment Reminder",
    description: "Send automated reminders before scheduled appointments",
    icon: Calendar,
    color: "from-purple-500 to-pink-500",
    badge: "High Impact",
  },
  {
    id: "review_request",
    title: "Review Request",
    description: "Ask for Google reviews after completing a service",
    icon: Star,
    color: "from-amber-500 to-orange-500",
    badge: "Growth",
  },
];

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -300 : 300, opacity: 0 }),
};

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");

  const [twilioNumber, setTwilioNumber] = useState("");

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [persona, setPersona] = useState("");

  const [selectedWorkflow, setSelectedWorkflow] = useState("");

  const goNext = () => {
    setDirection(1);
    setCurrentStep((s) => Math.min(s + 1, 5));
  };

  const goBack = () => {
    setDirection(-1);
    setCurrentStep((s) => Math.max(s - 1, 1));
  };

  const isStep1Valid = businessName.trim() && industry;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start p-4 pt-8 md:pt-12">
      <div className="max-w-2xl w-full">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((step, idx) => (
              <div key={step.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center relative">
                  <div
                    className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                      currentStep > step.id
                        ? "bg-green-500 text-white"
                        : currentStep === step.id
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "bg-muted text-muted-foreground"
                    }`}
                    data-testid={`step-indicator-${step.id}`}
                  >
                    {currentStep > step.id ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={`text-[10px] md:text-xs mt-1.5 font-medium whitespace-nowrap ${
                      currentStep >= step.id ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 mt-[-20px] transition-colors duration-300 ${
                      currentStep > step.id ? "bg-green-500" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Step {currentStep} of 5
          </p>
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          {currentStep === 1 && (
            <motion.div
              key="step1"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="border-border/50">
                <CardContent className="p-6 md:p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-xl">
                      <Building2 className="h-7 w-7 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold" data-testid="text-step1-title">Tell Us About Your Business</h2>
                    <p className="text-muted-foreground">We'll customize your entire experience based on your industry.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Business Name *</label>
                      <Input
                        placeholder="e.g. Apex Marketing Solutions"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        data-testid="input-business-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Industry *</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                        {INDUSTRIES.map((ind) => (
                          <button
                            key={ind.id}
                            onClick={() => setIndustry(ind.id)}
                            className={`text-left px-3 py-2 rounded-lg border text-sm transition-all ${
                              industry === ind.id
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border hover:border-primary/50 text-foreground/80"
                            }`}
                            data-testid={`button-industry-${ind.id}`}
                          >
                            {ind.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Owner Phone</label>
                      <Input
                        placeholder="+1 (555) 000-0000"
                        value={ownerPhone}
                        onChange={(e) => setOwnerPhone(e.target.value)}
                        data-testid="input-owner-phone"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={goNext}
                      disabled={!isStep1Valid}
                      className="gap-2"
                      size="lg"
                      data-testid="button-step1-next"
                    >
                      Next <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="border-border/50">
                <CardContent className="p-6 md:p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-xl">
                      <Phone className="h-7 w-7 text-blue-500" />
                    </div>
                    <h2 className="text-2xl font-bold" data-testid="text-step2-title">Connect Your Phone Number</h2>
                    <p className="text-muted-foreground">Link a Twilio number to send and receive SMS messages with your contacts.</p>
                  </div>

                  <div className="bg-muted/30 rounded-xl p-5 border border-border/50 space-y-3">
                    <div className="flex items-start gap-3">
                      <Zap className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-sm">Why connect a phone number?</p>
                        <p className="text-sm text-muted-foreground">Enable 2-way SMS conversations, automated responses, and appointment reminders directly from your dashboard.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Globe className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-sm">Powered by Twilio</p>
                        <p className="text-sm text-muted-foreground">Industry-leading SMS infrastructure with 99.95% uptime and global reach.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Existing Twilio Number (optional)</label>
                    <Input
                      placeholder="+1 (555) 000-0000"
                      value={twilioNumber}
                      onChange={(e) => setTwilioNumber(e.target.value)}
                      data-testid="input-twilio-number"
                    />
                    <p className="text-xs text-muted-foreground">If you already have a Twilio number, enter it here. Otherwise, you can set this up later.</p>
                  </div>

                  <div className="flex justify-between pt-2">
                    <Button variant="ghost" onClick={goBack} className="gap-2" data-testid="button-step2-back">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={goNext} className="gap-2" data-testid="button-step2-skip">
                        <SkipForward className="h-4 w-4" /> Skip
                      </Button>
                      <Button
                        onClick={() => {
                          if (twilioNumber.trim()) {
                            toast({ title: "Phone number saved", description: "Your Twilio number has been connected." });
                          }
                          goNext();
                        }}
                        className="gap-2"
                        data-testid="button-step2-connect"
                      >
                        Connect <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="border-border/50">
                <CardContent className="p-6 md:p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center p-3 bg-purple-500/10 rounded-xl">
                      <Bot className="h-7 w-7 text-purple-500" />
                    </div>
                    <h2 className="text-2xl font-bold" data-testid="text-step3-title">Train Your AI Bot</h2>
                    <p className="text-muted-foreground">Give your AI assistant knowledge about your business so it can respond to leads intelligently.</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Website URL</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="https://yourbusiness.com"
                          value={websiteUrl}
                          onChange={(e) => setWebsiteUrl(e.target.value)}
                          className="pl-10"
                          data-testid="input-website-url"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">We'll scrape your website to train the AI on your services, pricing, and FAQs.</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">Bot Persona</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {PERSONAS.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setPersona(p.id)}
                            className={`p-4 rounded-xl border text-left transition-all ${
                              persona === p.id
                                ? "border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/20"
                                : "border-border hover:border-purple-500/50"
                            }`}
                            data-testid={`button-persona-${p.id}`}
                          >
                            <span className="text-2xl">{p.emoji}</span>
                            <p className="font-medium mt-2">{p.label}</p>
                            <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-2">
                    <Button variant="ghost" onClick={goBack} className="gap-2" data-testid="button-step3-back">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={goNext} className="gap-2" data-testid="button-step3-skip">
                        <SkipForward className="h-4 w-4" /> Skip
                      </Button>
                      <Button
                        onClick={() => {
                          if (websiteUrl.trim()) {
                            toast({ title: "Training started", description: "Your AI bot is being trained on your website content." });
                          }
                          goNext();
                        }}
                        className="gap-2 bg-purple-600 hover:bg-purple-700"
                        data-testid="button-step3-train"
                      >
                        <Sparkles className="h-4 w-4" /> Start Training
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div
              key="step4"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="border-border/50">
                <CardContent className="p-6 md:p-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center p-3 bg-green-500/10 rounded-xl">
                      <GitFork className="h-7 w-7 text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold" data-testid="text-step4-title">Launch Your First Workflow</h2>
                    <p className="text-muted-foreground">Choose a pre-built automation to start engaging your contacts immediately.</p>
                  </div>

                  <div className="space-y-3">
                    {WORKFLOW_TEMPLATES.map((wf) => (
                      <button
                        key={wf.id}
                        onClick={() => setSelectedWorkflow(wf.id === selectedWorkflow ? "" : wf.id)}
                        className={`w-full text-left p-4 rounded-xl border transition-all ${
                          selectedWorkflow === wf.id
                            ? "border-green-500 bg-green-500/5 ring-2 ring-green-500/20"
                            : "border-border hover:border-green-500/50"
                        }`}
                        data-testid={`button-workflow-${wf.id}`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-xl bg-gradient-to-br ${wf.color} text-white shrink-0`}>
                            <wf.icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold">{wf.title}</p>
                              <Badge variant="secondary" className="text-[10px]">{wf.badge}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{wf.description}</p>
                          </div>
                          {selectedWorkflow === wf.id && (
                            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-1" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between pt-2">
                    <Button variant="ghost" onClick={goBack} className="gap-2" data-testid="button-step4-back">
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={goNext} className="gap-2" data-testid="button-step4-skip">
                        <SkipForward className="h-4 w-4" /> Skip
                      </Button>
                      <Button
                        onClick={() => {
                          if (selectedWorkflow) {
                            const wf = WORKFLOW_TEMPLATES.find((w) => w.id === selectedWorkflow);
                            toast({ title: "Workflow deployed!", description: `"${wf?.title}" is now active.` });
                          }
                          goNext();
                        }}
                        className="gap-2 bg-green-600 hover:bg-green-700"
                        disabled={!selectedWorkflow}
                        data-testid="button-step4-deploy"
                      >
                        <Zap className="h-4 w-4" /> Deploy
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 5 && (
            <motion.div
              key="step5"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <Card className="border-green-500/20 bg-green-500/5 overflow-hidden relative">
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-2 h-2 rounded-full"
                      style={{
                        background: ["#10b981", "#8b5cf6", "#3b82f6", "#f59e0b", "#ec4899", "#06b6d4"][i % 6],
                        left: `${10 + Math.random() * 80}%`,
                        top: "-10px",
                      }}
                      animate={{
                        y: [0, 500],
                        x: [0, (Math.random() - 0.5) * 100],
                        opacity: [1, 0],
                        scale: [1, 0.5],
                      }}
                      transition={{
                        duration: 2 + Math.random() * 2,
                        delay: Math.random() * 1.5,
                        repeat: Infinity,
                        repeatDelay: Math.random() * 3,
                      }}
                    />
                  ))}
                </div>

                <CardContent className="p-8 md:p-12 text-center space-y-6 relative z-10">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
                  >
                    <div className="h-20 w-20 bg-green-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-500/30">
                      <CheckCircle2 className="h-10 w-10 text-white" />
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="space-y-2"
                  >
                    <h2 className="text-3xl font-bold" data-testid="text-step5-title">Your Account is Ready! 🎉</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      {businessName ? `${businessName} is` : "Everything is"} all set up and ready to go. Start managing your leads, automations, and conversations from your dashboard.
                    </p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="grid grid-cols-3 gap-4 max-w-sm mx-auto"
                  >
                    <div className="p-3 rounded-xl bg-background/60 border border-border/50">
                      <p className="text-2xl font-bold text-foreground">✓</p>
                      <p className="text-xs text-muted-foreground mt-1">Business</p>
                    </div>
                    <div className="p-3 rounded-xl bg-background/60 border border-border/50">
                      <p className="text-2xl font-bold text-foreground">{twilioNumber ? "✓" : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Phone</p>
                    </div>
                    <div className="p-3 rounded-xl bg-background/60 border border-border/50">
                      <p className="text-2xl font-bold text-foreground">{selectedWorkflow ? "✓" : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Workflow</p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="pt-4"
                  >
                    <Button
                      size="lg"
                      onClick={() => setLocation("/")}
                      className="gap-2 px-8"
                      data-testid="button-go-to-dashboard"
                    >
                      Go to Dashboard <ArrowRight className="h-4 w-4" />
                    </Button>
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
