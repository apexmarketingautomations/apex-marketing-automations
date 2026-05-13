/**
 * Charge Normalizer
 *
 * Classifies raw charge text into 12 standard criminal-defense categories,
 * sets dui_related / felony_related flags, and returns a lead-priority score.
 *
 * Used by:
 *  - arrestIngestPipeline   (booking extraction)
 *  - legalSignalPipeline    (FL arrest signals via OSHA / court feeds)
 *  - countyBookingScrapers  (per-county normalization)
 */

export type ChargeCategory =
  | "dui_dwi"
  | "felony_dui"
  | "drug_possession"
  | "domestic_violence"
  | "assault_battery"
  | "traffic_warrant"
  | "probation_violation"
  | "suspended_license"
  | "reckless_driving"
  | "violent_felony"
  | "theft_burglary"
  | "other_criminal";

export interface NormalizedCharge {
  raw:           string;
  category:      ChargeCategory;
  dui_related:   boolean;
  felony_related: boolean;
  /** 0–100 priority score for lead routing */
  priority:      number;
  /** Cleaned display label */
  label:         string;
}

export interface ChargeProfile {
  charges:        NormalizedCharge[];
  primaryCategory: ChargeCategory;
  dui_related:    boolean;
  felony_related: boolean;
  /** Composite lead-priority score 0–100 */
  leadScore:      number;
  /** Comma-separated display string */
  summary:        string;
}

// ── Pattern maps (ordered: most-specific first) ─────────────────────────────

