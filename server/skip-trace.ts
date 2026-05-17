// @ts-nocheck
import axios from 'axios';

// ─── Circuit breaker ───────────────────────────────────────────────────────────
// Trips automatically on 402/403 quota errors so the process stops hammering
// a dead API on every inbound lead. Resets only on restart.
// Also respects BATCHDATA_DISABLED=true env var as a manual kill switch.

let _circuitOpen = false;
let _circuitTrippedAt: string | null = null;

export function isBatchDataDisabled(): boolean {
  if (process.env.BATCHDATA_DISABLED === "true") return true;
  return _circuitOpen;
}

function tripCircuit(reason: string): void {
  if (_circuitOpen) return;
  _circuitOpen = true;
  _circuitTrippedAt = new Date().toISOString();
  console.error(
    `[SKIP-TRACE] ⛔ Circuit breaker OPEN — BatchData calls suspended. ` +
    `Reason: ${reason}. ` +
    `Set BATCHDATA_DISABLED=false and restart to re-enable. ` +
    `Tripped at: ${_circuitTrippedAt}`
  );
}

/** Returns a no-op result when BatchData is disabled/exhausted. */
function disabledResult(input: SkipTraceInput): SkipTraceOutput {
  return {
    ownerName: input.ownerName || null,
    ownerPhone: null,
    ownerEmail: null,
    mailingAddress: null,
    additionalPhones: [],
    additionalEmails: [],
    additionalAddresses: [],
    allPersons: [],
    totalPersonsFound: 0,
    raw: { disabled: true, reason: _circuitOpen ? "circuit_breaker_open" : "BATCHDATA_DISABLED" },
  };
}

export interface SkipTraceInput {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  ownerName?: string;
}

export interface SkipTracePerson {
  name: string;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  allPhones: string[];
  allEmails: string[];
  allAddresses: string[];
  age?: number | null;
  relationship?: string | null;
}

export interface SkipTraceOutput {
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  mailingAddress: string | null;
  additionalPhones: string[];
  additionalEmails: string[];
  additionalAddresses: string[];
  allPersons: SkipTracePerson[];
  totalPersonsFound: number;
  raw: any;
}

function extractPhones(obj: any): string[] {
  const phones: string[] = [];
  const sources = [
    obj?.phoneNumbers,
    obj?.phones,
    obj?.phone_numbers,
    obj?.contactInfo?.phones,
  ].filter(Boolean);
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const p of src) {
      const num = p?.number || p?.phoneNumber || p?.phone || p?.value || (typeof p === 'string' ? p : null);
      if (typeof num === 'string') {
        const cleaned = num.replace(/\D/g, '');
        if (cleaned.length >= 10) phones.push(cleaned);
      }
    }
  }
  return [...new Set(phones)];
}

function extractEmails(obj: any): string[] {
  const emails: string[] = [];
  const sources = [
    obj?.emailAddresses,
    obj?.emails,
    obj?.email_addresses,
    obj?.contactInfo?.emails,
  ].filter(Boolean);
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const e of src) {
      const addr = e?.address || e?.email || e?.value || (typeof e === 'string' ? e : null);
      if (typeof addr === 'string' && addr.includes('@') && addr.includes('.')) {
        emails.push(addr.toLowerCase());
      }
    }
  }
  return [...new Set(emails)];
}

function extractAddresses(obj: any): string[] {
  const addresses: string[] = [];
  const sources = [
    obj?.mailingAddress,
    obj?.addresses,
    obj?.priorAddresses,
    obj?.associatedAddresses,
    obj?.currentAddress,
  ].filter(Boolean);
  for (const src of sources) {
    const items = Array.isArray(src) ? src : [src];
    for (const a of items) {
      if (!a) continue;
      const parts = [a.street || a.address, a.city, a.state, a.zip || a.zipCode]
        .filter(Boolean)
        .map((s: any) => String(s).trim());
      if (parts.length >= 2) addresses.push(parts.join(', '));
    }
  }
  return [...new Set(addresses)];
}

function extractPersonName(person: any): string {
  if (person?.name?.first || person?.name?.last) {
    return `${person.name.first || ''} ${person.name.last || ''}`.trim();
  }
  if (person?.fullName) return person.fullName;
  if (person?.firstName || person?.lastName) {
    return `${person.firstName || ''} ${person.lastName || ''}`.trim();
  }
  return '';
}

