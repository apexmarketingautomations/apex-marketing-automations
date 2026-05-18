/**
 * client/src/lib/dynamic-pages/schema.ts
 *
 * Full type definitions for the Apex Dynamic Pages prompt-driven schema.
 * This schema drives the WebGL scene, page copy, sections, CTAs, and metadata.
 * Both frontend renderer and backend AI generation import from here (via shared path).
 */

export type ThemeStyle =
  | "glassmorphism"
  | "neon"
  | "minimal"
  | "corporate"
  | "luxury"
  | "dark"
  | "vibrant"
  | "nature"
  | "tech"
  | "cyberpunk"
  | "warm"
  | "medical"
  | "legal"
  | "energetic";

export type MotionIntensity = "none" | "subtle" | "medium" | "fast" | "cinematic";

export type EnvironmentType =
  | "outer_space"
  | "underwater"
  | "city"
  | "forest"
  | "abstract"
  | "luxury"
  | "medical"
  | "tech"
  | "storm"
  | "sunset"
  | "neon_city"
  | "minimal"
  | "nature"
  | "industrial"
  | "beach"
  | "mountain"
  | "laboratory"
  | "courtroom"
  | "gym";

export type AnimationType =
  | "slow_float"
  | "orbit"
  | "spin"
  | "idle"
  | "bob"
  | "pulse"
  | "drift"
  | "wave";

export type MaterialType = "distort" | "wobble" | "standard" | "glass" | "metallic" | "emissive";

export type PrimitiveType = "orb" | "torus" | "box" | "cone" | "cylinder" | "ring" | "future_mesh_slot";

/** How the object was authored — drives renderer behavior and future tooling. */
export type SceneObjectCategory = "primitive" | "semantic_object" | "custom_model";

export type GenerationMode = "apex-fast" | "stitch-style" | "stitch-import";

export type DesignSource = "apex-generator" | "stitch-import" | "stitch-inspired";

export interface SceneObject {
  id: string;
  /** Semantic label — what the user asked for (e.g. "spinning straight razor") */
  label: string;
  /** How this object was authored:
   *  - "primitive": generic Three.js shape, no semantic meaning
   *  - "semantic_object": user-described object, rendered via fallbackPrimitive until a GLB model is available
   *  - "custom_model": GLB/GLTF model path (future)
   */
  objectCategory?: SceneObjectCategory;
  /** Actual Three.js primitive to render. For semantic_object this is the fallback until models are available. */
  type: PrimitiveType;
  /** Normalized semantic type for future 3D model lookup, e.g. "straight_razor" */
  semanticType?: string;
  /** Human-readable description of what this object should look like — stored for future generative model pipeline */
  objectPrompt?: string;
  /** The primitive to render until a real 3D model is available */
  fallbackPrimitive?: PrimitiveType;
  style: string;
  /** Props the user requested — stored for future GLB mesh generation */
  props: string[];
  position: [number, number, number];
  scale: [number, number, number];
  animation: AnimationType;
  color: string;
  emissive?: string;
  material: MaterialType;
  distort?: number;
  wobbleFactor?: number;
  opacity?: number;
}

// ── Stitch import interfaces ──────────────────────────────────────────────────
// Placeholders for future Stitch output ingestion.

export interface StitchHandoffMetadata {
  stitchProjectId?: string;
  stitchExportedAt?: string;
  figmaFileUrl?: string;
  screenshotUrl?: string;
  generatedByModel?: string;
}

export interface StitchImportPayload {
  /** Raw HTML/CSS pasted from a Stitch export */
  htmlCss?: string;
  /** Structured design JSON if Stitch ever exposes an export API */
  designJson?: unknown;
  /** Handoff metadata from Figma or Stitch */
  handoff?: StitchHandoffMetadata;
  /** Reference screenshot for image-based generation */
  screenshotUrl?: string;
}

export interface ParticleConfig {
  type: "stars" | "rain" | "snow" | "dust" | "sparks" | "bubbles" | "leaves" | "custom";
  density: "low" | "medium" | "high";
  speed: number; // 0.1–3.0
  color: string;
  count?: number;
  size?: number;
}

