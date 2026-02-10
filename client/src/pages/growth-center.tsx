import { useState, useEffect, useRef } from "react";
import { Mic, Megaphone, Play, Loader2, CheckCircle2, Sparkles, TrendingUp, Plus, Trash2, Phone, XCircle, Clock, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Lead {
  name: string;
  phone: string;
}

interface DialResult {
  name: string;
  phone: string;
  status: "dialed" | "failed";
  callId?: string;
  error?: string;
}

export default function GrowthCenter() {
  const [adCommand, setAdCommand] = useState("");
  const [adLoading, setAdLoading] = useState(false);
  const [adResult, setAdResult] = useState<any>(null);

  const [leads, setLeads] = useState<Lead[]>([
    { name: "", phone: "" },
  ]);
  const [assistantId, setAssistantId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [dialerRunning, setDialerRunning] = useState(false);
  const [dialerJobId, setDialerJobId] = useState<string | null>(null);
  const [dialerProgress, setDialerProgress] = useState<{ current: number; total: number; status: string; results: DialResult[]; leads?: Lead[] } | null>(null);
  const [existingAgents, setExistingAgents] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/voice-agents")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setExistingAgents(data);
          setAssistantId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleLaunchAd = async () => {
    if (!adCommand.trim()) return;
    setAdLoading(true);
    setAdResult(null);

    try {
      const res = await fetch("/api/generate-ad-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: adCommand }),
      });

      if (!res.ok) throw new Error("Failed to generate campaign");

      const data = await res.json();
      setAdResult(data);
      toast({ title: "Campaign Ready", description: "Your ad campaign has been generated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAdLoading(false);
    }
  };

  const addLead = () => {
    setLeads([...leads, { name: "", phone: "" }]);
  };

  const removeLead = (index: number) => {
    setLeads(leads.filter((_, i) => i !== index));
  };

  const updateLead = (index: number, field: "name" | "phone", value: string) => {
    const updated = [...leads];
    updated[index][field] = value;
    setLeads(updated);
  };

  const validLeads = leads.filter((l) => l.phone.trim());

  const startPowerDialer = async () => {
    if (!assistantId.trim() || validLeads.length === 0) return;
    setDialerRunning(true);
    setDialerProgress(null);

    try {
      const res = await fetch("/api/voice-agents/power-dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantId: assistantId.trim(),
          phoneNumberId: phoneNumberId.trim() || undefined,
          leads: validLeads,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start dialer");
      }

      const data = await res.json();
      setDialerJobId(data.jobId);
      setDialerProgress({ current: 0, total: data.total, status: "running", results: [], leads: validLeads });

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/voice-agents/power-dial/${data.jobId}`);
          if (!pollRes.ok) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDialerRunning(false);
            setDialerProgress((prev) => prev ? { ...prev, status: "failed" } : null);
            toast({ title: "Dialer Error", description: "Lost connection to the dialer job.", variant: "destructive" });
            return;
          }

          const pollData = await pollRes.json();
          setDialerProgress({
            current: pollData.current,
            total: pollData.total,
            status: pollData.status,
            results: pollData.results,
            leads: pollData.leads,
          });

          if (pollData.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDialerRunning(false);
            toast({ title: "Batch Complete", description: `Dialed ${pollData.results.length} leads.` });
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setDialerRunning(false);
          setDialerProgress((prev) => prev ? { ...prev, status: "failed" } : null);
          toast({ title: "Dialer Error", description: "Connection lost. Check server logs.", variant: "destructive" });
        }
      }, 3000);
    } catch (err: any) {
      setDialerRunning(false);
      toast({ title: "Dialer Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans">
      <div className="p-10 max-w-4xl mx-auto space-y-8">
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 mb-4">
            <TrendingUp className="text-emerald-400" size={32} />
          </div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Growth Center</h1>
          <p className="text-neutral-400 mt-2">Launch ads and cold calls with a single command.</p>
        </div>

        <Card className="bg-gradient-to-r from-blue-900 to-slate-900 border-blue-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Megaphone className="text-blue-400" />
              AI Ad Manager
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={adCommand}
                onChange={(e) => setAdCommand(e.target.value)}
                placeholder="Ex: Run a $50/day ad for my new whitening special targeting brides."
                className="bg-black/40 border-white/10 text-white placeholder:text-neutral-500"
                onKeyDown={(e) => e.key === "Enter" && !adLoading && handleLaunchAd()}
                data-testid="input-ad-command"
              />
              <Button
                className="bg-blue-600 hover:bg-blue-500 shrink-0"
                onClick={handleLaunchAd}
                disabled={adLoading || !adCommand.trim()}
                data-testid="button-launch-ad"
              >
                {adLoading ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <Play size={16} className="mr-2" />
                )}
                {adLoading ? "Generating..." : "Launch"}
              </Button>
            </div>

            <AnimatePresence>
              {adResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-black/30 rounded-xl p-4 space-y-3 border border-blue-500/10">
                    <div className="flex items-center gap-2 text-blue-300 text-sm font-medium">
                      <CheckCircle2 size={16} /> Campaign Generated
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-neutral-500 text-xs">Platform</p>
                        <p className="text-white" data-testid="text-ad-platform">{adResult.platform || "Facebook / Instagram"}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 text-xs">Daily Budget</p>
                        <p className="text-white" data-testid="text-ad-budget">{adResult.budget?.daily || "—"}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 text-xs">Objective</p>
                        <p className="text-white" data-testid="text-ad-objective">{adResult.objective || "—"}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 text-xs">Status</p>
                        <p className="text-amber-400" data-testid="text-ad-status">{adResult.status || "PAUSED"}</p>
                      </div>
                    </div>
                    {adResult.adCopy && (
                      <div>
                        <p className="text-neutral-500 text-xs mb-1">Ad Copy</p>
                        <p className="text-sm text-neutral-200 italic" data-testid="text-ad-copy">
                          "{adResult.adCopy.headline}"
                        </p>
                        <p className="text-xs text-neutral-400 mt-1">{adResult.adCopy.body}</p>
                      </div>
                    )}
                    {adResult.targeting && (
                      <div>
                        <p className="text-neutral-500 text-xs mb-1">Targeting</p>
                        <div className="flex flex-wrap gap-1">
                          {adResult.targeting.interests?.map((interest: string, i: number) => (
                            <span key={i} className="text-xs bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded-full">
                              {interest}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-r from-purple-900 to-slate-900 border-purple-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Mic className="text-purple-400" />
              AI Cold Caller — Power Dialer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Agent / Assistant ID</label>
                {existingAgents.length > 0 ? (
                  <select
                    value={assistantId}
                    onChange={(e) => setAssistantId(e.target.value)}
                    className="w-full h-10 bg-black/40 border border-white/10 rounded-md px-3 text-sm text-white focus:outline-none focus:border-purple-500"
                    data-testid="select-assistant-id"
                  >
                    {existingAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.id.slice(0, 16)}
                      </option>
                    ))}
                    <option value="">Enter manually...</option>
                  </select>
                ) : (
                  <Input
                    value={assistantId}
                    onChange={(e) => setAssistantId(e.target.value)}
                    placeholder="Vapi Assistant ID"
                    className="bg-black/40 border-white/10 text-white"
                    data-testid="input-assistant-id"
                  />
                )}
                {assistantId === "" && existingAgents.length > 0 && (
                  <Input
                    value={assistantId}
                    onChange={(e) => setAssistantId(e.target.value)}
                    placeholder="Paste Assistant ID"
                    className="bg-black/40 border-white/10 text-white mt-2"
                    data-testid="input-assistant-id-manual"
                  />
                )}
              </div>
              <div>
                <label className="text-xs text-neutral-400 mb-1.5 block">Phone Number ID (caller ID)</label>
                <Input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="From Vapi dashboard (optional)"
                  className="bg-black/40 border-white/10 text-white"
                  data-testid="input-dialer-phone-id"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-neutral-400 flex items-center gap-1.5">
                  <Users size={12} /> Lead List ({validLeads.length} valid)
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-purple-400 hover:text-purple-300 h-7 text-xs"
                  onClick={addLead}
                  disabled={dialerRunning}
                  data-testid="button-add-lead"
                >
                  <Plus size={12} className="mr-1" /> Add Lead
                </Button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {leads.map((lead, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={lead.name}
                      onChange={(e) => updateLead(i, "name", e.target.value)}
                      placeholder={`Name (e.g. Lead ${i + 1})`}
                      className="bg-black/40 border-white/10 text-white text-sm h-9 flex-1"
                      disabled={dialerRunning}
                      data-testid={`input-lead-name-${i}`}
                    />
                    <Input
                      value={lead.phone}
                      onChange={(e) => updateLead(i, "phone", e.target.value)}
                      placeholder="+15550101"
                      className="bg-black/40 border-white/10 text-white text-sm h-9 w-40"
                      disabled={dialerRunning}
                      data-testid={`input-lead-phone-${i}`}
                    />
                    {leads.length > 1 && (
                      <button
                        onClick={() => removeLead(i)}
                        className="text-neutral-500 hover:text-red-400 p-1"
                        disabled={dialerRunning}
                        data-testid={`button-remove-lead-${i}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Button
              className="w-full bg-purple-600 hover:bg-purple-500 h-12 text-base"
              onClick={startPowerDialer}
              disabled={dialerRunning || !assistantId.trim() || validLeads.length === 0}
              data-testid="button-start-power-dialer"
            >
              {dialerRunning ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" /> Dialing in Progress...
                </>
              ) : (
                <>
                  <Phone size={18} className="mr-2" /> Start Power Dialer ({validLeads.length} lead{validLeads.length !== 1 ? "s" : ""})
                </>
              )}
            </Button>

            <AnimatePresence>
              {dialerProgress && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-black/30 rounded-xl p-4 space-y-4 border border-purple-500/10">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-purple-300 flex items-center gap-2">
                        {dialerProgress.status === "completed" ? (
                          <><CheckCircle2 size={16} /> Batch Complete</>
                        ) : dialerProgress.status === "failed" ? (
                          <><XCircle size={16} className="text-red-400" /> <span className="text-red-300">Dialer Stopped</span></>
                        ) : (
                          <><Loader2 size={16} className="animate-spin" /> Dialing...</>
                        )}
                      </span>
                      <span className="text-xs text-neutral-400">
                        {dialerProgress.results.length} / {dialerProgress.total}
                      </span>
                    </div>

                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${(dialerProgress.results.length / dialerProgress.total) * 100}%` }}
                      />
                    </div>

                    {dialerProgress.status === "running" && dialerProgress.results.length < dialerProgress.total && (
                      <div className="flex items-center gap-2 text-xs text-neutral-400">
                        <Clock size={12} />
                        <span>30s delay between calls to avoid spam flags</span>
                      </div>
                    )}

                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {dialerProgress.results.map((r, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg bg-white/5"
                          data-testid={`dial-result-${i}`}
                        >
                          <div className="flex items-center gap-2">
                            {r.status === "dialed" ? (
                              <CheckCircle2 size={14} className="text-green-400" />
                            ) : (
                              <XCircle size={14} className="text-red-400" />
                            )}
                            <span className="text-neutral-200">{r.name}</span>
                            <span className="text-neutral-500 text-xs">{r.phone}</span>
                          </div>
                          <span className={`text-xs ${r.status === "dialed" ? "text-green-400" : "text-red-400"}`}>
                            {r.status === "dialed" ? "Dialed" : "Failed"}
                          </span>
                        </div>
                      ))}

                      {dialerProgress.status === "running" && dialerProgress.results.length < dialerProgress.total && (
                        <div className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg bg-purple-500/10 animate-pulse">
                          <Loader2 size={14} className="text-purple-400 animate-spin" />
                          <span className="text-purple-300">
                            Calling {dialerProgress.leads?.[dialerProgress.results.length]?.name || "next lead"}...
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
