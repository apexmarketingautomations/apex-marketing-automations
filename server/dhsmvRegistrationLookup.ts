/**
 * Florida DHSMV Vehicle Registration Lookup
 *
 * Uses Nimble Pipeline API to query the FL Department of Highway Safety
 * and Motor Vehicles Motor Vehicle Check web portal for a given plate number.
 *
 * What DHSMV returns:
 *   - Registered owner name (may differ from crash driver — e.g. spouse, employer)
 *   - Owner mailing address
 *   - Vehicle year / make / model / color
 *   - Registration expiration
 *
 * This data is supplementary to FLHSMV crash report driver info.
 * When both are available, the crash contact gets both the DRIVER (from crash
 * report) and the REGISTERED OWNER (from this lookup) as separate note lines.
 */

import { nimblePipelineFetch, isNimbleConfigured } from "./nimbleClient";

const DHSMV_BASE     = "https://services.flhsmv.gov/MVCheckWeb";
const DHSMV_INQUIRY  = `${DHSMV_BASE}/Inquiry.aspx`;

export interface RegistrationResult {
  found: boolean;
  ownerName?: string;
  ownerAddress?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  registrationExpires?: string;
  rawHtml?: string;
  error?: string;
}

/**
 * Parse owner and vehicle info out of the DHSMV MVCheck HTML response.
 * The portal returns a simple table — we extract the key rows.
 */
function parseDhsmvHtml(html: string): RegistrationResult {
  if (!html || html.length < 100) {
    return { found: false, error: "Empty response" };
  }

  // Check for "no record found" indicators
  const lower = html.toLowerCase();
  if (
    lower.includes("no record found") ||
    lower.includes("no vehicle found") ||
    lower.includes("not found") ||
    lower.includes("invalid plate")
  ) {
    return { found: false };
  }

  // Extract table cell values using regex — matches <td ...>VALUE</td>
  const tdPattern = /<td[^>]*>\s*([^<]{2,})\s*<\/td>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tdPattern.exec(html)) !== null) {
    const val = m[1].trim().replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
    if (val.length > 1 && !val.startsWith("<")) cells.push(val);
  }

  // Label-value pairs: the portal renders "Owner Name:" then value in next cell
  const result: RegistrationResult = { found: false };
  for (let i = 0; i < cells.length - 1; i++) {
    const label = cells[i].toLowerCase().replace(/[:\s]+$/, "").trim();
    const value = cells[i + 1];
    if (!value || value.toLowerCase().includes(":")) continue;

    if (label.includes("owner name") || label === "name")          result.ownerName = value;
    if (label.includes("address") || label === "mailing address")  result.ownerAddress = value;
    if (label.includes("year"))     result.vehicleYear  = value;
    if (label.includes("make"))     result.vehicleMake  = value;
    if (label.includes("model"))    result.vehicleModel = value;
    if (label.includes("color"))    result.vehicleColor = value;
    if (label.includes("expir") || label.includes("renewal")) result.registrationExpires = value;
  }

  result.found = !!(result.ownerName || result.ownerAddress);
  return result;
}

/**
 * Look up a Florida vehicle registration by plate number.
 *
 * @param plate - Plate number only (e.g. "ABC1234")
 * @param state - State code (default "FL")
 */
export async function lookupRegistration(
  plate: string,
  state = "FL",
): Promise<RegistrationResult> {
  if (!isNimbleConfigured()) {
    console.warn("[DHSMV-REG] Nimble not configured — NIMBLE_API_USERNAME/PASSWORD missing");
    return { found: false, error: "Nimble not configured" };
  }

  const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleanPlate || cleanPlate.length < 2) {
    return { found: false, error: "Invalid plate number" };
  }

  console.log(`[DHSMV-REG] Looking up plate ${cleanPlate} (${state}) via Nimble`);

  const res = await nimblePipelineFetch({
    url:    DHSMV_INQUIRY,
    method: "POST",
    body: {
      PlateNumber: cleanPlate,
      StateCode:   state,
    },
    render:  true,
    country: "US",
    waitMs:  2000,
  });

  if (!res.ok) {
    console.warn(`[DHSMV-REG] Nimble fetch failed for plate ${cleanPlate}: ${res.error}`);
    return { found: false, error: res.error ?? `HTTP ${res.status}` };
  }

  const parsed = parseDhsmvHtml(res.html);
  parsed.rawHtml = undefined; // don't store full HTML

  if (parsed.found) {
    console.log(
      `[DHSMV-REG] ✓ Found plate ${cleanPlate}: owner=${parsed.ownerName} addr=${parsed.ownerAddress}`
    );
  } else {
    console.log(`[DHSMV-REG] No record for plate ${cleanPlate}`);
  }

  return parsed;
}

/**
 * Format a registration result as a contact note line.
 */
export function formatRegistrationNote(result: RegistrationResult, plate: string): string | null {
  if (!result.found) return null;
  const vehicle = [result.vehicleYear, result.vehicleMake, result.vehicleModel, result.vehicleColor]
    .filter(Boolean).join(" ");
  return [
    `DHSMV Registration (plate ${plate}):`,
    result.ownerName    ? `  Owner: ${result.ownerName}`           : null,
    result.ownerAddress ? `  Address: ${result.ownerAddress}`      : null,
    vehicle             ? `  Vehicle: ${vehicle}`                  : null,
    result.registrationExpires ? `  Expires: ${result.registrationExpires}` : null,
  ].filter(Boolean).join("\n");
}
