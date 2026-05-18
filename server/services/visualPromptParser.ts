/**
 * server/services/visualPromptParser.ts
 *
 * Keyword-based parser that extracts structured intent from a natural language prompt.
 * Runs synchronously — no AI call needed, saves tokens for schema generation.
 *
 * v2 changes:
 * - Added 30+ new niches including barbershop, grooming, tattoo, food-truck, etc.
 * - Expanded KNOWN_OBJECTS with grooming, medical, legal, food, and trade items.
 * - Added fallback semantic extraction for objects NOT in KNOWN_OBJECTS.
 * - Extracted per-niche CTA text, form fields, and CRM tags.
 */

export interface ParsedPromptIntent {
  niche: string;
  businessType: string;
  businessLabel: string;    // human-readable, e.g. "Barber Shop"
  style: string;
  environment: string;
  objects: string[];         // objects user explicitly requested
  semanticObjects: SemanticObjectHint[];  // richer object hints for scene builder
  colors: string[];
  motion: string;
  lighting: string;
  ctaIntent: string;
  ctaText: string;           // niche-specific CTA text
  formFields: string[];      // niche-appropriate form fields
  crmTag: string;            // niche-specific CRM tag
  targetAudience: string;    // inferred audience
  funnelGoal: string;
  /** True if prompt is an incremental edit ("make it more X", "add X") */
  isPatch: boolean;
  /** Which schema sections the patch targets */
  patchTargets: Array<"lighting" | "motion" | "colors" | "objects" | "copy" | "cta" | "theme" | "particles">;
}

export interface SemanticObjectHint {
  label: string;             // what the user said, e.g. "spinning razor"
  semanticType: string;      // normalized, e.g. "straight_razor"
  animation: string;         // "spin", "slow_float", "orbit"
  material: string;          // "metallic", "glass", "emissive"
  color: string;             // hex color
  fallbackPrimitive: string; // Three.js primitive to use until real model exists
  scale?: [number, number, number];
}