export interface LightingConfig {
  type: "neon_rim" | "warm_studio" | "cool_ambient" | "dramatic" | "sunset" | "medical" | "neutral";
  colors: string[];
  intensity: number; // 0.5–3.0
  ambientIntensity: number;
}

export interface CameraConfig {
  mode: "slow_orbit" | "fixed" | "gentle_sway" | "cinematic_pan" | "static";
  intensity: number; // autoRotateSpeed 0.1–2.0
  fov?: number;
  position?: [number, number, number];
}

export interface PostProcessingConfig {
  bloom: boolean;
  bloomIntensity?: number;
  chromaticAberration: boolean;
  vignette: boolean;
  vignetteIntensity?: number;
}

export interface WebGLSceneSchema {
  sceneType: "procedural" | "custom_prompt_scene" | "fallback_static";
  /** Original user prompt for this scene */
  prompt: string;
  environment: EnvironmentType;
  objects: SceneObject[];
  particles: ParticleConfig;
  lighting: LightingConfig;
  camera: CameraConfig;
  postProcessing: PostProcessingConfig;
  /** AI-generated background image URL (optional fallback layer) */
  fallbackImage?: string;
}

export type SectionType =
  | "hero"
  | "features"
  | "testimonials"
  | "faq"
  | "cta_banner"
  | "services"
  | "team"
  | "gallery"
  | "pricing"
  | "contact"
  | "stats"
  | "process";

export interface SectionSchema {
  id: string;
  type: SectionType;
  title: string;
  subtitle?: string;
  body?: string;
  items?: Array<{ title: string; body: string; icon?: string }>;
  visible: boolean;
  order: number;
}

export type CTAAnimation = "none" | "pulse" | "glow" | "bounce" | "shimmer";

export interface CTAConfig {
  primaryText: string;
  primaryUrl: string;
  secondaryText?: string;
  secondaryUrl?: string;
  animation: CTAAnimation;
  color?: string;
}

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "phone" | "textarea" | "select";
  required: boolean;
  options?: string[];
}

export interface FormConfig {
  id: string;
  title: string;
  submitText: string;
  fields: FormField[];
  webhookUrl?: string;
  crmTag?: string;
}

export interface AnalyticsMetadata {
  pageType: string;
  niche: string;
  funnelStage: "awareness" | "consideration" | "conversion";
  trackingEvents: string[];
}

export interface CRMMetadata {
  leadSource: string;
  automationTag: string;
  assignedWorkflow?: string;
  notificationEmail?: string;
}

export interface PublishMetadata {
  published: boolean;
  publishedAt?: string;
  slug: string;
  customDomain?: string;
  canonicalUrl?: string;
  /** Tenant sub-account that owns this page */
  subAccountId?: number;
}

export interface PageCopy {
  headline: string;
  subheadline: string;
  body: string;
  seoTitle: string;
  seoDescription: string;
}

export interface DynamicPageSchema {
  version: "1.0";
  id: string;
  /**
   * AI-generated Tailwind HTML for the below-hero sections.
   * When present, DynamicPageRenderer renders this inside a sandboxed iframe
   * instead of the fixed schema-driven section components.
   * The WebGL 3D hero always renders above it unchanged.
   */
  generatedHtml?: string;
  /** How this schema was generated — drives debug panel display and future tooling. */
  designSource?: DesignSource;
  /** The generation mode used to produce this schema. */
  generationMode?: GenerationMode;
  /** Stitch import payload — populated only for stitch-import mode. */
  stitchImport?: StitchImportPayload;
  meta: {
    title: string;
    slug: string;
    niche: string;
    businessType: string;
    /** The original user prompt that generated this page */
    prompt: string;
    createdAt: string;
    updatedAt: string;
    subAccountId?: number;
  };
  theme: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      surface: string;
      text: string;
      textMuted: string;
    };
    style: ThemeStyle;
    motion: MotionIntensity;
    font: string;
  };
  copy: PageCopy;
  scene: WebGLSceneSchema;
  sections: SectionSchema[];
  cta: CTAConfig;
  forms: FormConfig[];
  analytics: AnalyticsMetadata;
  crm: CRMMetadata;
  publish: PublishMetadata;
}

