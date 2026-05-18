/**
 * client/src/lib/card-identity/schema.ts
 *
 * TypeScript types for the AI-generated Identity Visual DNA.
 * Drives the WebGL scene, typography, branding, and interaction style of a card.
 */

export type IdentityStyle =
  | "luxury_founder"
  | "cyberpunk_creative"
  | "warm_professional"
  | "playful_service"
  | "bold_authority"
  | "minimal_tech"
  | "cinematic_realtor"
  | "energetic_fitness"
  | "elegant_beauty"
  | "raw_industrial"
  | "nature_wellness"
  | "gold_finance";

export interface SceneObject {
  id: string;
  type: "orb" | "ring" | "cube" | "crystal" | "logo_float" | "particles_burst";
  position: [number, number, number];
  scale: number;
  color: string;
  material: "distort" | "glass" | "emissive" | "metallic" | "wobble";
  animation: "float" | "spin" | "pulse" | "orbit" | "breathe";
  opacity: number;
}

export interface ParticleConfig {
  enabled: boolean;
  count: number;
  color: string;
  size: number;
  speed: number;
  type: "float" | "rain" | "sparkle" | "swirl";
}

export interface LightingConfig {
  ambientIntensity: number;
  pointLights: Array<{
    position: [number, number, number];
    color: string;
    intensity: number;
  }>;
}

export interface PostProcessingConfig {
  bloom: boolean;
  bloomIntensity: number;
  vignette: boolean;
  chromaticAberration: boolean;
}

export interface IdentityVisualDNA {
  version: "1.0";
  prompt: string;
  identityStyle: IdentityStyle;
  motionProfile: "cinematic_slow" | "energetic" | "subtle" | "static" | "playful";
  lightingStyle: string;
  particleStyle: "floating_energy" | "none" | "rain" | "sparkle" | "confetti" | "starfield";
  interactionStyle: "premium_glass" | "magnetic" | "playful_bounce" | "minimal";
  ctaBehavior: "magnetic_glow" | "pulse" | "shimmer" | "bounce" | "none";
  cameraMotion: "slow_orbit" | "static" | "drift" | "lock";
  themeIntensity: number;
  mobileOptimization: boolean;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
  };
  scene: {
    environment: "space" | "luxury" | "neon_city" | "nature" | "abstract" | "minimal" | "club";
    objects: SceneObject[];
    particles: ParticleConfig;
    lighting: LightingConfig;
    postProcessing: PostProcessingConfig;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: number;
    letterSpacing: string;
  };
  branding: {
    tagline?: string;
    bioImprovement?: string;
    ctaPrimary: string;
    ctaSecondary?: string;
    authorityHook?: string;
  };
  niche: string;
  generatedAt: string;
}

export function createBlankDNA(): IdentityVisualDNA {
  return {
    version: "1.0",
    prompt: "",
    identityStyle: "luxury_founder",
    motionProfile: "cinematic_slow",
    lightingStyle: "blue_holographic",
    particleStyle: "floating_energy",
    interactionStyle: "premium_glass",
    ctaBehavior: "magnetic_glow",
    cameraMotion: "slow_orbit",
    themeIntensity: 0.7,
    mobileOptimization: true,
    colors: {
      primary: "#6366f1",
      secondary: "#a855f7",
      accent: "#06b6d4",
      background: "#030712",
      surface: "#0f1117",
      text: "#ffffff",
    },
    scene: {
      environment: "space",
      objects: [
        {
          id: "orb1",
          type: "orb",
          position: [-2, 0.5, -1],
          scale: 1,
          color: "#6366f1",
          material: "distort",
          animation: "float",
          opacity: 0.85,
        },
        {
          id: "orb2",
          type: "orb",
          position: [2, -0.5, -2],
          scale: 0.7,
          color: "#a855f7",
          material: "glass",
          animation: "pulse",
          opacity: 0.6,
        },
      ],
      particles: {
        enabled: true,
        count: 600,
        color: "#6366f1",
        size: 0.04,
        speed: 0.5,
        type: "float",
      },
      lighting: {
        ambientIntensity: 0.3,
        pointLights: [
          { position: [5, 5, 5], color: "#6366f1", intensity: 2 },
          { position: [-5, -5, -3], color: "#a855f7", intensity: 1.5 },
        ],
      },
      postProcessing: {
        bloom: true,
        bloomIntensity: 1.5,
        vignette: true,
        chromaticAberration: false,
      },
    },
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      headingWeight: 900,
      letterSpacing: "-0.02em",
    },
    branding: {
      ctaPrimary: "Get in Touch",
      ctaSecondary: "View Portfolio",
    },
    niche: "professional",
    generatedAt: new Date().toISOString(),
  };
}
