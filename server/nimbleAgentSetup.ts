/**
 * nimbleAgentSetup.ts
 *
 * One-time (idempotent) script to create and publish Nimble browser agents
 * for all 11 Florida county jail booking systems.
 *
 * Run after configuring NIMBLE_API_KEY in Railway:
 *   npx tsx server/nimbleAgentSetup.ts
 *
 * Each agent handles:
 *   - Interactive form submission with date range inputs
 *   - JavaScript-rendered page extraction
 *   - Detail record pagination
 *   - DUI/felony flagging
 *   - 72h default window with 7-day fallback
 */

import { COUNTY_BOOKING_CONFIGS, type CountyBookingConfig } from "./jailBookingPipeline";

function resolveNimbleKey(): string {
  return (
    process.env.NIMBLE_API_KEY ||
    process.env.NIMBLE_TOKEN   ||
    process.env.NIMBLE_KEY     ||
    ""
  ).trim();
}

const NIMBLE_BASE_URL = process.env.NIMBLE_API_URL || "https://api.webnimble.com";

// ── Shared schemas (identical for every county agent) ─────────────────────────

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    booking_date_from: { type: "string", description: "Start date YYYY-MM-DD (default 72h ago)" },
    booking_date_to:   { type: "string", description: "End date YYYY-MM-DD (default today)"     },
    first_name:        { type: "string", description: "Optional first name filter"               },
    last_name:         { type: "string", description: "Optional last name filter"                },
  },
  required: ["booking_date_from", "booking_date_to"],
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          county:           { type: "string"  },
          source_url:       { type: "string"  },
          full_name:        { type: "string"  },
          first_name:       { type: "string"  },
          last_name:        { type: "string"  },
          booking_id:       { type: "string"  },
          booking_date:     { type: "string"  },
          arrest_date:      { type: "string"  },
          charges:          { type: "array", items: { type: "string" } },
          charge_category:  { type: "string"  },
          dui_related:      { type: "boolean" },
          felony_related:   { type: "boolean" },
          bond_amount:      { type: "string"  },
          custody_status:   { type: "string"  },
          age:              { type: "string"  },
          dob:              { type: "string"  },
          city_state:       { type: "string"  },
          mugshot_url:      { type: "string"  },
          scrape_timestamp: { type: "string"  },
        },
      },
    },
  },
};

// ── County-specific agent prompts ─────────────────────────────────────────────

