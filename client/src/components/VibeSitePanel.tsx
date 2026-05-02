import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Image as ImageIcon, Sparkles, Building, Users, Target, Phone, MapPin, Mic, ChevronDown, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VibeDesignData {
  businessName: string;
  niche: string;
  tagline: string;
  services: string;
  targetAudience: string;
  tone: string;
  callToAction: string;
  phone: string;
  location: string;
  uploadedImages: UploadedImage[];
  extraNotes: string;
}

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  label: string; // "logo", "hero", "team", "product", etc.
}

interface VibeSitePanelProps {
  onClose: () => void;
  onGenerate: (prompt: string, design: VibeDesignData) => void;
  selectedTheme: string;
  onThemeChange: (theme: string) => void;
  isGenerating: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const THEMES = [
  { id: "dark-luxury",  label: "Dark Luxury",   colors: ["#050404", "#c9a84c"], desc: "Gold & Black" },
  { id: "neon-cyber",   label: "Neon Cyber",     colors: ["#0a0a1a", "#00ff88"], desc: "Electric Green" },
  { id: "deep-purple",  label: "Deep Purple",    colors: ["#0d0014", "#a855f7"], desc: "Cosmic Violet" },
  { id: "ocean-dark",   label: "Ocean Dark",     colors: ["#020b18", "#0ea5e9"], desc: "Bioluminescent" },
  { id: "fire-red",     label: "Fire Red",       colors: ["#0a0000", "#ef4444"], desc: "Crimson Flame" },
  { id: "clean-white",  label: "Clean White",    colors: ["#ffffff", "#6366f1"], desc: "Minimal Light" },
];

const TONES = [
  { id: "luxury",       label: "Luxury",        emoji: "👑" },
  { id: "bold",         label: "Bold & Direct",  emoji: "⚡" },
  { id: "professional", label: "Professional",   emoji: "💼" },
  { id: "friendly",     label: "Friendly",       emoji: "😊" },
  { id: "aggressive",   label: "Aggressive",     emoji: "🔥" },
  { id: "minimal",      label: "Minimal",        emoji: "◻️" },
];

const NICHES = [
  "Personal Injury Law", "Criminal Defense", "Family Law", "Roofing & Construction",
  "Real Estate", "Medical / MedSpa", "Fitness & Gym", "Restaurant", "E-Commerce",
  "Digital Marketing Agency", "Auto Detailing", "Hair Salon / Barbershop",
  "Insurance", "Coaching / Consulting", "Dental", "Solar", "HVAC", "Other",
];

const IMAGE_LABELS = ["Logo", "Hero Background", "Team Photo", "Product", "Before/After", "Office/Location", "Other"];

// ── VibeSitePanel ─────────────────────────────────────────────────────────────

export function VibeSitePanel({ onClose, onGenerate, selectedTheme, onThemeChange, isGenerating }: VibeSitePanelProps) {
  const [design, setDesign] = useState<VibeDesignData>({
    businessName: "",
    niche: "",
    tagline: "",
    services: "",
    targetAudience: "",
    tone: "luxury",
    callToAction: "",
    phone: "",
    location: "",
    uploadedImages: [],
    extraNotes: "",
  });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (field: keyof VibeDesignData, value: any) =>
    setDesign(prev => ({ ...prev, [field]: value }));

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const newImgs: UploadedImage[] = Array.from(files)
      .filter(f => f.type.startsWith("image/"))
      .slice(0, 8 - design.uploadedImages.length)
      .map(file => ({
        id: Math.random().toString(36).slice(2),
        file,
        preview: URL.createObjectURL(file),
        label: "Hero Background",
      }));
    update("uploadedImages", [...design.uploadedImages, ...newImgs]);
  };

  const removeImage = (id: string) => {
    update("uploadedImages", design.uploadedImages.filter(img => img.id !== id));
  };

  const updateImageLabel = (id: string, label: string) => {
    update("uploadedImages", design.uploadedImages.map(img =>
      img.id === id ? { ...img, label } : img
    ));
  };

  const handleGenerate = async () => {
    // Build rich prompt from all design fields
    const parts = [
      design.businessName && `Business Name: ${design.businessName}`,
      design.niche && `Industry: ${design.niche}`,
      design.tagline && `Tagline: "${design.tagline}"`,
      design.services && `Services/Products: ${design.services}`,
      design.targetAudience && `Target Audience: ${design.targetAudience}`,
      design.callToAction && `Primary CTA: ${design.callToAction}`,
      design.phone && `Phone: ${design.phone}`,
      design.location && `Location: ${design.location}`,
      design.tone && `Brand Tone: ${design.tone}`,
      design.uploadedImages.length > 0 && `Uploaded images available: ${design.uploadedImages.map(i => i.label).join(", ")}`,
      design.extraNotes && `Additional notes: ${design.extraNotes}`,
    ].filter(Boolean).join("\n");

    // Convert images to base64 for upload
    const imageUploads: string[] = [];
    for (const img of design.uploadedImages) {
      try {
        const formData = new FormData();
        formData.append("files", img.file);
        const uploadRes = await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          const url = data?.files?.[0]?.url || data?.url;
          if (url) imageUploads.push(`${img.label}: ${url}`);
        }
      } catch (_e) { /* continue without image */ }
    }

