/**
 * courtFilingAgentSetup.ts
 *
 * One-time (idempotent) script to create and publish Nimble browser agents
 * for FL county court filing portals (family law, probate).
 *
 * These agents handle form-based portals (checkbox case type selection,
 * date range inputs, JS-rendered results) that can't be directly extracted
 * via the realtime API without form interaction.
 *
 * Run after configuring NIMBLE_API_KEY in Railway:
 *   NIMBLE_API_KEY=<key> npx tsx server/courtFilingAgentSetup.ts
 *
 * Portals targeted:
 *   - matrix.leeclerk.org       (Lee County — primary FL clerk portal)
 *   - myflcourtaccess.com       (FL statewide eFiling portal — fallback)
 *   - collierclerk.com          (Collier County)
 *   - charlotteclerk.com        (Charlotte County)
 *   - sarasotaclerk.com         (Sarasota County)
 *   - manateeclerk.com          (Manatee County)
 *   - mypalmbeachclerk.com      (Palm Beach County)
 *   - miamidadeclerk.com        (Miami-Dade County)
 *
 * Case types extracted:
 *   DR  = Domestic Relations (divorce, dissolution of marriage)
 *   DV  = Domestic Violence / Injunction
 *   DM  = Custody / Modification
 *   PR  = Probate (new estate filings)
 *   GD  = Guardianship
 */

const NIMBLE_BASE_URL = process.env.NIMBLE_API_URL || "https://api.webnimble.com";

function resolveNimbleKey(): string {
  return (
    process.env.NIMBLE_API_KEY ||
    process.env.NIMBLE_TOKEN   ||
    process.env.NIMBLE_KEY     ||
    ""
  ).trim();
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    filing_date_from: { type: "string", description: "Start filing date YYYY-MM-DD (default 24h ago)" },
    filing_date_to:   { type: "string", description: "End filing date YYYY-MM-DD (default today)"    },
    case_types:       { type: "array",  items: { type: "string" }, description: "Case types to search: DR, DV, DM, PR, GD" },
    max_results:      { type: "number", description: "Max records to return (default 100)"            },
  },
  required: ["filing_date_from", "filing_date_to"],
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type:  "array",
      items: {
        type: "object",
        properties: {
          county:               { type: "string" },
          source_url:           { type: "string" },
          case_number:          { type: "string" },
          filing_date:          { type: "string" },
          case_type:            { type: "string" },
          case_description:     { type: "string" },
          petitioner_name:      { type: "string" },
          respondent_name:      { type: "string" },
          attorney_petitioner:  { type: "string" },
          has_minor_children:   { type: "boolean" },
          court_name:           { type: "string" },
          status:               { type: "string" },
          scrape_timestamp:     { type: "string" },
        },
      },
    },
  },
};

// ── Agent configs ─────────────────────────────────────────────────────────────

interface CourtAgentConfig {
  agentName:   string;
  county:      string;
  portalUrl:   string;
  prompt:      string;
}