const COUNTY_PROMPTS: Record<string, (cfg: CountyBookingConfig) => string> = {

  LEE: (cfg) => `
Interactive jail booking search workflow for Lee County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}
2. Locate the booking search form (fields: booking_date_from, booking_date_to, first_name, last_name).
3. Set booking_date_from field to: input.booking_date_from (YYYY-MM-DD)
4. Set booking_date_to field to: input.booking_date_to (YYYY-MM-DD)
5. If input.first_name provided: fill first name field. If input.last_name provided: fill last name field.
6. Click the Search/Submit button. Wait for JavaScript-rendered results table.
7. Extract every row from the results table: full name, booking ID, booking date, charges, bond, custody status.
8. For each row that has a detail/view link: open it and extract full charge list, bond amount, custody status, mugshot URL, booking number, DOB, age, arrest date, city/state.
9. If pagination exists (Next button, page numbers), click through ALL pages.
10. If zero results for the given window, return an empty results array.

FIELD MAPPING:
- county: always "Lee"
- dui_related: true if any charge text contains DUI, DWI, or "driving under influence"
- felony_related: true if any charge contains FELONY, "F-" prefix, or a statute flagged as felony
- scrape_timestamp: ISO timestamp of extraction

DEDUP: Return unique records only. Key: booking_id, then full_name+booking_date+first_charge.
DO NOT return the search page HTML. Return structured data only.
`,

  CHARLOTTE: (cfg) => `
Interactive jail booking search workflow for Charlotte County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}
2. Find the inmate/booking search form. It may be under Detention > Inmate Search.
3. Set the booking date FROM field = input.booking_date_from, TO = input.booking_date_to.
4. Fill optional name fields if provided in input.
5. Submit the form. Wait for JavaScript-rendered results.
6. Extract every booking row: name, booking number, booking date, arrest date, charges, bond, custody.
7. Open each detail record for: full charge list, mugshot URL, DOB, age.
8. Paginate through all result pages.

FIELD MAPPING:
- county: always "Charlotte"
- dui_related: true if DUI/DWI in any charge
- felony_related: true if FELONY or "F-" charge present
- scrape_timestamp: ISO timestamp

DEDUP by booking_id, then full_name+booking_date+charge[0].
`,

  COLLIER: (cfg) => `
Interactive jail booking search workflow for Collier County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}
2. Locate the inmate information or booking search form.
3. Set date range: from = input.booking_date_from, to = input.booking_date_to.
4. Submit. Wait for JavaScript-rendered results.
5. Extract all booking records: name, booking ID, date, charges, bond, custody status.
6. For each record with a detail link: extract full charges, mugshot, DOB, arrest date.
7. Paginate all result pages.

FIELD MAPPING:
- county: always "Collier"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp

DEDUP by booking_id then name+date+charge.
`,

  HENDRY: (cfg) => `
Interactive jail booking search workflow for Hendry County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If that path returns 404, try the homepage at https://www.hendrysheriff.org/ and look for links labeled: Jail Roster, Inmates, Booking Search, Corrections.
2. Access the booking/inmate search. Set date range if available: from = input.booking_date_from, to = input.booking_date_to.
3. If no date filter exists (small county static roster): extract ALL currently listed bookings.
4. Extract: name, booking ID, booking date, charges, bond amount, custody status.
5. Open detail records if available for mugshot, DOB.

FIELD MAPPING:
- county: always "Hendry"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp

Note: Hendry is a small county. Fewer records expected. If booking system is unavailable, return empty array with an error note in scrape_timestamp field.
`,

  GLADES: (cfg) => `
Interactive jail booking search workflow for Glades County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.gladessheriff.com/ main page and look for: Jail Roster, Inmate Search, Active Bookings, Corrections.
2. Glades County is very small — the roster may be a simple HTML table or PDF.
3. Extract all available booking records: name, booking ID or case number, booking date, charges, bond, custody status.
4. If date filtering is available, use input.booking_date_from through input.booking_date_to.
5. If only a daily roster is available, extract all current entries.

FIELD MAPPING:
- county: always "Glades"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp
`,

  SARASOTA: (cfg) => `
Interactive jail booking search workflow for Sarasota County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.sarasotasheriff.org/ and find: Corrections, Inmate Search, Booking Search.
2. Set booking date from = input.booking_date_from, to = input.booking_date_to.
3. Submit search. Wait for JavaScript-rendered results.
4. Extract all booking records: name, booking number, date, charges, bond, custody status.
5. Open detail records for full charge list, mugshot URL, DOB, arrest date.
6. Paginate all result pages.

FIELD MAPPING:
- county: always "Sarasota"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp
`,

  MANATEE: (cfg) => `
Interactive jail booking search workflow for Manatee County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.manateesheriff.org/ → Corrections or Inmate Search.
2. Set date range: from = input.booking_date_from, to = input.booking_date_to.
3. Submit. Wait for results.
4. Extract all booking records: name, booking ID, date, charges, bond, custody status.
5. Open detail records for full charges, mugshot, DOB.
6. Paginate all pages.

FIELD MAPPING:
- county: always "Manatee"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp
`,

  POLK: (cfg) => `
Interactive jail booking search workflow for Polk County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl} — this is Polk's dedicated inmate search portal.
2. Find the booking date filter. Set from = input.booking_date_from, to = input.booking_date_to.
3. Execute the search. Wait for results.
4. Extract all records: name, booking number, date, charges (all counts), bond, custody status.
5. Open each detail record for full charge list, mugshot URL, DOB, arrest date.
6. Paginate through ALL result pages — Polk is a large county with high booking volume.

FIELD MAPPING:
- county: always "Polk"
- dui_related: true if DUI/DWI/driving under influence in any charge
- felony_related: true if FELONY or "F-" or felony statute code present
- scrape_timestamp: ISO timestamp
`,

  HILLSBOROUGH: (cfg) => `
Interactive jail booking search workflow for Hillsborough County Sheriff (FL) — Tampa area.

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.hcso.tampa.fl.us/ → Arrest Inquiry or Inmate Search.
2. Locate the arrest/booking search form. Set date range: from = input.booking_date_from, to = input.booking_date_to.
3. Submit. Wait for JavaScript-rendered results.
4. Extract all booking records: name, booking number, date, charges, bond, custody status.
5. Open detail pages for full charge list, mugshot URL, DOB, arrest date.
6. Paginate ALL result pages — Hillsborough is a major metro county with high volume.

FIELD MAPPING:
- county: always "Hillsborough"
- dui_related / felony_related from charge descriptions
- scrape_timestamp: ISO timestamp
`,

  PINELLAS: (cfg) => `
Interactive jail booking search workflow for Pinellas County Sheriff (FL) — St. Petersburg area.

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.pcsoweb.com/ → Active Bookings or Inmate Search.
2. Set booking date range: from = input.booking_date_from, to = input.booking_date_to.
3. Submit form. Wait for results.
4. Extract all booking records: name, booking ID, date, charges, bond, custody status.
5. Open detail records for full charges, mugshot, DOB.
6. Paginate all pages.

FIELD MAPPING:
- county: always "Pinellas"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp
`,

  PASCO: (cfg) => `
Interactive jail booking search workflow for Pasco County Sheriff (FL).

TARGET: ${cfg.bookingUrl}

STEPS:
1. Navigate to ${cfg.bookingUrl}. If 404, try https://www.pascosheriff.org/ → Inmate Search or Jail Roster.
2. Set date range: from = input.booking_date_from, to = input.booking_date_to.
3. Submit. Wait for results.
4. Extract all booking records: name, booking ID, booking date, charges, bond amount, custody status.
5. Open detail records for full charge list, mugshot URL, DOB, arrest date.
6. Paginate all pages.

FIELD MAPPING:
- county: always "Pasco"
- dui_related / felony_related from charge text
- scrape_timestamp: ISO timestamp
`,
};