function parsePersons(raw: any): SkipTracePerson[] {
  const candidates: any[] = [];
  const resultBlock = raw?.results;
  if (Array.isArray(resultBlock)) {
    for (const r of resultBlock) {
      if (Array.isArray(r?.persons)) candidates.push(...r.persons);
      else if (r?.person) candidates.push(r.person);
      else if (r?.name || r?.phoneNumbers) candidates.push(r);
    }
  } else if (resultBlock?.persons && Array.isArray(resultBlock.persons)) {
    candidates.push(...resultBlock.persons);
  } else if (Array.isArray(raw?.persons)) {
    candidates.push(...raw.persons);
  }
  if (raw?.owner) candidates.push(raw.owner);
  if (raw?.currentOwner) candidates.push(raw.currentOwner);
  if (raw?.owners && Array.isArray(raw.owners)) candidates.push(...raw.owners);

  if (candidates.length === 0) return [];

  return candidates
    .filter(Boolean)
    .map((p): SkipTracePerson => {
      const allPhones = extractPhones(p);
      const allEmails = extractEmails(p);
      const allAddresses = extractAddresses(p);
      const name = extractPersonName(p);
      return {
        name,
        phone: allPhones[0] || null,
        email: allEmails[0] || null,
        mailingAddress: allAddresses[0] || null,
        allPhones,
        allEmails,
        allAddresses,
        age: p?.age || p?.estimatedAge || null,
        relationship: p?.relationship || p?.ownerType || null,
      };
    })
    .filter(p => p.name || p.phone || p.email);
}

export async function skipTraceLookup(
  input: SkipTraceInput,
  apiKey: string
): Promise<SkipTraceOutput> {
  // ── Circuit breaker / kill switch check ──────────────────────────────────
  if (isBatchDataDisabled()) {
    console.warn("[SKIP-TRACE] Skipped — BatchData is disabled (exhausted or kill switch)");
    return disabledResult(input);
  }

  const fullAddress = [input.address, input.city, input.state, input.zip]
    .filter(Boolean)
    .join(', ');

  try {
    const response = await axios.post(
      'https://api.batchdata.com/api/v1/property/skip-trace',
      {
        requests: [
          {
            propertyAddress: {
              street: input.address,
              city: input.city || '',
              state: input.state || '',
              zip: input.zip || '',
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const allPersons = parsePersons(response.data);

    if (allPersons.length === 0) {
      console.log(`🔍 SKIP TRACE: No persons found for ${fullAddress}`);
      return {
        ownerName: input.ownerName || null,
        ownerPhone: null,
        ownerEmail: null,
        mailingAddress: null,
        additionalPhones: [],
        additionalEmails: [],
        additionalAddresses: [],
        allPersons: [],
        totalPersonsFound: 0,
        raw: response.data,
      };
    }

    const allPhones: string[] = [];
    const allEmails: string[] = [];
    const allAddresses: string[] = [];

    for (const p of allPersons) {
      allPhones.push(...p.allPhones);
      allEmails.push(...p.allEmails);
      allAddresses.push(...p.allAddresses);
    }

    const uniquePhones = [...new Set(allPhones)];
    const uniqueEmails = [...new Set(allEmails)];
    const uniqueAddresses = [...new Set(allAddresses)];
    const primary = allPersons[0];

    console.log(
      `🔍 SKIP TRACE: ${fullAddress} => ${allPersons.length} persons, ` +
      `${uniquePhones.length} phones, ${uniqueEmails.length} emails, ` +
      `${uniqueAddresses.length} addresses`
    );

    return {
      ownerName: primary.name || input.ownerName || null,
      ownerPhone: uniquePhones[0] || null,
      ownerEmail: uniqueEmails[0] || null,
      mailingAddress: uniqueAddresses[0] || null,
      additionalPhones: uniquePhones.slice(1),
      additionalEmails: uniqueEmails.slice(1),
      additionalAddresses: uniqueAddresses.slice(1),
      allPersons,
      totalPersonsFound: allPersons.length,
      raw: response.data,
    };
  } catch (error: any) {
    const status = error?.response?.status;
    console.error(`🔍 SKIP TRACE: API error for ${fullAddress} (HTTP ${status ?? "network"}):`, error?.message);

    if (status === 402) {
      tripCircuit("credits_exhausted (HTTP 402)");
      return disabledResult(input);
    }
    if (status === 403) {
      tripCircuit("quota_exhausted_or_invalid_key (HTTP 403)");
      return disabledResult(input);
    }
    if (status === 401) {
      tripCircuit("invalid_api_key (HTTP 401)");
      return disabledResult(input);
    }
    if (status === 429) {
      // Rate limit — don't trip circuit, just skip this request
      console.warn("[SKIP-TRACE] Rate limited — skipping this request");
      return disabledResult(input);
    }

    // Network / timeout errors — don't trip the circuit, may be transient
    throw new Error(`Skip trace lookup failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Get the BatchData API key.
 * Re-exported from vendorConfig — canonical resolver lives there.
 */
export { resolveBatchDataKey as getBatchDataKey } from "./vendorConfig";

export function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