// ── Default / blank schema ────────────────────────────────────────────────────

export function createBlankSchema(overrides: Partial<DynamicPageSchema> = {}): DynamicPageSchema {
  const now = new Date().toISOString();
  return {
    version: "1.0",
    id: crypto.randomUUID?.() ?? `page-${Date.now()}`,
    meta: {
      title: "New Page",
      slug: "new-page",
      niche: "general",
      businessType: "business",
      prompt: "",
      createdAt: now,
      updatedAt: now,
    },
    theme: {
      colors: {
        primary: "#6366f1",
        secondary: "#a855f7",
        accent: "#06b6d4",
        background: "#030712",
        surface: "#0f172a",
        text: "#f8fafc",
        textMuted: "#94a3b8",
      },
      style: "dark",
      motion: "medium",
      font: "Inter",
    },
    copy: {
      headline: "Your Business, Elevated",
      subheadline: "AI-powered solutions tailored to your needs",
      body: "We help businesses grow with cutting-edge technology and proven strategies.",
      seoTitle: "New Page | Apex",
      seoDescription: "AI-powered business solutions",
    },
    scene: {
      sceneType: "procedural",
      prompt: "",
      environment: "abstract",
      objects: [
        {
          id: "orb-1",
          label: "orb",
          type: "orb",
          style: "cinematic_3d",
          props: [],
          position: [-3.5, 1, -2],
          scale: [1, 1, 1],
          animation: "slow_float",
          color: "#6366f1",
          material: "distort",
          distort: 0.5,
          opacity: 0.85,
        },
        {
          id: "orb-2",
          label: "orb",
          type: "orb",
          style: "cinematic_3d",
          props: [],
          position: [3.5, -1, -1],
          scale: [1, 1, 1],
          animation: "slow_float",
          color: "#a855f7",
          material: "distort",
          distort: 0.3,
          opacity: 0.85,
        },
        {
          id: "torus-1",
          label: "torus",
          type: "torus",
          style: "metallic",
          props: [],
          position: [-2, -2, 0],
          scale: [1, 1, 1],
          animation: "slow_float",
          color: "#a855f7",
          material: "wobble",
          wobbleFactor: 0.4,
        },
      ],
      particles: {
        type: "stars",
        density: "medium",
        speed: 1,
        color: "#6366f1",
        count: 800,
        size: 0.04,
      },
      lighting: {
        type: "cool_ambient",
        colors: ["#6366f1", "#a855f7", "#818cf8"],
        intensity: 2,
        ambientIntensity: 0.3,
      },
      camera: {
        mode: "slow_orbit",
        intensity: 0.5,
        fov: 60,
      },
      postProcessing: {
        bloom: true,
        bloomIntensity: 1.5,
        chromaticAberration: true,
        vignette: true,
        vignetteIntensity: 0.8,
      },
    },
    sections: [
      {
        id: "hero",
        type: "hero",
        title: "Transform Your Business",
        subtitle: "AI-powered tools that work while you sleep",
        visible: true,
        order: 0,
      },
      {
        id: "features",
        type: "features",
        title: "What We Offer",
        items: [
          { title: "AI Automation", body: "Set it and forget it workflows" },
          { title: "Lead Capture", body: "Never miss a potential client" },
          { title: "Smart Follow-Up", body: "Personalized outreach at scale" },
        ],
        visible: true,
        order: 1,
      },
    ],
    cta: {
      primaryText: "Get Started Free",
      primaryUrl: "#contact",
      animation: "pulse",
    },
    forms: [],
    analytics: {
      pageType: "landing",
      niche: "general",
      funnelStage: "conversion",
      trackingEvents: ["page_view", "cta_click", "form_submit"],
    },
    crm: {
      leadSource: "dynamic-page",
      automationTag: "new-lead",
    },
    publish: {
      published: false,
      slug: "new-page",
    },
    ...overrides,
  };
}