// ── Nimble API calls ───────────────────────────────────────────────────────────

async function nimblePost(path: string, body: unknown): Promise<any> {
  const key = resolveNimbleKey();
  const res = await fetch(`${NIMBLE_BASE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nimble API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function nimbleGet(path: string): Promise<any> {
  const key = resolveNimbleKey();
  const res = await fetch(`${NIMBLE_BASE_URL}${path}`, {
    headers: { "Authorization": `Bearer ${key}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function agentExists(agentName: string): Promise<boolean> {
  try {
    const data = await nimbleGet(`/v1/agents/${agentName}`);
    return !!data && !data.error;
  // allow-silent-catch: existence check — network/API errors mean "agent not found"
  } catch {
    return false;
  }
}

async function pollUntilComplete(sessionId: string, maxWaitMs = 120_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 8000));
    const status = await nimbleGet(`/v1/agents/status/${sessionId}`);
    if (!status) continue;
    if (status.status === "complete")             return status.agent_name || null;
    if (status.status === "waiting")              return null; // needs more input
    if (["error", "failed"].includes(status.status)) {
      console.warn(`[NIMBLE-SETUP] Session ${sessionId} failed: ${status.message}`);
      return null;
    }
  }
  console.warn(`[NIMBLE-SETUP] Session ${sessionId} timed out`);
  return null;
}

// ── Setup Single Agent ─────────────────────────────────────────────────────────

async function setupCountyAgent(config: CountyBookingConfig): Promise<boolean> {
  if (await agentExists(config.agentName)) {
    console.log(`[NIMBLE-SETUP] ${config.county}: agent "${config.agentName}" already exists — skipping`);
    return true;
  }

  const promptFn = COUNTY_PROMPTS[config.county];
  if (!promptFn) {
    console.warn(`[NIMBLE-SETUP] ${config.county}: no prompt defined — skipping`);
    return false;
  }

  const prompt = promptFn(config);
  console.log(`[NIMBLE-SETUP] ${config.county}: creating agent "${config.agentName}"...`);

  let sessionId: string;
  try {
    const gen = await nimblePost("/v1/agents/generate", {
      session_id:    config.agentName,
      url:           config.bookingUrl,
      prompt,
      input_schema:  INPUT_SCHEMA,
      output_schema: OUTPUT_SCHEMA,
    });
    sessionId = gen?.session_id || config.agentName;
  } catch (err: any) {
    console.error(`[NIMBLE-SETUP] ${config.county}: generate failed — ${err.message}`);
    return false;
  }

  // Poll until generation complete
  const agentName = await pollUntilComplete(sessionId);
  if (!agentName) {
    console.error(`[NIMBLE-SETUP] ${config.county}: agent generation did not complete`);
    return false;
  }

  // Publish so it becomes reusable
  try {
    await nimblePost("/v1/agents/publish", { session_id: sessionId });
    console.log(`[NIMBLE-SETUP] ${config.county}: agent "${agentName}" published`);
    return true;
  } catch (err: any) {
    console.warn(`[NIMBLE-SETUP] ${config.county}: publish failed (agent still usable) — ${err.message}`);
    return true; // still usable unpublished within same session
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const key = resolveNimbleKey();
  if (!key) {
    console.error("[NIMBLE-SETUP] No Nimble credential configured. Set NIMBLE_API_KEY in Railway env vars.");
    process.exit(1);
  }

  console.log("[NIMBLE-SETUP] Starting agent setup for all FL county jail booking scrapers...");
  console.log(`[NIMBLE-SETUP] ${COUNTY_BOOKING_CONFIGS.length} counties to configure`);

  let ok = 0;
  let failed = 0;

  for (const config of COUNTY_BOOKING_CONFIGS) {
    if (!config.enabled) {
      console.log(`[NIMBLE-SETUP] ${config.county}: disabled — skipping`);
      continue;
    }
    const success = await setupCountyAgent(config);
    if (success) ok++;
    else         failed++;
    await new Promise(r => setTimeout(r, 2000)); // be polite to the API
  }

  console.log(`[NIMBLE-SETUP] Complete — agents created/verified: ${ok} | failed: ${failed}`);

  if (failed > 0) {
    console.warn("[NIMBLE-SETUP] Some agents failed. Re-run after fixing the issue.");
    process.exit(1);
  }
}

// Run if invoked directly: npx tsx server/nimbleAgentSetup.ts
// Use import.meta.url for ESM compatibility
const _isMain = process.argv[1]?.endsWith("nimbleAgentSetup.ts") ||
                process.argv[1]?.endsWith("nimbleAgentSetup.js");
if (_isMain) {
  main().catch(err => {
    console.error("[NIMBLE-SETUP] Fatal:", err.message);
    process.exit(1);
  });
}

export { setupCountyAgent, main as setupAllBookingAgents };
