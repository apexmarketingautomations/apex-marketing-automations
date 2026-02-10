import { useState } from "react";
import { Mic, Megaphone, Play, Loader2, CheckCircle2, Sparkles, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function GrowthCenter() {
  const [adCommand, setAdCommand] = useState("");
  const [voiceCommand, setVoiceCommand] = useState("");
  const [adLoading, setAdLoading] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [adResult, setAdResult] = useState<any>(null);
  const [voiceResult, setVoiceResult] = useState<any>(null);
  const { toast } = useToast();

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

  const handleStartDialing = async () => {
    if (!voiceCommand.trim()) return;
    setVoiceLoading(true);
    setVoiceResult(null);

    try {
      const res = await fetch("/api/voice-agents/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDescription: voiceCommand }),
      });

      if (!res.ok) throw new Error("Failed to generate agent");

      const data = await res.json();
      setVoiceResult(data);
      toast({ title: "Agent Persona Ready", description: `${data.suggestedName} is configured.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setVoiceLoading(false);
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
              AI Cold Caller
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={voiceCommand}
                onChange={(e) => setVoiceCommand(e.target.value)}
                placeholder="Ex: Call all leads from yesterday. Act like Sarah. Book them in."
                className="bg-black/40 border-white/10 text-white placeholder:text-neutral-500"
                onKeyDown={(e) => e.key === "Enter" && !voiceLoading && handleStartDialing()}
                data-testid="input-voice-command"
              />
              <Button
                className="bg-purple-600 hover:bg-purple-500 shrink-0"
                onClick={handleStartDialing}
                disabled={voiceLoading || !voiceCommand.trim()}
                data-testid="button-start-dialing"
              >
                {voiceLoading ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <Play size={16} className="mr-2" />
                )}
                {voiceLoading ? "Generating..." : "Start Dialing"}
              </Button>
            </div>

            <AnimatePresence>
              {voiceResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-black/30 rounded-xl p-4 space-y-3 border border-purple-500/10">
                    <div className="flex items-center gap-2 text-purple-300 text-sm font-medium">
                      <Sparkles size={16} /> Agent Configured
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-neutral-500 text-xs">Agent Name</p>
                        <p className="text-white" data-testid="text-agent-name">{voiceResult.suggestedName}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 text-xs">Persona</p>
                        <p className="text-neutral-200" data-testid="text-agent-persona">{voiceResult.persona}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500 text-xs">Opening Line</p>
                        <p className="text-neutral-200 italic" data-testid="text-agent-greeting">"{voiceResult.firstMessage}"</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-white/5">
                      <a
                        href="/voice-agent"
                        className="text-xs text-purple-400 hover:text-purple-300 underline"
                        data-testid="link-deploy-agent"
                      >
                        Deploy this agent on Voice Agent Studio →
                      </a>
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
