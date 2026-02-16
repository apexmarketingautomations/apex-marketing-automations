import axios from 'axios';

export interface DistressedProperty {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string;
  ownerPhone: string | null;
  propertyType: string;
  estimatedValue: number;
  estimatedEquity: number;
  distressSignals: string[];
  priority: string;
  lat: number | null;
  lng: number | null;
}

function classifyDistress(prop: any): { signals: string[]; priority: string } {
  const signals: string[] = [];

  if (prop.status === 'Pre-Foreclosure' || prop.status === 'Foreclosure') signals.push('Pre-Foreclosure');
  if (prop.listedDate) {
    const daysOnMarket = Math.floor((Date.now() - new Date(prop.listedDate).getTime()) / 86400000);
    if (daysOnMarket > 90) signals.push('Stale Listing (90+ days)');
    if (daysOnMarket > 180) signals.push('Expired Listing');
  }
  if (prop.priceReductions && prop.priceReductions > 0) signals.push(`Price Reduced ${prop.priceReductions}x`);
  if (prop.ownerOccupied === false) signals.push('Absentee Owner');
  if (prop.propertyType === 'Vacant Land' || prop.lotSize > 10000) signals.push('Potential Vacant');

  const estimatedEquityPct = prop.price && prop.assessedValue
    ? ((prop.assessedValue - (prop.price * 0.7)) / prop.assessedValue)
    : 0.3;
  if (estimatedEquityPct > 0.5) signals.push('High Equity');

  if (signals.length === 0) signals.push('Active Listing');

  const criticalSignals = ['Pre-Foreclosure', 'Expired Listing'];
  const highSignals = ['Absentee Owner', 'High Equity', 'Price Reduced'];
  const hasCritical = signals.some(s => criticalSignals.some(cs => s.includes(cs)));
  const hasHigh = signals.some(s => highSignals.some(hs => s.includes(hs)));

  const priority = hasCritical ? 'critical' : hasHigh ? 'high' : 'medium';
  return { signals, priority };
}

export async function scanDistressedProperties(
  targetZips?: string[],
  distressFilters?: string[],
  minEquity?: number,
): Promise<{ properties: DistressedProperty[]; source: string }> {
  const apiKey = process.env.RENTCAST_API_KEY;

  if (!apiKey) {
    console.log("🏠 PROPERTY RADAR: No RENTCAST_API_KEY — no data available");
    return { properties: [], source: "no_api_key" };
  }

  const zips = targetZips?.length ? targetZips : ['33901'];
  const allProperties: DistressedProperty[] = [];

  for (const zip of zips.slice(0, 5)) {
    try {
      console.log(`🏠 PROPERTY RADAR: Querying RentCast for zip ${zip}...`);
      const response = await axios.get('https://api.rentcast.io/v1/listings/sale', {
        params: {
          zipCode: zip,
          propertyType: 'Single Family',
          limit: 20,
        },
        headers: {
          accept: 'application/json',
          'X-Api-Key': apiKey,
        },
        timeout: 15000,
      });

      const listings = Array.isArray(response.data) ? response.data : [];
      console.log(`🏠 PROPERTY RADAR: RentCast returned ${listings.length} listings for ${zip}`);

      for (const prop of listings) {
        const estimatedValue = prop.price || prop.assessedValue || 0;
        const estimatedEquity = Math.round(estimatedValue * (prop.ownerOccupied === false ? 0.45 : 0.30));
        const { signals, priority } = classifyDistress(prop);

        if (minEquity && estimatedEquity < minEquity) continue;

        if (distressFilters?.length) {
          const hasMatch = signals.some(s =>
            distressFilters.some(f => s.toLowerCase().includes(f.toLowerCase()))
          );
          if (!hasMatch) continue;
        }

        const fullAddress = typeof prop.addressLine1 === 'string'
          ? prop.addressLine1
          : `${prop.formattedAddress || prop.address || 'Unknown'}`;

        allProperties.push({
          id: `rc-${prop.id || prop.mlsId || `${zip}-${allProperties.length}`}`,
          address: fullAddress,
          city: prop.city || '',
          state: prop.state || '',
          zip: prop.zipCode || zip,
          ownerName: prop.ownerName || 'On File',
          ownerPhone: prop.ownerPhone || null,
          propertyType: prop.propertyType || 'Single Family',
          estimatedValue,
          estimatedEquity,
          distressSignals: signals,
          priority,
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    } catch (error: any) {
      console.error(`🏠 PROPERTY RADAR: RentCast error for zip ${zip}:`, error?.message || error);
    }
  }

  console.log(`🏠 PROPERTY RADAR: Total ${allProperties.length} properties after filtering`);
  return { properties: allProperties, source: "rentcast_live" };
}

export function calculateDealMetrics(estimatedValue: number, estimatedEquity: number) {
  if (!estimatedValue || estimatedValue <= 0) {
    return { arv: 0, maxOffer: 0, assignmentFee: 0, potentialProfit: 0, equityPercentage: 0 };
  }
  const maxOffer = Math.round(estimatedValue * 0.7);
  const assignmentFee = Math.round(estimatedValue * 0.05);
  const potentialProfit = estimatedEquity - (estimatedValue - maxOffer);

  return {
    arv: estimatedValue,
    maxOffer,
    assignmentFee,
    potentialProfit: Math.max(potentialProfit, assignmentFee),
    equityPercentage: Math.round((estimatedEquity / estimatedValue) * 100),
  };
}
