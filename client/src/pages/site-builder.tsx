import { useState, useEffect, useCallback } from "react";
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
  GripVertical,
  History,
  Globe,
  Users,
  Plus,
  Edit,
  Copy,
  Share2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Info,
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
  customDomain?: string;
  publishedUrl?: string;
}

interface SiteVersion {
  id: number;
  siteId: number;
  versionNumber: number;
  label: string;
  siteData: any;
  createdAt: string;
}

interface Collaborator {
  id: number;
  siteId: number;
  name: string;
  email: string;
  role: string;
  inviteCode: string;
  joinedAt: string;
}

function SectionEditor({ section, index, onUpdate, onClose }: { section: any; index: number; onUpdate: (idx: number, props: any) => void; onClose: () => void }) {
  const [editProps, setEditProps] = useState<Record<string, any>>({ ...section.props });

  const handleChange = (key: string, value: any) => {
    setEditProps((prev: Record<string, any>) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onUpdate(index, editProps);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-neutral-900 border border-white/10 rounded-xl p-4 mb-2 space-y-3"
      data-testid={`editor-section-${index}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-indigo-400">Edit {section.type} Section</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white" data-testid={`button-close-editor-${index}`}>
          <X size={16} />
        </button>
      </div>
      {Object.entries(editProps).map(([key, value]) => {
        if (key === "features" || key === "formId" || typeof value === "object") return null;
        return (
          <div key={key}>
            <label className="text-xs text-slate-400 block mb-1 capitalize">{key}</label>
            <Input
              value={String(value || "")}
              onChange={(e) => handleChange(key, e.target.value)}
              className="bg-white/5 border-white/10 text-sm"
              data-testid={`input-edit-${key}-${index}`}
            />
          </div>
        );
      })}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={onClose}>Cancel</Button>
        <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-xs" onClick={handleSave} data-testid={`button-save-section-${index}`}>Apply</Button>
      </div>
    </motion.div>
  );
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

  const [editMode, setEditMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [currentSiteId, setCurrentSiteId] = useState<number | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const [domainSiteId, setDomainSiteId] = useState<number | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);

  const [collabSiteId, setCollabSiteId] = useState<number | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collabName, setCollabName] = useState("");
  const [collabEmail, setCollabEmail] = useState("");
  const [loadingCollabs, setLoadingCollabs] = useState(false);

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

  const fetchVersions = useCallback(async (siteId: number) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/versions`);
      if (res.ok) setVersions(await res.json());
    } catch {} finally {
      setLoadingVersions(false);
    }
  }, []);

  const fetchCollaborators = useCallback(async (siteId: number) => {
    setLoadingCollabs(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/collaborators`);
      if (res.ok) setCollaborators(await res.json());
    } catch {} finally {
      setLoadingCollabs(false);
    }
  }, []);

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
      setCurrentSiteId(null);
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
      const saved = await res.json();
      setCurrentSiteId(saved.id);

      await fetch(`/api/sites/${saved.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: saveName.trim() }),
      });

      await fetchSavedSites();
      setShowSaveDialog(false);
      setSaveName("");
      toast({ title: "Design Saved!", description: `"${saveName.trim()}" has been saved with version snapshot.` });
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
    setCurrentSiteId(site.id);
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

  const handleRestoreVersion = (version: SiteVersion) => {
    const data = version.siteData as any;
    if (!data?.theme || !Array.isArray(data?.sections)) {
      toast({ title: "Invalid Version", description: "This version has corrupt data.", variant: "destructive" });
      return;
    }
    setSiteData(data);
    toast({ title: "Version Restored", description: `Restored to v${version.versionNumber}: ${version.label}` });
  };

  const openVersionHistory = () => {
    if (currentSiteId) {
      fetchVersions(currentSiteId);
    }
    setShowVersionHistory(true);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      const [moved] = sections.splice(dragIndex, 1);
      sections.splice(index, 0, moved);
      setDragIndex(index);
      return { ...prev, sections };
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragIndex(null);
  };

  const handleDeleteSection = (index: number) => {
    if (!confirm("Delete this section?")) return;
    setSiteData((prev: any) => ({
      ...prev,
      sections: prev.sections.filter((_: any, i: number) => i !== index),
    }));
    toast({ title: "Section Deleted" });
  };

  const handleUpdateSectionProps = (index: number, newProps: any) => {
    setSiteData((prev: any) => {
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], props: newProps };
      return { ...prev, sections };
    });
    toast({ title: "Section Updated" });
  };

  const handleAddSection = (type: string) => {
    const defaults: Record<string, any> = {
      HERO: { title: "New Hero Section", subtitle: "Your subtitle here", cta: "Get Started", image: "" },
      FEATURES: { title: "Our Features", features: [{ icon: "Star", title: "Feature 1", desc: "Description" }, { icon: "Zap", title: "Feature 2", desc: "Description" }, { icon: "Heart", title: "Feature 3", desc: "Description" }] },
      BOOKING: { title: "Book Now", formId: "new-form" },
    };
    setSiteData((prev: any) => ({
      ...prev,
      sections: [...prev.sections, { type, props: defaults[type] }],
    }));
    setAddSectionOpen(false);
    toast({ title: "Section Added", description: `Added ${type} section` });
  };

  const handleSaveDomain = async (siteId: number) => {
    setSavingDomain(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customDomain: domainInput.trim() }),
      });
      if (!res.ok) throw new Error("Failed to save domain");
      await fetchSavedSites();
      setDomainSiteId(null);
      setDomainInput("");
      toast({ title: "Domain Connected", description: `Domain "${domainInput.trim()}" has been set.` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingDomain(false);
    }
  };

  const handleAddCollaborator = async () => {
    if (!collabSiteId || !collabName.trim() || !collabEmail.trim()) return;
    try {
      const res = await fetch(`/api/sites/${collabSiteId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: collabName.trim(), email: collabEmail.trim(), role: "editor" }),
      });
      if (!res.ok) throw new Error("Failed to add collaborator");
      setCollabName("");
      setCollabEmail("");
      await fetchCollaborators(collabSiteId);
      toast({ title: "Collaborator Added" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleRemoveCollaborator = async (collabId: number) => {
    if (!collabSiteId) return;
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: "DELETE" });
      await fetchCollaborators(collabSiteId);
      toast({ title: "Collaborator Removed" });
    } catch {}
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Invite code copied to clipboard." });
  };

  const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
    HERO: HeroSection,
    FEATURES: FeatureSection,
    BOOKING: BookingSection,
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
          <div className="flex items-center gap-3">
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
            {siteData && (
              <button
                onClick={() => setEditMode(!editMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  editMode
                    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                    : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                }`}
                data-testid="button-toggle-edit-mode"
              >
                {editMode ? <EyeOff size={14} /> : <Eye size={14} />}
                {editMode ? "Exit Edit" : "Edit Mode"}
              </button>
            )}
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
            {currentSiteId && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 hover:bg-white/5 text-slate-300"
                onClick={openVersionHistory}
                data-testid="button-version-history"
              >
                <History size={14} className="mr-2" /> Versions
              </Button>
            )}
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
                const Component = COMPONENT_MAP[section.type];
                if (!Component) return null;
                const props = { ...section.props, theme: siteData.theme };

                if (editMode) {
                  return (
                    <div
                      key={i}
                      className={`relative group border-2 transition-colors ${dragIndex === i ? "border-indigo-500 bg-indigo-500/5" : "border-transparent hover:border-indigo-500/30"}`}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={handleDrop}
                      onDragEnd={() => setDragIndex(null)}
                      data-testid={`section-wrapper-${i}`}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-grab">
                        <GripVertical size={18} className="text-white/70" />
                      </div>
                      <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <button
                          onClick={() => setEditingSectionIndex(editingSectionIndex === i ? null : i)}
                          className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"
                          data-testid={`button-edit-section-${i}`}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteSection(i)}
                          className="p-1.5 rounded bg-red-600 text-white hover:bg-red-500"
                          data-testid={`button-delete-section-${i}`}
                        >
                          <Trash2 size={14} />
                        </button>
                        {i > 0 && (
                          <button
                            onClick={() => {
                              setSiteData((prev: any) => {
                                const s = [...prev.sections];
                                [s[i - 1], s[i]] = [s[i], s[i - 1]];
                                return { ...prev, sections: s };
                              });
                            }}
                            className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"
                            data-testid={`button-move-up-${i}`}
                          >
                            <ArrowUp size={14} />
                          </button>
                        )}
                        {i < siteData.sections.length - 1 && (
                          <button
                            onClick={() => {
                              setSiteData((prev: any) => {
                                const s = [...prev.sections];
                                [s[i], s[i + 1]] = [s[i + 1], s[i]];
                                return { ...prev, sections: s };
                              });
                            }}
                            className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"
                            data-testid={`button-move-down-${i}`}
                          >
                            <ArrowDown size={14} />
                          </button>
                        )}
                      </div>
                      <AnimatePresence>
                        {editingSectionIndex === i && (
                          <SectionEditor
                            section={section}
                            index={i}
                            onUpdate={handleUpdateSectionProps}
                            onClose={() => setEditingSectionIndex(null)}
                          />
                        )}
                      </AnimatePresence>
                      <Component {...props} />
                    </div>
                  );
                }

                return <Component key={i} {...props} />;
              })}

              {editMode && (
                <div className="p-4 flex justify-center">
                  {addSectionOpen ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2"
                    >
                      {["HERO", "FEATURES", "BOOKING"].map((type) => (
                        <Button
                          key={type}
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-500 text-xs"
                          onClick={() => handleAddSection(type)}
                          data-testid={`button-add-${type.toLowerCase()}`}
                        >
                          <Plus size={14} className="mr-1" /> {type}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-xs"
                        onClick={() => setAddSectionOpen(false)}
                        data-testid="button-cancel-add-section"
                      >
                        Cancel
                      </Button>
                    </motion.div>
                  ) : (
                    <Button
                      variant="outline"
                      className="border-dashed border-white/20 text-slate-400 hover:text-white hover:border-indigo-500"
                      onClick={() => setAddSectionOpen(true)}
                      data-testid="button-add-section"
                    >
                      <Plus size={16} className="mr-2" /> Add Section
                    </Button>
                  )}
                </div>
              )}

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

      {/* Version History Slide-out Panel */}
      <AnimatePresence>
        {showVersionHistory && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-[360px] bg-neutral-900 border-l border-white/10 z-[70] flex flex-col shadow-2xl"
            data-testid="panel-version-history"
          >
            <div className="p-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <History size={18} className="text-indigo-400" />
                Version History
              </h3>
              <button onClick={() => setShowVersionHistory(false)} className="text-slate-400 hover:text-white" data-testid="button-close-versions">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {loadingVersions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  <History size={32} className="mx-auto mb-3 opacity-30" />
                  <p>No versions yet.</p>
                  <p className="text-xs mt-1">Save the design to create version snapshots.</p>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-indigo-500/20" />
                  <div className="space-y-4">
                    {versions.map((v) => (
                      <div key={v.id} className="relative pl-10" data-testid={`version-item-${v.id}`}>
                        <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full bg-indigo-500 border-2 border-neutral-900" />
                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-indigo-300">v{v.versionNumber}</span>
                            <span className="text-xs text-slate-500">
                              {new Date(v.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{v.label}</p>
                          <Button
                            size="sm"
                            className="mt-2 bg-indigo-600 hover:bg-indigo-500 text-xs w-full"
                            onClick={() => handleRestoreVersion(v)}
                            data-testid={`button-restore-version-${v.id}`}
                          >
                            Restore
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save Dialog */}
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

        {/* My Designs Modal */}
        {showSaved && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowSaved(false); setDomainSiteId(null); setCollabSiteId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-saved-designs"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <FolderOpen size={20} className="text-indigo-400" />
                  My Saved Designs
                </h3>
                <button onClick={() => { setShowSaved(false); setDomainSiteId(null); setCollabSiteId(null); }} className="text-slate-400 hover:text-white">
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
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-sm truncate">{site.name}</h4>
                            {site.customDomain && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-medium" data-testid={`badge-domain-${site.id}`}>
                                <Globe size={10} /> {site.customDomain}
                              </span>
                            )}
                          </div>
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
                            onClick={() => { setDomainSiteId(domainSiteId === site.id ? null : site.id); setDomainInput(site.customDomain || ""); setCollabSiteId(null); }}
                            className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                            title="Connect Domain"
                            data-testid={`button-domain-${site.id}`}
                          >
                            <Globe size={14} />
                          </button>
                          <button
                            onClick={() => { setCollabSiteId(collabSiteId === site.id ? null : site.id); setDomainSiteId(null); if (collabSiteId !== site.id) fetchCollaborators(site.id); }}
                            className="p-2 text-slate-400 hover:text-indigo-400 transition-colors"
                            title="Share"
                            data-testid={`button-share-${site.id}`}
                          >
                            <Share2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(site.id, site.name)}
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            data-testid={`button-delete-site-${site.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Domain Mapping Panel */}
                      <AnimatePresence>
                        {domainSiteId === site.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-3" data-testid={`panel-domain-${site.id}`}>
                              <div className="flex gap-2">
                                <Input
                                  value={domainInput}
                                  onChange={(e) => setDomainInput(e.target.value)}
                                  placeholder="e.g., mybusiness.com"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-domain-${site.id}`}
                                />
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-500 text-xs"
                                  onClick={() => handleSaveDomain(site.id)}
                                  disabled={!domainInput.trim() || savingDomain}
                                  data-testid={`button-save-domain-${site.id}`}
                                >
                                  {savingDomain ? <Loader2 size={12} className="animate-spin" /> : "Connect"}
                                </Button>
                              </div>
                              {site.customDomain && (
                                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-xs space-y-2" data-testid={`info-dns-${site.id}`}>
                                  <div className="flex items-center gap-1 text-indigo-300 font-semibold">
                                    <Info size={12} /> DNS Setup Instructions
                                  </div>
                                  <div className="space-y-1 text-slate-300">
                                    <p><span className="text-slate-500">A Record:</span> Point <code className="bg-black/30 px-1 rounded">{site.customDomain}</code> to <code className="bg-black/30 px-1 rounded">76.76.21.21</code></p>
                                    <p><span className="text-slate-500">CNAME:</span> Point <code className="bg-black/30 px-1 rounded">www.{site.customDomain}</code> to <code className="bg-black/30 px-1 rounded">cname.apex-sites.com</code></p>
                                  </div>
                                  <p className="text-slate-500">Changes may take up to 48 hours to propagate.</p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Collaboration Panel */}
                      <AnimatePresence>
                        {collabSiteId === site.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/10 space-y-3" data-testid={`panel-collab-${site.id}`}>
                              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
                                <Users size={14} /> Collaborators
                              </div>
                              <div className="flex gap-2">
                                <Input
                                  value={collabName}
                                  onChange={(e) => setCollabName(e.target.value)}
                                  placeholder="Name"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-collab-name-${site.id}`}
                                />
                                <Input
                                  value={collabEmail}
                                  onChange={(e) => setCollabEmail(e.target.value)}
                                  placeholder="Email"
                                  className="bg-white/5 border-white/10 text-sm flex-1"
                                  data-testid={`input-collab-email-${site.id}`}
                                />
                                <Button
                                  size="sm"
                                  className="bg-indigo-600 hover:bg-indigo-500 text-xs"
                                  onClick={handleAddCollaborator}
                                  disabled={!collabName.trim() || !collabEmail.trim()}
                                  data-testid={`button-add-collab-${site.id}`}
                                >
                                  Invite
                                </Button>
                              </div>

                              {loadingCollabs ? (
                                <div className="flex justify-center py-3">
                                  <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                                </div>
                              ) : collaborators.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-2">No collaborators yet. Invite someone above.</p>
                              ) : (
                                <div className="space-y-2">
                                  {collaborators.map((c) => (
                                    <div key={c.id} className="flex items-center justify-between bg-white/5 rounded-lg p-2 text-xs" data-testid={`collab-item-${c.id}`}>
                                      <div className="flex-1 min-w-0">
                                        <span className="font-medium text-white">{c.name}</span>
                                        <span className="text-slate-400 ml-2">{c.email}</span>
                                        <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px]">{c.role}</span>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0 ml-2">
                                        <button
                                          onClick={() => copyToClipboard(c.inviteCode)}
                                          className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-indigo-300 transition-colors"
                                          title="Copy invite code"
                                          data-testid={`button-copy-code-${c.id}`}
                                        >
                                          <Copy size={10} />
                                          <span className="font-mono">{c.inviteCode}</span>
                                        </button>
                                        <button
                                          onClick={() => handleRemoveCollaborator(c.id)}
                                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                                          data-testid={`button-remove-collab-${c.id}`}
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
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
