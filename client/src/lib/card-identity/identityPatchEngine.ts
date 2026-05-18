/**
 * client/src/lib/card-identity/identityPatchEngine.ts
 *
 * Client-side local patch engine for incremental DNA edits.
 * Handles common quick commands without a server round-trip.
 */

import type { IdentityVisualDNA } from "./schema";

function darkenHex(hex: string, amount = 0.15): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - amount)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.floor((num & 0xff) * (1 - amount)));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function lightenHex(hex: string, amount = 0.2): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.floor((num >> 16) + 255 * amount));
  const g = Math.min(255, Math.floor(((num >> 8) & 0xff) + 255 * amount));
  const b = Math.min(255, Math.floor((num & 0xff) + 255 * amount));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

/** Returns a patched DNA or null if the prompt didn't match a local rule */
export function localPatchDNA(dna: IdentityVisualDNA, prompt: string): IdentityVisualDNA | null {
  const p = prompt.toLowerCase().trim();

  // Cinematic
  if (p.includes("more cinematic") || p.includes("cinematic")) {
    return {
      ...dna,
      themeIntensity: Math.min(1, dna.themeIntensity + 0.15),
      motionProfile: "cinematic_slow",
      scene: {
        ...dna.scene,
        postProcessing: {
          ...dna.scene.postProcessing,
          bloom: true,
          bloomIntensity: Math.min(3, (dna.scene.postProcessing.bloomIntensity || 1.5) + 0.5),
          vignette: true,
        },
      },
    };
  }

  // Add glow
  if (p.includes("add glow") || p.includes("more glow") || p.includes("glow")) {
    return {
      ...dna,
      ctaBehavior: "magnetic_glow",
      scene: {
        ...dna.scene,
        postProcessing: {
          ...dna.scene.postProcessing,
          bloom: true,
          bloomIntensity: Math.min(3, (dna.scene.postProcessing.bloomIntensity || 1.5) + 0.8),
        },
      },
    };
  }

  // Reduce motion
  if (p.includes("reduce motion") || p.includes("less motion") || p.includes("calm")) {
    return {
      ...dna,
      motionProfile: "subtle",
      cameraMotion: "static",
      scene: {
        ...dna.scene,
        particles: { ...dna.scene.particles, count: Math.floor(dna.scene.particles.count * 0.4), speed: 0.2 },
        postProcessing: { ...dna.scene.postProcessing, chromaticAberration: false },
      },
    };
  }

  // Darker
  if (p.includes("darker") || p.includes("more dark")) {
    return {
      ...dna,
      colors: {
        ...dna.colors,
        background: darkenHex(dna.colors.background, 0.3),
        surface: darkenHex(dna.colors.surface, 0.3),
      },
    };
  }

  // More particles
  if (p.includes("more particles") || p.includes("add particles")) {
    return {
      ...dna,
      particleStyle: "floating_energy",
      scene: {
        ...dna.scene,
        particles: {
          ...dna.scene.particles,
          enabled: true,
          count: Math.min(1200, dna.scene.particles.count + 300),
        },
      },
    };
  }

  // Playful
  if (p.includes("playful") || p.includes("fun") || p.includes("bounce")) {
    return {
      ...dna,
      motionProfile: "playful",
      interactionStyle: "playful_bounce",
      ctaBehavior: "bounce",
      colors: {
        ...dna.colors,
        primary: lightenHex(dna.colors.primary, 0.1),
        accent: lightenHex(dna.colors.accent, 0.1),
      },
    };
  }

  // Minimal
  if (p.includes("minimal") || p.includes("clean") || p.includes("simple")) {
    return {
      ...dna,
      motionProfile: "subtle",
      particleStyle: "none",
      interactionStyle: "minimal",
      ctaBehavior: "none",
      scene: {
        ...dna.scene,
        particles: { ...dna.scene.particles, enabled: false, count: 0 },
        postProcessing: {
          bloom: false,
          bloomIntensity: 0,
          vignette: false,
          chromaticAberration: false,
        },
        objects: dna.scene.objects.slice(0, 1),
      },
    };
  }

  // More luxury
  if (p.includes("more luxury") || p.includes("luxury")) {
    return {
      ...dna,
      identityStyle: "luxury_founder",
      lightingStyle: "gold_luxury",
      themeIntensity: Math.min(1, dna.themeIntensity + 0.1),
      colors: {
        ...dna.colors,
        primary: "#d4af37",
        secondary: "#b8860b",
        accent: "#ffd700",
      },
    };
  }

  return null; // No local rule matched — caller should try server
}
