import { useState, useRef } from "react";
import {
  Send,
  Loader2,
  Megaphone,
  Target,
  DollarSign,
  Users,
  MapPin,
  Image,
  FileText,
  Rocket,
  RefreshCcw,
  TrendingUp,
  Eye,
  MousePointerClick,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Upload,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const CTA_LABELS: Record<string, string> = {
  BOOK_NOW: "Book Now",
  LEARN_MORE: "Learn More",
  SIGN_UP: "Sign Up",
  GET_OFFER: "Get Offer",
  SHOP_NOW: "Shop Now",
};

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Lead Generation",
  OUTCOME_AWARENESS: "Brand Awareness",
  OUTCOME_TRAFFIC: "Website Traffic",
  OUTCOME_SALES: "Sales",
};

function CampaignCard({ campaign, onImageChange }: { campaign: any; onImageChange: (url: string | null) => void }) {
  const budgetDollars = (campaign.daily_budget / 100).toFixed(0);
  const totalBudget = ((campaign.daily_budget / 100) * (campaign.duration_days || 14)).toFixed(0);
  const targeting = campaign.targeting;
  const adCopy = campaign.ad_copy;
  const cities = targeting?.geo_locations?.cities || [];
  const interests = targeting?.interests || [];
  const behaviors = targeting?.behaviors || [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();
  const isUploaded = campaign.generated_image_url && campaign.generated_image_url.startsWith("/uploads/");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload-ad-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        let errMsg = "Upload failed";
        try { const err = await res.json(); errMsg = err.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      onImageChange(data.url);
      toast({ title: "Image Uploaded", description: "Your ad creative has been updated." });
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message || "Could not upload image.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white" data-testid="text-campaign-name">
            {campaign.campaign_name}
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-full">
              {OBJECTIVE_LABELS[campaign.objective] || campaign.objective}
            </span>
            <span className="text-xs text-neutral-400 flex items-center gap-1">
              <Clock size={12} /> {campaign.duration_days || 14} days
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-green-400" data-testid="text-daily-budget">${budgetDollars}</p>
          <p className="text-xs text-neutral-400">per day · ${totalBudget} total</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
            <Target size={16} className="text-indigo-400" /> Targeting
          </h3>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Users size={14} className="text-neutral-500" />
              <span className="text-neutral-300">
                Ages {targeting?.age_min || 18}–{targeting?.age_max || 65}
                {targeting?.genders?.length === 1 && (targeting.genders[0] === 1 ? " · Men" : " · Women")}
                {targeting?.genders?.length === 2 && " · All Genders"}
              </span>
            </div>

            {cities.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin size={14} className="text-neutral-500 mt-0.5" />
                <div className="text-neutral-300">
                  {cities.map((c: any, i: number) => (
                    <span key={i}>
                      {c.key}{c.radius ? ` (${c.radius}mi)` : ""}
                      {i < cities.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {interests.length > 0 && (
              <div>
                <p className="text-xs text-neutral-500 mb-1">Interests</p>
                <div className="flex flex-wrap gap-1">
                  {interests.map((i: any, idx: number) => (
                    <span key={idx} className="text-xs bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded-full">
                      {i.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {behaviors.length > 0 && (
              <div>
                <p className="text-xs text-neutral-500 mb-1">Behaviors</p>
                <div className="flex flex-wrap gap-1">
                  {behaviors.map((b: any, idx: number) => (
                    <span key={idx} className="text-xs bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded-full">
                      {b.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-300 flex items-center gap-2">
              <FileText size={16} className="text-green-400" /> Ad Creative
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleFileUpload}
              data-testid="input-upload-ad-image"
            />
            <div className="flex items-center gap-1">
              {campaign.generated_image_url && isUploaded && (
                <button
                  onClick={() => onImageChange(null)}
                  className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5"
                  data-testid="button-remove-image"
                >
                  <X size={10} /> Remove
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 disabled:opacity-50"
                data-testid="button-upload-image"
              >
                {uploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                {uploading ? "Uploading..." : "Upload Image"}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl overflow-hidden shadow-lg" data-testid="card-ad-preview">
            {campaign.generated_image_url ? (
              <div className="h-56 relative overflow-hidden group">
                <img
                  src={campaign.generated_image_url}
                  alt="Ad creative"
                  className="w-full h-full object-cover"
                  data-testid="img-ad-creative"
                />
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                  {isUploaded ? (
                    <><Upload size={10} /> Uploaded</>
                  ) : (
                    <><Sparkles size={10} /> AI Generated</>
                  )}
                </div>
                <div
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-white text-xs flex items-center gap-2 bg-black/60 px-3 py-2 rounded-lg">
                    <Upload size={14} /> Replace Image
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="h-40 bg-gradient-to-br from-neutral-200 to-neutral-300 flex items-center justify-center cursor-pointer hover:from-neutral-300 hover:to-neutral-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-placeholder"
              >
                <div className="text-center text-neutral-500">
                  <Upload size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-medium">Click to upload an image</p>
                  <p className="text-[10px] opacity-60 mt-1">JPEG, PNG, WebP, GIF up to 5MB</p>
                </div>
              </div>
            )}
            <div className="p-4 space-y-2">
              <p className="text-sm text-neutral-800 font-medium">{adCopy?.primary_text}</p>
              <p className="text-base font-bold text-neutral-900">{adCopy?.headline}</p>
              <p className="text-xs text-neutral-500">{adCopy?.description}</p>
              <div className="pt-2 border-t border-neutral-100">
                <span className="text-xs font-bold text-blue-600 uppercase">
                  {CTA_LABELS[adCopy?.cta] || adCopy?.cta}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <Eye size={20} className="mx-auto mb-2 text-blue-400" />
          <p className="text-lg font-bold text-white" data-testid="text-est-reach">{campaign.estimated_reach}</p>
          <p className="text-xs text-neutral-400">Est. Daily Reach</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <MousePointerClick size={20} className="mx-auto mb-2 text-green-400" />
          <p className="text-lg font-bold text-white" data-testid="text-est-cpl">{campaign.estimated_cpl}</p>
          <p className="text-xs text-neutral-400">Est. Cost Per Lead</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
          <TrendingUp size={20} className="mx-auto mb-2 text-purple-400" />
          <p className="text-lg font-bold text-white">{campaign.duration_days || 14} days</p>
          <p className="text-xs text-neutral-400">Campaign Duration</p>
        </div>
      </div>

      {campaign.strategy_notes && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4">
          <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2 mb-2">
            <Sparkles size={14} /> AI Strategy Notes
          </h3>
          <p className="text-sm text-neutral-300" data-testid="text-strategy-notes">{campaign.strategy_notes}</p>
        </div>
      )}
    </div>
  );
}

export default function AdLauncher() {
  const [prompt, setPrompt] = useState("");
  const [campaign, setCampaign] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setLaunched(false);
    setHistory((prev) => [...prev, prompt]);

    try {
      const res = await fetch("/api/generate-ad-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const data = await res.json();
      setCampaign(data);
    } catch (err: any) {
      toast({
        title: "Campaign Generation Failed",
        description: err.message || "Could not generate campaign plan.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setPrompt("");
    }
  };

  const handleLaunch = () => {
    setLaunched(true);
    toast({
      title: "Campaign Queued!",
      description: "Campaign created in PAUSED state. Connect your Facebook Ads account to go live.",
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col md:flex-row font-sans">
      <div className="w-full md:w-[400px] border-r border-white/10 flex flex-col bg-neutral-900 z-10 md:min-h-screen">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Megaphone className="text-orange-500" />
            Ad Launcher
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Describe your offer, AI builds the full campaign.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 && (
            <div className="text-center text-neutral-500 mt-10 text-sm p-4 border border-dashed border-white/10 rounded-xl">
              <p className="mb-3">Try prompts like:</p>
              <ul className="space-y-2 text-orange-400">
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() => setPrompt("Botox special for women 25-45 in Miami, luxury med spa")}
                    data-testid="button-prompt-botox"
                  >
                    "Botox special, women 25-45, Miami"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() => setPrompt("6-week gym challenge, $49 sign-up, targeting men in LA who are into fitness")}
                    data-testid="button-prompt-gym-ad"
                  >
                    "Gym challenge, $49, fitness men in LA"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() => setPrompt("Teeth whitening promo $99, targeting young professionals in NYC")}
                    data-testid="button-prompt-dental-ad"
                  >
                    "Teeth whitening $99, NYC professionals"
                  </button>
                </li>
              </ul>
            </div>
          )}
          {history.map((h, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 p-3 rounded-lg text-sm border border-white/5"
            >
              <span className="opacity-50 text-xs block mb-1">YOU</span>
              {h}
            </motion.div>
          ))}
          {isGenerating && (
            <div className="flex items-center gap-2 text-orange-400 text-sm animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building campaign strategy & generating ad creative...
            </div>
          )}
          {campaign && !isGenerating && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-orange-500/10 p-3 rounded-lg text-sm border border-orange-500/20"
            >
              <span className="opacity-50 text-xs block mb-1">AI</span>
              <div className="flex items-center gap-2 text-orange-300">
                <CheckCircle2 className="h-4 w-4" />
                Campaign plan ready for review.
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                {campaign.campaign_name} · ${(campaign.daily_budget / 100).toFixed(0)}/day
              </p>
            </motion.div>
          )}
        </div>

        <div className="p-4 bg-neutral-950 border-t border-white/10">
          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your ad campaign..."
              className="bg-white/5 border-white/10 focus:border-orange-500"
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              data-testid="input-ad-prompt"
            />
            <Button
              onClick={() => handleGenerate()}
              disabled={isGenerating || !prompt.trim()}
              className="bg-orange-600 hover:bg-orange-700"
              data-testid="button-generate-campaign"
            >
              <Send size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-neutral-950 relative flex flex-col">
        <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-neutral-900">
          <h2 className="text-sm font-medium text-neutral-300">Campaign Preview</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5"
              onClick={() => handleGenerate()}
              disabled={isGenerating || history.length === 0}
              data-testid="button-regenerate-campaign"
            >
              <RefreshCcw size={14} className="mr-2" /> Regenerate
            </Button>
            <Button
              size="sm"
              className={`text-white ${launched ? "bg-green-600" : "bg-orange-600 hover:bg-orange-700"}`}
              onClick={handleLaunch}
              disabled={!campaign || launched}
              data-testid="button-launch-campaign"
            >
              {launched ? (
                <>
                  <CheckCircle2 size={14} className="mr-2" /> Queued
                </>
              ) : (
                <>
                  <Rocket size={14} className="mr-2" /> Launch Campaign
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8">
          <AnimatePresence mode="wait">
            {campaign ? (
              <motion.div
                key="campaign"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto"
              >
                {launched && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mb-6 bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3"
                  >
                    <CheckCircle2 className="text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-300">Campaign Created (PAUSED)</p>
                      <p className="text-xs text-neutral-400">Connect your Facebook Ads account to activate this campaign.</p>
                    </div>
                  </motion.div>
                )}

                {!launched && (
                  <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle className="text-amber-400" size={20} />
                    <div>
                      <p className="text-sm font-medium text-amber-300">Review Before Launching</p>
                      <p className="text-xs text-neutral-400">Campaigns launch in PAUSED state for safety. Review targeting and budget carefully.</p>
                    </div>
                  </div>
                )}

                <CampaignCard
                  campaign={campaign}
                  onImageChange={(url) => setCampaign((prev: any) => prev ? { ...prev, generated_image_url: url } : prev)}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center text-neutral-600 space-y-4 mt-32"
              >
                <Megaphone size={64} className="opacity-20" />
                <p className="text-lg">Describe your promotion to get started</p>
                <p className="text-sm text-neutral-500">
                  AI will generate targeting, copy, budget, and creative for your campaign
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