// ── Niche map ─────────────────────────────────────────────────────────────────
// [regex, niche, businessType, businessLabel]
const NICHE_MAP: Array<[RegExp, string, string, string]> = [
  // ── Beauty & Grooming (must come before generic "beauty") ────────────────
  [/barber|barbershop|barber.?shop|men.?s.?hair|fresh.?cut|fade|taper|straight.?razor.?cut|shave/i, "beauty", "barbershop", "Barber Shop"],
  [/tattoo|ink.?studio|tattoo.?artist|body.?art/i, "beauty", "tattoo_studio", "Tattoo Studio"],
  [/nail.?salon|nail.?bar|manicure|pedicure|gel.?nails/i, "beauty", "nail_salon", "Nail Salon"],
  [/lash|brow.?studio|eyelash|microblading/i, "beauty", "lash_studio", "Lash & Brow Studio"],
  [/spray.?tan|tanning.?salon/i, "beauty", "tanning_salon", "Spray Tan Studio"],
  [/makeup.?artist|mua\b|bridal.?makeup/i, "beauty", "makeup_artist", "Makeup Artist"],
  [/salon|hair.?salon|hair.?stylist|blowout|balayage|highlights/i, "beauty", "hair_salon", "Hair Salon"],
  // ── Health & Medical ─────────────────────────────────────────────────────
  [/med.?spa|medspa|botox|filler|facial|aesthetics|hydrafacial|microneedling/i, "health", "med_spa", "Med Spa"],
  [/dental|dentist|orthodonti|tooth|teeth.?whitening/i, "health", "dental", "Dental Practice"],
  [/chiroprac/i, "health", "chiropractic", "Chiropractic Clinic"],
  [/physical.?therapy|physiotherapy|pt.?clinic/i, "health", "physical_therapy", "Physical Therapy"],
  [/mental.?health|therapy|counseling|therapist|psychiatr/i, "health", "mental_health", "Mental Health Practice"],
  [/plastic.?surgery|cosmetic.?surgery|breast|rhinoplasty/i, "health", "plastic_surgery", "Cosmetic Surgery"],
  [/fertility|ivf\b|egg.?freezing/i, "health", "fertility_clinic", "Fertility Clinic"],
  [/urgent.?care|walk.?in.?clinic|immediate.?care/i, "health", "urgent_care", "Urgent Care"],
  [/pharmacy|drugstore|prescription/i, "health", "pharmacy", "Pharmacy"],
  [/acupuncture|tcm\b|traditional.?chinese/i, "health", "acupuncture", "Acupuncture"],
  [/addiction.?recovery|rehab|substance.?abuse/i, "health", "addiction_recovery", "Addiction Recovery"],
  [/weight.?loss.?clinic|medical.?weight|bariatric/i, "health", "weight_loss", "Weight Loss Clinic"],
  // ── Legal ───────────────────────────────────────────────────────────────
  [/personal.?injury|pi.?attorney|car.?accident|crash.?law|auto.?accident/i, "legal", "personal_injury_law", "Personal Injury Law Firm"],
  [/criminal.?defense|criminal.?law|dui.?attorney/i, "legal", "criminal_defense", "Criminal Defense Law Firm"],
  [/family.?law|divorce.?attorney|custody/i, "legal", "family_law", "Family Law Firm"],
  [/immigration.?law|visa.?attorney|deportation/i, "legal", "immigration_law", "Immigration Law Firm"],
  [/workers.?comp|workplace.?injury/i, "legal", "workers_comp", "Workers Comp Attorney"],
  [/bankruptcy.?attorney|chapter.?7|chapter.?13/i, "legal", "bankruptcy", "Bankruptcy Attorney"],
  [/estate.?planning|probate|will.?attorney|trust.?attorney/i, "legal", "estate_planning", "Estate Planning Attorney"],
  // ── Fitness ──────────────────────────────────────────────────────────────
  [/gym\b|fitness.?center|weight.?room|weight.?training|powerlifting/i, "fitness", "gym", "Gym & Fitness Center"],
  [/crossfit|wod\b|functional.?fitness/i, "fitness", "crossfit", "CrossFit Box"],
  [/yoga.?studio|yoga.?class|hot.?yoga|bikram/i, "fitness", "yoga_studio", "Yoga Studio"],
  [/personal.?train|1.?on.?1.?training|private.?trainer/i, "fitness", "personal_trainer", "Personal Trainer"],
  [/pilates|reformer.?pilates/i, "fitness", "pilates", "Pilates Studio"],
  [/martial.?arts|bjj\b|jiu.?jitsu|karate|mma.?gym|boxing.?gym/i, "fitness", "martial_arts", "Martial Arts"],
  [/swim.?school|swim.?lesson|swimming/i, "fitness", "swim_school", "Swim School"],
  [/weight.?loss|diet.?program|nutrition.?coach/i, "fitness", "weight_loss_fitness", "Weight Loss Program"],
  // ── Food & Hospitality ────────────────────────────────────────────────────
  [/restaurant|dining|bistro|eatery|tavern/i, "food", "restaurant", "Restaurant"],
  [/fine.?dining|upscale.?restaurant|michelin|tasting.?menu/i, "food", "fine_dining", "Fine Dining Restaurant"],
  [/cafe|coffee.?shop|coffeehouse|espresso.?bar/i, "food", "coffee_shop", "Coffee Shop"],
  [/bakery|pastry|patisserie|bread.?shop/i, "food", "bakery", "Bakery"],
  [/food.?truck|mobile.?kitchen|street.?food/i, "food", "food_truck", "Food Truck"],
  [/bar\b|nightclub|lounge|cocktail.?bar|speakeasy/i, "food", "bar_nightclub", "Bar & Nightclub"],
  [/catering|event.?catering|corporate.?catering/i, "food", "catering", "Catering Company"],
  [/meal.?prep|meal.?delivery|meal.?kit/i, "food", "meal_prep", "Meal Prep Service"],
  // ── Automotive ───────────────────────────────────────────────────────────
  [/auto.?detail|car.?detail|ceramic.?coat|paint.?correction/i, "automotive", "auto_detailing", "Auto Detailing"],
  [/auto.?repair|mechanic|car.?repair|oil.?change|tire/i, "automotive", "auto_repair", "Auto Repair Shop"],
  [/car.?dealership|auto.?dealer|car.?lot/i, "automotive", "auto_dealer", "Auto Dealership"],
  [/towing|roadside.?assistance|wrecker/i, "automotive", "towing", "Towing Service"],
  [/car.?wash|auto.?wash/i, "automotive", "car_wash", "Car Wash"],
  // ── Home Services ──────────────────────────────────────────────────────
  [/roofing|roof.?repair|storm.?damage.?roof|shingle/i, "home_services", "roofing", "Roofing Company"],
  [/plumbing|pipe.?repair|drain.?clean|water.?heater/i, "home_services", "plumbing", "Plumbing"],
  [/hvac|ac.?repair|air.?condition|furnace|heating.?cooling/i, "home_services", "hvac", "HVAC"],
  [/solar|solar.?panel|solar.?install/i, "home_services", "solar", "Solar Installation"],
  [/landscaping|lawn.?care|lawn.?service|yard.?work/i, "home_services", "landscaping", "Landscaping"],
  [/cleaning.?service|maid.?service|house.?cleaning|janitorial/i, "home_services", "cleaning", "Cleaning Service"],
  [/pest.?control|exterminator|bug.?control/i, "home_services", "pest_control", "Pest Control"],
  [/painting|house.?paint|exterior.?paint|interior.?paint/i, "home_services", "painting", "Painting Contractor"],
  [/general.?contractor|home.?remodel|renovation|home.?improvement/i, "home_services", "general_contractor", "General Contractor"],
  [/pool.?service|pool.?clean|pool.?repair/i, "home_services", "pool_service", "Pool Service"],
  [/security.?system|alarm.?system|home.?security/i, "home_services", "security", "Home Security"],
  // ── Real Estate ───────────────────────────────────────────────────────
  [/real.?estate|realtor|property.?list|home.?buy|home.?sell|home.?value/i, "real_estate", "real_estate", "Real Estate"],
  [/property.?management|landlord|rental.?management/i, "real_estate", "property_management", "Property Management"],
  [/mortgage|home.?loan|refinanc/i, "real_estate", "mortgage", "Mortgage Broker"],
  // ── Tech & SaaS ──────────────────────────────────────────────────────
  [/saas|software.?as|app\b|tech.?startup|platform\b/i, "tech", "saas", "SaaS Platform"],
  [/web.?design.?agency|web.?dev.?agency|digital.?agency/i, "tech", "web_agency", "Web Design Agency"],
  [/ai.?startup|machine.?learning|llm\b|artificial.?intelligence.?startup/i, "tech", "ai_startup", "AI Startup"],
  [/cybersecurity|infosec|penetration.?test/i, "tech", "cybersecurity", "Cybersecurity Firm"],
  // ── Professional Services ─────────────────────────────────────────────
  [/marketing.?agency|growth.?agency|digital.?marketing/i, "professional_services", "marketing_agency", "Marketing Agency"],
  [/seo.?agency|search.?engine/i, "professional_services", "seo_agency", "SEO Agency"],
  [/business.?coach|executive.?coach|leadership.?coach/i, "professional_services", "business_coach", "Business Coach"],
  [/life.?coach|mindset.?coach|motivational/i, "professional_services", "life_coach", "Life Coach"],
  [/insurance.?agency|insurance.?broker/i, "professional_services", "insurance_agency", "Insurance Agency"],
  [/accounting|cpa\b|bookkeeping|tax.?prep/i, "finance", "accounting", "Accounting Firm"],
  [/financial.?advisor|wealth.?management|investment.?advisor/i, "finance", "financial_advisor", "Financial Advisor"],
  // ── Education ─────────────────────────────────────────────────────────
  [/tutoring|tutor\b|test.?prep|sat.?prep|homework.?help/i, "education", "tutoring", "Tutoring Center"],
  [/online.?course|e.?learning|course.?platform|digital.?course/i, "education", "online_course", "Online Course Platform"],
  [/music.?school|music.?lesson|instrument.?lesson/i, "education", "music_school", "Music School"],
  [/dance.?studio|dance.?class|dance.?lesson/i, "education", "dance_studio", "Dance Studio"],
  // ── Pet Services ──────────────────────────────────────────────────────
  [/pet.?groom|dog.?groom|dog.?salon|cat.?groom/i, "pet_services", "pet_grooming", "Pet Grooming"],
  [/veterinary|vet.?clinic|animal.?hospital|pet.?hospital/i, "pet_services", "veterinary", "Veterinary Clinic"],
  [/dog.?training|dog.?trainer|puppy.?class/i, "pet_services", "dog_training", "Dog Training"],
  // ── Retail & E-Commerce ───────────────────────────────────────────────
  [/ecommerce|e.?commerce|online.?store|dropshipping/i, "ecommerce", "ecommerce", "E-Commerce Store"],
  [/boutique|clothing.?store|fashion.?store|apparel/i, "retail", "boutique", "Boutique Clothing"],
  [/jewelry.?store|jeweler|diamond.?ring/i, "retail", "jewelry_store", "Jewelry Store"],
  [/supplement|protein.?powder|pre.?workout|sports.?nutrition/i, "retail", "supplement_store", "Supplement Store"],
  // ── Events & Creative ─────────────────────────────────────────────────
  [/wedding.?planner|wedding.?coordinator|event.?planner/i, "events", "event_planning", "Event Planning"],
  [/photography.?studio|portrait.?studio|headshot/i, "creative", "photography_studio", "Photography Studio"],
  [/dj\b|entertainment.?company|event.?dj/i, "events", "dj_entertainment", "DJ & Entertainment"],
  // ── Misc ──────────────────────────────────────────────────────────────
  [/giraffe|animal|wildlife|zoo/i, "entertainment", "entertainment", "Entertainment"],
  [/space|astronaut|galaxy|universe/i, "entertainment", "space_brand", "Space Brand"],
];

