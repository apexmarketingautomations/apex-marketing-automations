import { useState, useEffect } from "react";
import {
  Phone,
  Loader2,
  Mic,
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const VOICE_OPTIONS = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Warm, professional female" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "Calm, friendly male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", desc: "Soft, nurturing female" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", desc: "Confident, deep male" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "Clear, neutral male" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", desc: "Conversational, energetic" },
];

export default function VoiceAgent() {
  const [step, setStep] = useState<"describe" | "configure" | "deployed">("describe");
  const [businessPrompt, setBusinessPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [persona, setPersona] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [agentName, setAgentName] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS[0].id);
  const [deployedAgent, setDeployedAgent] = useState<any>(null);
  const [existingAgents, setExistingAgents] = useState<any[]>([]);
  const [hasVapiKey, setHasVapiKey] = useState<boolean | null>(null);
  const [callAgentId, setCallAgentId] = useState<string | null>(null);
  const [callPhone, setCallPhone] = useState("");
  const [callPhoneNumberId, setCallPhoneNumberId] = useState("");
  const [isCalling, setIsCalling] = useState(false);
  const [callResult, setCallResult] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/voice-agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setExistingAgents(data);
          setHasVapiKey(true);
        }
      })
      .catch(() => setHasVapiKey(false));
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
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Deployment failed");
      }

      const agent = await res.json();
      setDeployedAgent(agent);
      setStep("deployed");
      toast({ title: "Agent Deployed!", description: `${agentName} is ready to take calls.` });
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
    if (deployedAgent?.id) {
      navigator.clipboard.writeText(deployedAgent.id);
      toast({ title: "Copied!", description: "Agent ID copied to clipboard." });
    }
  };

  const handleOutboundCall = async () => {
    if (!callAgentId || !callPhone.trim()) return;
    setIsCalling(true);
    setCallResult(null);

    try {
      const res = await fetch("/api/voice-agents/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: callAgentId,
          customerPhone: callPhone.trim(),
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

  const openCallPanel = (agentId: string) => {
    setCallAgentId(agentId);
    setCallPhone("");
    setCallPhoneNumberId("");
    setCallResult(null);
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
                    <label className="text-sm text-neutral-400 mb-2 block flex items-center gap-2">
                      <Volume2 size={14} /> Voice
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {VOICE_OPTIONS.map((voice) => (
                        <button
                          key={voice.id}
                          onClick={() => setSelectedVoice(voice.id)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            selectedVoice === voice.id
                              ? "border-violet-500 bg-violet-500/10"
                              : "border-white/10 bg-white/5 hover:border-white/20"
                          }`}
                          data-testid={`button-voice-${voice.name.toLowerCase()}`}
                        >
                          <p className="text-sm font-medium">{voice.name}</p>
                          <p className="text-xs text-neutral-400">{voice.desc}</p>
                        </button>
                      ))}
                    </div>
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

          {step === "deployed" && deployedAgent && (
            <motion.div
              key="deployed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-8 text-center space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/20">
                  <CheckCircle2 className="text-green-400" size={32} />
                </div>
                <h2 className="text-2xl font-bold text-green-300">{agentName} is Live!</h2>
                <p className="text-neutral-400">Your voice agent has been deployed and is ready to handle calls.</p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-neutral-300">Agent Details</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-white/5">
                    <span className="text-sm text-neutral-400">Agent ID</span>
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-violet-300 bg-violet-500/10 px-2 py-1 rounded" data-testid="text-agent-id">
                        {deployedAgent.id}
                      </code>
                      <button onClick={copyAgentId} className="text-neutral-400 hover:text-white" data-testid="button-copy-id">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/5">
                    <span className="text-sm text-neutral-400">Status</span>
                    <span className="text-sm text-green-400 flex items-center gap-1">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                      Active
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/5">
                    <span className="text-sm text-neutral-400">Voice</span>
                    <span className="text-sm text-neutral-300">
                      {VOICE_OPTIONS.find((v) => v.id === selectedVoice)?.name || "Default"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-neutral-400">Greeting</span>
                    <span className="text-sm text-neutral-300 max-w-[250px] truncate">"{firstMessage}"</span>
                  </div>
                </div>
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
                      value={callAgentId === deployedAgent.id ? callPhone : ""}
                      onChange={(e) => {
                        setCallAgentId(deployedAgent.id);
                        setCallPhone(e.target.value);
                      }}
                      placeholder="+14155551234"
                      className="bg-white/5 border-white/10"
                      data-testid="input-outbound-phone"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Vapi Phone Number ID (from your Vapi dashboard)</label>
                    <Input
                      value={callAgentId === deployedAgent.id ? callPhoneNumberId : ""}
                      onChange={(e) => {
                        setCallAgentId(deployedAgent.id);
                        setCallPhoneNumberId(e.target.value);
                      }}
                      placeholder="Optional — required for outbound calls"
                      className="bg-white/5 border-white/10"
                      data-testid="input-phone-number-id"
                    />
                  </div>
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700"
                    disabled={isCalling || !(callAgentId === deployedAgent.id && callPhone.trim())}
                    onClick={() => {
                      setCallAgentId(deployedAgent.id);
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
                  {callResult && callAgentId === deployedAgent.id && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm">
                      <p className="text-green-300 font-medium">Call initiated!</p>
                      <p className="text-xs text-neutral-400 mt-1">
                        Call ID: <code className="text-green-300">{callResult.callId}</code> — Status: {callResult.status}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-amber-400 mt-0.5" size={18} />
                  <div>
                    <p className="text-sm font-medium text-amber-300">Outbound Call Requirements</p>
                    <p className="text-xs text-neutral-400 mt-1">
                      To make outbound calls, you need a phone number configured in your Vapi dashboard. Enter its Phone Number ID above.
                      Agent ID: <code className="text-amber-300">{deployedAgent.id}</code>
                    </p>
                  </div>
                </div>
              </div>

              <Button
                className="w-full bg-violet-600 hover:bg-violet-700"
                onClick={() => {
                  setStep("describe");
                  setBusinessPrompt("");
                  setPersona("");
                  setFirstMessage("");
                  setDeployedAgent(null);
                }}
                data-testid="button-create-another"
              >
                <RefreshCcw className="mr-2" size={16} /> Create Another Agent
              </Button>
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
                  className="bg-white/5 border border-white/10 rounded-xl p-4"
                  data-testid={`card-agent-${agent.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
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
                        <Input
                          value={callPhoneNumberId}
                          onChange={(e) => setCallPhoneNumberId(e.target.value)}
                          placeholder="Vapi Phone Number ID (optional)"
                          className="bg-white/5 border-white/10 h-9 text-sm"
                          data-testid={`input-call-number-id-${agent.id}`}
                        />
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

        {hasVapiKey === false && (
          <div className="mt-8 bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 text-center">
            <AlertCircle className="mx-auto text-amber-400 mb-3" size={24} />
            <p className="text-sm text-amber-300 font-medium">Vapi API Key Required</p>
            <p className="text-xs text-neutral-400 mt-1">
              Add your VAPI_API_KEY in Secrets to deploy agents. You can still generate personas without it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