const COURT_AGENT_CONFIGS: CourtAgentConfig[] = [

  {
    agentName: "apex-lee-county-court-filings",
    county:    "LEE",
    portalUrl: "https://matrix.leeclerk.org/",
    prompt: `
Interactive court case search workflow for Lee County Clerk (FL).

TARGET: https://matrix.leeclerk.org/

STEPS:
1. Navigate to https://matrix.leeclerk.org/
2. Locate the case search form. You will see checkboxes for case types and date range inputs.
3. Select the following case type checkboxes: "Domestic Relations" (DR), "Domestic Violence" (DV), "Probate" (PR), "Guardianship" (GD).
   If "Domestic Relations" is not available as a single option, check for sub-types covering dissolution of marriage, custody, or family law.
4. Set the filing date FROM field to: input.filing_date_from (format: MM/DD/YYYY)
5. Set the filing date TO field to: input.filing_date_to (format: MM/DD/YYYY)
6. Click the Search button. Wait for results to render (may take 2-4 seconds).
7. From the results table, extract for each row:
   - Case number (format: YY-CASETYPE-SEQNUM, e.g. 2024-DR-001234)
   - Filing date
   - Case type
   - Party names (Petitioner / Respondent or Plaintiff / Defendant)
   - Attorney for petitioner (if shown)
   - Case status
8. If the case description mentions "MINOR CHILD" or "WITH CHILDREN", set has_minor_children = true.
9. If pagination exists, click through all result pages up to max_results.

FIELD MAPPING:
- county: always "Lee"
- source_url: the URL of the case detail page if available, else the search results URL
- case_type: use the FL code (DR, DV, DM, PR, GD) — map "Domestic Relations" → DR, "Domestic Violence" → DV, "Probate" → PR, "Guardianship" → GD
- scrape_timestamp: ISO timestamp of extraction

DEDUP: Return each case number only once.
IMPORTANT: Return structured JSON data only — do NOT return raw HTML.
`,
  },

  {
    agentName: "apex-collier-county-court-filings",
    county:    "COLLIER",
    portalUrl: "https://www.collierclerk.com/records-and-courts/court-records/",
    prompt: `
Interactive court case search for Collier County Clerk (FL).

TARGET: https://www.collierclerk.com/records-and-courts/court-records/

STEPS:
1. Navigate to the court records search page. Look for a "Case Search" or "Search Court Records" link/button.
2. In the case type or division field, select or type: Domestic Relations, Domestic Violence, Probate.
3. Set filing date range from input.filing_date_from to input.filing_date_to.
4. Submit. Wait for JS-rendered results.
5. Extract case records: case number, filing date, case type, petitioner name, respondent name, attorney, status.
6. Paginate through all result pages.

FIELD MAPPING:
- county: always "Collier"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if case description mentions minor child, children, or parenting
- scrape_timestamp: ISO timestamp
`,
  },

  {
    agentName: "apex-charlotte-county-court-filings",
    county:    "CHARLOTTE",
    portalUrl: "https://www.charlotteclerk.com/courts/",
    prompt: `
Interactive court case search for Charlotte County Clerk (FL).

TARGET: https://www.charlotteclerk.com/courts/

STEPS:
1. Navigate to the courts page. Find the case search or case lookup link.
2. Search for Domestic Relations (DR), Domestic Violence (DV), and Probate (PR) cases.
3. Set date range from input.filing_date_from to input.filing_date_to.
4. Extract case records: case number, filing date, case type, petitioner, respondent, attorney, status.
5. Paginate all results.

FIELD MAPPING:
- county: always "Charlotte"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if minor child mentioned
- scrape_timestamp: ISO timestamp
`,
  },

  {
    agentName: "apex-sarasota-county-court-filings",
    county:    "SARASOTA",
    portalUrl: "https://www.sarasotaclerk.com/",
    prompt: `
Interactive court case search for Sarasota County Clerk (FL).

TARGET: https://www.sarasotaclerk.com/

STEPS:
1. Navigate to the public case search. Look for "Court Records", "Case Search", or "Public Access".
2. Filter for case types: Domestic Relations (DR), Domestic Violence (DV), Probate (PR).
3. Set filing date range: input.filing_date_from to input.filing_date_to.
4. Extract: case number, filing date, case type, parties (petitioner/respondent), attorney, status.
5. Paginate.

FIELD MAPPING:
- county: always "Sarasota"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if "MINOR" or "CHILDREN" in case text
- scrape_timestamp: ISO timestamp
`,
  },

  {
    agentName: "apex-manatee-county-court-filings",
    county:    "MANATEE",
    portalUrl: "https://www.manateeclerk.com/online-services/case-search/",
    prompt: `
Interactive court case search for Manatee County Clerk (FL).

TARGET: https://www.manateeclerk.com/online-services/case-search/

STEPS:
1. Navigate to case search. Select case division: Family Law, Domestic Violence, Probate.
2. Set filing date range: input.filing_date_from to input.filing_date_to.
3. Search. Wait for JS results. Extract all records.
4. Fields: case number, filing date, case type, petitioner, respondent, attorney, status.
5. Paginate.

FIELD MAPPING:
- county: always "Manatee"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if minor children mentioned
- scrape_timestamp: ISO timestamp
`,
  },

  {
    agentName: "apex-palm-beach-county-court-filings",
    county:    "PALM_BEACH",
    portalUrl: "https://apps.mypalmbeachclerk.com/search/",
    prompt: `
Interactive court case search for Palm Beach County Clerk (FL).

TARGET: https://apps.mypalmbeachclerk.com/search/

STEPS:
1. Navigate to the search portal. Select "Case Search" or equivalent.
2. Filter by division: Domestic Relations (DR), Domestic Violence (DV), Probate (PR/GD).
3. Set filing date range: input.filing_date_from to input.filing_date_to.
4. Search. Extract: case number, filing date, case type, parties, attorney, status.
5. Paginate through all result pages.

FIELD MAPPING:
- county: always "Palm Beach"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if minor children mentioned
- scrape_timestamp: ISO timestamp
`,
  },

  {
    agentName: "apex-miami-dade-county-court-filings",
    county:    "MIAMI_DADE",
    portalUrl: "https://www2.miamidadeclerk.com/ocs/",
    prompt: `
Interactive court case search for Miami-Dade County Clerk (FL).

TARGET: https://www2.miamidadeclerk.com/ocs/

STEPS:
1. Navigate to the Online Court Search (OCS) portal.
2. Select division/category: Family Law, Domestic Violence, Probate.
3. Set filing date range: input.filing_date_from to input.filing_date_to.
4. Execute search. Wait for results.
5. Extract: case number, filing date, case type, petitioner name, respondent name, attorney, case status.
6. Paginate — Miami-Dade is a large county with high filing volume.

FIELD MAPPING:
- county: always "Miami-Dade"
- case_type: DR, DV, DM, PR, or GD
- has_minor_children: true if "MINOR" in description
- scrape_timestamp: ISO timestamp
`,
  },

];

