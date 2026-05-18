/**
 * server/services/visualPromptParser.ts
 *
 * Keyword-based parser that extracts structured intent from a natural language prompt.
 * Runs synchronously — no AI call needed, saves tokens for schema generation.
 */

export interface ParsedPromptIntent {
  niche: string;
  businessType: string;
  style: string;
  environment: string;
  objects: string[];
  colors: string[];
  motion: string;
  lighting: string;
  ctaIntent: string;
  funnelGoal: string;
  /** True if prompt is an incremental edit ("make it more X", "add X") */
  isPatch: boolean;
  /** Which schema sections the patch targets */
  patchTargets: Array<"lighting" | "motion" | "colors" | "objects" | "copy" | "cta" | "theme" | "particles">;
}

// ── Keyword maps ──────────────────────────────────────────────────────────────

const NICHE_MAP: Array<[RegExp, string, string]> = [
  [/med.?spa|medspa|botox|filler|facial|aesthetics/i, "medical_spa", "medical_spa"],
  [/personal.?injury|pi.?attorney|car.?accident|crash.?law/i, "legal", "personal_injury_law"],
  [/criminal.?defense|criminal.?law/i, "legal", "criminal_defense"],
  [/family.?law|divorce.?attorney/i, "legal", "family_law"],
  [/immigration.?law/i, "legal", "immigration_law"],
  [/workers.?comp/i, "legal", "workers_comp"],
  [/roofing|roof.?repair|storm.?damage/i, "home_services", "roofing"],
  [/plumbing|pipe/i, "home_services", "plumbing"],
  [/hvac|ac.?repair|air.?condition/i, "home_services", "hvac"],
  [/solar|solar.?panel/i, "home_services", "solar"],
  [/landscaping|lawn/i, "home_services", "landscaping"],
  [/cleaning.?service|maid.?service|house.?cleaning/i, "home_services", "cleaning"],
  [/dental|dentist|orthodonti/i, "health", "dental"],
  [/chiroprac/i, "health", "chiropractic"],
  [/physical.?therapy|physiotherapy/i, "health", "physical_therapy"],
  [/mental.?health|therapy|counseling|therapist/i, "health", "mental_health"],
  [/weight.?loss|gym|fitness|workout/i, "fitness", "fitness"],
  [/real.?estate|property|home.?buy|home.?sell/i, "real_estate", "real_estate"],
  [/restaurant|food|dining|cafe|bistro/i, "food", "restaurant"],
  [/pet|dog|cat|veterinary|grooming/i, "pet_services", "pet_services"],
  [/ecommerce|e.?commerce|shop|store|retail/i, "ecommerce", "ecommerce"],
  [/saas|software|app|tech.?startup/i, "tech", "saas"],
  [/accounting|cpa|bookkeeping|tax/i, "finance", "accounting"],
  [/insurance/i, "finance", "insurance"],
  [/beauty|salon|hair|nail/i, "beauty", "beauty_salon"],
  [/photography|photographer/i, "creative", "photography"],
  [/consulting|consultant/i, "professional_services", "consulting"],
  [/giraffe|animal|wildlife|zoo/i, "entertainment", "entertainment"],
  [/space|astronaut|galaxy|universe/i, "entertainment", "entertainment"],
];

const ENVIRONMENT_MAP: Array<[RegExp, string]> = [
  [/outer.?space|space|stars|galaxy|universe|astronaut/i, "outer_space"],
  [/underwater|ocean|sea|aquatic|marine/i, "underwater"],
  [/cyberpunk|neon.?city|night.?city|blade.?runner/i, "neon_city"],
  [/city|urban|downtown|skyline/i, "city"],
  [/forest|nature|woods|jungle|trees/i, "forest"],
  [/beach|ocean|tropical|coastal/i, "beach"],
  [/mountain|alpine|peak|snow/i, "mountain"],
  [/lab|laboratory|scientific|sterile/i, "laboratory"],
  [/court|legal|courthouse|courtroom/i, "courtroom"],
  [/sunset|sunrise|golden.?hour/i, "sunset"],
  [/storm|rain|thunder|lightning/i, "storm"],
  [/gym|athletic|fitness.?center/i, "gym"],
  [/luxury|high.?end|premium|elegant/i, "luxury"],
  [/medical|hospital|clinic|sterile|health/i, "medical"],
  [/tech|futuristic|digital|cyber/i, "tech"],
  [/minimal|clean|simple|white/i, "minimal"],
  [/industrial|warehouse|concrete/i, "industrial"],
];

const STYLE_MAP: Array<[RegExp, string]> = [
  [/glass|glassmorphism|frosted/i, "glassmorphism"],
  [/neon|electric|glow/i, "neon"],
  [/cyberpunk|punk|dystopia/i, "cyberpunk"],
  [/luxury|premium|opulent|gold/i, "luxury"],
  [/minimal|clean|simple|whitespace/i, "minimal"],
  [/dark|noir|moody/i, "dark"],
  [/vibrant|colorful|bold|bright/i, "vibrant"],
  [/nature|organic|green|earthy/i, "nature"],
  [/tech|futuristic|digital|holographic/i, "tech"],
  [/warm|cozy|welcoming|friendly/i, "warm"],
  [/medical|clinical|professional|sterile/i, "medical"],
  [/legal|corporate|authoritative|serious/i, "legal"],
];

const MOTION_MAP: Array<[RegExp, string]> = [
  [/cinematic|epic|slow.?motion|dramatic/i, "cinematic"],
  [/fast|energetic|dynamic|quick/i, "fast"],
  [/slow|subtle|gentle|calm|zen/i, "subtle"],
  [/no.?motion|static|still|freeze/i, "none"],
];

