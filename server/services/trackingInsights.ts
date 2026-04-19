// ---------------------------------------------------------------------------
// Insight engine.
//
// Pure, deterministic translator from raw card metrics + behavior aggregates
// into human-readable, color-coded insights for the client dashboard. No I/O
// here — keeps it trivial to unit-test and safe to call on every request.
//
// Future hooks (NOT implemented yet):
//   - AI recommendation rewrites
//   - cross-client benchmark comparisons
//   - CTA optimization suggestions
//   - campaign comparison narratives
// ---------------------------------------------------------------------------

export type InsightType = "positive" | "warning" | "opportunity";

export interface Insight {
  type: InsightType;
  message: string;
  // Stable identifier so the UI can dedupe / animate without depending on copy.
  code: string;
}

export interface InsightInput {
  taps: number;
  qrScans: number;
  uniqueVisitors: number;
  repeatVisitors: number;
  identifiedVisitors: number;
  leads: number;
  bookedCalls: number;
  conversionRate: number;
  repeatRate: number;
  peakHours: number[];
  sessionDepth: number;
  // Optional trend signal — when provided, drives the "more visitors are
  // being identified" insight. The caller computes this against a prior
  // window so the engine itself stays stateless.
  identifiedDelta?: number;
}

const SESSION_DEPTH_THRESHOLD = 3; // events per visit
const REPEAT_RATE_HIGH = 0.25;
const CONVERSION_RATE_LOW = 0.1;
const TRAFFIC_NO_CONVERT_TAPS = 30;

function formatHours(hours: number[]): string {
  if (!hours.length) return "";
  const fmt = (h: number) => {
    const suffix = h >= 12 ? "PM" : "AM";
    const display = ((h + 11) % 12) + 1;
    return `${display}${suffix}`;
  };
  if (hours.length === 1) return fmt(hours[0]);
  return hours.map(fmt).join(" & ");
}

export function generateInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const totalEntry = input.taps + input.qrScans;

  // Engagement quality — repeat visitors signal real interest.
  if (input.repeatRate > REPEAT_RATE_HIGH && input.uniqueVisitors >= 3) {
    insights.push({
      type: "positive",
      code: "repeat_engagement",
      message: "Repeat visitors are highly engaged and more likely to convert.",
    });
  }

  // Traffic without conversion — most actionable warning.
  if (totalEntry > TRAFFIC_NO_CONVERT_TAPS && input.leads === 0) {
    insights.push({
      type: "warning",
      code: "traffic_no_convert",
      message: "Your card is getting attention but not converting. Review your landing page.",
    });
  }

  // Conversion-rate floor (only meaningful once we have at least some traffic
  // — telling someone with 4 visitors their rate is "low" is noise).
  if (input.uniqueVisitors >= 10 && input.conversionRate < CONVERSION_RATE_LOW && input.leads > 0) {
    insights.push({
      type: "warning",
      code: "low_conversion",
      message: "Your conversion rate is low. Consider optimizing your CTA or offer.",
    });
  }

  // Peak hours — schedule-actionable insight.
  if (input.peakHours.length > 0 && totalEntry >= 10) {
    insights.push({
      type: "opportunity",
      code: "peak_hours",
      message: `Most engagement happens around ${formatHours(input.peakHours)}. Prioritize availability during this time.`,
    });
  }

  // Identification trend — surfaced when caller supplied a positive delta.
  if (typeof input.identifiedDelta === "number" && input.identifiedDelta > 0 && input.identifiedVisitors > 0) {
    insights.push({
      type: "positive",
      code: "identification_growth",
      message: "More visitors are being identified. Your follow-up system is working.",
    });
  }

  // Session depth — multi-section exploration signals interest.
  if (input.sessionDepth > SESSION_DEPTH_THRESHOLD && input.uniqueVisitors >= 3) {
    insights.push({
      type: "positive",
      code: "deep_sessions",
      message: "Visitors are exploring multiple sections. Interest level is high.",
    });
  }

  // Booked calls win — celebrate-and-extend.
  if (input.bookedCalls > 0 && input.leads > 0) {
    const bookRate = input.bookedCalls / Math.max(input.leads, 1);
    if (bookRate > 0.3) {
      insights.push({
        type: "positive",
        code: "strong_booking_rate",
        message: "Leads are converting to booked calls at a strong rate. Keep your follow-up cadence.",
      });
    }
  }

  return insights;
}
