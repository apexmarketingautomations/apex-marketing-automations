import { useState, useEffect } from "react";
import {
  Send,
  Smartphone,
  Monitor,
  RefreshCcw,
  Save,
  Loader2,
  LayoutTemplate,
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
  FolderOpen,
  Trash2,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChatWidget } from "@/components/chat-widget";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShieldCheck,
  Clock,
  Sparkles,
  Star,
  Dumbbell,
  Heart,
  Zap,
  Trophy,
  CheckCircle2,
};

function HeroSection({ title, subtitle, cta, image, theme }: any) {
  return (
    <div
      className="py-20 px-6 md:px-12 flex flex-col items-center text-center relative overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div
        className="absolute inset-0 opacity-20 bg-cover bg-center z-0"
        style={{ backgroundImage: `url(${image})` }}
      />
      <div className="relative z-10 max-w-3xl space-y-6">
        <h1
          className="text-4xl md:text-6xl font-bold tracking-tight"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h1>
        <p className="text-lg md:text-xl opacity-90">{subtitle}</p>
        <Button
          size="lg"
          className="mt-4 font-bold"
          style={{ backgroundColor: theme.primary, color: theme.bg }}
          data-testid="button-hero-cta"
        >
          {cta}
        </Button>
      </div>
    </div>
  );
}

