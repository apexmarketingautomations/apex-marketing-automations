import { useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  PhoneCall,
  Settings2,
  Sparkles,
  Waves,
} from "lucide-react";

type TicketType = "reservation_request" | "check_in" | "check_out" | "general";

type FlowStep = {
  id: string;
  label: string;
  prompt: string;
  hint: string;
};

const HOTEL_DEFAULT_ASSISTANT_ID = "795da2d4-89e7-4133-810a-6f93f7b40a15";
const HOTEL_VAPI_PUBLIC_KEY = "b8b3b156-b0ad-4c8a-845a-e48854e79b9e";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toDisplayText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const message = (value as any).message;
    if (typeof message === "string") return message;
    const error = (value as any).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as any).message === "string") {
      return (error as any).message;
    }
    const statusCode = (value as any).statusCode;
    try {
      const compact = JSON.stringify(value);
      if (typeof statusCode !== "undefined") {
        return compact ? `${compact}` : String(statusCode);
      }
      return compact || fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function loadLocal(key: string, fallback: string) {
  try {
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore localStorage write failures in kiosk mode
  }
}

function getFlowSteps(mode: TicketType): FlowStep[] {
  switch (mode) {
    case "check_in":
      return [
        {
          id: "welcome",
          label: "Welcome",
          prompt: "Welcome to OYO Waterfront Hotel. I can help you get checked in right here.",
          hint: "Invite the guest to relax while the assistant leads the process.",
        },
        {
          id: "identity",
          label: "Identity",
          prompt: "Let’s confirm your name, phone number, and the reservation you’re arriving for today.",
          hint: "Collect name, mobile, reservation number, or last name lookup info.",
        },
        {
          id: "stay",
          label: "Stay Details",
          prompt: "I’ll walk through arrival details, room preferences, and any late check-in or special requests.",
          hint: "Capture arrival time, room notes, accessibility needs, pet info, or parking.",
        },
        {
          id: "handoff",
          label: "Desk Handoff",
          prompt: "Everything is ready. I’m sending your check-in packet to the front desk now.",
          hint: "Create the ticket so staff can finish ID, payment, keys, and incidentals.",
        },
      ];
    case "check_out":
      return [
        {
          id: "welcome",
          label: "Goodbye",
          prompt: "I can help make checkout quick. We’ll confirm your room and wrap up any final details.",
          hint: "Open with a clean checkout experience.",
        },
        {
          id: "room",
          label: "Room",
          prompt: "Please confirm the guest name, room number, and whether you need a receipt by email.",
          hint: "Capture room, email, receipt preference, and transport timing.",
        },
        {
          id: "incidentals",
          label: "Incidentals",
          prompt: "I’ll note any minibar, late checkout, parking, or damage review items for the desk.",
          hint: "Store notes staff must verify before closing out the stay.",
        },
        {
          id: "reviews",
          label: "Follow-Up",
          prompt: "You’re all set. We’ll text your receipt and review link after the desk confirms checkout.",
          hint: "Sets up your later SMS and review workflows.",
        },
      ];
    case "general":
      return [
        {
          id: "greeting",
          label: "Greeting",
          prompt: "Hi there. I’m the front desk assistant. Tell me what you need and I’ll get you routed fast.",
          hint: "Good for late arrivals, amenities, directions, and support requests.",
        },
        {
          id: "capture",
          label: "Capture",
          prompt: "I’ll take down your details so the right staff member can jump in without repeating yourself.",
          hint: "Collect contact info and a short issue summary.",
        },
        {
          id: "resolve",
          label: "Resolve",
          prompt: "I’m packaging this for the hotel team now and flagging the right priority level.",
          hint: "Turn the request into an actionable internal ticket.",
        },
      ];
    case "reservation_request":
    default:
      return [
        {
          id: "intro",
          label: "Discover",
          prompt: "I can help you book a stay. Let’s start with your travel dates and how many guests are joining you.",
          hint: "Keep the conversation warm and fast.",
        },
        {
          id: "preferences",
          label: "Preferences",
          prompt: "Tell me what kind of room experience you want and any special needs for the stay.",
          hint: "Room type, budget sensitivity, accessibility, pets, and parking all go here.",
        },
        {
          id: "contact",
          label: "Contact",
          prompt: "I’ll take your name, mobile number, and email so the hotel can lock in the best option.",
          hint: "This becomes the front desk ticket and future SMS thread.",
        },
        {
          id: "confirm",
          label: "Confirm",
          prompt: "Perfect. I’m sending your request to the front desk now so they can confirm availability.",
          hint: "Staff-confirm-first flow until PMS integration is added.",
        },
      ];
  }
}

const MODES: Array<{ id: TicketType; label: string; icon: typeof CalendarPlus }> = [
  { id: "reservation_request", label: "Reserve", icon: CalendarPlus },
  { id: "check_in", label: "Check In", icon: ClipboardCheck },
  { id: "check_out", label: "Check Out", icon: LogOut },
  { id: "general", label: "Help", icon: PhoneCall },
];

export default function FrontDeskKioskPage() {
  const { toast } = useToast();
  const vapiRef = useRef<Vapi | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);

  const [hotelName] = useState("OYO Waterfront Hotel - Cape Coral");
  const [timezone] = useState("America/New_York");

  const [assistantId] = useState(HOTEL_DEFAULT_ASSISTANT_ID);
  const [isVapiConfigured] = useState<boolean>(!!HOTEL_VAPI_PUBLIC_KEY);
  const [mode, setMode] = useState<TicketType>("check_in");
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceStage, setVoiceStage] = useState("idle");
  const [lastVoiceError, setLastVoiceError] = useState("");
  const [showOperatorPanel, setShowOperatorPanel] = useState(false);

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [dates, setDates] = useState("");
  const [roomOrNotes, setRoomOrNotes] = useState("");

  const steps = useMemo(() => getFlowSteps(mode), [mode]);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;
  useEffect(() => {
    saveLocal("frontdesk.assistantId", HOTEL_DEFAULT_ASSISTANT_ID);
  }, []);

  useEffect(() => {
    saveLocal("frontdesk.publicKey", HOTEL_VAPI_PUBLIC_KEY);
  }, []);

  useEffect(() => {
    setStepIndex(0);
  }, [mode]);

  useEffect(() => {
    return () => {
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current);
      }
      try {
        vapiRef.current?.stop();
      } catch {
        // ignore cleanup failure
      }
    };
  }, []);

  async function ensureVapi() {
    if (!HOTEL_VAPI_PUBLIC_KEY) {
      throw new Error("Vapi public key is missing for this kiosk");
    }
    if (!vapiRef.current) {
      vapiRef.current = new Vapi(HOTEL_VAPI_PUBLIC_KEY);
      vapiRef.current.on("call-start-progress", (event: any) => {
        const stage = typeof event?.stage === "string" ? event.stage : "unknown";
        const status = typeof event?.status === "string" ? event.status : "";
        const detailText = toDisplayText(event?.metadata?.error, "");
        const detail = detailText ? `: ${detailText}` : "";
        setVoiceStage(`${stage}${status ? ` (${status})` : ""}${detail}`);
      });
      vapiRef.current.on("call-start", () => {
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        setVoiceStage("connected");
        setLastVoiceError("");
        setVoiceConnecting(false);
        setVoiceActive(true);
      });
      vapiRef.current.on("call-end", () => {
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        setVoiceStage("ended");
        setVoiceActive(false);
        setVoiceConnecting(false);
        setVoiceLevel(0);
        vapiRef.current = null;
      });
      vapiRef.current.on("volume-level", (level: number) => {
        setVoiceLevel(level || 0);
      });
      vapiRef.current.on("error", (err: any) => {
        console.error("[KIOSK] vapi error", err);
        if (connectTimeoutRef.current != null) {
          window.clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        const detail = toDisplayText(
          err?.error?.message ?? err?.message ?? err?.errorMsg ?? err?.type ?? err,
          "Unknown Vapi error",
        );
        setVoiceStage(`error${detail ? `: ${detail}` : ""}`);
        setLastVoiceError(detail || "Unknown Vapi error");
        setVoiceActive(false);
        setVoiceConnecting(false);
        setVoiceLevel(0);
        vapiRef.current = null;
        toast({
          title: "Voice error",
          description: detail || "The voice session failed",
          variant: "destructive",
        });
      });
    }
  }

  async function startVoice() {
    if (!assistantId) {
      toast({
        title: "Assistant missing",
        description: "Add the hotel assistantId in the operator panel first.",
        variant: "destructive",
      });
      return;
    }

    setVoiceConnecting(true);
    setLastVoiceError("");
    setVoiceStage("connecting");
    try {
      await ensureVapi();
      connectTimeoutRef.current = window.setTimeout(() => {
        setVoiceConnecting(false);
        setVoiceActive(false);
        setVoiceLevel(0);
        setVoiceStage("timeout waiting for connection");
        setLastVoiceError("Connection timeout");
        try {
          vapiRef.current?.stop();
        } catch {
          // ignore timeout stop failure
        }
        vapiRef.current = null;
        toast({
          title: "Connection timeout",
          description: "The assistant did not connect. Check microphone permission and try again.",
          variant: "destructive",
        });
      }, 20000);

      setVoiceStage("starting assistant");
      await (vapiRef.current as any).start(assistantId);
    } catch (err: any) {
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      const detail = toDisplayText(err?.message ?? err?.error?.message ?? err, "Unknown error");
      setVoiceStage(`failed: ${detail}`);
      setLastVoiceError(detail);
      setVoiceConnecting(false);
      toast({
        title: "Couldn’t start voice",
        description: detail,
        variant: "destructive",
      });
    }
  }

  async function stopVoice() {
    try {
      vapiRef.current?.stop();
    } catch {
      // ignore stop failure
    }
    setVoiceActive(false);
    setVoiceConnecting(false);
    setVoiceLevel(0);
    setVoiceStage("stopped");
    if (connectTimeoutRef.current != null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    vapiRef.current = null;
  }

  function resetForm() {
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setDates("");
    setRoomOrNotes("");
    setStepIndex(0);
  }

  async function submitTicket() {
    setSubmitting(true);
    try {
      const payload = {
        hotelName,
        timezone,
        dates: dates.trim() || null,
        roomOrNotes: roomOrNotes.trim() || null,
        step: currentStep.id,
        stepLabel: currentStep.label,
      };

      const res = await fetch("/api/frontdesk/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: mode,
          source: "kiosk",
          guestName: guestName.trim() || null,
          guestPhone: guestPhone.trim() || null,
          guestEmail: guestEmail.trim() || null,
          payload,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

      toast({
        title: "Front desk notified",
        description: "The guest handoff ticket has been created.",
      });
      resetForm();
    } catch (err: any) {
      const detail = toDisplayText(err?.message ?? err, "Unknown error");
      toast({
        title: "Couldn’t create ticket",
        description: detail,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function nextStep() {
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  const modeCopy =
    mode === "check_in"
      ? "Guided arrival and front desk handoff"
      : mode === "check_out"
        ? "Quick departure, incidentals, and receipt follow-up"
        : mode === "reservation_request"
          ? "New stay intake with staff confirmation"
          : "General guest support and escalation";

  return (
    <div className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(225,29,72,0.18),transparent_28%),radial-gradient(circle_at_50%_70%,rgba(255,255,255,0.06),transparent_35%)]" />
      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:36px_36px]" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-5 md:px-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.35em] text-white/45">Autonomous Front Desk</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{hotelName}</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowOperatorPanel((value) => !value)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/75 transition hover:bg-white/10"
            >
              <Settings2 className="h-4 w-4" />
              Operator
            </button>
            <a
              href="/dashboard"
              className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/75 transition hover:bg-white/10"
            >
              Exit
            </a>
          </div>
        </header>

        <main className="relative grid flex-1 grid-cols-1 gap-6 px-6 pb-8 md:px-10 xl:grid-cols-[1.3fr_0.9fr]">
          <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] md:p-8">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

            <div className="grid gap-8 xl:grid-cols-[160px_1fr] xl:items-start">
              <div className="flex gap-3 overflow-x-auto xl:flex-col">
                {MODES.map((item) => {
                  const Icon = item.icon;
                  const active = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={cn(
                        "group flex min-w-[112px] flex-1 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition xl:min-w-0 xl:flex-none",
                        active
                          ? "border-white/25 bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.12)]"
                          : "border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.07]",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-full",
                          active ? "bg-black text-white" : "bg-white/10 text-white/80",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs uppercase tracking-[0.28em] text-white/55">
                      <Sparkles className="h-3.5 w-3.5" />
                      Concierge Mode
                    </div>
                    <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
                      A speaking check-in agent that leads the guest, step by step.
                    </h1>
                    <p className="mt-4 max-w-2xl text-base text-white/65 md:text-lg">
                      {modeCopy}. The assistant speaks first, captures details, and hands everything to the front desk without making the guest repeat themselves.
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid gap-8 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
                  <div className="flex flex-col items-center justify-center">
                    <div className="relative flex h-[320px] w-[320px] items-center justify-center md:h-[380px] md:w-[380px]">
                      <div
                        className={cn(
                          "absolute inset-6 rounded-full border border-white/10 bg-[radial-gradient(circle,rgba(255,255,255,0.2),rgba(255,255,255,0.02)_60%,transparent_72%)] blur-sm transition-all duration-500",
                          voiceActive && "scale-110 opacity-100",
                          !voiceActive && "opacity-70",
                        )}
                      />
                      <div
                        className={cn(
                          "absolute inset-0 rounded-full border border-rose-300/15 transition duration-700",
                          voiceActive ? "animate-ping" : "opacity-60",
                        )}
                      />
                      <div
                        className={cn(
                          "absolute inset-[28px] rounded-full border transition duration-500",
                          voiceActive ? "border-white/40" : "border-white/10",
                        )}
                      />
                      <div
                        className={cn(
                          "absolute inset-[58px] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.95),rgba(255,255,255,0.22)_18%,rgba(210,10,50,0.5)_42%,rgba(0,0,0,0.95)_72%)] shadow-[0_0_110px_rgba(255,255,255,0.1)] transition-transform duration-500",
                          voiceActive && "scale-105",
                          voiceConnecting && "animate-pulse",
                        )}
                        style={{
                          transform: `scale(${1 + Math.min(voiceLevel, 1) * 0.12})`,
                        }}
                      />
                      <div className="relative z-10 flex flex-col items-center text-center">
                        <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-white/65">
                          {voiceConnecting ? "Connecting" : voiceActive ? "Speaking" : "Ready"}
                        </div>
                        <div className="mt-6 text-2xl font-semibold md:text-3xl">Apex Front Desk Agent</div>
                        <div className="mt-2 max-w-[220px] text-sm text-white/65">
                          {voiceActive
                            ? "The guest is in a live guided conversation."
                            : "Tap start and the assistant will begin leading the guest through the stay flow."}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                      <Button
                        onClick={voiceActive ? stopVoice : startVoice}
                        disabled={voiceConnecting}
                        className={cn(
                          "h-14 rounded-full px-6 text-base",
                          voiceActive
                            ? "bg-white text-black hover:bg-white/90"
                            : "bg-rose-600 text-white hover:bg-rose-500",
                        )}
                      >
                        {voiceConnecting ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : voiceActive ? (
                          <MicOff className="mr-2 h-5 w-5" />
                        ) : (
                          <Mic className="mr-2 h-5 w-5" />
                        )}
                        {voiceActive ? "End Session" : "Start Speaking"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={nextStep}
                        className="h-14 rounded-full border-white/10 bg-white/[0.03] px-6 text-base text-white hover:bg-white/[0.08]"
                      >
                        Advance Flow
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>

                    <div className="mt-4 w-full max-w-[520px] rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-left">
                      <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Voice Status</div>
                      <div className="mt-2 text-sm text-white/80">{voiceStage}</div>
                      {lastVoiceError ? (
                        <div className="mt-2 text-sm text-rose-200">{lastVoiceError}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-black/25 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.24em] text-white/45">Current Guidance</div>
                          <div className="mt-1 text-xl font-medium">{currentStep.label}</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                          Step {stepIndex + 1} / {steps.length}
                        </div>
                      </div>

                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-white via-rose-200 to-rose-500 transition-all duration-500"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      <div className="mt-5 rounded-[20px] border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <Waves className="h-4 w-4" />
                          What the agent says
                        </div>
                        <p className="mt-3 text-2xl leading-snug tracking-tight text-white">
                          {currentStep.prompt}
                        </p>
                        <p className="mt-4 text-sm text-white/50">{currentStep.hint}</p>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <Button
                          variant="outline"
                          onClick={previousStep}
                          disabled={stepIndex === 0}
                          className="rounded-full border-white/10 bg-transparent text-white hover:bg-white/[0.08]"
                        >
                          <ChevronLeft className="mr-2 h-4 w-4" />
                          Back
                        </Button>
                        <div className="text-sm text-white/50">
                          {voiceActive ? "Live voice session in progress" : "You can advance manually while designing the flow"}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {steps.map((step, index) => (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setStepIndex(index)}
                          className={cn(
                            "rounded-2xl border p-4 text-left transition",
                            index === stepIndex
                              ? "border-white/25 bg-white text-black"
                              : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.07]",
                          )}
                        >
                          <div className="text-[11px] uppercase tracking-[0.22em] opacity-60">Step {index + 1}</div>
                          <div className="mt-2 font-medium">{step.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-white/45">Guest Intake</div>
                  <div className="mt-1 text-xl font-medium">Front Desk Handoff</div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
                  Staff-confirm-first
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-white/45">Guest name</label>
                  <Input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="mt-2 h-12 rounded-2xl border-white/10 bg-black/30 text-white"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-white/45">Mobile</label>
                    <Input
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="+1..."
                      className="mt-2 h-12 rounded-2xl border-white/10 bg-black/30 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.2em] text-white/45">Email</label>
                    <Input
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="guest@email.com"
                      className="mt-2 h-12 rounded-2xl border-white/10 bg-black/30 text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-white/45">Dates or timing</label>
                  <Input
                    value={dates}
                    onChange={(e) => setDates(e.target.value)}
                    placeholder="Arrival, departure, late arrival, or preferred stay dates"
                    className="mt-2 h-12 rounded-2xl border-white/10 bg-black/30 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-white/45">
                    {mode === "check_in"
                      ? "Room / ID / deposit notes"
                      : mode === "check_out"
                        ? "Room / incidental notes"
                        : "Guest notes"}
                  </label>
                  <Textarea
                    value={roomOrNotes}
                    onChange={(e) => setRoomOrNotes(e.target.value)}
                    className="mt-2 min-h-[150px] rounded-[22px] border-white/10 bg-black/30 text-white"
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button
                  onClick={submitTicket}
                  disabled={submitting}
                  className="h-12 flex-1 rounded-full bg-white text-black hover:bg-white/90"
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Send to Front Desk
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForm}
                  className="h-12 rounded-full border-white/10 bg-transparent px-5 text-white hover:bg-white/[0.08]"
                >
                  Reset
                </Button>
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-white/45">Experience Notes</div>
              <div className="mt-3 space-y-3 text-sm text-white/65">
                <p>The guest should feel like the kiosk is in control of the conversation, not waiting for instructions.</p>
                <p>The live voice agent handles the welcome and pacing. This panel exists mainly to preserve the handoff if staff need to take over.</p>
                <p>Next pass: auto-transcribed live fields, PMS sync, and branded post-checkout SMS + Google review automations.</p>
              </div>
            </section>

            {showOperatorPanel && (
              <section className="rounded-[28px] border border-white/10 bg-black/35 p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-white/45">Operator Panel</div>
                <div className="mt-4">
                  <label className="text-xs uppercase tracking-[0.2em] text-white/45">Vapi assistant id</label>
                  <Input
                    value={assistantId}
                    readOnly
                    className="mt-2 h-12 rounded-2xl border-white/10 bg-black/40 text-white/70"
                  />
                </div>
                <div className="mt-4">
                  <label className="text-xs uppercase tracking-[0.2em] text-white/45">Vapi public key</label>
                  <Input
                    value={HOTEL_VAPI_PUBLIC_KEY}
                    readOnly
                    className="mt-2 h-12 rounded-2xl border-white/10 bg-black/40 text-white/70"
                  />
                </div>
                <div className="mt-3 text-xs text-white/50">
                  The assistant id and public key must come from the same Vapi workspace or the browser call will fail.
                </div>
              </section>
            )}
          </aside>
        </main>
      </div>
    </div>
  );
}
