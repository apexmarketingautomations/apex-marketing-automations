import axios from 'axios';

export interface SkipTraceInput {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  ownerName?: string;
}

export interface SkipTraceOutput {
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  mailingAddress: string | null;
  additionalPhones: string[];
  additionalEmails: string[];
  raw: any;
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

    const results = response.data?.results?.persons || response.data?.results || [];
    const person = Array.isArray(results) ? results[0] : results;

    if (!person) {
      console.log(`🔍 SKIP TRACE: No results for ${fullAddress}`);
      return {
        ownerName: input.ownerName || null,
        ownerPhone: null,
        ownerEmail: null,
        mailingAddress: null,
        additionalPhones: [],
        additionalEmails: [],
        raw: response.data,
      };
    }

    const phones: string[] = [];
    const emails: string[] = [];

    if (person.phoneNumbers && Array.isArray(person.phoneNumbers)) {
      for (const p of person.phoneNumbers) {
        const num = p.number || p.phoneNumber || p;
        if (typeof num === 'string' && num.length >= 10) {
          phones.push(num);
        }
      }
    }

    if (person.emailAddresses && Array.isArray(person.emailAddresses)) {
      for (const e of person.emailAddresses) {
        const addr = e.address || e.email || e;
        if (typeof addr === 'string' && addr.includes('@')) {
          emails.push(addr);
        }
      }
    }

    const name =
      person.name
        ? `${person.name.first || ''} ${person.name.last || ''}`.trim()
        : person.fullName || input.ownerName || null;

    const mailingAddr = person.mailingAddress
      ? [
          person.mailingAddress.street,
          person.mailingAddress.city,
          person.mailingAddress.state,
          person.mailingAddress.zip,
        ]
          .filter(Boolean)
          .join(', ')
      : null;

    console.log(
      `🔍 SKIP TRACE: Found data for ${fullAddress} — ${phones.length} phones, ${emails.length} emails`
    );

    return {
      ownerName: name,
      ownerPhone: phones[0] || null,
      ownerEmail: emails[0] || null,
      mailingAddress: mailingAddr,
      additionalPhones: phones.slice(1),
      additionalEmails: emails.slice(1),
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

export function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