function FeatureSection({ title, features, theme }: any) {
  return (
    <div
      className="py-16 px-6 md:px-12 bg-white/5"
      style={{ color: theme.text }}
    >
      <div className="max-w-6xl mx-auto">
        <h2
          className="text-3xl font-bold text-center mb-12"
          style={{ fontFamily: theme.font }}
        >
          {title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f: any, i: number) => {
            const IconComponent = ICON_MAP[f.icon] || Star;
            return (
              <div
                key={i}
                className="p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: theme.primary + "20",
                    color: theme.primary,
                  }}
                >
                  <IconComponent size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                <p className="text-sm opacity-70">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSection({ title, theme }: any) {
  return (
    <div
      className="py-20 px-6 text-center"
      style={{ backgroundColor: theme.bg, color: theme.text }}
    >
      <div className="max-w-md mx-auto p-8 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-sm">
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
        <div className="space-y-4">
          <Input
            placeholder="Full Name"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-name"
          />
          <Input
            placeholder="Email Address"
            className="bg-white/10 border-white/20"
            data-testid="input-preview-email"
          />
          <Button
            className="w-full font-bold"
            style={{ backgroundColor: theme.primary, color: theme.bg }}
            data-testid="button-preview-submit"
          >
            Check Availability
          </Button>
          <p className="text-xs opacity-50 mt-4">Powered by Apex Marketing Animation</p>
        </div>
      </div>
    </div>
  );
}

interface SavedSite {
  id: number;
  name: string;
  prompt: string;
  siteData: any;
  createdAt: string;
}

export default function SiteBuilder() {
  const [prompt, setPrompt] = useState("");
  const [siteData, setSiteData] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<"desktop" | "mobile">("desktop");
  const [history, setHistory] = useState<string[]>([]);
  const [lastPrompt, setLastPrompt] = useState("");
  const [savedSites, setSavedSites] = useState<SavedSite[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchSavedSites();
  }, []);

  const fetchSavedSites = async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSavedSites(data);
      }
    } catch {}
  };

  const handleGenerate = async (overridePrompt?: string) => {
    const text = overridePrompt || prompt.trim();
    if (!text) return;
    setIsGenerating(true);
    setLastPrompt(text);
    if (!overridePrompt) setHistory((prev) => [...prev, text]);

    try {
      const res = await fetch("/api/generate-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const data = await res.json();
      setSiteData(data);
    } catch (err: any) {
      toast({
        title: "Generation Failed",
        description: err.message || "Could not generate site. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setPrompt("");
    }
  };

  const handleRegenerate = () => {
    if (lastPrompt) handleGenerate(lastPrompt);
  };

  const handleSave = async () => {
    if (!siteData || !saveName.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          prompt: lastPrompt || "Untitled prompt",
          siteData,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await fetchSavedSites();
      setShowSaveDialog(false);
      setSaveName("");
      toast({ title: "Design Saved!", description: `"${saveName.trim()}" has been saved.` });
    } catch (err: any) {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = (site: SavedSite) => {
    const data = site.siteData as any;
    if (!data?.theme || !Array.isArray(data?.sections)) {
      toast({ title: "Invalid Design", description: "This saved design has missing data and can't be loaded.", variant: "destructive" });
      return;
    }
    setSiteData(data);
    setLastPrompt(site.prompt);
    setHistory((prev) => [...prev, `Loaded: ${site.name}`]);
    setShowSaved(false);
    toast({ title: "Design Loaded", description: `"${site.name}" is now in the preview.` });
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      const res = await fetch(`/api/sites/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchSavedSites();
      toast({ title: "Deleted", description: `"${name}" has been removed.` });
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    }
  };

  const handlePublish = () => {
    toast({
      title: "Site Published!",
      description: "Your landing page is now live.",
    });
  };

  return (
    <div className="min-h-screen bg-[#030014] text-white flex flex-col md:flex-row font-sans relative">
      <div className="fixed inset-0 bg-grid z-0 pointer-events-none" />
      <div className="fixed top-0 left-0 w-full h-[500px] bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none z-0" />

      <div className="w-full md:w-[400px] border-r border-white/10 flex flex-col glass-panel z-10 md:min-h-screen relative">
        <div className="p-6 border-b border-white/5">
          <h1 className="text-xl font-bold flex items-center gap-2 glow-text">
            <LayoutTemplate className="text-indigo-400 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
            Site Architect
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            AI-POWERED // DESCRIBE &rarr; GENERATE
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 && (
            <div className="text-center text-slate-500 mt-10 text-sm p-4 border border-dashed border-white/10 rounded-xl glass">
              <p className="mb-3">Try prompts like:</p>
              <ul className="space-y-2 text-indigo-400">
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Gym landing page, aggressive red/black theme"
                      )
                    }
                    data-testid="button-prompt-gym"
                  >
                    "Gym landing page, aggressive style"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Luxury med spa funnel, gold and black theme"
                      )
                    }
                    data-testid="button-prompt-luxe"
                  >
                    "Luxury med spa, gold & black"
                  </button>
                </li>
                <li>
                  <button
                    className="hover:underline text-left"
                    onClick={() =>
                      setPrompt(
                        "Dentist funnel, clean blue/white, friendly"
                      )
                    }
                    data-testid="button-prompt-dental"
                  >
                    "Dentist funnel, clean & friendly"
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
              className="glass p-3 rounded-lg text-sm"
            >
              <span className="opacity-50 text-xs block mb-1 font-mono">YOU</span>
              {h}
            </motion.div>
          ))}
          {isGenerating && (
            <div className="flex items-center gap-2 text-indigo-400 text-sm animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating layout & copy...
            </div>
          )}
          {siteData && !isGenerating && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-500/10 p-3 rounded-lg text-sm border border-indigo-500/20 glow-box"
            >
              <span className="opacity-50 text-xs block mb-1 font-mono">AI</span>
              <div className="flex items-center gap-2 text-indigo-300">
                <CheckCircle2 className="h-4 w-4" />
                Site generated with {siteData.sections.length} sections.
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Theme: {siteData.theme.font} /{" "}
                <span
                  className="inline-block w-3 h-3 rounded-full align-middle"
                  style={{ backgroundColor: siteData.theme.primary }}
                />{" "}
                {siteData.theme.primary}
              </p>
            </motion.div>
          )}
        </div>

        <div className="p-4 bg-black/40 border-t border-white/5 backdrop-blur-md">
          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the website..."
              className="bg-white/5 border-white/10 focus:border-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              data-testid="input-prompt"
            />
            <Button
              onClick={() => handleGenerate()}
              disabled={isGenerating || !prompt.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
              data-testid="button-generate"
            >
              <Send size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col bg-black/40 backdrop-blur-sm z-10">
        <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-white/5 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-2 bg-black/50 p-1 rounded-lg border border-white/5">
            <button
              onClick={() => setViewMode("desktop")}
              className={`p-2 rounded transition-colors ${
                viewMode === "desktop"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
              data-testid="button-view-desktop"
            >
              <Monitor size={16} />
            </button>
            <button
              onClick={() => setViewMode("mobile")}
              className={`p-2 rounded transition-colors ${
                viewMode === "mobile"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
              data-testid="button-view-mobile"
            >
              <Smartphone size={16} />
            </button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5 text-slate-300"
              onClick={() => setShowSaved(true)}
              data-testid="button-load-designs"
            >
              <FolderOpen size={14} className="mr-2" /> My Designs{savedSites.length > 0 && ` (${savedSites.length})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5 text-slate-300"
              onClick={handleRegenerate}
              disabled={!lastPrompt || isGenerating}
              data-testid="button-regenerate"
            >
              <RefreshCcw size={14} className="mr-2" /> Regenerate
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
              onClick={() => { setSaveName(""); setShowSaveDialog(true); }}
              disabled={!siteData}
              data-testid="button-save-design"
            >
              <Save size={14} className="mr-2" /> Save
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-500/20"
              onClick={handlePublish}
              disabled={!siteData}
              data-testid="button-publish"
            >
              Publish
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-8 flex justify-center items-start bg-[radial-gradient(#2a2a2a_1px,transparent_1px)] [background-size:16px_16px]">
          {siteData ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className={`bg-white shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500 ease-in-out ${
                viewMode === "mobile"
                  ? "w-[375px] rounded-[30px] border-[8px] border-neutral-900"
                  : "w-full max-w-5xl rounded-lg border-[8px] border-neutral-900"
              }`}
              style={{ minHeight: "800px" }}
              data-testid="preview-canvas"
            >
              {siteData.sections.map((section: any, i: number) => {
                const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
                  HERO: HeroSection,
                  FEATURES: FeatureSection,
                  BOOKING: BookingSection,
                };
                const Component = COMPONENT_MAP[section.type];
                if (!Component) return null;
                const props = { ...section.props, theme: siteData.theme };
                return <Component key={i} {...props} />;
              })}
              <ChatWidget primaryColor={siteData.theme.primary} />
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-600 space-y-4 mt-32">
              <div className="w-20 h-20 rounded-2xl glass flex items-center justify-center glow-box">
                <LayoutTemplate size={40} className="text-indigo-500/30" />
              </div>
              <p className="text-lg font-medium text-slate-400">Enter a prompt to generate a preview</p>
              <p className="text-sm text-slate-600">
                Describe your business type, style, and color preferences
              </p>
              {savedSites.length > 0 && (
                <Button
                  variant="outline"
                  className="mt-4 border-white/10 hover:bg-white/5 text-slate-400"
                  onClick={() => setShowSaved(true)}
                  data-testid="button-load-designs-empty"
                >
                  <FolderOpen size={16} className="mr-2" /> Load a Saved Design
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showSaveDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSaveDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-save-design"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Save Design</h3>
                <button onClick={() => setShowSaveDialog(false)} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">Give your design a name so you can find it later.</p>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g., Med Spa Gold Theme"
                className="bg-white/5 border-white/10 mb-4"
                onKeyDown={(e) => e.key === "Enter" && saveName.trim() && handleSave()}
                autoFocus
                data-testid="input-save-name"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10"
                  onClick={() => setShowSaveDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-500"
                  onClick={handleSave}
                  disabled={!saveName.trim() || isSaving}
                  data-testid="button-confirm-save"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Save size={14} className="mr-2" />}
                  Save Design
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showSaved && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSaved(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-saved-designs"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <FolderOpen size={20} className="text-indigo-400" />
                  My Saved Designs
                </h3>
                <button onClick={() => setShowSaved(false)} className="text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3">
                {savedSites.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <FolderOpen size={40} className="mx-auto mb-3 opacity-30" />
                    <p>No saved designs yet.</p>
                    <p className="text-xs mt-1">Generate a site and click Save to store it here.</p>
                  </div>
                ) : (
                  savedSites.map((site) => (
                    <div
                      key={site.id}
                      className="group bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors"
                      data-testid={`card-saved-site-${site.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm truncate">{site.name}</h4>
                          <p className="text-xs text-slate-400 mt-1 truncate">{site.prompt}</p>
                          <p className="text-xs text-slate-600 mt-1">
                            {new Date(site.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            className="bg-indigo-600 hover:bg-indigo-500 h-8 text-xs"
                            onClick={() => handleLoad(site)}
                            data-testid={`button-load-site-${site.id}`}
                          >
                            Load
                          </Button>
                          <button
                            onClick={() => handleDelete(site.id, site.name)}
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            data-testid={`button-delete-site-${site.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
