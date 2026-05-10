import axios from 'axios';

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
    console.error(`🔍 SKIP TRACE: API error for ${fullAddress}:`, error?.message);
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      throw new Error('Invalid or expired skip trace API key. Check your BatchData credentials.');
    }
    if (error?.response?.status === 402) {
      throw new Error('Skip trace credits exhausted. Please top up your BatchData account.');
    }
    throw new Error(`Skip trace lookup failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Get the BatchData API key — checks both variable names for compatibility.
 */
export function getBatchDataKey(): string | null {
  return process.env.BATCH_DATA || process.env.BATCHDATA_API_KEY || null;
}

export function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