// ── Environment map ───────────────────────────────────────────────────────────

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
  [/barber|barbershop|salon|grooming/i, "industrial"],  // mapped to industrial = dark interior feel
  [/spa|wellness|zen|tranquil/i, "luxury"],
  [/restaurant|dining|kitchen|chef/i, "warm"],
];

// ── Style map ────────────────────────────────────────────────────────────────

const STYLE_MAP: Array<[RegExp, string]> = [
  [/glass|glassmorphism|frosted/i, "glassmorphism"],
  // "dark" before "neon" — descriptive adjectives like "glowing" should not trigger neon aesthetic
  [/dark|noir|moody|masculine/i, "dark"],
  // Require explicit neon/electric aesthetic language, not just "glowing" objects
  [/\bneon\b|\bneon.?glow\b|\bneon.?lights?\b|electric.?aesthetic|electric.?blue|synthwave/i, "neon"],
  [/cyberpunk|punk|dystopia/i, "cyberpunk"],
  [/luxury|premium|opulent|gold/i, "luxury"],
  [/minimal|clean|simple|whitespace/i, "minimal"],
  [/vibrant|colorful|bold|bright/i, "vibrant"],
  [/nature|organic|green|earthy/i, "nature"],
  [/tech|futuristic|digital|holographic/i, "tech"],
  [/warm|cozy|welcoming|friendly/i, "warm"],
  [/medical|clinical|professional|sterile/i, "medical"],
  [/legal|corporate|authoritative|serious/i, "legal"],
  [/masculine|rough|gritty|rugged/i, "dark"],
  [/feminine|soft|pastel|delicate/i, "warm"],
  [/artisan|handmade|craft|authentic/i, "warm"],
  [/energetic|aggressive|bold|powerful/i, "vibrant"],
];