const PATTERNS: Array<{
  category:      ChargeCategory;
  dui:           boolean;
  felony:        boolean;
  priority:      number;
  label:         string;
  patterns:      RegExp[];
}> = [
  // ── DUI / DWI ───────────────────────────────────────────────────────────
  {
    category: "felony_dui",
    dui:      true,
    felony:   true,
    priority: 95,
    label:    "Felony DUI",
    patterns: [
      /felony\s*dui/i,
      /dui.*felony/i,
      /dui.*(?:3rd|third|4th|fourth|subsequent)/i,
      /dui.*(?:serious\s*bodily\s*injury|sbi|death|manslaughter)/i,
      /driving\s*under\s*influence.*felony/i,
    ],
  },
  {
    category: "dui_dwi",
    dui:      true,
    felony:   false,
    priority: 90,
    label:    "DUI / DWI",
    patterns: [
      /\bdui\b/i,
      /\bdwi\b/i,
      /driving\s*under\s*(the\s*)?influence/i,
      /operating\s*under\s*(the\s*)?influence/i,
      /impaired\s*driving/i,
      /drunk\s*driving/i,
      /bui\b/i,                    // boating under influence
      /boating\s*under\s*influence/i,
    ],
  },
  // ── Violent Felony ───────────────────────────────────────────────────────
  {
    category: "violent_felony",
    dui:      false,
    felony:   true,
    priority: 85,
    label:    "Violent Felony",
    patterns: [
      /murder/i,
      /manslaughter/i,
      /attempted\s*murder/i,
      /armed\s*robbery/i,
      /home\s*invasion/i,
      /carjacking/i,
      /kidnapping/i,
      /aggravated\s*(?:battery|assault|stalking|kidnapping)/i,
      /felony\s*(?:battery|assault)/i,
      /(?:battery|assault).*(?:deadly\s*weapon|firearm|weapon)/i,
      /sexual\s*battery/i,
      /sexual\s*assault/i,
      /rape/i,
    ],
  },
  // ── Domestic Violence ────────────────────────────────────────────────────
  {
    category: "domestic_violence",
    dui:      false,
    felony:   false,
    priority: 75,
    label:    "Domestic Violence",
    patterns: [
      /domestic\s*(?:violence|battery|assault|abuse)/i,
      /battery.*(?:spouse|domestic|household|family)/i,
      /violation.*(?:injunction|restraining\s*order|protective\s*order).*domestic/i,
    ],
  },
  // ── Assault / Battery ────────────────────────────────────────────────────
  {
    category: "assault_battery",
    dui:      false,
    felony:   false,
    priority: 65,
    label:    "Assault / Battery",
    patterns: [
      /\bassault\b/i,
      /\bbattery\b/i,
      /fighting/i,
      /affray/i,
    ],
  },
  // ── Probation Violation ──────────────────────────────────────────────────
  {
    category: "probation_violation",
    dui:      false,
    felony:   false,
    priority: 70,
    label:    "Probation Violation",
    patterns: [
      /probation\s*violation/i,
      /violation\s*of\s*probation/i,
      /\bvop\b/i,
      /community\s*control\s*violation/i,
    ],
  },
  // ── Drug Possession ──────────────────────────────────────────────────────
  {
    category: "drug_possession",
    dui:      false,
    felony:   false,
    priority: 72,
    label:    "Drug Possession",
    patterns: [
      /possess.*(?:controlled|substance|narcotic|cocaine|heroin|methamphetamine|meth|fentanyl|opioid|marijuana|cannabis|marijuana|hashish)/i,
      /\bdrug\b.*possess/i,
      /possess.*drug/i,
      /cocaine/i,
      /heroin/i,
      /methamphetamine/i,
      /fentanyl/i,
      /controlled\s*substance/i,
      /drug\s*(?:trafficking|distribution|sale)/i,
    ],
  },
  // ── Suspended License ────────────────────────────────────────────────────
  {
    category: "suspended_license",
    dui:      false,
    felony:   false,
    priority: 55,
    label:    "Suspended/Revoked License",
    patterns: [
      /(?:driving|operating).*(?:suspended|revoked|cancelled)\s*(?:license|privilege)/i,
      /license.*(?:suspended|revoked)/i,
      /\bDLSR\b/i,
      /\bHBWO\b/i,   // habitual traffic offender
      /habitual\s*traffic\s*offend/i,
    ],
  },
  // ── Reckless Driving ─────────────────────────────────────────────────────
  {
    category: "reckless_driving",
    dui:      false,
    felony:   false,
    priority: 58,
    label:    "Reckless Driving",
    patterns: [
      /reckless\s*driving/i,
      /reckless\s*operation/i,
      /leaving\s*(?:the\s*)?scene.*accident/i,
      /hit\s*and\s*run/i,
      /flee.*elude/i,
      /fleeing.*law\s*enforcement/i,
    ],
  },
  // ── Traffic Warrant ──────────────────────────────────────────────────────
  {
    category: "traffic_warrant",
    dui:      false,
    felony:   false,
    priority: 40,
    label:    "Traffic Warrant",
    patterns: [
      /traffic\s*warrant/i,
      /(?:bench|capias)\s*warrant.*traffic/i,
      /failure\s*to\s*(?:appear|pay).*traffic/i,
      /\bFTA\b.*traffic/i,
    ],
  },
  // ── Theft / Burglary ─────────────────────────────────────────────────────
  {
    category: "theft_burglary",
    dui:      false,
    felony:   false,
    priority: 60,
    label:    "Theft / Burglary",
    patterns: [
      /burglary/i,
      /larceny/i,
      /theft/i,
      /robbery/i,
      /shoplifting/i,
      /retail\s*theft/i,
      /fraud/i,
      /forgery/i,
      /identity\s*theft/i,
    ],
  },
];

// ── Felony keyword detector ──────────────────────────────────────────────────

const FELONY_KEYWORDS = /\bfelony\b|\bF[1-3]\b|(?:first|second|third)\s*degree\s*felony|\bPBF\b/i;

// ── Core normalizer ──────────────────────────────────────────────────────────

