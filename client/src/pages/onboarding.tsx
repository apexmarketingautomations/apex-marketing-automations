import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Briefcase, Dumbbell, Home, Stethoscope, Hammer, ArrowRight, Database, LayoutTemplate, Columns, Scale, Car, Scissors, GraduationCap, UtensilsCrossed, ShieldCheck, Sparkles, Building2, Truck, Dog, Camera, Heart, Wrench, Palmtree, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

const INDUSTRIES = [
  { id: "gym", label: "Gym & Fitness", icon: Dumbbell, color: "text-red-500", bg: "bg-red-500/10" },
  { id: "real_estate", label: "Real Estate", icon: Home, color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "dental", label: "Dental & Medical", icon: Stethoscope, color: "text-teal-500", bg: "bg-teal-500/10" },
  { id: "contractor", label: "Home Services", icon: Hammer, color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "law_firm", label: "Law Firm", icon: Scale, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  { id: "auto_dealer", label: "Auto Dealership", icon: Car, color: "text-slate-500", bg: "bg-slate-500/10" },
  { id: "salon", label: "Salon & Spa", icon: Scissors, color: "text-pink-500", bg: "bg-pink-500/10" },
  { id: "education", label: "Education & Coaching", icon: GraduationCap, color: "text-violet-500", bg: "bg-violet-500/10" },
  { id: "restaurant", label: "Restaurant & Bar", icon: UtensilsCrossed, color: "text-orange-500", bg: "bg-orange-500/10" },
  { id: "insurance", label: "Insurance Agency", icon: ShieldCheck, color: "text-green-500", bg: "bg-green-500/10" },
  { id: "medspa", label: "Med Spa & Aesthetics", icon: Sparkles, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10" },
  { id: "property_mgmt", label: "Property Management", icon: Building2, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { id: "logistics", label: "Logistics & Moving", icon: Truck, color: "text-yellow-500", bg: "bg-yellow-500/10" },
  { id: "veterinary", label: "Veterinary Clinic", icon: Dog, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "photography", label: "Photography & Video", icon: Camera, color: "text-rose-500", bg: "bg-rose-500/10" },
  { id: "nonprofit", label: "Nonprofit & Charity", icon: Heart, color: "text-red-400", bg: "bg-red-400/10" },
  { id: "auto_repair", label: "Auto Repair Shop", icon: Wrench, color: "text-zinc-500", bg: "bg-zinc-500/10" },
  { id: "travel", label: "Travel & Hospitality", icon: Palmtree, color: "text-sky-500", bg: "bg-sky-500/10" },
  { id: "financial", label: "Financial Services", icon: Landmark, color: "text-emerald-600", bg: "bg-emerald-600/10" },
];

export default function Onboarding() {
  const [step, setStep] = useState<"select" | "setup" | "complete">("select");
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [, setLocation] = useLocation();
  const [blueprint, setBlueprint] = useState<{ title: string; stages: string[]; fields: string[]; templates: string[] } | null>(null);
  const apiDoneRef = useRef(false);
  const animDoneRef = useRef(false);

  const startSetup = (industryId: string) => {
    setSelectedIndustry(industryId);
    setStep("setup");
    apiDoneRef.current = false;
    animDoneRef.current = false;

    const industryLabel = INDUSTRIES.find(i => i.id === industryId)?.label || industryId;

    api.onboard(industryId).then((data: { account: any; blueprint: { title: string; stages: string[]; fields: string[]; templates: string[] } }) => {
      setBlueprint(data.blueprint);
      apiDoneRef.current = true;
      if (animDoneRef.current) {
        setStep("complete");
      }
    }).catch(() => {
      apiDoneRef.current = true;
      if (animDoneRef.current) {
        setStep("complete");
      }
    });

    const steps = [
      { msg: `Fetching AI Blueprint for ${industryLabel}...`, progress: 20, delay: 800 },
      { msg: "Analyzing industry standards...", progress: 40, delay: 1500 },
      { msg: "Creating pipeline stages in database...", progress: 60, delay: 2200 },
      { msg: "Configuring custom fields...", progress: 80, delay: 3000 },
      { msg: "Generating SMS/Email templates...", progress: 95, delay: 3800 },
      { msg: "Account Ready.", progress: 100, delay: 4500 },
    ];

    let currentStep = 0;

    const runNextStep = () => {
      if (currentStep >= steps.length) {
        animDoneRef.current = true;
        if (apiDoneRef.current) {
          setStep("complete");
        }
        return;
      }

      const s = steps[currentStep];
      setTimeout(() => {
        setLog(prev => [...prev, s.msg]);
        setProgress(s.progress);
        currentStep++;
        runNextStep();
      }, s.delay - (currentStep > 0 ? steps[currentStep-1].delay : 0));
    };

    runNextStep();
  };

  const [searchQuery, setSearchQuery] = useState("");
  const filteredIndustries = INDUSTRIES.filter(ind =>
    ind.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start p-4 pt-10">
      
      <div className="max-w-5xl w-full">
        {/* Header */}
        <div className="text-center mb-8 space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-primary/10 rounded-xl mb-4">
            <Briefcase className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Account Setup</h1>
          <p className="text-muted-foreground">Select your industry to auto-configure your CRM with AI-powered pipelines, templates, and automations.</p>
        </div>

        <AnimatePresence mode="wait">
          
          {/* STEP 1: SELECT INDUSTRY */}
          {step === "select" && (
            <motion.div 
              key="select"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div className="relative max-w-md mx-auto">
                <ArrowRight className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground rotate-180" />
                <Input
                  placeholder="Search industries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-industry"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredIndustries.map((ind) => (
                <Card 
                  key={ind.id} 
                  className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
                  onClick={() => startSetup(ind.id)}
                  data-testid={`card-industry-${ind.id}`}
                >
                  <CardContent className="p-5 flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${ind.bg} ${ind.color} group-hover:scale-110 transition-transform`}>
                      <ind.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">{ind.label}</h3>
                      <p className="text-sm text-muted-foreground">Auto-configure for {ind.label}</p>
                    </div>
                    <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardContent>
                </Card>
              ))}
              </div>
            </motion.div>
          )}

          {/* STEP 2: SETUP PROGRESS */}
          {step === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-xl shadow-lg p-8 space-y-8"
            >
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="flex items-center gap-2 text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Configuring Account...
                  </span>
                  <span className="text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              <div className="space-y-2 bg-muted/30 p-4 rounded-lg font-mono text-sm h-48 overflow-y-auto border border-border/50">
                {log.map((line, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2 text-foreground/80"
                  >
                    <Check className="h-3 w-3 text-green-500" />
                    {line}
                  </motion.div>
                ))}
                {progress < 100 && (
                   <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    className="flex items-center gap-2 text-muted-foreground animate-pulse"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    Processing...
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 3: COMPLETE */}
          {step === "complete" && blueprint && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <Card className="border-green-500/20 bg-green-500/5">
                <CardContent className="p-6 text-center space-y-4">
                  <div className="h-16 w-16 bg-green-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-500/20">
                    <Check className="h-8 w-8 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground">Setup Complete!</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    We've configured your account for the <strong>{blueprint.title}</strong> industry standards.
                  </p>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-md">
                      <LayoutTemplate className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{blueprint.stages.length} Pipelines</p>
                      <p className="text-xs text-muted-foreground mt-1">{blueprint.stages.join(", ")}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="p-2 bg-purple-100 text-purple-600 rounded-md">
                      <Columns className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{blueprint.fields.length} Custom Fields</p>
                      <p className="text-xs text-muted-foreground mt-1">{blueprint.fields.join(", ")}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-md">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{blueprint.templates.length} Templates</p>
                      <p className="text-xs text-muted-foreground mt-1">Ready to use</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-center pt-8">
                <Button size="lg" onClick={() => setLocation("/")} className="gap-2">
                  Enter Dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
