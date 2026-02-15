import { useState } from "react";
import { Palette } from "lucide-react";

const VIBES = [
  {
    id: "cyber",
    name: "Cyber Default",
    colors: { bg: "#030014", glow: "#6366f1", accent: "#818cf8", glass: "0.08" },
    font: "'Inter', sans-serif",
  },
  {
    id: "neon-nights",
    name: "Neon Nights",
    colors: { bg: "#050505", glow: "#00f3ff", accent: "#00f3ff", glass: "0.15" },
    font: "'Orbitron', sans-serif",
  },
  {
    id: "gilded-rose",
    name: "Gilded Rose",
    colors: { bg: "#0a0505", glow: "#ff007a", accent: "#ff5ea0", glass: "0.12" },
    font: "'Playfair Display', serif",
  },
  {
    id: "emerald-dark",
    name: "Emerald Dark",
    colors: { bg: "#020d0a", glow: "#10b981", accent: "#34d399", glass: "0.1" },
    font: "'DM Sans', sans-serif",
  },
  {
    id: "solar-gold",
    name: "Solar Gold",
    colors: { bg: "#0a0800", glow: "#f59e0b", accent: "#fbbf24", glass: "0.1" },
    font: "'Space Grotesk', sans-serif",
  },
  {
    id: "blood-moon",
    name: "Blood Moon",
    colors: { bg: "#0a0204", glow: "#ef4444", accent: "#f87171", glass: "0.12" },
    font: "'Montserrat', sans-serif",
  },
];

export function applyVibe(vibeId: string) {
  const vibe = VIBES.find((v) => v.id === vibeId) || VIBES[0];
  const root = document.documentElement;
  root.style.setProperty("--vibe-bg", vibe.colors.bg);
  root.style.setProperty("--vibe-glow", vibe.colors.glow);
  root.style.setProperty("--vibe-accent", vibe.colors.accent);
  root.style.setProperty("--vibe-glass", vibe.colors.glass);
  root.style.setProperty("--vibe-font", vibe.font);
  localStorage.setItem("apex-vibe", vibeId);
}

export function initVibe() {
  const saved = localStorage.getItem("apex-vibe");
  if (saved) applyVibe(saved);
}

export function VibeSwitcher() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(localStorage.getItem("apex-vibe") || "cyber");

  const handleSelect = (id: string) => {
    setCurrent(id);
    applyVibe(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-slate-400 hover:text-white text-sm"
        data-testid="button-vibe-switcher"
      >
        <Palette size={14} />
        <span className="hidden md:inline flex-1 text-left text-xs">Vibe</span>
        <span
          className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/20"
          style={{ backgroundColor: VIBES.find((v) => v.id === current)?.colors.glow }}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-52 bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 p-2 space-y-1">
            <div className="px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Select Vibe</div>
            {VIBES.map((vibe) => (
              <button
                key={vibe.id}
                onClick={() => handleSelect(vibe.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                  current === vibe.id
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
                data-testid={`button-vibe-${vibe.id}`}
              >
                <span
                  className="w-4 h-4 rounded-full shrink-0 ring-2"
                  style={{
                    backgroundColor: vibe.colors.glow,
                    boxShadow: current === vibe.id ? `0 0 12px ${vibe.colors.glow}50, 0 0 0 2px ${vibe.colors.glow}` : "none",
                  }}
                />
                <span className="text-xs font-medium">{vibe.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
