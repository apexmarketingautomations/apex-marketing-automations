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
  Palette,
  Building2,
  Scissors,
  Stethoscope,
  UtensilsCrossed,
  GraduationCap,
  Briefcase,
  Car,
  Camera,
  Crown,
  Flame,
  Music,
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
  Crown,
  Flame,
  Camera,
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
  const [showTemplates, setShowTemplates] = useState(false);

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

  const SITE_TEMPLATES = [
    {
      id: "gym-aggressive",
      name: "Iron Forge Gym",
      industry: "Fitness",
      icon: Dumbbell,
      color: "#ef4444",
      description: "High-energy gym landing page with bold red/black theme and aggressive copy",
      siteData: {
        theme: { bg: "#0a0a0a", primary: "#ef4444", text: "#ffffff", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "CRUSH YOUR LIMITS", subtitle: "Elite training for those who refuse to settle. Transform your body in 90 days or your money back.", cta: "START FREE TRIAL", image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "WHY IRON FORGE", features: [{ icon: "Dumbbell", title: "Pro Equipment", desc: "Olympic-grade free weights, machines, and functional training rigs" }, { icon: "Zap", title: "Expert Coaches", desc: "NASM-certified trainers with competition experience" }, { icon: "Trophy", title: "Results Guaranteed", desc: "90-day transformation guarantee or your money back" }] } },
          { type: "BOOKING", props: { title: "Claim Your Free Session", formId: "gym-trial" } },
        ],
      },
    },
    {
      id: "medspa-luxury",
      name: "Lumière Med Spa",
      industry: "Med Spa",
      icon: Sparkles,
      color: "#d4a574",
      description: "Elegant luxury med spa with gold/black theme and premium aesthetic",
      siteData: {
        theme: { bg: "#0c0a09", primary: "#d4a574", text: "#fafaf9", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Timeless Beauty, Refined", subtitle: "Experience the art of aesthetic medicine at Manhattan's most exclusive med spa. Botox, fillers, and advanced skincare treatments.", cta: "Book Consultation", image: "https://images.unsplash.com/photo-1560750588-73207b1ef5b8?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Signature Services", features: [{ icon: "Sparkles", title: "Botox & Fillers", desc: "Natural-looking results from board-certified injectors" }, { icon: "Heart", title: "Laser Treatments", desc: "Advanced laser skin resurfacing and hair removal" }, { icon: "ShieldCheck", title: "Medical Grade", desc: "FDA-approved treatments in a luxurious clinical setting" }] } },
          { type: "BOOKING", props: { title: "Schedule Your Consultation", formId: "medspa-consult" } },
        ],
      },
    },
    {
      id: "dental-clean",
      name: "Bright Smile Dental",
      industry: "Dental",
      icon: Stethoscope,
      color: "#3b82f6",
      description: "Clean, friendly dental practice with calming blue/white professional theme",
      siteData: {
        theme: { bg: "#0f172a", primary: "#3b82f6", text: "#f1f5f9", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Your Smile Deserves the Best", subtitle: "Gentle, modern dentistry for the whole family. Same-day appointments available with flexible payment plans.", cta: "Book Appointment", image: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?q=80&w=2068&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Why Choose Us", features: [{ icon: "ShieldCheck", title: "Gentle Care", desc: "Anxiety-free dentistry with sedation options available" }, { icon: "Clock", title: "Same-Day Service", desc: "Emergency appointments and quick turnaround on procedures" }, { icon: "Star", title: "5-Star Rated", desc: "Over 2,000 happy patients and counting" }] } },
          { type: "BOOKING", props: { title: "Request Your Appointment", formId: "dental-appt" } },
        ],
      },
    },
    {
      id: "restaurant-warm",
      name: "Ember Kitchen",
      industry: "Restaurant",
      icon: UtensilsCrossed,
      color: "#f59e0b",
      description: "Warm, inviting restaurant page with amber tones and appetizing copy",
      siteData: {
        theme: { bg: "#1c1917", primary: "#f59e0b", text: "#fafaf9", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Farm to Table, Fire to Soul", subtitle: "Handcrafted dishes using locally sourced ingredients, wood-fired to perfection. Reserve your table tonight.", cta: "Reserve a Table", image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Ember Experience", features: [{ icon: "Star", title: "Chef's Tasting Menu", desc: "A curated 7-course journey through seasonal flavors" }, { icon: "Heart", title: "Local Ingredients", desc: "Partnerships with 12+ local farms and artisan producers" }, { icon: "Trophy", title: "Award Winning", desc: "Zagat rated, James Beard nominated, community loved" }] } },
          { type: "BOOKING", props: { title: "Make a Reservation", formId: "restaurant-reserve" } },
        ],
      },
    },
    {
      id: "realestate-modern",
      name: "Apex Realty",
      industry: "Real Estate",
      icon: Building2,
      color: "#10b981",
      description: "Modern real estate agency with sleek green/dark theme and property focus",
      siteData: {
        theme: { bg: "#0f1115", primary: "#10b981", text: "#e2e8f0", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Find Your Dream Home", subtitle: "Luxury properties, expert agents, and a seamless buying experience. Browse 500+ exclusive listings today.", cta: "Browse Listings", image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=2075&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Why Apex Realty", features: [{ icon: "ShieldCheck", title: "Trusted Agents", desc: "Licensed professionals with 15+ years of market experience" }, { icon: "Zap", title: "Fast Closings", desc: "Average 21-day close with our streamlined process" }, { icon: "Star", title: "Premium Listings", desc: "Exclusive access to off-market and pre-launch properties" }] } },
          { type: "BOOKING", props: { title: "Schedule a Viewing", formId: "realty-viewing" } },
        ],
      },
    },
    {
      id: "salon-chic",
      name: "Velvet Salon",
      industry: "Salon",
      icon: Scissors,
      color: "#ec4899",
      description: "Chic hair salon with pink/dark glam theme and trendy styling",
      siteData: {
        theme: { bg: "#18181b", primary: "#ec4899", text: "#fafafa", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Where Style Meets Art", subtitle: "Award-winning stylists creating looks that turn heads. Balayage, cuts, extensions, and bridal packages.", cta: "Book Your Look", image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2074&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Services", features: [{ icon: "Sparkles", title: "Color & Balayage", desc: "Hand-painted highlights and vivid color transformations" }, { icon: "Star", title: "Precision Cuts", desc: "Tailored cuts from NYC-trained master stylists" }, { icon: "Heart", title: "Bridal Packages", desc: "Full bridal party styling with trial sessions included" }] } },
          { type: "BOOKING", props: { title: "Book Your Appointment", formId: "salon-booking" } },
        ],
      },
    },
    {
      id: "coaching-pro",
      name: "Peak Performance",
      industry: "Coaching",
      icon: GraduationCap,
      color: "#8b5cf6",
      description: "Professional business coaching with purple/dark authority theme",
      siteData: {
        theme: { bg: "#0c0a1a", primary: "#8b5cf6", text: "#e2e8f0", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Unlock Your Full Potential", subtitle: "Executive coaching for ambitious leaders. 10x your revenue, build elite teams, and dominate your industry.", cta: "Apply Now", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Peak Method", features: [{ icon: "Trophy", title: "Proven Framework", desc: "The same system used by 200+ CEOs to scale past 7 figures" }, { icon: "Zap", title: "1-on-1 Mentoring", desc: "Weekly private sessions with a dedicated success coach" }, { icon: "CheckCircle2", title: "Accountability", desc: "Daily tracking, weekly reviews, and monthly strategy pivots" }] } },
          { type: "BOOKING", props: { title: "Book a Strategy Call", formId: "coaching-call" } },
        ],
      },
    },
    {
      id: "auto-bold",
      name: "Apex Auto Detailing",
      industry: "Automotive",
      icon: Car,
      color: "#06b6d4",
      description: "Bold auto detailing shop with cyan/dark high-performance theme",
      siteData: {
        theme: { bg: "#0a0f1a", primary: "#06b6d4", text: "#f0f9ff", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Showroom Finish, Every Time", subtitle: "Professional ceramic coating, paint correction, and full detailing. Your ride deserves the best treatment.", cta: "Get a Quote", image: "https://images.unsplash.com/photo-1507136566006-cfc505b114fc?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Packages", features: [{ icon: "ShieldCheck", title: "Ceramic Coating", desc: "9H hardness coating with 5-year warranty and hydrophobic protection" }, { icon: "Sparkles", title: "Paint Correction", desc: "Multi-stage machine polishing to remove swirls and scratches" }, { icon: "Star", title: "Full Detail", desc: "Interior deep clean, exterior polish, and engine bay detailing" }] } },
          { type: "BOOKING", props: { title: "Schedule Your Detail", formId: "auto-detail" } },
        ],
      },
    },
    {
      id: "law-firm",
      name: "Sterling & Associates",
      industry: "Legal",
      icon: Briefcase,
      color: "#1e40af",
      description: "Authoritative law firm page with deep blue/dark professional theme",
      siteData: {
        theme: { bg: "#0c1222", primary: "#1e40af", text: "#e2e8f0", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Justice. Integrity. Results.", subtitle: "Over 30 years of trial-tested experience in personal injury, business law, and estate planning. Free consultations.", cta: "Free Consultation", image: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Practice Areas", features: [{ icon: "ShieldCheck", title: "Personal Injury", desc: "No fee unless we win. Millions recovered for our clients" }, { icon: "Star", title: "Business Law", desc: "Contracts, compliance, and corporate litigation expertise" }, { icon: "CheckCircle2", title: "Estate Planning", desc: "Wills, trusts, and comprehensive asset protection strategies" }] } },
          { type: "BOOKING", props: { title: "Request a Free Case Review", formId: "law-consult" } },
        ],
      },
    },
    {
      id: "yoga-zen",
      name: "Serenity Studio",
      industry: "Yoga & Wellness",
      icon: Heart,
      color: "#a3e635",
      description: "Zen yoga studio with calming green/dark natural wellness theme",
      siteData: {
        theme: { bg: "#0a1a0a", primary: "#a3e635", text: "#ecfccb", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Breathe. Flow. Transform.", subtitle: "Discover inner peace through yoga, meditation, and holistic wellness. All levels welcome, first class free.", cta: "Try a Free Class", image: "https://images.unsplash.com/photo-1545389336-cf090694435e?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Our Offerings", features: [{ icon: "Heart", title: "Vinyasa Flow", desc: "Dynamic movement sequences synchronized with breath" }, { icon: "Sparkles", title: "Sound Healing", desc: "Crystal bowl meditation and chakra balancing sessions" }, { icon: "Clock", title: "Flexible Schedule", desc: "Classes from 6am to 9pm, 7 days a week" }] } },
          { type: "BOOKING", props: { title: "Reserve Your Mat", formId: "yoga-class" } },
        ],
      },
    },
    {
      id: "creator-glam",
      name: "Velvet Glow",
      industry: "Adult Creator",
      icon: Crown,
      color: "#e879f9",
      description: "Premium indie creator page with purple/pink glam aesthetic and VIP subscription CTA",
      siteData: {
        theme: { bg: "#0d0015", primary: "#e879f9", text: "#fae8ff", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Exclusive. Bold. Unapologetic.", subtitle: "Your all-access pass to premium content, private messages, and behind-the-scenes drops. Join the VIP list.", cta: "Subscribe Now", image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2064&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "What You Get", features: [{ icon: "Crown", title: "VIP Content", desc: "Exclusive photos, videos, and livestreams updated weekly" }, { icon: "Heart", title: "Direct Messages", desc: "Private 1-on-1 messaging and custom content requests" }, { icon: "Star", title: "Early Access", desc: "Be the first to see new drops and limited releases" }] } },
          { type: "BOOKING", props: { title: "Join the Inner Circle", formId: "creator-sub" } },
        ],
      },
    },
    {
      id: "creator-dark",
      name: "Midnight Muse",
      industry: "Adult Creator",
      icon: Flame,
      color: "#f43f5e",
      description: "Dark, sultry creator page with red/black bold theme and link-in-bio style",
      siteData: {
        theme: { bg: "#0a0000", primary: "#f43f5e", text: "#ffe4e6", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Welcome to My World", subtitle: "Curated content, exclusive drops, and a community that gets it. All links, all platforms, one place.", cta: "See My Content", image: "https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=2029&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Find Me Here", features: [{ icon: "Flame", title: "Premium Feed", desc: "Subscribe for the full uncensored experience" }, { icon: "Camera", title: "Photo Sets", desc: "Professional themed shoots released monthly" }, { icon: "Zap", title: "Live Sessions", desc: "Weekly live streams with real-time interaction" }] } },
          { type: "BOOKING", props: { title: "Get in Touch", formId: "creator-contact" } },
        ],
      },
    },
    {
      id: "creator-luxe",
      name: "Gilded Rose",
      industry: "Adult Creator",
      icon: Sparkles,
      color: "#fbbf24",
      description: "Luxury gold-themed creator page with high-end branding and tiered membership",
      siteData: {
        theme: { bg: "#0f0d08", primary: "#fbbf24", text: "#fef3c7", font: "Playfair Display" },
        sections: [
          { type: "HERO", props: { title: "Art. Allure. Access.", subtitle: "A curated luxury experience for discerning fans. Three tiers of exclusive membership with escalating perks.", cta: "Choose Your Tier", image: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "Membership Tiers", features: [{ icon: "Star", title: "Bronze - $9/mo", desc: "Access to weekly photo sets and community chat" }, { icon: "Sparkles", title: "Silver - $25/mo", desc: "All Bronze perks plus video content and DMs" }, { icon: "Crown", title: "Gold - $50/mo", desc: "Full access: custom content, video calls, and priority requests" }] } },
          { type: "BOOKING", props: { title: "Apply for Gold Membership", formId: "creator-gold" } },
        ],
      },
    },
    {
      id: "creator-neon",
      name: "Neon Nights",
      industry: "Adult Creator",
      icon: Camera,
      color: "#22d3ee",
      description: "Cyberpunk neon-themed creator page with electric cyan aesthetic and bold energy",
      siteData: {
        theme: { bg: "#020617", primary: "#22d3ee", text: "#cffafe", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Plug In. Turn On.", subtitle: "Digital-first content creator with a vibe that hits different. Exclusive drops, collabs, and 24/7 access.", cta: "Enter the Feed", image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "The Experience", features: [{ icon: "Zap", title: "Daily Content", desc: "Fresh uploads every single day across all platforms" }, { icon: "Camera", title: "Cinematic Quality", desc: "Studio-grade production on every piece of content" }, { icon: "Heart", title: "Fan Community", desc: "Private Discord with exclusive rooms and events" }] } },
          { type: "BOOKING", props: { title: "Book a Collab", formId: "creator-collab" } },
        ],
      },
    },
    {
      id: "creator-minimal",
      name: "Bare Canvas",
      industry: "Adult Creator",
      icon: Music,
      color: "#a78bfa",
      description: "Minimalist artistic creator page with soft violet tones and clean aesthetic",
      siteData: {
        theme: { bg: "#0c0a15", primary: "#a78bfa", text: "#ede9fe", font: "Inter" },
        sections: [
          { type: "HERO", props: { title: "Less Noise. More Art.", subtitle: "A clean, intentional space for creators who value aesthetic over everything. Minimalist content, maximum impact.", cta: "View Portfolio", image: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?q=80&w=2074&auto=format&fit=crop" } },
          { type: "FEATURES", props: { title: "What I Offer", features: [{ icon: "Sparkles", title: "Curated Gallery", desc: "Hand-picked portfolio of my best artistic work" }, { icon: "Heart", title: "Intimate Access", desc: "Behind-the-scenes process and personal journal entries" }, { icon: "Star", title: "Prints & Merch", desc: "Limited edition prints and exclusive branded merchandise" }] } },
          { type: "BOOKING", props: { title: "Commission a Piece", formId: "creator-commission" } },
        ],
      },
    },
  ];

  const handleLoadTemplate = (template: typeof SITE_TEMPLATES[0]) => {
    setSiteData(template.siteData);
    setLastPrompt(`Template: ${template.name}`);
    setHistory((prev) => [...prev, `Loaded template: ${template.name}`]);
    setCurrentSiteId(null);
    setShowTemplates(false);
    toast({ title: "Template Loaded", description: `"${template.name}" is ready to customize.` });
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
              <div className="mt-4 pt-3 border-t border-white/10">
                <button
                  onClick={() => setShowTemplates(true)}
                  className="flex items-center gap-2 mx-auto text-indigo-400 hover:text-indigo-300 transition-colors"
                  data-testid="button-browse-templates-empty"
                >
                  <Palette size={16} />
                  Or browse Template Gallery
                </button>
              </div>
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

        <div className="p-4 bg-black/40 border-t border-white/5 backdrop-blur-md space-y-2">
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
          <button
            onClick={() => setShowTemplates(true)}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-indigo-400 transition-colors py-1.5 rounded-lg border border-dashed border-white/10 hover:border-indigo-500/30"
            data-testid="button-open-templates"
          >
            <Palette size={14} />
            Browse Template Gallery
          </button>
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

      {/* Template Gallery */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-md"
            onClick={() => setShowTemplates(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[#0a0a1a] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[85vh] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              data-testid="dialog-template-gallery"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/5">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Palette className="text-indigo-400" size={22} />
                    Template Gallery
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Pre-designed landing pages ready to customize</p>
                </div>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors"
                  data-testid="button-close-templates"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(85vh - 80px)" }}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {SITE_TEMPLATES.map((template) => {
                    const IconComp = template.icon;
                    return (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: 1.02, y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        className="group relative rounded-xl border border-white/10 overflow-hidden cursor-pointer bg-white/5 hover:border-indigo-500/40 transition-all duration-300"
                        onClick={() => handleLoadTemplate(template)}
                        data-testid={`template-card-${template.id}`}
                      >
                        <div
                          className="h-40 relative overflow-hidden"
                          style={{ backgroundColor: template.siteData.theme.bg }}
                        >
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
                              style={{ backgroundColor: template.color + "20", color: template.color }}
                            >
                              <IconComp size={20} />
                            </div>
                            <h3
                              className="text-sm font-bold"
                              style={{ color: template.siteData.theme.text, fontFamily: template.siteData.theme.font }}
                            >
                              {template.siteData.sections[0]?.props?.title}
                            </h3>
                            <p
                              className="text-[10px] mt-1 line-clamp-2 opacity-60"
                              style={{ color: template.siteData.theme.text }}
                            >
                              {template.siteData.sections[0]?.props?.subtitle}
                            </p>
                            <div
                              className="mt-2 px-3 py-1 rounded-full text-[10px] font-bold"
                              style={{ backgroundColor: template.color, color: template.siteData.theme.bg }}
                            >
                              {template.siteData.sections[0]?.props?.cta}
                            </div>
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                            <span className="text-xs font-medium text-white bg-indigo-600 px-3 py-1 rounded-full">
                              Use Template
                            </span>
                          </div>
                        </div>
                        <div className="p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: template.color }}
                            />
                            <h4 className="text-sm font-bold text-white">{template.name}</h4>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-400">
                              {template.industry}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-400">
                              {template.siteData.theme.font}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1.5 line-clamp-2">{template.description}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
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