// ── Motion map ────────────────────────────────────────────────────────────────

const MOTION_MAP: Array<[RegExp, string]> = [
  [/cinematic|epic|slow.?motion|dramatic/i, "cinematic"],
  [/fast|energetic|dynamic|quick/i, "fast"],
  [/slow|subtle|gentle|calm|zen/i, "subtle"],
  [/no.?motion|static|still|freeze/i, "none"],
];

// ── Color map ────────────────────────────────────────────────────────────────

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
  [/silver|chrome|steel|metallic/i, "#94a3b8"],
  [/brown|wood|mahogany|walnut/i, "#92400e"],
  [/masculine|bold.?dark|deep.?dark/i, "#1a1a2e"],
];

// ── Known semantic objects ────────────────────────────────────────────────────
// Each entry: [searchRegex, label, semanticType, animation, material, color, fallbackPrimitive]

const OBJECT_MAP: Array<[RegExp, string, string, string, string, string, string]> = [
  // ── Grooming & Barber ───────────────────────────────────────────────────
  [/straight.?razor|razor.?blade|cut.?throat.?razor/i, "straight razor", "straight_razor", "spin", "metallic", "#c0c0c0", "box"],
  [/razor\b/i, "razor", "razor", "spin", "metallic", "#b0b0b0", "box"],
  [/barber.?pole|candy.?cane.?pole/i, "barber pole", "barber_pole", "spin", "standard", "#cc0000", "cylinder"],
  [/clipper|hair.?clipper|electric.?clipper/i, "hair clippers", "hair_clippers", "idle", "metallic", "#555555", "box"],
  [/barber.?chair|leather.?chair|salon.?chair/i, "barber chair", "barber_chair", "idle", "standard", "#1a1a1a", "box"],
  [/comb\b|hair.?comb/i, "comb", "comb", "slow_float", "standard", "#2c2c2c", "box"],
  [/scissor|shear/i, "scissors", "scissors", "slow_float", "metallic", "#c0c0c0", "box"],
  [/mirror\b|salon.?mirror/i, "mirror", "mirror", "idle", "glass", "#e0e8f0", "box"],
  // ── Medical & Health ────────────────────────────────────────────────────
  [/stethoscope/i, "stethoscope", "stethoscope", "slow_float", "standard", "#1e3a5f", "torus"],
  [/syringe|needle\b/i, "syringe", "syringe", "slow_float", "glass", "#e0e8f0", "cylinder"],
  [/pill|capsule|tablet/i, "pill", "pill", "bob", "standard", "#ffffff", "orb"],
  [/dna|helix/i, "DNA helix", "dna_helix", "spin", "emissive", "#4ade80", "torus"],
  [/heart\b/i, "heart", "heart", "pulse", "emissive", "#ec4899", "orb"],
  [/brain\b/i, "brain", "brain", "slow_float", "standard", "#f59e0b", "orb"],
  // ── Legal ──────────────────────────────────────────────────────────────
  [/gavel\b/i, "gavel", "gavel", "bob", "standard", "#92400e", "box"],
  [/scale.?of.?justice|justice.?scale|scale\b/i, "scales of justice", "justice_scales", "slow_float", "metallic", "#f59e0b", "torus"],
  [/briefcase/i, "briefcase", "briefcase", "slow_float", "standard", "#1c1917", "box"],
  // ── Fitness ────────────────────────────────────────────────────────────
  [/dumbbell|barbell|weight.?plate/i, "dumbbell", "dumbbell", "slow_float", "metallic", "#374151", "cylinder"],
  [/boxing.?glove|glove\b/i, "boxing glove", "boxing_glove", "bob", "standard", "#dc2626", "orb"],
  // ── Food ──────────────────────────────────────────────────────────────
  [/chef.?hat|toque/i, "chef hat", "chef_hat", "bob", "standard", "#ffffff", "cylinder"],
  [/fork\b|spoon\b|utensil/i, "utensils", "utensils", "slow_float", "metallic", "#c0c0c0", "box"],
  [/coffee.?cup|espresso.?cup/i, "coffee cup", "coffee_cup", "slow_float", "standard", "#92400e", "cylinder"],
  // ── Automotive ────────────────────────────────────────────────────────
  [/car\b|vehicle|automobile/i, "car", "car", "slow_float", "metallic", "#1f2937", "box"],
  [/wrench|spanner\b/i, "wrench", "wrench", "spin", "metallic", "#475569", "box"],
  // ── Creative & Objects ────────────────────────────────────────────────
  [/diamond|gem\b|crystal/i, "diamond", "diamond", "slow_float", "glass", "#60a5fa", "cone"],
  [/crown\b/i, "crown", "crown", "bob", "metallic", "#f59e0b", "torus"],
  [/rocket|spaceship/i, "rocket", "rocket", "orbit", "metallic", "#6366f1", "cone"],
  [/camera\b/i, "camera", "camera", "slow_float", "standard", "#1f2937", "box"],
  [/guitar\b|violin\b|instrument\b/i, "instrument", "instrument", "slow_float", "standard", "#92400e", "box"],
  [/house\b|home\b/i, "house", "house", "bob", "standard", "#2563eb", "box"],
  [/leaf\b|plant\b|flower\b/i, "leaf", "leaf", "drift", "standard", "#10b981", "cone"],
  [/lightning|thunderbolt|bolt\b/i, "lightning bolt", "lightning_bolt", "pulse", "emissive", "#fbbf24", "cone"],
  [/star\b/i, "star", "star", "slow_float", "emissive", "#fbbf24", "cone"],
  [/moon\b/i, "moon", "moon", "bob", "standard", "#e2e8f0", "orb"],
  [/sun\b/i, "sun", "sun", "pulse", "emissive", "#f59e0b", "orb"],
  [/wave\b|water/i, "wave", "wave", "wave", "standard", "#0ea5e9", "torus"],
  // ── Animals ───────────────────────────────────────────────────────────
  [/giraffe/i, "giraffe", "giraffe", "idle", "standard", "#f59e0b", "box"],
  [/lion\b/i, "lion", "lion", "idle", "standard", "#ca8a04", "orb"],
  [/dragon\b/i, "dragon", "dragon", "orbit", "emissive", "#dc2626", "orb"],
  [/shark\b/i, "shark", "shark", "drift", "standard", "#475569", "cone"],
  [/eagle|hawk\b|bird\b/i, "bird", "bird", "orbit", "standard", "#92400e", "cone"],
];

