import type { IndustryKnowledge } from "./cognitiveTypes";

const KNOWLEDGE_BASE: Record<string, IndustryKnowledge> = {
  "personal_injury": {
    industry: "Personal Injury Law",
    leadStrategies: [
      "Crash report monitoring via Sentinel geofence",
      "Google Ads targeting accident-related keywords",
      "Hospital and tow yard geofencing",
      "Referral network automation",
    ],
    conversionBenchmarks: { "lead_to_consult": 0.35, "consult_to_signed": 0.25, "target_response_time_sec": 60 },
    bestChannels: ["sms", "phone", "google_ads"],
    seasonalTrends: ["Holiday weekends see spikes in accidents", "Winter months increase slip-and-fall cases"],
    commonWorkflows: [
      "Crash detected → Immediate SMS → Vapi call within 60s",
      "New lead → Auto-response → Schedule consultation",
      "Missed call → Text-back within 30s",
    ],
    avgResponseTimeBenchmark: 60,
    tips: [
      "Firms that respond within 60 seconds convert 3x more crash leads",
      "SMS outperforms email for initial contact in PI",
      "Follow-up within 24 hours doubles retention rate",
    ],
  },
  "real_estate": {
    industry: "Real Estate",
    leadStrategies: [
      "Facebook/Instagram lead ads for listings",
      "Open house follow-up automation",
      "Zillow and Realtor.com lead import",
      "Neighborhood farming campaigns",
    ],
    conversionBenchmarks: { "lead_to_showing": 0.15, "showing_to_offer": 0.30, "target_response_time_sec": 300 },
    bestChannels: ["sms", "email", "facebook_ads"],
    seasonalTrends: ["Spring is peak buying season", "Year-end sees motivated sellers"],
    commonWorkflows: [
      "New listing inquiry → Auto-response → Schedule showing",
      "Open house attendee → Follow-up sequence → CRM pipeline",
      "Price drop alert → Notify interested buyers",
    ],
    avgResponseTimeBenchmark: 300,
    tips: [
      "Agents who follow up within 5 minutes are 21x more likely to qualify a lead",
      "Drip campaigns over 30 days keep leads warm",
      "Video tours in SMS get 3x engagement",
    ],
  },
  "roofing": {
    industry: "Roofing",
    leadStrategies: [
      "Storm damage geo-targeted ads",
      "Google Local Service Ads",
      "Door-to-door follow-up automation",
      "Insurance claim assistance marketing",
    ],
    conversionBenchmarks: { "lead_to_estimate": 0.40, "estimate_to_job": 0.30, "target_response_time_sec": 180 },
    bestChannels: ["sms", "phone", "google_ads"],
    seasonalTrends: ["Post-storm periods create surge demand", "Spring and fall are peak seasons"],
    commonWorkflows: [
      "Storm alert → Targeted ad campaign → Lead capture",
      "Estimate request → Auto-response → Schedule inspection",
      "Job complete → Review request → Referral incentive",
    ],
    avgResponseTimeBenchmark: 180,
    tips: [
      "Speed-to-lead matters — first roofer on-site wins 70% of jobs",
      "Before/after photos in follow-up increase close rate",
      "Insurance assistance messaging converts better than price messaging",
    ],
  },
  "med_spa": {
    industry: "Med Spa",
    leadStrategies: [
      "Instagram beauty transformation ads",
      "Google Ads for specific treatments",
      "Referral and loyalty program automation",
      "Seasonal promotion campaigns",
    ],
    conversionBenchmarks: { "lead_to_consult": 0.25, "consult_to_treatment": 0.60, "target_response_time_sec": 600 },
    bestChannels: ["instagram", "sms", "email"],
    seasonalTrends: ["Holiday season drives gift card sales", "Summer increases body contouring demand"],
    commonWorkflows: [
      "Inquiry → Consultation booking → Appointment reminder",
      "Treatment complete → Follow-up → Review request",
      "Abandoned booking → Re-engagement sequence",
    ],
    avgResponseTimeBenchmark: 600,
    tips: [
      "Before/after galleries drive the highest engagement",
      "SMS appointment reminders reduce no-shows by 40%",
      "Loyalty programs increase repeat visits by 25%",
    ],
  },
  "home_services": {
    industry: "Home Services",
    leadStrategies: [
      "Google Local Service Ads",
      "Nextdoor community marketing",
      "Seasonal maintenance reminders",
      "Review-driven referral campaigns",
    ],
    conversionBenchmarks: { "lead_to_estimate": 0.35, "estimate_to_job": 0.45, "target_response_time_sec": 120 },
    bestChannels: ["sms", "phone", "google_ads"],
    seasonalTrends: ["HVAC peaks in summer/winter", "Plumbing emergencies spike in winter"],
    commonWorkflows: [
      "Service request → Auto-response → Dispatch scheduling",
      "Job complete → Invoice → Review request",
      "Seasonal reminder → Maintenance offer → Booking",
    ],
    avgResponseTimeBenchmark: 120,
    tips: [
      "Same-day response wins 80% of home service jobs",
      "Review volume is the #1 factor for Google Local ranking",
      "Maintenance plans create predictable recurring revenue",
    ],
  },
  "legal": {
    industry: "Legal Services",
    leadStrategies: ["Google Ads for practice areas", "Content marketing and SEO", "Referral network automation"],
    conversionBenchmarks: { "lead_to_consult": 0.30, "consult_to_retained": 0.35, "target_response_time_sec": 300 },
    bestChannels: ["phone", "sms", "google_ads"],
    seasonalTrends: ["Tax season drives demand for tax attorneys", "New Year increases family law inquiries"],
    commonWorkflows: [
      "Inquiry → Qualification questions → Consultation scheduling",
      "Consultation complete → Retainer agreement → Onboarding",
    ],
    avgResponseTimeBenchmark: 300,
    tips: ["Intake speed is the strongest predictor of retention", "Empathy in first contact doubles conversion"],
  },
  "default": {
    industry: "General Business",
    leadStrategies: ["Multi-channel lead capture", "Referral programs", "Content marketing", "Paid advertising"],
    conversionBenchmarks: { "lead_to_customer": 0.20, "target_response_time_sec": 300 },
    bestChannels: ["sms", "email", "phone"],
    commonWorkflows: [
      "New lead → Auto-response → Follow-up sequence",
      "Missed call → Text-back → Scheduling",
      "Customer → Review request → Referral ask",
    ],
    avgResponseTimeBenchmark: 300,
    tips: [
      "Responding within 5 minutes increases conversion by 10x",
      "Multi-channel follow-up outperforms single-channel",
      "Automation frees time for high-value conversations",
    ],
  },
};

