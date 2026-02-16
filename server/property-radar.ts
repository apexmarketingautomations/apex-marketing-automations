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

const SAMPLE_PROPERTIES: DistressedProperty[] = [
  {
    id: "prop-001",
    address: "4821 Sahara Ave",
    city: "Las Vegas",
    state: "NV",
    zip: "89104",
    ownerName: "Robert Martinez",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 285000,
    estimatedEquity: 142000,
    distressSignals: ["Pre-Foreclosure", "Tax Lien"],
    priority: "critical",
    lat: 36.1435,
    lng: -115.1781,
  },
  {
    id: "prop-002",
    address: "1922 Charleston Blvd",
    city: "Las Vegas",
    state: "NV",
    zip: "89104",
    ownerName: "Linda Chen",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 195000,
    estimatedEquity: 87000,
    distressSignals: ["Vacant", "Code Violation"],
    priority: "high",
    lat: 36.1585,
    lng: -115.1687,
  },
  {
    id: "prop-003",
    address: "7340 Smoke Ranch Rd",
    city: "Las Vegas",
    state: "NV",
    zip: "89128",
    ownerName: "James Thompson",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 340000,
    estimatedEquity: 210000,
    distressSignals: ["Probate", "Deferred Maintenance"],
    priority: "high",
    lat: 36.2012,
    lng: -115.2534,
  },
  {
    id: "prop-004",
    address: "3015 Tropicana Ave",
    city: "Las Vegas",
    state: "NV",
    zip: "89121",
    ownerName: "Patricia Davis",
    ownerPhone: null,
    propertyType: "Duplex",
    estimatedValue: 410000,
    estimatedEquity: 195000,
    distressSignals: ["Expired Listing", "High Equity"],
    priority: "medium",
    lat: 36.1011,
    lng: -115.1182,
  },
  {
    id: "prop-005",
    address: "5601 Boulder Hwy",
    city: "Las Vegas",
    state: "NV",
    zip: "89122",
    ownerName: "Michael Johnson",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 165000,
    estimatedEquity: 112000,
    distressSignals: ["Tax Lien", "Divorce Filing", "Vacant"],
    priority: "critical",
    lat: 36.1152,
    lng: -115.0628,
  },
  {
    id: "prop-006",
    address: "920 E Desert Inn Rd",
    city: "Las Vegas",
    state: "NV",
    zip: "89109",
    ownerName: "Sandra Williams",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 225000,
    estimatedEquity: 165000,
    distressSignals: ["Pre-Foreclosure", "Absentee Owner"],
    priority: "critical",
    lat: 36.1281,
    lng: -115.1492,
  },
  {
    id: "prop-007",
    address: "2780 S Maryland Pkwy",
    city: "Las Vegas",
    state: "NV",
    zip: "89109",
    ownerName: "David Brown",
    ownerPhone: null,
    propertyType: "Condo",
    estimatedValue: 155000,
    estimatedEquity: 72000,
    distressSignals: ["Expired Listing", "Price Reduced 3x"],
    priority: "medium",
    lat: 36.1367,
    lng: -115.1379,
  },
  {
    id: "prop-008",
    address: "4102 W Flamingo Rd",
    city: "Las Vegas",
    state: "NV",
    zip: "89103",
    ownerName: "Karen Wilson",
    ownerPhone: null,
    propertyType: "Single Family",
    estimatedValue: 375000,
    estimatedEquity: 248000,
    distressSignals: ["Probate", "Estate Sale", "Vacant"],
    priority: "critical",
    lat: 36.1152,
    lng: -115.1962,
  },
];

export async function scanDistressedProperties(targetZips?: string[], distressFilters?: string[], minEquity?: number): Promise<{ properties: DistressedProperty[]; source: string }> {
  let properties = [...SAMPLE_PROPERTIES];

  if (targetZips && targetZips.length > 0) {
    properties = properties.filter(p => targetZips.includes(p.zip));
  }

  if (distressFilters && distressFilters.length > 0) {
    properties = properties.filter(p =>
      p.distressSignals.some(signal =>
        distressFilters.some(filter => signal.toLowerCase().includes(filter.toLowerCase()))
      )
    );
  }

  if (minEquity && minEquity > 0) {
    properties = properties.filter(p => p.estimatedEquity >= minEquity);
  }

  const count = Math.min(properties.length, Math.floor(Math.random() * 3) + 2);
  const shuffled = properties.sort(() => 0.5 - Math.random()).slice(0, count);

  return { properties: shuffled, source: "simulated" };
}

export function calculateDealMetrics(estimatedValue: number, estimatedEquity: number) {
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
