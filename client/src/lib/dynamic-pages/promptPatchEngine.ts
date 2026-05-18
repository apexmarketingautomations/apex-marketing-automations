import type { DynamicPageSchema, MotionIntensity, CTAAnimation } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeDeep<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && typeof sv === "object" && !Array.isArray(sv) &&
        tv !== null && typeof tv === "object" && !Array.isArray(tv)) {
      (result as any)[key] = mergeDeep(tv as any, sv as any);
    } else if (sv !== undefined) {
      (result as any)[key] = sv;
    }
  }
  return result;
}

/**
 * Interprets incremental edit prompts and returns a partial patch to merge.
 * This runs client-side for fast local patching without an API round-trip.
 */
export function interpretLocalPatch(prompt: string, current: DynamicPageSchema): Partial<DynamicPageSchema> {
  const p = prompt.toLowerCase();
  const patch: Partial<DynamicPageSchema> = {};

  // Motion / cinematics
  if (/more cinematic|cinematic|epic|dramatic/.test(p)) {
    patch.theme = mergeDeep(current.theme, { motion: "cinematic" as MotionIntensity });
    patch.scene = mergeDeep(current.scene, {
      camera: { ...current.scene.camera, intensity: Math.min(2, (current.scene.camera.intensity ?? 0.5) + 0.5) },
      postProcessing: { ...current.scene.postProcessing, bloom: true, bloomIntensity: 2.5, vignette: true },
      lighting: { ...current.scene.lighting, intensity: Math.min(3, (current.scene.lighting.intensity ?? 2) + 0.5) },
    });
  }

  if (/reduce motion|less motion|slower|slow down|minimal motion/.test(p)) {
    patch.theme = mergeDeep(current.theme, { motion: "subtle" as MotionIntensity });
    patch.scene = mergeDeep(current.scene, {
      camera: { ...current.scene.camera, intensity: 0.2 },
      particles: { ...current.scene.particles, speed: 0.3 },
    });
  }

  if (/no motion|static|freeze/.test(p)) {
    patch.theme = mergeDeep(current.theme, { motion: "none" as MotionIntensity });
    patch.scene = mergeDeep(current.scene, {
      camera: { ...current.scene.camera, mode: "static" },
      particles: { ...current.scene.particles, speed: 0 },
    });
  }

  // Darkness / lightness
  if (/darker|more dark|pitch black/.test(p)) {
    patch.theme = mergeDeep(current.theme, {
      colors: { ...current.theme.colors, background: "#000000", surface: "#050505" },
    });
    patch.scene = mergeDeep(current.scene, {
      lighting: { ...current.scene.lighting, ambientIntensity: 0.1 },
    });
  }

  if (/lighter|brighter|more light/.test(p)) {
    patch.scene = mergeDeep(current.scene, {
      lighting: { ...current.scene.lighting, ambientIntensity: 0.8, intensity: 1.5 },
    });
  }

  // CTA mutations
  if (/glow.*cta|cta.*glow|make.*cta.*glow/.test(p)) {
    patch.cta = { ...current.cta, animation: "glow" as CTAAnimation };
  }

  if (/pulse.*cta|cta.*pulse/.test(p)) {
    patch.cta = { ...current.cta, animation: "pulse" as CTAAnimation };
  }

  // Particles
  if (/more particles|dense particles|heavy particles/.test(p)) {
    patch.scene = mergeDeep(current.scene, {
      particles: { ...current.scene.particles, density: "high", count: 1500 },
    });
  }

  if (/fewer particles|less particles|minimal particles/.test(p)) {
    patch.scene = mergeDeep(current.scene, {
      particles: { ...current.scene.particles, density: "low", count: 200 },
    });
  }

  // Object additions (basic — full AI patch goes to server)
  const addMatch = p.match(/add (?:a |an )?(.+?)(?:\s*$|,)/);
  if (addMatch) {
    const label = addMatch[1].trim();
    const newObj = {
      id: `obj-${Date.now()}`,
      label,
      type: "orb" as const,
      style: "cinematic_3d",
      props: [],
      position: [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, -2] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      animation: "slow_float" as const,
      color: current.theme.colors.primary,
      material: "distort" as const,
      distort: 0.4,
      opacity: 0.85,
    };
    patch.scene = {
      ...current.scene,
      objects: [...(current.scene.objects ?? []), newObj],
    };
  }

  // Color themes
  if (/pink|rose gold|feminine/.test(p)) {
    patch.theme = mergeDeep(current.theme, {
      colors: { ...current.theme.colors, primary: "#ec4899", secondary: "#f472b6", accent: "#fb7185" },
    });
  }

  if (/gold|luxury|premium/.test(p)) {
    patch.theme = mergeDeep(current.theme, {
      colors: { ...current.theme.colors, primary: "#d97706", secondary: "#fbbf24", accent: "#92400e" },
    });
  }

  if (/neon|cyberpunk|electric/.test(p)) {
    patch.theme = mergeDeep(current.theme, {
      colors: { ...current.theme.colors, primary: "#00ff88", secondary: "#ff0080", accent: "#00ffff" },
      style: "cyberpunk",
    });
  }

  if (/blue|ocean|cool/.test(p) && !p.includes("pink") && !p.includes("red")) {
    patch.theme = mergeDeep(current.theme, {
      colors: { ...current.theme.colors, primary: "#3b82f6", secondary: "#06b6d4", accent: "#60a5fa" },
    });
  }

  // Mobile friendly
  if (/mobile.friendly|mobile.first|responsive/.test(p)) {
    patch.scene = mergeDeep(current.scene, {
      particles: { ...current.scene.particles, density: "low", count: 300 },
      postProcessing: { ...current.scene.postProcessing, chromaticAberration: false },
    });
  }

  return patch;
}

/** Apply a partial patch onto an existing schema */
export function applyPatch(existing: DynamicPageSchema, patch: Partial<DynamicPageSchema>): DynamicPageSchema {
  return mergeDeep(existing, patch);
}

/** Apply a local-interpreted incremental edit from a short prompt */
export function applyLocalPromptPatch(existing: DynamicPageSchema, prompt: string): DynamicPageSchema {
  const patch = interpretLocalPatch(prompt, existing);
  return applyPatch(existing, patch);
}