const INDUSTRY_ALIASES: Record<string, string> = {
  "personal injury": "personal_injury",
  "pi": "personal_injury",
  "attorney": "personal_injury",
  "lawyer": "legal",
  "law firm": "legal",
  "real estate": "real_estate",
  "realtor": "real_estate",
  "realty": "real_estate",
  "roofing": "roofing",
  "roofer": "roofing",
  "med spa": "med_spa",
  "medspa": "med_spa",
  "medical spa": "med_spa",
  "aesthetics": "med_spa",
  "home services": "home_services",
  "hvac": "home_services",
  "plumbing": "home_services",
  "plumber": "home_services",
  "electrician": "home_services",
  "cleaning": "home_services",
  "legal": "legal",
  "legal services": "legal",
};

export function getIndustryKnowledge(industry: string): IndustryKnowledge {
  const normalized = industry.toLowerCase().trim();
  const aliasKey = INDUSTRY_ALIASES[normalized] || normalized.replace(/\s+/g, "_");
  return KNOWLEDGE_BASE[aliasKey] || KNOWLEDGE_BASE["default"];
}

export function getAvailableIndustries(): string[] {
  return Object.keys(KNOWLEDGE_BASE).filter(k => k !== "default");
}

export function getResponseTimeBenchmark(industry: string): number {
  const knowledge = getIndustryKnowledge(industry);
  return knowledge.avgResponseTimeBenchmark;
}
