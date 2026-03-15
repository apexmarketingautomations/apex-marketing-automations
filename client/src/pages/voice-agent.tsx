import { PlanGate } from "@/components/plan-gate";
import { useState, useEffect, useRef } from "react";
import {
  Phone,
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  User,
  Volume2,
  Settings2,
  Rocket,
  RefreshCcw,
  Copy,
  PhoneCall,
  Clock,
  PhoneOutgoing,
  X,
  ShieldAlert,
  Plus,
  Trash2,
  Search,
  ShoppingCart,
  Wifi,
  MessageSquare,
  BookOpen,
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { VOICE_AGENT_STEPS } from "@/components/tutorial-steps";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CallPlayer } from "@/components/call-player";
import Vapi from "@vapi-ai/web";

interface ObjectionRule {
  trigger: string;
  response: string;
  note?: string;
}

const DEFAULT_OBJECTION_RULES: ObjectionRule[] = [
  {
    trigger: "I'm busy",
    response: "No worries, I'll be super quick. I just wanted to ask...",
    note: "Pivot back to script",
  },
  {
    trigger: "Not interested",
    response: "Totally fair. Just so I don't bother you again, was it the price?",
  },
  {
    trigger: "Are you a robot?",
    response: "I'm a virtual assistant, but I can book appointments. Want to grab a slot?",
    note: "DO NOT lie and say you are human — it kills trust",
  },
];

const VOICE_OPTIONS = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "Mature, reassuring female", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", desc: "Laid-back, casual male", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", desc: "Clear, engaging female", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", desc: "Deep, confident male", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "Professional, upbeat female", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "Dominant, firm male", previewUrl: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3" },
];

type VoiceProvider = "11labs" | "elevenlabs";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  preview_url: string;
}