    const fullPrompt = parts + (imageUploads.length > 0 ? `\n\nClient Images:\n${imageUploads.join("\n")}` : "");
    onGenerate(fullPrompt, design);
  };

  const canGenerate = design.businessName.trim().length > 0 && design.niche.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a0a]"
        style={{ scrollbarWidth: "thin" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0a0a0a]/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
              <Sparkles size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Vibe Site Generator</h2>
              <p className="text-slate-500 text-xs">Design your AI-powered site</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Theme Picker */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">Visual Theme</label>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map(theme => (
                <button
                  key={theme.id}
                  onClick={() => onThemeChange(theme.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    selectedTheme === theme.id
                      ? "border-white/30 bg-white/10 scale-105"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex gap-1">
                      <div className="w-3 h-3 rounded-full border border-white/20" style={{ background: theme.colors[0] }} />
                      <div className="w-3 h-3 rounded-full border border-white/20" style={{ background: theme.colors[1] }} />
                    </div>
                    {selectedTheme === theme.id && <span className="text-[8px] text-white font-black bg-white/20 px-1 rounded">✓</span>}
                  </div>
                  <p className="text-white text-[11px] font-bold">{theme.label}</p>
                  <p className="text-slate-600 text-[9px]">{theme.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Business Info */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">Business Information</label>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block flex items-center gap-1">
                    <Building size={9} /> Business Name *
                  </label>
                  <Input
                    value={design.businessName}
                    onChange={e => update("businessName", e.target.value)}
                    placeholder="Crash Connect Law"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Niche / Industry *</label>
                  <select
                    value={design.niche}
                    onChange={e => update("niche", e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="" className="bg-[#0a0a0a]">Select niche...</option>
                    {NICHES.map(n => (
                      <option key={n} value={n} className="bg-[#0a0a0a]">{n}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Tagline / Slogan</label>
                <Input
                  value={design.tagline}
                  onChange={e => update("tagline", e.target.value)}
                  placeholder="We Fight. You Win."
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block flex items-center gap-1">
                  <Target size={9} /> Services / Products
                </label>
                <textarea
                  value={design.services}
                  onChange={e => update("services", e.target.value)}
                  placeholder="Personal injury claims, car accident cases, slip & fall, workers comp..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-600 text-sm resize-none focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block flex items-center gap-1">
                    <Users size={9} /> Target Audience
                  </label>
                  <Input
                    value={design.targetAudience}
                    onChange={e => update("targetAudience", e.target.value)}
                    placeholder="Accident victims in Florida"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">Primary Call to Action</label>
                  <Input
                    value={design.callToAction}
                    onChange={e => update("callToAction", e.target.value)}
                    placeholder="Get a Free Consultation"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block flex items-center gap-1">
                    <Phone size={9} /> Phone Number
                  </label>
                  <Input
                    value={design.phone}
                    onChange={e => update("phone", e.target.value)}
                    placeholder="+1 (239) 555-0100"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block flex items-center gap-1">
                    <MapPin size={9} /> Location
                  </label>
                  <Input
                    value={design.location}
                    onChange={e => update("location", e.target.value)}
                    placeholder="Fort Myers, FL"
                    className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 text-sm h-9"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Brand Tone */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">Brand Tone</label>
            <div className="grid grid-cols-3 gap-2">
              {TONES.map(tone => (
                <button
                  key={tone.id}
                  onClick={() => update("tone", tone.id)}
                  className={`p-2.5 rounded-xl border text-center transition-all ${
                    design.tone === tone.id
                      ? "border-purple-500/50 bg-purple-500/15 text-white"
                      : "border-white/10 bg-white/[0.02] text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <div className="text-base mb-0.5">{tone.emoji}</div>
                  <div className="text-[10px] font-bold">{tone.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">
              Upload Your Images <span className="text-slate-600 font-normal normal-case">(optional — logo, hero, team, etc.)</span>
            </label>

            {/* Drop Zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                dragOver
                  ? "border-purple-500 bg-purple-500/10"
                  : "border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
              />
              <Upload size={24} className="text-slate-500 mx-auto mb-2" />
              <p className="text-slate-400 text-sm font-medium">Drop images here or click to upload</p>
              <p className="text-slate-600 text-xs mt-1">PNG, JPG, WebP — up to 8 images — 50MB each</p>
            </div>

            {/* Uploaded Images */}
            {design.uploadedImages.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {design.uploadedImages.map(img => (
                  <div key={img.id} className="relative rounded-xl overflow-hidden border border-white/10 bg-white/5">
                    <img
                      src={img.preview}
                      alt={img.label}
                      className="w-full h-24 object-cover"
                    />
                    <div className="p-2 flex items-center gap-2">
                      <select
                        value={img.label}
                        onChange={e => updateImageLabel(img.id, e.target.value)}
                        className="flex-1 text-[10px] bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-slate-300 focus:outline-none"
                      >
                        {IMAGE_LABELS.map(l => (
                          <option key={l} value={l} className="bg-[#0a0a0a]">{l}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeImage(img.id)}
                        className="text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {design.uploadedImages.length < 8 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="h-full min-h-[120px] rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-600 hover:text-slate-400 hover:border-white/20 transition-all"
                  >
                    <Plus size={20} />
                    <span className="text-xs">Add more</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Extra Notes */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Additional Notes</label>
            <textarea
              value={design.extraNotes}
              onChange={e => update("extraNotes", e.target.value)}
              placeholder="Any specific requirements, competitor references, must-have sections, color preferences, etc."
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-600 text-sm resize-none focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Generate Button */}
          <div className="pt-2">
            {!canGenerate && (
              <p className="text-amber-400/70 text-xs mb-3 flex items-center gap-1">
                ⚠ Fill in Business Name and Niche to generate
              </p>
            )}
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3 text-sm disabled:opacity-40"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">✨</span> Generating your vibe site...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles size={15} /> Generate Vibe Site
                </span>
              )}
            </Button>
            <p className="text-center text-slate-600 text-xs mt-2">
              Powered by Apex AI + Nano Banana image generation
            </p>
          </div>

        </div>
      </motion.div>
    </motion.div>
  );
}
