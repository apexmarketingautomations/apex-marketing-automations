import { useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mic, MicOff, PhoneCall, ClipboardCheck, LogOut, CalendarPlus } from "lucide-react";

type TicketType = "reservation_request" | "check_in" | "check_out" | "general";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function loadLocal(key: string, fallback: string) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function saveLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export default function FrontDeskKioskPage() {
  const { toast } = useToast();

  const [hotelName] = useState("OYO Waterfront Hotel - Cape Coral");
  const [timezone] = useState("America/New_York");

  const [assistantId, setAssistantId] = useState(() => loadLocal("frontdesk.assistantId", ""));
  const [isVapiConfigured, setIsVapiConfigured] = useState<boolean | null>(null);
  const vapiRef = useRef<Vapi | null>(null);

  const [mode, setMode] = useState<TicketType>("reservation_request");
  const [submitting, setSubmitting] = useState(false);

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [roomOrNotes, setRoomOrNotes] = useState("");
  const [dates, setDates] = useState("");

  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);

  const canStartVoice = useMemo(() => {
    return !!assistantId && isVapiConfigured === true;
  }, [assistantId, isVapiConfigured]);

  useEffect(() => {
    fetch("/api/vapi/get-config")
      .then((r) => r.json())
      .then((cfg) => setIsVapiConfigured(!!cfg?.isConfigured && !!cfg?.publicKey))
      .catch(() => setIsVapiConfigured(false));
  }, []);

  useEffect(() => {
    saveLocal("frontdesk.assistantId", assistantId);
  }, [assistantId]);

  useEffect(() => {
    return () => {
      try { vapiRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  async function ensureVapi() {
    const cfg = await fetch("/api/vapi/get-config").then((r) => r.json());
    if (!cfg?.publicKey) {
      throw new Error("Voice is not configured (missing VAPI public key)");
    }
    if (!vapiRef.current) {
      vapiRef.current = new Vapi(cfg.publicKey);
      vapiRef.current.on("call-start", () => setVoiceActive(true));
      vapiRef.current.on("call-end", () => setVoiceActive(false));
      vapiRef.current.on("error", (e: any) => {
        console.error("[KIOSK] vapi error", e);
        setVoiceActive(false);
        setVoiceConnecting(false);
        toast({ title: "Voice error", description: e?.message || "Call failed", variant: "destructive" });
      });
    }
  }

  async function startVoice() {
    if (!assistantId) {
      toast({ title: "Assistant not set", description: "Add an assistantId first.", variant: "destructive" });
      return;
    }
    setVoiceConnecting(true);
    try {
      await ensureVapi();
      const webCallRes = await fetch("/api/vapi/start-web-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantId }),
      });
      const errData = !webCallRes.ok ? await webCallRes.json().catch(() => ({})) : null;
      if (!webCallRes.ok) throw new Error((errData as any)?.error || "Failed to create web call");
      const { webCallUrl } = await webCallRes.json();
      if (!webCallUrl) throw new Error("No webCallUrl returned");

      await (vapiRef.current as any).reconnect({ webCallUrl });
      setVoiceConnecting(false);
    } catch (err: any) {
      setVoiceConnecting(false);
      toast({ title: "Couldn’t start voice", description: err?.message || "Unknown error", variant: "destructive" });
    }
  }

  async function stopVoice() {
    try { vapiRef.current?.stop(); } catch { /* ignore */ }
    setVoiceActive(false);
  }

  function resetForm() {
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setRoomOrNotes("");
    setDates("");
  }

  async function submitTicket() {
    setSubmitting(true);
    try {
      const payload: any = {
        hotelName,
        timezone,
        dates: dates.trim() || null,
        roomOrNotes: roomOrNotes.trim() || null,
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

      toast({ title: "Ticket created", description: `Saved to ${hotelName}.` });
      resetForm();
    } catch (err: any) {
      toast({ title: "Couldn’t create ticket", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-white/60">Front Desk</div>
            <div className="text-xl font-semibold truncate">{hotelName}</div>
          </div>
          <div className="flex items-center gap-2">
            <a className="text-xs text-white/60 hover:text-white transition" href="/dashboard">Exit</a>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold">Voice (In-Person)</div>
          <div className="mt-3 grid gap-2">
            <label className="text-xs text-white/60">Vapi Assistant ID</label>
            <Input
              value={assistantId}
              onChange={(e) => setAssistantId(e.target.value)}
              placeholder="assistantId (per hotel sub-account)"
              className="bg-black/40 border-white/10"
            />
            <div className="flex items-center gap-2 mt-2">
              <Button
                onClick={voiceActive ? stopVoice : startVoice}
                disabled={voiceConnecting || (!voiceActive && !canStartVoice)}
                className={cn("w-full justify-center", voiceActive ? "bg-white text-black hover:bg-white/90" : "bg-white/10 hover:bg-white/15")}
              >
                {voiceConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : (voiceActive ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />)}
                {voiceActive ? "End Voice Session" : "Start Voice Session"}
              </Button>
            </div>
            {isVapiConfigured === false && (
              <div className="text-xs text-red-300 mt-2">
                Voice isn’t configured on this server (missing Vapi keys).
              </div>
            )}
            <div className="text-xs text-white/50 mt-2">
              Tip: run this page on an iPad in Guided Access so it stays locked on the kiosk.
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Front Desk Intake</div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className={cn("border-white/10 bg-transparent text-white hover:bg-white/10", mode === "reservation_request" && "bg-white/10")}
                onClick={() => setMode("reservation_request")}
              >
                <CalendarPlus className="w-4 h-4 mr-2" />
                Reservation
              </Button>
              <Button
                variant="outline"
                className={cn("border-white/10 bg-transparent text-white hover:bg-white/10", mode === "check_in" && "bg-white/10")}
                onClick={() => setMode("check_in")}
              >
                <ClipboardCheck className="w-4 h-4 mr-2" />
                Check-In
              </Button>
              <Button
                variant="outline"
                className={cn("border-white/10 bg-transparent text-white hover:bg-white/10", mode === "check_out" && "bg-white/10")}
                onClick={() => setMode("check_out")}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Check-Out
              </Button>
              <Button
                variant="outline"
                className={cn("border-white/10 bg-transparent text-white hover:bg-white/10", mode === "general" && "bg-white/10")}
                onClick={() => setMode("general")}
              >
                <PhoneCall className="w-4 h-4 mr-2" />
                General
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/60">Guest name</label>
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1 bg-black/40 border-white/10" />
            </div>
            <div>
              <label className="text-xs text-white/60">Mobile phone</label>
              <Input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+1…" className="mt-1 bg-black/40 border-white/10" />
            </div>
            <div>
              <label className="text-xs text-white/60">Email</label>
              <Input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="guest@email.com" className="mt-1 bg-black/40 border-white/10" />
            </div>
            <div>
              <label className="text-xs text-white/60">Dates / timing</label>
              <Input value={dates} onChange={(e) => setDates(e.target.value)} placeholder="Check-in / Check-out dates, late arrival, etc." className="mt-1 bg-black/40 border-white/10" />
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs text-white/60">{mode === "check_in" ? "Room / ID / Deposit notes" : mode === "check_out" ? "Room / Incidentals notes" : "Notes"}</label>
            <Textarea value={roomOrNotes} onChange={(e) => setRoomOrNotes(e.target.value)} className="mt-1 min-h-[140px] bg-black/40 border-white/10" />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-white/50">
              Creates an internal ticket for staff. PMS integration can be added later.
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="border-white/10 bg-transparent text-white hover:bg-white/10" onClick={resetForm}>
                Clear
              </Button>
              <Button onClick={submitTicket} disabled={submitting} className="bg-white text-black hover:bg-white/90">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create Ticket
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