const COLOR_MAP: Array<[RegExp, string]> = [
  [/pink|rose.?gold|magenta/i, "#ec4899"],
  [/gold|golden|yellow/i, "#f59e0b"],
  [/purple|violet|lavender/i, "#8b5cf6"],
  [/blue|cobalt|navy|sky/i, "#3b82f6"],
  [/green|emerald|jade|forest/i, "#10b981"],
  [/red|crimson|ruby/i, "#ef4444"],
  [/orange|amber|copper/i, "#f97316"],
  [/white|clean|minimal|crisp/i, "#f8fafc"],
  [/black|dark|noir/i, "#0a0a0a"],
  [/teal|cyan|aqua/i, "#06b6d4"],
  [/neon.?green|electric.?green/i, "#00ff88"],
  [/neon.?pink|hot.?pink/i, "#ff0080"],
];

// Nouns that could be objects in a scene
const KNOWN_OBJECTS = [
  "giraffe", "elephant", "lion", "dog", "cat", "bird", "fish", "shark",
  "robot", "astronaut", "unicorn", "dragon", "car", "plane", "rocket",
  "flower", "tree", "mountain", "wave", "lightning", "crystal",
  "stethoscope", "gavel", "scale", "hammer", "wrench", "briefcase",
  "diamond", "crown", "star", "moon", "sun", "cloud",
];

const PATCH_KEYWORDS: Array<[RegExp, ParsedPromptIntent["patchTargets"][0][]]> = [
  [/more cinematic|darker|slower|cinematic|faster|motion/i, ["lighting", "motion"]],
  [/reduce.?motion|less.?motion|no.?motion/i, ["motion", "particles"]],
  [/glow.*cta|cta.*glow|button.*glow/i, ["cta"]],
  [/change.*color|different.*color|more.*color/i, ["colors", "theme"]],
  [/more.*premium|luxury|elegant/i, ["colors", "theme", "lighting"]],
  [/mobile.?friendly|responsive/i, ["particles", "motion"]],
  [/add .+/i, ["objects"]],
  [/more.*futuristic|cyberpunk|neon/i, ["colors", "theme", "lighting"]],
];

// ── Parser ────────────────────────────────────────────────────────────────────

export function parsePromptIntent(prompt: string): ParsedPromptIntent {
  const p = prompt;

  // Niche + business type
  let niche = "general";
  let businessType = "business";
  for (const [re, n, b] of NICHE_MAP) {
    if (re.test(p)) { niche = n; businessType = b; break; }
  }

  // Environment
  let environment = "abstract";
  for (const [re, env] of ENVIRONMENT_MAP) {
    if (re.test(p)) { environment = env; break; }
  }

  // Style
  let style = "dark";
  for (const [re, s] of STYLE_MAP) {
    if (re.test(p)) { style = s; break; }
  }

  // Motion
  let motion = "medium";
  for (const [re, m] of MOTION_MAP) {
    if (re.test(p)) { motion = m; break; }
  }

  // Colors — collect all matches
  const colors: string[] = [];
  for (const [re, color] of COLOR_MAP) {
    if (re.test(p)) colors.push(color);
  }

  // Objects — extract nouns from prompt
  const objects: string[] = [];
  for (const obj of KNOWN_OBJECTS) {
    if (new RegExp(`\\b${obj}s?\\b`, "i").test(p)) objects.push(obj);
  }
  // Also try "add a/an <noun>" pattern
  const addMatch = p.match(/add (?:a |an )?([a-z]+)/i);
  if (addMatch && !objects.includes(addMatch[1].toLowerCase())) {
    objects.push(addMatch[1].toLowerCase());
  }

  // Lighting
  let lighting = "cool_ambient";
  if (/warm|cozy|sunset|golden/i.test(p)) lighting = "warm_studio";
  else if (/neon|electric|rim|glow/i.test(p)) lighting = "neon_rim";
  else if (/dramatic|noir|dark/i.test(p)) lighting = "dramatic";
  else if (/medical|sterile|clean/i.test(p)) lighting = "medical";
  else if (/neutral|natural|soft/i.test(p)) lighting = "neutral";

  // CTA intent
  let ctaIntent = "contact";
  if (/book|appointment|schedul/i.test(p)) ctaIntent = "booking";
  else if (/buy|purchase|shop/i.test(p)) ctaIntent = "purchase";
  else if (/free.?quote|estimate|quote/i.test(p)) ctaIntent = "quote";
  else if (/consult|talk|call/i.test(p)) ctaIntent = "consultation";
  else if (/learn.?more|discover/i.test(p)) ctaIntent = "learn";

  // Funnel goal
  let funnelGoal = "lead_capture";
  if (/sale|purchase|buy/i.test(p)) funnelGoal = "sale";
  else if (/awareness|brand/i.test(p)) funnelGoal = "awareness";
  else if (/appointment|book/i.test(p)) funnelGoal = "appointment";

  // Patch detection
  const patchPhrases = /^(make (it|this)|add |change |reduce |less |more |turn |update |adjust |remove )/i;
  const isPatch = patchPhrases.test(p.trim());

  const patchTargets: ParsedPromptIntent["patchTargets"] = [];
  if (isPatch) {
    for (const [re, targets] of PATCH_KEYWORDS) {
      if (re.test(p)) {
        for (const t of targets) {
          if (!patchTargets.includes(t)) patchTargets.push(t);
        }
      }
    }
    if (patchTargets.length === 0) patchTargets.push("theme");
  }

  return {
    niche, businessType, style, environment,
    objects, colors, motion, lighting,
    ctaIntent, funnelGoal, isPatch, patchTargets,
  };
}