// ── Nimble API helpers ────────────────────────────────────────────────────────

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
  // allow-silent-catch: existence check failure means "not found"
  } catch { return false; }
}

async function pollUntilComplete(sessionId: string, maxWaitMs = 120_000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 8000));
    const status = await nimbleGet(`/v1/agents/status/${sessionId}`);
    if (!status) continue;
    if (status.status === "complete")               return status.agent_name || sessionId;
    if (status.status === "waiting")               return null;
    if (["error","failed"].includes(status.status)) {
      console.warn(`[COURT-AGENT-SETUP] Session ${sessionId} failed: ${status.message}`);
      return null;
    }
  }
  console.warn(`[COURT-AGENT-SETUP] Session ${sessionId} timed out`);
  return null;
}

// ── Setup single agent ────────────────────────────────────────────────────────

async function setupCourtAgent(cfg: CourtAgentConfig): Promise<boolean> {
  if (await agentExists(cfg.agentName)) {
    console.log(`[COURT-AGENT-SETUP] ${cfg.county}: agent "${cfg.agentName}" already exists — skipping`);
    return true;
  }

  console.log(`[COURT-AGENT-SETUP] ${cfg.county}: creating agent "${cfg.agentName}"...`);

  let sessionId: string;
  try {
    const gen = await nimblePost("/v1/agents/generate", {
      session_id:    cfg.agentName,
      url:           cfg.portalUrl,
      prompt:        cfg.prompt,
      input_schema:  INPUT_SCHEMA,
      output_schema: OUTPUT_SCHEMA,
    });
    sessionId = gen?.session_id || cfg.agentName;
  } catch (err: any) {
    console.error(`[COURT-AGENT-SETUP] ${cfg.county}: generate failed — ${err.message}`);
    return false;
  }

  const agentName = await pollUntilComplete(sessionId);
  if (!agentName) {
    console.error(`[COURT-AGENT-SETUP] ${cfg.county}: agent generation did not complete`);
    return false;
  }

  try {
    await nimblePost("/v1/agents/publish", { session_id: sessionId });
    console.log(`[COURT-AGENT-SETUP] ${cfg.county}: agent "${agentName}" published ✅`);
    return true;
  } catch (err: any) {
    console.warn(`[COURT-AGENT-SETUP] ${cfg.county}: publish failed (agent still usable) — ${err.message}`);
    return true;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const key = resolveNimbleKey();
  if (!key) {
    console.error("[COURT-AGENT-SETUP] No Nimble credential configured. Set NIMBLE_API_KEY.");
    process.exit(1);
  }

  console.log("[COURT-AGENT-SETUP] Starting agent setup for FL county court filing portals...");
  console.log(`[COURT-AGENT-SETUP] ${COURT_AGENT_CONFIGS.length} counties to configure`);
  console.log("[COURT-AGENT-SETUP] Case types: DR (divorce), DV (domestic violence), DM (custody), PR (probate), GD (guardianship)");

  let ok = 0;
  let failed = 0;

  for (const cfg of COURT_AGENT_CONFIGS) {
    const success = await setupCourtAgent(cfg);
    if (success) ok++;
    else         failed++;
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n[COURT-AGENT-SETUP] Complete — agents created/verified: ${ok} | failed: ${failed}`);
  if (failed > 0) {
    console.warn("[COURT-AGENT-SETUP] Some agents failed. Re-run after fixing the issue.");
    process.exit(1);
  }
}

export { setupCourtAgent, main as setupAllCourtFilingAgents };