function VoiceAgentInner() {
  const [step, setStep] = useState<"describe" | "configure" | "deployed">("describe");
  const [businessPrompt, setBusinessPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [persona, setPersona] = useState("");
  const [firstMessage, setFirstMessage] = useState("Hi, this is Sarah on a recorded line. How can I help?");
  const [agentName, setAgentName] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS[0].id);
  const [deployedAgent, setDeployedAgent] = useState<any>(null);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [existingAgents, setExistingAgents] = useState<any[]>([]);
  const [hasVapiKey, setHasVapiKey] = useState<boolean | null>(null);
  const [callAgentId, setCallAgentId] = useState<string | null>(null);
  const [callPhone, setCallPhone] = useState("");
  const [callPhoneNumberId, setCallPhoneNumberId] = useState("");
  const [isCalling, setIsCalling] = useState(false);
  const [callResult, setCallResult] = useState<any>(null);
  const [demoActive, setDemoActive] = useState(false);
  const [demoConnecting, setDemoConnecting] = useState(false);
  const [demoVolume, setDemoVolume] = useState(0);
  const [demoAgentName, setDemoAgentName] = useState<string>("");
  const [objectionRules, setObjectionRules] = useState<ObjectionRule[]>(DEFAULT_OBJECTION_RULES);
  const [phoneConfig, setPhoneConfig] = useState<{ hasTwilio: boolean; hasVapi: boolean; webhookDomain: string | null } | null>(null);
  const [areaCode, setAreaCode] = useState("305");
  const [searchingNumbers, setSearchingNumbers] = useState(false);
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [purchasingNumber, setPurchasingNumber] = useState<string | null>(null);
  const [ownedNumbers, setOwnedNumbers] = useState<any[]>([]);
  const [purchasedNumber, setPurchasedNumber] = useState<any>(null);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [loadingCallLogs, setLoadingCallLogs] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("11labs");
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState<boolean | null>(null);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingElevenLabsVoices, setLoadingElevenLabsVoices] = useState(false);
  const vapiRef = useRef<Vapi | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_tutorial_voice_agent");

  useEffect(() => {
    fetch("/api/elevenlabs/config")
      .then((r) => r.json())
      .then((data) => setHasElevenLabsKey(data.isConfigured))
      .catch(() => setHasElevenLabsKey(false));
  }, []);

  useEffect(() => {
    if (voiceProvider === "elevenlabs" && elevenLabsVoices.length === 0 && !loadingElevenLabsVoices) {
      setLoadingElevenLabsVoices(true);
      fetch("/api/elevenlabs/voices")
        .then((r) => r.json())
        .then((data) => {
          if (data.voices && Array.isArray(data.voices)) {
            setElevenLabsVoices(data.voices);
            if (data.voices.length > 0) {
              setSelectedVoice(data.voices[0].voice_id);
            }
          }
        })
        .catch(() => {
          toast({ title: "Error", description: "Could not load ElevenLabs voices.", variant: "destructive" });
        })
        .finally(() => setLoadingElevenLabsVoices(false));
    }
  }, [voiceProvider]);

  useEffect(() => {
    fetch("/api/vapi/get-config")
      .then((r) => r.json())
      .then((data) => {
        setHasVapiKey(data.isConfigured);
      })
      .catch(() => setHasVapiKey(false));

    fetch("/api/voice-agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setExistingAgents(data);
        }
      })
      .catch(e => console.error("Failed to load voice agents:", e));

    fetch("/api/phone-numbers/config")
      .then((r) => r.json())
      .then((data) => setPhoneConfig(data))
      .catch(e => console.error("Failed to load phone config:", e));

    fetch("/api/phone-numbers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setOwnedNumbers(data);
        else if (data?.numbers && Array.isArray(data.numbers)) setOwnedNumbers(data.numbers);
      })
      .catch(e => console.error("Failed to load phone numbers:", e));
  }, []);

  useEffect(() => {
    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
    };
  }, []);

  const handleGeneratePersona = async () => {
    if (!businessPrompt.trim()) return;
    setIsGenerating(true);

    try {
      const res = await fetch("/api/voice-agents/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDescription: businessPrompt }),
      });

      if (!res.ok) throw new Error("Failed to generate persona");

      const data = await res.json();
      setPersona(data.persona || "");
      setFirstMessage(data.firstMessage || "");
      setAgentName(data.suggestedName || "AI Assistant");
      setStep("configure");
    } catch (err: any) {
      toast({
        title: "Generation Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const fetchCallLogs = async (agentId?: string) => {
    setLoadingCallLogs(true);
    try {
      const url = agentId ? `/api/voice-agents/calls?assistantId=${agentId}&limit=10` : "/api/voice-agents/calls?limit=10";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data)) setCallLogs(data);
    } catch {
      setCallLogs([]);
    } finally {
      setLoadingCallLogs(false);
    }
  };

  const searchNumbers = async () => {
    setSearchingNumbers(true);
    setAvailableNumbers([]);
    try {
      const res = await fetch(`/api/phone-numbers/search?areaCode=${areaCode}&limit=5`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Search failed");
      }
      const data = await res.json();
      setAvailableNumbers(data);
      if (data.length === 0) {
        toast({ title: "No Numbers Found", description: `No numbers available in area code ${areaCode}. Try another.`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Search Failed", description: err.message, variant: "destructive" });
    } finally {
      setSearchingNumbers(false);
    }
  };

  const purchaseNumber = async (phoneNumber: string, agentId?: string) => {
    setPurchasingNumber(phoneNumber);
    try {
      const res = await fetch("/api/phone-numbers/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, assistantId: agentId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Purchase failed");
      }
      const data = await res.json();
      setPurchasedNumber(data);
      setAvailableNumbers([]);
      setOwnedNumbers((prev) => [...prev, { sid: data.sid, phoneNumber: data.phoneNumber, friendlyName: data.friendlyName, vapiPhoneId: data.vapiPhoneId || null }]);
      toast({ title: "Number Purchased!", description: `${data.phoneNumber} is now active and linked to your AI agent.` });
    } catch (err: any) {
      toast({ title: "Purchase Failed", description: err.message, variant: "destructive" });
    } finally {
      setPurchasingNumber(null);
    }
  };

  const handleDeploy = async () => {
    if (!persona || !firstMessage) return;
    setIsDeploying(true);

    try {
      const res = await fetch("/api/voice-agents/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          firstMessage,
          voiceId: selectedVoice,
          voiceProvider: "11labs",
          objectionRules: objectionRules.filter((r) => r.trigger.trim() && r.response.trim()),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Deployment failed");
      }

      const agent = await res.json();
      const newAgentName = agentName || agent.name || "Agent";
      setDeployedAgent(agent);
      setSelectedAgent({ id: agent.id, name: newAgentName });
      setExistingAgents((prev) => [{ id: agent.id, name: newAgentName, createdAt: new Date().toISOString(), model: agent.model?.model, voice: agent.voice?.voiceId }, ...prev]);
      setStep("deployed");
      fetchCallLogs(agent.id);
      toast({ title: "Agent Deployed!", description: `${newAgentName} is ready to take calls.` });
    } catch (err: any) {
      toast({
        title: "Deployment Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const copyAgentId = () => {
    const id = selectedAgent?.id || deployedAgent?.id;
    if (id) {
      navigator.clipboard.writeText(id);
      toast({ title: "Copied!", description: "Agent ID copied to clipboard." });
    }
  };

  const formatE164 = (phone: string): string => {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (phone.startsWith("+")) return phone.trim();
    return `+${digits}`;
  };

  const handleOutboundCall = async () => {
    if (!callAgentId || !callPhone.trim()) return;
    setIsCalling(true);
    setCallResult(null);

    const formattedPhone = formatE164(callPhone.trim());

    try {
      const res = await fetch("/api/voice-agents/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: callAgentId,
          customerPhone: formattedPhone,
          phoneNumberId: callPhoneNumberId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Call failed");
      }

      const data = await res.json();
      setCallResult(data);
      toast({ title: "Call Initiated!", description: `Call ${data.callId} is ${data.status}.` });
    } catch (err: any) {
      toast({ title: "Call Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsCalling(false);
    }
  };

  const playVoicePreview = (voiceId: string, previewUrl: string) => {
    if (playingVoiceId === voiceId && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingVoiceId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    setPlayingVoiceId(voiceId);
    audio.play().catch(() => {
      setPlayingVoiceId(null);
      toast({ title: "Playback Error", description: "Could not play voice preview.", variant: "destructive" });
    });
    audio.onended = () => {
      setPlayingVoiceId(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingVoiceId(null);
      audioRef.current = null;
    };
  };

  const openCallPanel = (agentId: string) => {
    setCallAgentId(agentId);
    setCallPhone("");
    setCallPhoneNumberId("");
    setCallResult(null);
  };

  const startDemoCall = async (agentId: string, name?: string) => {
    if (!hasVapiKey) {
      toast({ title: "Missing Key", description: "Vapi keys are not configured in Secrets.", variant: "destructive" });
      return;
    }

    setDemoConnecting(true);
    setDemoAgentName(name || "Agent");

    try {
      const configRes = await fetch("/api/vapi/get-config");
      const config = await configRes.json();
      if (!config.publicKey) {
        throw new Error("Vapi public key is not configured. Add VAPI_PUBLIC_KEY in Secrets.");
      }

      const webCallRes = await fetch("/api/vapi/start-web-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantId: agentId }),
      });

      if (!webCallRes.ok) {
        const errData = await webCallRes.json().catch(() => ({ error: "Failed to create web call" }));
        throw new Error(errData.error || errData.detail || "Failed to create web call");
      }

      const { webCallUrl } = await webCallRes.json();
      if (!webCallUrl) {
        throw new Error("No webCallUrl returned from server");
      }

      const vapi = new Vapi(config.publicKey);
      vapiRef.current = vapi;

      const connectTimeout = setTimeout(() => {
        if (!vapiRef.current) return;
        setDemoConnecting(false);
        toast({ title: "Connection Timeout", description: "Demo call took too long to connect. Please try again.", variant: "destructive" });
        try { vapiRef.current.stop(); } catch {}
        vapiRef.current = null;
      }, 20000);

      vapi.on("call-start", () => {
        clearTimeout(connectTimeout);
        setDemoConnecting(false);
        setDemoActive(true);
      });

      vapi.on("call-end", () => {
        clearTimeout(connectTimeout);
        setDemoActive(false);
        setDemoConnecting(false);
        setDemoVolume(0);
        vapiRef.current = null;
      });

      vapi.on("volume-level", (level: number) => {
        setDemoVolume(level);
      });

      vapi.on("error", (err: any) => {
        clearTimeout(connectTimeout);
        console.error("Vapi error:", JSON.stringify(err));
        setDemoActive(false);
        setDemoConnecting(false);
        vapiRef.current = null;
        let errMsg = "The demo call encountered an error.";
        if (typeof err === "string") errMsg = err;
        else if (typeof err?.message === "string") errMsg = err.message;
        else if (typeof err?.error === "string") errMsg = err.error;
        else if (typeof err?.error?.message === "string") errMsg = err.error.message;
        else if (typeof err?.errorMessage === "string") errMsg = err.errorMessage;
        else { try { errMsg = JSON.stringify(err); } catch {} }
        toast({ title: "Call Error", description: errMsg, variant: "destructive" });
      });

      await (vapi as any).reconnect({ webCallUrl });
    } catch (err: any) {
      console.error("Vapi start error:", err);
      setDemoConnecting(false);
      let errMsg = "Could not start browser call. Make sure you allow microphone access.";
      if (typeof err?.message === "string") errMsg = err.message;
      else if (typeof err?.error === "string") errMsg = err.error;
      else { try { errMsg = JSON.stringify(err); } catch {} }
      toast({ title: "Failed to Start", description: errMsg, variant: "destructive" });
    }
  };

  const stopDemoCall = () => {
    if (vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current = null;
    }
    setDemoActive(false);
    setDemoConnecting(false);
    setDemoVolume(0);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-500/20 mb-4">
            <Phone className="text-violet-400" size={32} />
          </div>
          <h1 className="text-3xl font-bold">Voice Agent Studio</h1>
          <p className="text-neutral-400 mt-2">Deploy AI phone agents that book appointments, answer questions, and close deals.</p>
          <Button variant="ghost" size="sm" onClick={startTutorial} className="text-slate-400 hover:text-white mt-3" data-testid="button-start-tutorial">
            <BookOpen size={16} className="mr-1" /> Tutorial
          </Button>
        </div>

        <div className="flex items-center justify-center gap-2 mb-10">
          {["describe", "configure", "deployed"].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step === s
                    ? "bg-violet-500 text-white"
                    : ["describe", "configure", "deployed"].indexOf(step) > i
                    ? "bg-green-500 text-white"
                    : "bg-white/10 text-neutral-500"
                }`}
                data-testid={`step-indicator-${s}`}
              >
                {["describe", "configure", "deployed"].indexOf(step) > i ? (
                  <CheckCircle2 size={16} />
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-sm hidden md:inline ${step === s ? "text-white" : "text-neutral-500"}`}>
                {s === "describe" ? "Describe" : s === "configure" ? "Configure" : "Deployed"}
              </span>
              {i < 2 && <div className="w-12 h-px bg-white/10 mx-2" />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === "describe" && (
            <motion.div
              key="describe"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <Sparkles className="text-violet-400" />
                  <h2 className="text-xl font-bold">Describe Your Business</h2>
                </div>
                <p className="text-sm text-neutral-400">
                  Tell us about your business and what you want your voice agent to do. AI will generate the perfect persona.
                </p>

                <textarea
                  value={businessPrompt}
                  onChange={(e) => setBusinessPrompt(e.target.value)}
                  placeholder="e.g., I run a luxury med spa in Miami. I want the agent to answer calls, book Botox and filler appointments, and handle pricing questions. It should sound warm and professional."
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-violet-500 resize-none"
                  data-testid="input-business-description"
                />

                <div className="text-center text-neutral-500 text-sm p-4 border border-dashed border-white/10 rounded-xl">
                  <p className="mb-3">Try descriptions like:</p>
                  <ul className="space-y-2 text-violet-400">
                    <li>
                      <button
                        className="hover:underline text-left"
                        onClick={() =>
                          setBusinessPrompt(
                            "Luxury med spa in Miami. Agent books Botox & filler appointments, handles pricing, sounds warm and professional."
                          )
                        }
                        data-testid="button-example-medspa"
                      >
                        "Med spa - book appointments, handle pricing"
                      </button>
                    </li>
                    <li>
                      <button
                        className="hover:underline text-left"
                        onClick={() =>
                          setBusinessPrompt(
                            "Personal training gym in LA. Agent signs up new members for a 6-week challenge, handles objections, energetic and motivating."
                          )
                        }
                        data-testid="button-example-gym"
                      >
                        "Gym - sign up members, handle objections"
                      </button>
                    </li>
                    <li>
                      <button
                        className="hover:underline text-left"
                        onClick={() =>
                          setBusinessPrompt(
                            "Dental practice. Agent schedules cleanings and consultations, answers insurance questions, friendly and reassuring."
                          )
                        }
                        data-testid="button-example-dental"
                      >
                        "Dental - schedule visits, answer insurance questions"
                      </button>
                    </li>
                  </ul>
                </div>

                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700 h-12 text-base"
                  onClick={handleGeneratePersona}
                  disabled={isGenerating || !businessPrompt.trim()}
                  data-testid="button-generate-persona"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 animate-spin" size={18} /> Generating Agent Persona...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2" size={18} /> Generate Agent Persona
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "configure" && (
            <motion.div
              key="configure"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-white/5 border border-white/10 rounded-2xl p-8 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <Settings2 className="text-violet-400" />
                  <h2 className="text-xl font-bold">Configure Your Agent</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-neutral-400 mb-2 block">Agent Name</label>
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      className="bg-white/5 border-white/10"
                      data-testid="input-agent-name"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-neutral-400 mb-2 block flex items-center gap-2">
                      <User size={14} /> Agent Persona
                    </label>
                    <textarea
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                      className="w-full h-24 bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-violet-500 resize-none"
                      data-testid="input-persona"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-neutral-400 mb-2 block flex items-center gap-2">
                      <PhoneCall size={14} /> First Message (What the agent says when it picks up)
                    </label>
                    <Input
                      value={firstMessage}
                      onChange={(e) => setFirstMessage(e.target.value)}
                      className="bg-white/5 border-white/10"
                      data-testid="input-first-message"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-neutral-400 mb-3 block flex items-center gap-2">
                      <ShieldAlert size={14} /> Objection Handling Rules
                    </label>
                    <div className="space-y-3">
                      {objectionRules.map((rule, idx) => (
                        <div key={idx} className="bg-black/20 border border-white/5 rounded-xl p-4 space-y-2 relative group">
                          <button
                            onClick={() => setObjectionRules((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-3 right-3 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-remove-objection-${idx}`}
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-500 whitespace-nowrap">If they say:</span>
                            <Input
                              value={rule.trigger}
                              onChange={(e) => {
                                const updated = [...objectionRules];
                                updated[idx] = { ...updated[idx], trigger: e.target.value };
                                setObjectionRules(updated);
                              }}
                              className="bg-white/5 border-white/10 text-sm h-8"
                              placeholder={`"I'm busy"`}
                              data-testid={`input-objection-trigger-${idx}`}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-500 whitespace-nowrap">Respond:</span>
                            <Input
                              value={rule.response}
                              onChange={(e) => {
                                const updated = [...objectionRules];
                                updated[idx] = { ...updated[idx], response: e.target.value };
                                setObjectionRules(updated);
                              }}
                              className="bg-white/5 border-white/10 text-sm h-8"
                              placeholder="No worries, I'll be super quick..."
                              data-testid={`input-objection-response-${idx}`}
                            />
                          </div>
                          {rule.note && (
                            <p className="text-xs text-amber-400/70 pl-1">{rule.note}</p>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => setObjectionRules((prev) => [...prev, { trigger: "", response: "" }])}
                        className="flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                        data-testid="button-add-objection"
                      >
                        <Plus size={14} /> Add Rule
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-neutral-400 mb-2 block flex items-center gap-2">
                      <Volume2 size={14} /> Voice Provider
                    </label>
                    <div className="flex gap-2 mb-4">
                      <button
                        onClick={() => { setVoiceProvider("11labs"); setSelectedVoice(VOICE_OPTIONS[0].id); }}
                        className={`flex-1 p-3 rounded-xl border text-center transition-all ${
                          voiceProvider === "11labs"
                            ? "border-violet-500 bg-violet-500/10 text-white"
                            : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/20"
                        }`}
                        data-testid="button-provider-vapi"
                      >
                        <p className="text-sm font-medium">Vapi (Default)</p>
                        <p className="text-xs text-neutral-500">Built-in voices</p>
                      </button>
                      <button
                        onClick={() => {
                          if (!hasElevenLabsKey) {
                            toast({ title: "Not Connected", description: "Connect ElevenLabs in the Integrations Hub first.", variant: "destructive" });
                            return;
                          }
                          setVoiceProvider("elevenlabs");
                        }}
                        className={`flex-1 p-3 rounded-xl border text-center transition-all ${
                          voiceProvider === "elevenlabs"
                            ? "border-fuchsia-500 bg-fuchsia-500/10 text-white"
                            : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/20"
                        }`}
                        data-testid="button-provider-elevenlabs"
                      >
                        <p className="text-sm font-medium">ElevenLabs</p>
                        <p className="text-xs text-neutral-500">{hasElevenLabsKey ? "Connected" : "Not connected"}</p>
                      </button>
                    </div>

                    <label className="text-sm text-neutral-400 mb-2 block flex items-center gap-2">
                      <Volume2 size={14} /> Voice
                    </label>

                    {voiceProvider === "11labs" ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {VOICE_OPTIONS.map((voice) => (
                          <div
                            key={voice.id}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              selectedVoice === voice.id
                                ? "border-violet-500 bg-violet-500/10"
                                : "border-white/10 bg-white/5 hover:border-white/20"
                            }`}
                            onClick={() => setSelectedVoice(voice.id)}
                            data-testid={`button-voice-${voice.name.toLowerCase()}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">{voice.name}</p>
                                <p className="text-xs text-neutral-400">{voice.desc}</p>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); playVoicePreview(voice.id, voice.previewUrl); }}
                                className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                                  playingVoiceId === voice.id
                                    ? "bg-fuchsia-500/20 text-fuchsia-400"
                                    : "bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10"
                                }`}
                                title={playingVoiceId === voice.id ? "Stop preview" : `Listen to ${voice.name}`}
                                data-testid={`button-preview-${voice.name.toLowerCase()}`}
                              >
                                {playingVoiceId === voice.id ? (
                                  <Volume2 size={16} className="animate-pulse" />
                                ) : (
                                  <Volume2 size={16} />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div>
                        {loadingElevenLabsVoices ? (
                          <div className="flex items-center justify-center p-8 text-neutral-400">
                            <Loader2 className="animate-spin mr-2" size={16} /> Loading ElevenLabs voices...
                          </div>
                        ) : elevenLabsVoices.length === 0 ? (
                          <div className="text-center p-6 text-neutral-500 border border-white/10 rounded-xl">
                            <p>No voices available. Check your ElevenLabs API key.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto">
                            {elevenLabsVoices.map((voice) => (
                              <div
                                key={voice.voice_id}
                                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                                  selectedVoice === voice.voice_id
                                    ? "border-fuchsia-500 bg-fuchsia-500/10"
                                    : "border-white/10 bg-white/5 hover:border-white/20"
                                }`}
                                onClick={() => setSelectedVoice(voice.voice_id)}
                                data-testid={`button-voice-el-${voice.voice_id}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">{voice.name}</p>
                                    <p className="text-xs text-neutral-400">{voice.description || voice.category}</p>
                                  </div>
                                  {voice.preview_url && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); playVoicePreview(voice.voice_id, voice.preview_url); }}
                                      className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                                        playingVoiceId === voice.voice_id
                                          ? "bg-fuchsia-500/20 text-fuchsia-400"
                                          : "bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10"
                                      }`}
                                      title={playingVoiceId === voice.voice_id ? "Stop preview" : `Listen to ${voice.name}`}
                                      data-testid={`button-preview-el-${voice.voice_id}`}
                                    >
                                      {playingVoiceId === voice.voice_id ? (
                                        <Volume2 size={16} className="animate-pulse" />
                                      ) : (
                                        <Volume2 size={16} />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-violet-300 mb-2">Preview</h3>
                  <div className="bg-black/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-violet-500/30 flex items-center justify-center flex-shrink-0">
                        <Mic size={14} className="text-violet-300" />
                      </div>
                      <div>
                        <p className="text-xs text-violet-400 mb-1">{agentName} picks up:</p>
                        <p className="text-sm text-white italic" data-testid="text-preview-greeting">"{firstMessage}"</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="border-white/10 hover:bg-white/5"
                    onClick={() => setStep("describe")}
                    data-testid="button-back"
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 bg-violet-600 hover:bg-violet-700 h-12 text-base"
                    onClick={handleDeploy}
                    disabled={isDeploying || !persona || !firstMessage}
                    data-testid="button-deploy-agent"
                  >
                    {isDeploying ? (
                      <>
                        <Loader2 className="mr-2 animate-spin" size={18} /> Deploying to Vapi...
                      </>
                    ) : (
                      <>
                        <Rocket className="mr-2" size={18} /> Deploy Agent
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {step === "deployed" && deployedAgent && !selectedAgent && (
            <motion.div
              key="deployed-banner"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-8 text-center space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20">
                  <CheckCircle2 className="text-green-400" size={32} />
                </div>
                <h2 className="text-2xl font-bold text-green-300">{agentName} is Live!</h2>
                <p className="text-neutral-400">Your voice agent has been deployed. Select it below to test and manage it.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {existingAgents.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Phone size={18} className="text-violet-400" />
              Your Agents
            </h3>
            <div className="space-y-3">
              {existingAgents.map((agent) => (
                <div
                  key={agent.id}
                  className={`bg-white/5 border rounded-xl p-4 cursor-pointer transition-all hover:bg-white/8 ${
                    selectedAgent?.id === agent.id ? "border-violet-500/50 bg-violet-500/10" : "border-white/10"
                  }`}
                  onClick={() => {
                    setSelectedAgent(selectedAgent?.id === agent.id ? null : { id: agent.id, name: agent.name || "Agent" });
                    if (selectedAgent?.id !== agent.id) fetchCallLogs(agent.id);
                  }}
                  data-testid={`card-agent-${agent.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        selectedAgent?.id === agent.id ? "bg-violet-500/30" : "bg-violet-500/20"
                      }`}>
                        <Mic size={18} className="text-violet-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{agent.name || "Unnamed Agent"}</p>
                        <p className="text-xs text-neutral-400 flex items-center gap-1">
                          <Clock size={10} /> {agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : "Recent"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasVapiKey && (
                        <button
                          onClick={(e) => { e.stopPropagation(); demoActive ? stopDemoCall() : startDemoCall(agent.id, agent.name); setSelectedAgent({ id: agent.id, name: agent.name || "Agent" }); }}
                          className={`p-2 rounded-lg transition-colors ${
                            demoActive
                              ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              : "bg-fuchsia-500/10 text-fuchsia-400 hover:bg-fuchsia-500/20"
                          }`}
                          title={demoActive ? "End demo call" : "Talk to agent (browser)"}
                          data-testid={`button-demo-agent-${agent.id}`}
                        >
                          {demoConnecting ? <Loader2 size={16} className="animate-spin" /> : demoActive ? <MicOff size={16} /> : <Mic size={16} />}
                        </button>
                      )}
                      <button
                        onClick={() => openCallPanel(agent.id)}
                        className="p-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                        title="Make outbound call"
                        data-testid={`button-call-agent-${agent.id}`}
                      >
                        <PhoneOutgoing size={16} />
                      </button>
                      <code className="text-xs text-neutral-500 bg-white/5 px-2 py-1 rounded">{agent.id?.slice(0, 12)}...</code>
                    </div>
                  </div>

                <AnimatePresence>
                  {callAgentId === agent.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-violet-300">Outbound Call</span>
                          <button
                            onClick={() => setCallAgentId(null)}
                            className="text-neutral-500 hover:text-white"
                            data-testid={`button-close-call-${agent.id}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <Input
                          value={callPhone}
                          onChange={(e) => setCallPhone(e.target.value)}
                          placeholder="Customer phone (+14155551234)"
                          className="bg-white/5 border-white/10 h-9 text-sm"
                          data-testid={`input-call-phone-${agent.id}`}
                        />
                        <select
                          value={callPhoneNumberId}
                          onChange={(e) => setCallPhoneNumberId(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-md h-9 text-sm text-white px-2 w-full"
                          data-testid={`input-call-number-id-${agent.id}`}
                        >
                          <option value="" className="bg-neutral-900">Caller ID (select your number)</option>
                          {ownedNumbers.filter((n) => n.vapiPhoneId).map((n) => (
                            <option key={n.sid} value={n.vapiPhoneId} className="bg-neutral-900">
                              {n.phoneNumber} {n.friendlyName ? `(${n.friendlyName})` : ""}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          className="w-full bg-green-600 hover:bg-green-700"
                          disabled={isCalling || !callPhone.trim()}
                          onClick={handleOutboundCall}
                          data-testid={`button-dial-${agent.id}`}
                        >
                          {isCalling ? (
                            <>
                              <Loader2 className="mr-1.5 animate-spin" size={14} /> Dialing...
                            </>
                          ) : (
                            <>
                              <PhoneOutgoing className="mr-1.5" size={14} /> Call Now
                            </>
                          )}
                        </Button>
                        {callResult && (
                          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-xs">
                            <p className="text-green-300">Call initiated — ID: <code>{callResult.callId}</code></p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              ))}
            </div>
          </div>
        )}

        {selectedAgent && (
          <motion.div
            key={`panel-${selectedAgent.id}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 space-y-6"
            data-testid="selected-agent-panel"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <User size={18} className="text-violet-400" />
                {selectedAgent.name}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="text-neutral-400 hover:text-white"
                onClick={() => setSelectedAgent(null)}
                data-testid="button-close-agent-panel"
              >
                <X size={16} />
              </Button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-neutral-300">Agent Details</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-neutral-400">Agent ID</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-violet-300 bg-violet-500/10 px-2 py-1 rounded" data-testid="text-agent-id">
                      {selectedAgent.id}
                    </code>
                    <button onClick={copyAgentId} className="text-neutral-400 hover:text-white" data-testid="button-copy-id">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-neutral-400">Status</span>
                  <span className="text-sm text-green-400 flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    Active
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-violet-900/40 to-fuchsia-900/40 border border-violet-500/20 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Mic size={16} className="text-fuchsia-400" /> Talk to {selectedAgent.name} (Browser Demo)
              </h3>
              <p className="text-xs text-neutral-400">
                Test your agent right here in the browser. Click the button and start talking — your microphone will be used.
              </p>

              {!demoActive && !demoConnecting && (
                <Button
                  className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 h-12 text-base"
                  onClick={() => startDemoCall(selectedAgent.id, selectedAgent.name)}
                  disabled={!hasVapiKey}
                  data-testid="button-demo-call"
                >
                  <Mic className="mr-2" size={18} /> Talk to {selectedAgent.name} (Demo)
                </Button>
              )}

              {demoConnecting && (
                <div className="flex items-center justify-center gap-3 py-4">
                  <Loader2 className="animate-spin text-fuchsia-400" size={24} />
                  <span className="text-sm text-fuchsia-300">Connecting...</span>
                </div>
              )}

              {demoActive && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-4">
                    <div className="relative">
                      <div
                        className="w-20 h-20 rounded-full bg-fuchsia-500/20 flex items-center justify-center transition-all"
                        style={{
                          boxShadow: `0 0 ${20 + demoVolume * 60}px ${demoVolume * 30}px rgba(217,70,239,${0.2 + demoVolume * 0.4})`,
                          transform: `scale(${1 + demoVolume * 0.15})`,
                        }}
                      >
                        <Mic className="text-fuchsia-300" size={32} />
                      </div>
                    </div>
                  </div>
                  <p className="text-center text-sm text-fuchsia-300 animate-pulse">Listening... speak now</p>
                  <Button
                    className="w-full bg-red-600 hover:bg-red-500 h-12 text-base"
                    onClick={stopDemoCall}
                    data-testid="button-end-demo"
                  >
                    <MicOff className="mr-2" size={18} /> End Call
                  </Button>
                </div>
              )}

              {!hasVapiKey && (
                <p className="text-xs text-amber-400 mt-2">
                  Voice agent keys are not configured. Contact your admin to set up VAPI_PRIVATE_KEY in Secrets.
                </p>
              )}
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                <PhoneOutgoing size={16} className="text-violet-400" /> Make Outbound Call
              </h3>
              <p className="text-xs text-neutral-400">
                Have your agent call a customer. Enter their phone number in E.164 format (e.g. +14155551234).
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Customer Phone Number</label>
                  <Input
                    value={callAgentId === selectedAgent.id ? callPhone : ""}
                    onChange={(e) => {
                      setCallAgentId(selectedAgent.id);
                      setCallPhone(e.target.value);
                    }}
                    placeholder="+14155551234"
                    className="bg-white/5 border-white/10"
                    data-testid="input-outbound-phone"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Caller ID (your phone number)</label>
                  <select
                    value={callAgentId === selectedAgent.id ? callPhoneNumberId : ""}
                    onChange={(e) => {
                      setCallAgentId(selectedAgent.id);
                      setCallPhoneNumberId(e.target.value);
                    }}
                    className="bg-white/5 border border-white/10 rounded-md h-10 text-sm text-white px-3 w-full"
                    data-testid="input-phone-number-id"
                  >
                    <option value="" className="bg-neutral-900">Select your phone number</option>
                    {ownedNumbers.filter((n) => n.vapiPhoneId).map((n) => (
                      <option key={n.sid} value={n.vapiPhoneId} className="bg-neutral-900">
                        {n.phoneNumber} {n.friendlyName ? `(${n.friendlyName})` : ""}
                      </option>
                    ))}
                  </select>
                  {ownedNumbers.length > 0 && ownedNumbers.filter((n) => n.vapiPhoneId).length === 0 && (
                    <p className="text-xs text-amber-400 mt-1">Your numbers aren't linked to Vapi yet. Purchase a new number to auto-link.</p>
                  )}
                </div>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={isCalling || !(callAgentId === selectedAgent.id && callPhone.trim())}
                  onClick={() => {
                    setCallAgentId(selectedAgent.id);
                    handleOutboundCall();
                  }}
                  data-testid="button-make-call"
                >
                  {isCalling ? (
                    <>
                      <Loader2 className="mr-2 animate-spin" size={16} /> Dialing...
                    </>
                  ) : (
                    <>
                      <PhoneOutgoing className="mr-2" size={16} /> Call Now
                    </>
                  )}
                </Button>
                {callResult && callAgentId === selectedAgent.id && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm">
                    <p className="text-green-300 font-medium">Call initiated!</p>
                    <p className="text-xs text-neutral-400 mt-1">
                      Call ID: <code className="text-green-300">{callResult.callId}</code> — Status: {callResult.status}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/20 rounded-2xl p-6 space-y-5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Phone size={16} className="text-green-400" /> AI Phone Line
              </h3>
              <p className="text-xs text-neutral-400">
                Get a dedicated phone number for your agent. It will answer calls and reply to texts with AI — 24/7.
              </p>

              {purchasedNumber ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-2">
                  <div className="text-2xl font-mono font-bold text-green-400" data-testid="text-purchased-number">
                    {purchasedNumber.phoneNumber}
                  </div>
                  <p className="text-xs text-green-300 flex items-center justify-center gap-1.5">
                    <Wifi size={12} /> Active & Connected to AI
                  </p>
                  {purchasedNumber.vapiPhoneId && (
                    <p className="text-xs text-neutral-400">
                      Vapi Phone ID: <code className="text-green-300">{purchasedNumber.vapiPhoneId}</code>
                    </p>
                  )}
                  {purchasedNumber.dualAgent && (
                    <div className="flex items-center justify-center gap-3 mt-1">
                      <span className="text-xs text-violet-300 flex items-center gap-1">
                        <Phone size={10} /> Voice → AI Agent
                      </span>
                      <span className="text-xs text-neutral-500">|</span>
                      <span className="text-xs text-blue-300 flex items-center gap-1">
                        <MessageSquare size={10} /> SMS → AI Auto-Reply
                      </span>
                    </div>
                  )}
                </div>
              ) : phoneConfig?.hasTwilio ? (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={areaCode}
                      onChange={(e) => setAreaCode(e.target.value)}
                      placeholder="Area code (e.g. 305)"
                      className="bg-white/5 border-white/10 w-36"
                      maxLength={3}
                      data-testid="input-area-code"
                    />
                    <Button
                      className="bg-green-600 hover:bg-green-700"
                      onClick={searchNumbers}
                      disabled={searchingNumbers || !areaCode.trim()}
                      data-testid="button-search-numbers"
                    >
                      {searchingNumbers ? (
                        <Loader2 className="animate-spin mr-2" size={14} />
                      ) : (
                        <Search className="mr-2" size={14} />
                      )}
                      Find Numbers
                    </Button>
                  </div>

                  {availableNumbers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-neutral-400">{availableNumbers.length} numbers available:</p>
                      {availableNumbers.map((num) => (
                        <div
                          key={num.phoneNumber}
                          className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-3"
                          data-testid={`card-number-${num.phoneNumber}`}
                        >
                          <div>
                            <p className="text-sm font-mono text-white">{num.phoneNumber}</p>
                            <p className="text-xs text-neutral-400">
                              {num.locality && `${num.locality}, `}{num.region}
                              {num.capabilities?.sms && " · SMS"}
                              {num.capabilities?.voice && " · Voice"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700"
                            disabled={purchasingNumber !== null}
                            onClick={() => purchaseNumber(num.phoneNumber, selectedAgent.id)}
                            data-testid={`button-buy-${num.phoneNumber}`}
                          >
                            {purchasingNumber === num.phoneNumber ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : (
                              <><ShoppingCart size={14} className="mr-1" /> Buy</>
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-xs text-amber-300">
                    Add your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Secrets to enable phone number purchasing.
                  </p>
                </div>
              )}

              {ownedNumbers.length > 0 && !purchasedNumber && (
                <div className="border-t border-white/5 pt-4">
                  <p className="text-xs text-neutral-400 mb-2">Your existing numbers:</p>
                  <div className="space-y-2">
                    {ownedNumbers.map((num) => (
                      <div key={num.sid} className="flex items-center justify-between bg-black/10 rounded-lg px-3 py-2" data-testid={`card-owned-${num.sid}`}>
                        <span className="text-sm font-mono text-green-300">{num.phoneNumber}</span>
                        <span className="text-xs text-neutral-500">{num.friendlyName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
                  <Phone size={16} className="text-violet-400" /> Call Logs
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 hover:bg-white/5 text-xs"
                  onClick={() => fetchCallLogs(selectedAgent.id)}
                  disabled={loadingCallLogs}
                  data-testid="button-refresh-logs"
                >
                  {loadingCallLogs ? (
                    <Loader2 className="animate-spin" size={12} />
                  ) : (
                    <><RefreshCcw size={12} className="mr-1" /> Refresh</>
                  )}
                </Button>
              </div>

              {callLogs.length === 0 && !loadingCallLogs && (
                <p className="text-xs text-neutral-500 text-center py-4">
                  No call recordings yet. Make an outbound call or receive an inbound call to see logs here.
                </p>
              )}

              {loadingCallLogs && callLogs.length === 0 && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="animate-spin text-violet-400" size={20} />
                </div>
              )}

              <div className="space-y-3" data-testid="call-logs-list">
                {callLogs.map((call) => (
                  <CallPlayer
                    key={call.id}
                    recordingUrl={call.recordingUrl}
                    transcript={call.transcript}
                    duration={call.duration}
                    callerNumber={call.customer}
                    status={call.status}
                    createdAt={call.startedAt}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {hasVapiKey === false && (
          <div className="mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 text-center">
            <AlertCircle className="mx-auto text-amber-400 mb-3" size={24} />
            <p className="text-sm text-amber-300 font-medium">Vapi API Key Required</p>
            <p className="text-xs text-neutral-400 mt-1">
              Voice agent keys are not configured. Add VAPI_PRIVATE_KEY in Secrets to deploy and manage agents.
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {(demoConnecting || demoActive) && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md"
            data-testid="demo-call-overlay"
          >
            <div className="bg-black/90 backdrop-blur-xl border border-fuchsia-500/40 rounded-2xl p-5 shadow-[0_0_40px_rgba(217,70,239,0.3)]">
              {demoConnecting && (
                <div className="flex items-center justify-center gap-3 py-2">
                  <Loader2 className="animate-spin text-fuchsia-400" size={28} />
                  <div>
                    <p className="text-sm font-medium text-white">Connecting to {demoAgentName}...</p>
                    <p className="text-xs text-neutral-400">Please allow microphone access</p>
                  </div>
                </div>
              )}
              {demoActive && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-14 h-14 rounded-full bg-fuchsia-500/20 flex items-center justify-center transition-all"
                        style={{
                          boxShadow: `0 0 ${15 + demoVolume * 50}px ${demoVolume * 25}px rgba(217,70,239,${0.2 + demoVolume * 0.4})`,
                          transform: `scale(${1 + demoVolume * 0.15})`,
                        }}
                      >
                        <Volume2 className="text-fuchsia-300" size={24} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">Talking to {demoAgentName}</p>
                      <p className="text-xs text-fuchsia-300 animate-pulse">Listening... speak now</p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-red-600 hover:bg-red-500 flex-shrink-0 h-10 px-4"
                      onClick={stopDemoCall}
                      data-testid="button-end-demo-overlay"
                    >
                      <MicOff size={16} className="mr-1" /> End
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {showTutorial && <TutorialOverlay steps={VOICE_AGENT_STEPS} storageKey="apex_tutorial_voice_agent" onClose={closeTutorial} accentColor="violet" />}
    </div>
  );
}

export default function VoiceAgent() {
  return <PlanGate feature="voice_agents"><VoiceAgentInner /></PlanGate>;
}