// ── Niche-specific CTA map ────────────────────────────────────────────────────

const NICHE_CTA_MAP: Record<string, { ctaText: string; ctaIntent: string; formFields: string[]; crmTag: string; targetAudience: string }> = {
  barbershop: { ctaText: "Book a Cut", ctaIntent: "booking", formFields: ["name", "phone", "service", "preferred_date"], crmTag: "barbershop-lead", targetAudience: "men seeking premium grooming" },
  hair_salon: { ctaText: "Book an Appointment", ctaIntent: "booking", formFields: ["name", "phone", "service", "stylist_preference"], crmTag: "salon-lead", targetAudience: "women seeking hair services" },
  tattoo_studio: { ctaText: "Book a Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "tattoo_idea", "placement", "size"], crmTag: "tattoo-lead", targetAudience: "adults seeking body art" },
  nail_salon: { ctaText: "Book Your Nails", ctaIntent: "booking", formFields: ["name", "phone", "service_type", "preferred_date"], crmTag: "nail-salon-lead", targetAudience: "women seeking nail services" },
  med_spa: { ctaText: "Book a Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "email", "treatment_interest"], crmTag: "med-spa-lead", targetAudience: "adults seeking aesthetic treatments" },
  dental: { ctaText: "Book an Appointment", ctaIntent: "booking", formFields: ["name", "phone", "email", "concern", "preferred_date"], crmTag: "dental-lead", targetAudience: "families and adults needing dental care" },
  chiropractic: { ctaText: "Book a Free Consult", ctaIntent: "booking", formFields: ["name", "phone", "pain_area", "how_long"], crmTag: "chiro-lead", targetAudience: "adults with pain or injuries" },
  personal_injury_law: { ctaText: "Get a Free Case Review", ctaIntent: "consultation", formFields: ["name", "phone", "email", "accident_date", "accident_type"], crmTag: "pi-lead", targetAudience: "accident victims" },
  criminal_defense: { ctaText: "Get a Free Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "charge_type", "state", "court_date"], crmTag: "criminal-defense-lead", targetAudience: "people facing criminal charges" },
  family_law: { ctaText: "Schedule a Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "email", "case_type"], crmTag: "family-law-lead", targetAudience: "people navigating family legal matters" },
  gym: { ctaText: "Start Your Free Trial", ctaIntent: "booking", formFields: ["name", "phone", "email", "fitness_goal"], crmTag: "gym-lead", targetAudience: "adults seeking fitness" },
  yoga_studio: { ctaText: "Try a Free Class", ctaIntent: "booking", formFields: ["name", "phone", "email", "experience_level"], crmTag: "yoga-lead", targetAudience: "adults seeking mind-body wellness" },
  personal_trainer: { ctaText: "Book a Free Consult", ctaIntent: "consultation", formFields: ["name", "phone", "email", "goal", "fitness_level"], crmTag: "trainer-lead", targetAudience: "adults seeking personal fitness coaching" },
  restaurant: { ctaText: "Reserve a Table", ctaIntent: "booking", formFields: ["name", "phone", "party_size", "date", "time"], crmTag: "restaurant-lead", targetAudience: "diners seeking a great meal" },
  coffee_shop: { ctaText: "Find Our Location", ctaIntent: "learn", formFields: ["name", "email", "location_preference"], crmTag: "coffee-lead", targetAudience: "coffee lovers" },
  auto_detailing: { ctaText: "Get a Free Quote", ctaIntent: "quote", formFields: ["name", "phone", "vehicle_type", "service_package"], crmTag: "detailing-lead", targetAudience: "vehicle owners seeking detailing" },
  auto_repair: { ctaText: "Book a Service", ctaIntent: "booking", formFields: ["name", "phone", "vehicle", "issue"], crmTag: "auto-repair-lead", targetAudience: "vehicle owners" },
  roofing: { ctaText: "Get a Free Estimate", ctaIntent: "quote", formFields: ["name", "phone", "address", "roof_type", "issue"], crmTag: "roofing-lead", targetAudience: "homeowners with roof issues" },
  real_estate: { ctaText: "Get Your Home Value", ctaIntent: "consultation", formFields: ["name", "phone", "email", "address", "timeline"], crmTag: "real-estate-lead", targetAudience: "home buyers and sellers" },
  saas: { ctaText: "Start Free Trial", ctaIntent: "purchase", formFields: ["name", "email", "company", "team_size"], crmTag: "saas-lead", targetAudience: "businesses seeking software solutions" },
  ecommerce: { ctaText: "Shop Now", ctaIntent: "purchase", formFields: ["name", "email", "interest"], crmTag: "ecommerce-lead", targetAudience: "online shoppers" },
  marketing_agency: { ctaText: "Get a Free Audit", ctaIntent: "consultation", formFields: ["name", "phone", "email", "website", "monthly_budget"], crmTag: "agency-lead", targetAudience: "businesses seeking marketing help" },
  business_coach: { ctaText: "Book a Strategy Call", ctaIntent: "consultation", formFields: ["name", "email", "phone", "revenue", "main_challenge"], crmTag: "coach-lead", targetAudience: "business owners and entrepreneurs" },
};

// ── Patch keywords ─────────────────────────────────────────────────────────────

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

// ── Fallback semantic object extraction ───────────────────────────────────────
// For objects NOT in OBJECT_MAP, try to extract nouns from descriptive patterns.

function extractFallbackObjects(prompt: string, knownLabels: Set<string>): SemanticObjectHint[] {
  const hints: SemanticObjectHint[] = [];

  // Pattern: "spinning/floating/glowing/3D/animated <noun>"
  const descriptivePattern = /\b(spinning|floating|glowing|3d|animated|rotating|flying|moving|hovering|shining)\s+([a-z]+(?:\s+[a-z]+)?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = descriptivePattern.exec(prompt)) !== null) {
    const animation = match[1].toLowerCase();
    const noun = match[2].toLowerCase().trim();
    if (!knownLabels.has(noun) && noun.length > 2) {
      hints.push({
        label: `${animation} ${noun}`,
        semanticType: noun.replace(/\s+/g, "_"),
        animation: animationFromVerb(animation),
        material: "standard",
        color: "#94a3b8",
        fallbackPrimitive: "orb",
      });
      knownLabels.add(noun);
    }
  }

  // Pattern: "with a/an <noun>" or "with <noun>"
  const withPattern = /\bwith\s+(?:a\s+|an\s+)?([a-z]+(?:\s+[a-z]+)?)\b/gi;
  while ((match = withPattern.exec(prompt)) !== null) {
    const noun = match[1].toLowerCase().trim();
    // Skip common filler words
    if (!knownLabels.has(noun) && noun.length > 3 && !STOP_WORDS.has(noun)) {
      hints.push({
        label: noun,
        semanticType: noun.replace(/\s+/g, "_"),
        animation: "slow_float",
        material: "standard",
        color: "#94a3b8",
        fallbackPrimitive: "orb",
      });
      knownLabels.add(noun);
    }
  }

  // Pattern: "featuring a/an <noun>" or "featuring <noun>"
  const featuringPattern = /\bfeaturing\s+(?:a\s+|an\s+)?([a-z]+(?:\s+[a-z]+)?)\b/gi;
  while ((match = featuringPattern.exec(prompt)) !== null) {
    const noun = match[1].toLowerCase().trim();
    if (!knownLabels.has(noun) && noun.length > 3 && !STOP_WORDS.has(noun)) {
      hints.push({
        label: noun,
        semanticType: noun.replace(/\s+/g, "_"),
        animation: "slow_float",
        material: "standard",
        color: "#94a3b8",
        fallbackPrimitive: "orb",
      });
      knownLabels.add(noun);
    }
  }

  return hints;
}

function animationFromVerb(verb: string): string {
  const map: Record<string, string> = {
    spinning: "spin", rotating: "spin", floating: "slow_float", hovering: "bob",
    glowing: "pulse", flying: "orbit", animated: "slow_float", moving: "drift",
    shining: "pulse", "3d": "slow_float",
  };
  return map[verb] ?? "slow_float";
}

const STOP_WORDS = new Set([
  // Style / aesthetic adjectives
  "dark", "light", "modern", "clean", "bold", "sleek", "premium", "luxury",
  "professional", "aesthetic", "design", "style", "look", "feel", "vibe",
  "color", "theme", "background",
  // Common English words
  "the", "this", "that", "and", "for", "from", "with", "into", "using",
  "high", "low", "good", "great", "best", "top", "new", "old", "fast", "slow",
  "masculine", "feminine", "minimal", "simple", "complex", "rich", "warm", "cool",
  // Context words
  "landing", "page", "website", "site", "business", "company", "service",
  // Motion / animation verbs — these describe HOW an object moves, not WHAT object
  "spinning", "floating", "glowing", "rotating", "hovering", "animated",
  "moving", "flying", "shining", "orbiting", "drifting", "pulsing",
]);

// ── Main parser ───────────────────────────────────────────────────────────────

export function parsePromptIntent(prompt: string): ParsedPromptIntent {
  const p = prompt;

  // ── Niche + business type ─────────────────────────────────────────────────
  let niche = "general";
  let businessType = "business";
  let businessLabel = "Business";
  for (const [re, n, b, label] of NICHE_MAP) {
    if (re.test(p)) { niche = n; businessType = b; businessLabel = label; break; }
  }

  // ── Environment ───────────────────────────────────────────────────────────
  let environment = "abstract";
  for (const [re, env] of ENVIRONMENT_MAP) {
    if (re.test(p)) { environment = env; break; }
  }

  // ── Style ─────────────────────────────────────────────────────────────────
  let style = "dark";
  for (const [re, s] of STYLE_MAP) {
    if (re.test(p)) { style = s; break; }
  }

  // ── Motion ────────────────────────────────────────────────────────────────
  let motion = "medium";
  for (const [re, m] of MOTION_MAP) {
    if (re.test(p)) { motion = m; break; }
  }

  // ── Colors — collect all matches ──────────────────────────────────────────
  const colors: string[] = [];
  for (const [re, color] of COLOR_MAP) {
    if (re.test(p)) colors.push(color);
  }

  // ── Known semantic objects ────────────────────────────────────────────────
  const objects: string[] = [];
  const semanticObjects: SemanticObjectHint[] = [];
  const seenLabels = new Set<string>();

  for (const [re, label, semanticType, animation, material, color, fallbackPrimitive] of OBJECT_MAP) {
    if (re.test(p) && !seenLabels.has(semanticType)) {
      objects.push(label);
      semanticObjects.push({ label, semanticType, animation, material, color, fallbackPrimitive });
      seenLabels.add(semanticType);
    }
  }

  // ── Fallback semantic extraction for unknown objects ──────────────────────
  const knownLabels = new Set(objects.map(o => o.toLowerCase()));
  const fallbackObjects = extractFallbackObjects(p, knownLabels);
  semanticObjects.push(...fallbackObjects);
  objects.push(...fallbackObjects.map(o => o.label));

  // ── Lighting ──────────────────────────────────────────────────────────────
  let lighting = "cool_ambient";
  if (/warm|cozy|sunset|golden/i.test(p)) lighting = "warm_studio";
  else if (/neon|electric|rim|glow/i.test(p)) lighting = "neon_rim";
  else if (/dramatic|noir|dark|masculine/i.test(p)) lighting = "dramatic";
  else if (/medical|sterile|clean/i.test(p)) lighting = "medical";
  else if (/neutral|natural|soft/i.test(p)) lighting = "neutral";

  // ── CTA intent — prompt keywords (low priority; niche map overrides below) ──
  let ctaIntentFromPrompt = "contact";
  if (/book|appointment|schedul|reserv/i.test(p)) ctaIntentFromPrompt = "booking";
  // "shop" alone matches too broadly (e.g. "Barber shop"); require "shop now" / "online shop"
  else if (/buy\b|purchase|shop\s+now|online\s+shop/i.test(p)) ctaIntentFromPrompt = "purchase";
  else if (/free.?quote|estimate|quote/i.test(p)) ctaIntentFromPrompt = "quote";
  else if (/consult|talk|call/i.test(p)) ctaIntentFromPrompt = "consultation";
  else if (/learn.?more|discover/i.test(p)) ctaIntentFromPrompt = "learn";

  // ── Niche-specific overrides — take priority over generic keyword detection ─
  const nicheDefaults = NICHE_CTA_MAP[businessType] ?? buildGenericDefaults(businessType, niche);
  const ctaText = nicheDefaults.ctaText;
  const formFields = nicheDefaults.formFields;
  const crmTag = nicheDefaults.crmTag;
  const targetAudience = nicheDefaults.targetAudience;

  // Niche mapping is more accurate than keyword scanning — let it win.
  // Only keep the prompt-derived intent if the niche has no specific mapping.
  const ctaIntent = NICHE_CTA_MAP[businessType]
    ? nicheDefaults.ctaIntent
    : (ctaIntentFromPrompt !== "contact" ? ctaIntentFromPrompt : nicheDefaults.ctaIntent);

  // ── Funnel goal ───────────────────────────────────────────────────────────
  let funnelGoal = "lead_capture";
  if (/sale|purchase|buy/i.test(p)) funnelGoal = "sale";
  else if (/awareness|brand/i.test(p)) funnelGoal = "awareness";
  else if (/appointment|book|reserv/i.test(p)) funnelGoal = "appointment";

  // ── Patch detection ───────────────────────────────────────────────────────
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
    niche, businessType, businessLabel,
    style, environment,
    objects, semanticObjects,
    colors, motion, lighting,
    ctaIntent, ctaText, formFields, crmTag, targetAudience,
    funnelGoal, isPatch, patchTargets,
  };
}

function buildGenericDefaults(businessType: string, niche: string) {
  // Niche-level fallbacks when no specific businessType match exists
  const nicheCtaMap: Record<string, typeof NICHE_CTA_MAP[string]> = {
    beauty: { ctaText: "Book an Appointment", ctaIntent: "booking", formFields: ["name", "phone", "service"], crmTag: `${niche}-lead`, targetAudience: "adults seeking beauty services" },
    health: { ctaText: "Book a Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "email", "concern"], crmTag: `${niche}-lead`, targetAudience: "patients seeking health care" },
    legal: { ctaText: "Get a Free Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "email", "case_type"], crmTag: "legal-lead", targetAudience: "people needing legal help" },
    fitness: { ctaText: "Start Your Free Trial", ctaIntent: "booking", formFields: ["name", "phone", "email", "goal"], crmTag: "fitness-lead", targetAudience: "adults seeking fitness" },
    food: { ctaText: "Reserve a Table", ctaIntent: "booking", formFields: ["name", "phone", "party_size", "date"], crmTag: "food-lead", targetAudience: "diners" },
    automotive: { ctaText: "Get a Free Quote", ctaIntent: "quote", formFields: ["name", "phone", "vehicle", "service"], crmTag: "auto-lead", targetAudience: "vehicle owners" },
    home_services: { ctaText: "Get a Free Estimate", ctaIntent: "quote", formFields: ["name", "phone", "address", "service"], crmTag: "home-services-lead", targetAudience: "homeowners" },
    real_estate: { ctaText: "Schedule a Consultation", ctaIntent: "consultation", formFields: ["name", "phone", "email", "timeline"], crmTag: "real-estate-lead", targetAudience: "home buyers and sellers" },
    tech: { ctaText: "Start Free Trial", ctaIntent: "purchase", formFields: ["name", "email", "company"], crmTag: "tech-lead", targetAudience: "businesses" },
    ecommerce: { ctaText: "Shop Now", ctaIntent: "purchase", formFields: ["name", "email"], crmTag: "ecommerce-lead", targetAudience: "shoppers" },
    professional_services: { ctaText: "Schedule a Call", ctaIntent: "consultation", formFields: ["name", "email", "phone", "need"], crmTag: "professional-lead", targetAudience: "businesses" },
  };
  return nicheCtaMap[niche] ?? {
    ctaText: "Get Started",
    ctaIntent: "contact",
    formFields: ["name", "email", "phone", "message"],
    crmTag: `${businessType.replace(/_/g, "-")}-lead`,
    targetAudience: "potential customers",
  };
}