export function normalizeCharge(raw: string): NormalizedCharge {
  const text = raw.trim();

  for (const def of PATTERNS) {
    if (def.patterns.some(p => p.test(text))) {
      const felony_related = def.felony || FELONY_KEYWORDS.test(text);
      return {
        raw,
        category:      def.category,
        dui_related:   def.dui,
        felony_related,
        priority:      def.priority + (felony_related && !def.felony ? 5 : 0),
        label:         def.label,
      };
    }
  }

  // Fallback: check for bare felony keyword
  const felony_related = FELONY_KEYWORDS.test(text);
  return {
    raw,
    category:      "other_criminal",
    dui_related:   false,
    felony_related,
    priority:      felony_related ? 50 : 25,
    label:         "Other Criminal Defense",
  };
}

/**
 * Normalize a full array of charge strings and build a composite ChargeProfile.
 * Handles comma-separated charges within a single string.
 */
export function normalizeCharges(rawCharges: string | string[]): ChargeProfile {
  const inputs: string[] = Array.isArray(rawCharges)
    ? rawCharges
    : rawCharges
        .split(/[;,\n]/)
        .map(s => s.trim())
        .filter(Boolean);

  if (inputs.length === 0) {
    return {
      charges:         [],
      primaryCategory: "other_criminal",
      dui_related:     false,
      felony_related:  false,
      leadScore:       10,
      summary:         "Unknown",
    };
  }

  const charges = inputs.map(normalizeCharge);

  // Sort by priority desc; highest-priority charge = primary
  const sorted = [...charges].sort((a, b) => b.priority - a.priority);
  const primary = sorted[0];

  const dui_related    = charges.some(c => c.dui_related);
  const felony_related = charges.some(c => c.felony_related);

  // Composite lead score: highest-priority charge + bonus for multiple charges
  const baseScore    = primary.priority;
  const multiBonus   = Math.min(charges.length - 1, 3) * 2;
  const felonyBonus  = felony_related ? 5 : 0;
  const leadScore    = Math.min(100, baseScore + multiBonus + felonyBonus);

  const summary = [...new Set(charges.map(c => c.label))].join(", ");

  return {
    charges,
    primaryCategory: primary.category,
    dui_related,
    felony_related,
    leadScore,
    summary,
  };
}

// ── Prioritization helpers ───────────────────────────────────────────────────

/**
 * Returns a 0–100 lead score given booking metadata.
 * Used by the arrest ingest pipeline to rank leads before CRM routing.
 */
export function scoreArrestLead(opts: {
  chargeProfile:  ChargeProfile;
  bondAmount?:    number | null;
  hoursAgo?:      number;           // age of arrest in hours
  repeatOffender?: boolean;
}): number {
  let score = opts.chargeProfile.leadScore;

  // Bond amount boost (high bond = serious charge)
  if (opts.bondAmount) {
    if (opts.bondAmount >= 100_000) score = Math.min(100, score + 8);
    else if (opts.bondAmount >= 25_000) score = Math.min(100, score + 5);
    else if (opts.bondAmount >= 5_000)  score = Math.min(100, score + 2);
  }

  // Recency boost (arrest within 24h = higher urgency)
  if (opts.hoursAgo !== undefined) {
    if (opts.hoursAgo <= 24)  score = Math.min(100, score + 5);
    else if (opts.hoursAgo <= 72) score = Math.min(100, score + 2);
  }

  // Repeat offender boost
  if (opts.repeatOffender) score = Math.min(100, score + 5);

  return score;
}

/**
 * Maps a ChargeProfile to a legalVertical for CRM routing.
 */
export function chargeProfileToVertical(profile: ChargeProfile): string {
  if (profile.dui_related)   return "criminal";
  if (profile.felony_related) return "criminal";
  switch (profile.primaryCategory) {
    case "domestic_violence":
    case "assault_battery":
    case "violent_felony":
    case "drug_possession":
    case "probation_violation": return "criminal";
    case "suspended_license":
    case "reckless_driving":
    case "traffic_warrant":     return "traffic";
    case "theft_burglary":      return "criminal";
    default:                    return "criminal";
  }
}
