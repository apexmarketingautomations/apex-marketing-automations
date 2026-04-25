/**
 * homeServiceLeadDelivery.ts
 *
 * Delivers qualified leads to contractors via SMS then dashboard cascade.
 * Every outcome is reported to Apex Intelligence so it can learn which
 * contractors respond fastest, which lead types get claimed, and which
 * counties have the deepest contractor networks.
 *
 * Apex emission points (fire-and-forget, cannot crash delivery):
 *   → lead_delivered   SMS sent to contractor(s)
 *   → lead_claimed     contractor claimed within the window
 *   → lead_expired     claim window elapsed unclaimed
 *   → lead_cascaded    fell through to next contractor in queue
 *   → lead_sold        lead reached max buyer count
 */

import { db } from "./db";
import {
  homeServiceContractors,
  homeServiceLeadClaims,
  homeServiceLeads,
  type HomeServiceLead,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const CLAIM_WINDOW_MS    = 15 * 60 * 1000;   // 15 minutes
const MAX_SALES_PER_LEAD = 3;

// ── Apex hook — same pattern throughout the whole system ─────────────────────

function apexReport(params: {
  action:       string;
  subject:      string;
  result:       string;
  confidence:   number;
  subAccountId: number;
  metadata:     Record<string, unknown>;
}): void {
  import("./operator/apexIntelligence")
    .then(({ reportOutcome }) =>
      reportOutcome({
        agentName:    "home-service-delivery",
        niche:        "home_services",
        action:       params.action,
        subject:      params.subject,
        result:       params.result,
        confidence:   params.confidence,
        subAccountId: params.subAccountId,
        metadata:     params.metadata,
      }),
    )
    .catch((err) => console.warn("[HOMESERVICELEADDELIVERY] promise rejected:", err instanceof Error ? err.message : err));
}

// ── SMS ───────────────────────────────────────────────────────────────────────

async function sendLeadSms(
  toPhone:    string,
  lead:       HomeServiceLead,
  claimToken: string,
): Promise<boolean> {
  try {
    const claimUrl  = `${process.env.APP_URL ?? "https://app.apexmarketingautomation.com"}/claim/${claimToken}`;
    const body      = buildSmsBody(lead, claimUrl);
    const { sendSms } = await import("./twilioClient");
    await sendSms({ to: toPhone, body });
    return true;
  } catch (err: any) {
    console.error(`[HS-DELIVERY] SMS to ${toPhone} failed: ${err.message}`);
    return false;
  }
}

/**
 * Builds a signal-specific SMS that gives the contractor exactly what they
 * need to make a split-second decision: what happened, where, how much,
 * and how long they have. Different signal types get different openers
 * because a hurricane warning is a completely different conversation than
 * a probate estate or a new homeowner.
 */
function buildSmsBody(lead: HomeServiceLead, claimUrl: string): string {
  const jobMin   = lead.estimatedJobMin ? `$${lead.estimatedJobMin.toLocaleString()}` : null;
  const jobMax   = lead.estimatedJobMax ? `$${lead.estimatedJobMax.toLocaleString()}` : null;
  const jobRange = jobMin && jobMax ? `${jobMin}–${jobMax}` : jobMin ?? jobMax ?? null;
  const addr     = lead.address ?? `${lead.county} County, FL`;
  const propVal  = lead.propertyValue
    ? `$${Math.round(lead.propertyValue / 1000)}K home` : null;
  const service  = formatCategory(lead.serviceCategories?.[0]);

  // ── Signal-specific openers ─────────────────────────────────────────────────
  let opener = "";
  let context = "";

  switch (lead.signalType) {
    case "noaa_weather_alert":
      opener  = `🚨 STORM DAMAGE LEAD — ${service.toUpperCase()}`;
      context = lead.urgency === "critical"
        ? `Active weather emergency in ${lead.county} County. Homeowners are calling NOW for emergency tarping, inspections, and repairs. Window is 24–72hrs before the big companies flood the area.`
        : `Storm activity confirmed in ${lead.county} County. Roof inspections and damage assessments needed immediately.`;
      break;

    case "code_enforcement":
      opener  = `⚠️ CODE VIOLATION LEAD — ${service.toUpperCase()}`;
      context = `County-issued violation at ${addr}. Owner is legally required to fix this — they HAVE to hire someone. High close rate, low competition.`;
      break;

    case "pre_foreclosure":
    case "lis_pendens":
      opener  = `🏚️ PRE-FORECLOSURE LEAD — ${service.toUpperCase()}`;
      context = `Lis pendens filed. Owner has 60–90 days to fix and sell or lose the property. Motivated, fast timeline, realistic budget.`;
      break;

    case "probate":
      opener  = `📜 ESTATE REHAB LEAD — ${service.toUpperCase()}`;
      context = `Probate filed on ${propVal ? `a ${propVal}` : "a property"} at ${addr}. Inherited homes need full rehab before listing. Executor is the decision maker — one call closes it.`;
      break;

    case "new_homeowner":
      opener  = `🏠 NEW HOMEOWNER LEAD — ${service.toUpperCase()}`;
      context = `Just purchased${propVal ? ` a ${propVal}` : ""} at ${addr}${lead.yearBuilt ? ` (built ${lead.yearBuilt})` : ""}. New owners spend the most in the first 90 days — they're in buying mode right now.`;
      break;

    case "permit_filing":
      opener  = `🔨 PERMIT LEAD — ${service.toUpperCase()}`;
      context = `Active ${service.toLowerCase()} permit filed at ${addr}. Neighbor activity means the whole block is in project mode. Perfect door-knock or direct mail moment.`;
      break;

    case "sinkhole_report":
      opener  = `🚨 SINKHOLE REPORT — ${service.toUpperCase()}`;
      context = `Sinkhole reported at ${addr}. Owner needs foundation assessment and repair immediately — insurance typically covers this. High ticket, urgent timeline.`;
      break;

    case "flood_zone_change":
      opener  = `🌊 FLOOD ZONE LEAD — ${service.toUpperCase()}`;
      context = `FEMA reclassified ${addr} into a higher flood zone. Owner now needs mitigation work to keep insurance. This is a compliance-driven hire — they have no choice.`;
      break;

    default:
      opener  = `⚡ ${service.toUpperCase()} LEAD — ${lead.county} County`;
      context = lead.description ?? "Qualified home service lead in your territory.";
  }

  // ── Property snapshot ───────────────────────────────────────────────────────
  const details = [
    `📍 ${addr}`,
    propVal                   ? `🏠 ${propVal}`                                     : null,
    lead.squareFootage        ? `📐 ${lead.squareFootage.toLocaleString()} sq ft`    : null,
    lead.yearBuilt            ? `📅 Built ${lead.yearBuilt}`                         : null,
    jobRange                  ? `💰 Est. job value: ${jobRange}`                     : null,
  ].filter(Boolean).join("\n");

  // ── Urgency line ────────────────────────────────────────────────────────────
  const urgencyLine = lead.urgency === "critical"
    ? `⏱ You have 15 minutes before this goes to the next contractor.`
    : `⏱ Claim within 15 min or it moves to the next contractor.`;

  return [
    opener,
    ``,
    context,
    ``,
    details,
    ``,
    urgencyLine,
    ``,
    `Claim now → ${claimUrl}`,
  ].filter(line => line !== null).join("\n");
}

// ── Contractor matching ───────────────────────────────────────────────────────

async function findMatchedContractors(lead: HomeServiceLead): Promise<{
  territory: any[];
  pool:      any[];
}> {
  const county     = lead.county ?? "";
  const categories = (lead.serviceCategories ?? []) as string[];
  const catArray   = categories.length
    ? sql`${homeServiceContractors.serviceCategories}::jsonb ?| array[${sql.join(categories.map(c => sql`${c}`), sql`, `)}]`
    : sql`true`;

  const territory = await db
    .select().from(homeServiceContractors)
    .where(and(
      eq(homeServiceContractors.active, true),
      eq(homeServiceContractors.tier, "territory"),
      sql`${homeServiceContractors.counties}::jsonb ? ${county}`,
      catArray,
    ))
    .orderBy(sql`${homeServiceContractors.score} DESC`)
    .limit(3);

  const pool = await db
    .select().from(homeServiceContractors)
    .where(and(
      eq(homeServiceContractors.active, true),
      eq(homeServiceContractors.tier, "pay_per_lead"),
      sql`${homeServiceContractors.counties}::jsonb ? ${county}`,
      catArray,
    ))
    .orderBy(sql`${homeServiceContractors.score} DESC`)
    .limit(10);

  return { territory, pool };
}

// ── Main delivery ─────────────────────────────────────────────────────────────

export async function deliverLeadToContractors(
  lead:         HomeServiceLead,
  subAccountId: number = 1,
): Promise<{ delivered: number; method: "sms" | "dashboard" | "none" }> {
  try {
    const { territory, pool } = await findMatchedContractors(lead);

    if (territory.length === 0 && pool.length === 0) {
      await db.update(homeServiceLeads)
        .set({ status: "available", deliveryMethod: "dashboard" })
        .where(eq(homeServiceLeads.id, lead.id));

      apexReport({
        action:       "lead_dashboard_only",
        subject:      lead.signalType ?? "home_service_lead",
        result:       `No matched contractors for lead ${lead.id} — published to open dashboard`,
        confidence:   0.7,
        subAccountId,
        metadata: {
          leadId: lead.id, county: lead.county,
          signalType: lead.signalType, serviceCategories: lead.serviceCategories,
        },
      });

      return { delivered: 0, method: "dashboard" };
    }

    let delivered    = 0;
    const recipients = territory.length > 0 ? territory : pool.slice(0, 3);

    for (const contractor of recipients) {
      if (delivered >= MAX_SALES_PER_LEAD) break;

      const claimToken = generateClaimToken(lead.id, contractor.id);
      const leadPrice  = territory.includes(contractor) ? null : calculateLeadPrice(lead);

      const [claim] = await db.insert(homeServiceLeadClaims).values({
        leadId:       lead.id,
        contractorId: contractor.id,
        token:        claimToken,
        tier:         territory.includes(contractor) ? "territory" : "pay_per_lead",
        status:       "pending",
        expiresAt:    new Date(Date.now() + CLAIM_WINDOW_MS),
        pricePaid:    leadPrice,
      }).returning();

      const sent = await sendLeadSms(contractor.phone, lead, claimToken);
      if (sent) {
        delivered++;

        // ── Apex: lead delivered ───────────────────────────────────────────
        apexReport({
          action:       "lead_delivered",
          subject:      lead.signalType ?? "home_service_lead",
          result:       `Lead ${lead.id} delivered via SMS to contractor ${contractor.id} (${contractor.businessName})`,
          confidence:   0.9,
          subAccountId,
          metadata: {
            leadId:         lead.id,
            contractorId:   contractor.id,
            contractorName: contractor.businessName,
            contractorTier: territory.includes(contractor) ? "territory" : "pay_per_lead",
            county:         lead.county,
            signalType:     lead.signalType,
            score:          lead.score,
            tier:           lead.scoreTier,
            leadPrice,
            estimatedJobMin: lead.estimatedJobMin,
            estimatedJobMax: lead.estimatedJobMax,
          },
        });
      }

      scheduleClaimCascade(lead, claim.id, pool, subAccountId);
    }

    if (delivered > 0) {
      await db.update(homeServiceLeads)
        .set({ status: "delivered", deliveryMethod: "sms", deliveredAt: new Date() })
        .where(eq(homeServiceLeads.id, lead.id));
    }

    return { delivered, method: delivered > 0 ? "sms" : "dashboard" };

  } catch (err: any) {
    console.error(`[HS-DELIVERY] Lead ${lead.id} error: ${err.message}`);
    return { delivered: 0, method: "none" };
  }
}

// ── Cascade ───────────────────────────────────────────────────────────────────

function scheduleClaimCascade(
  lead:         HomeServiceLead,
  claimId:      number,
  poolContractors: any[],
  subAccountId: number,
): void {
  setTimeout(async () => {
    try {
      const [claim] = await db
        .select().from(homeServiceLeadClaims)
        .where(eq(homeServiceLeadClaims.id, claimId));

      if (!claim || claim.status === "claimed") return;

      await db.update(homeServiceLeadClaims)
        .set({ status: "expired" })
        .where(eq(homeServiceLeadClaims.id, claimId));

      // ── Apex: lead expired ─────────────────────────────────────────────────
      apexReport({
        action:       "lead_expired",
        subject:      lead.signalType ?? "home_service_lead",
        result:       `Claim window expired for lead ${lead.id} — cascading`,
        confidence:   0.85,
        subAccountId,
        metadata: {
          leadId: lead.id, claimId, county: lead.county,
          signalType: lead.signalType, score: lead.score,
        },
      });

      if (poolContractors.length === 0) {
        await db.update(homeServiceLeads)
          .set({ status: "available", deliveryMethod: "dashboard" })
          .where(eq(homeServiceLeads.id, lead.id));
        return;
      }

      const next      = poolContractors[0];
      const remaining = poolContractors.slice(1);
      const token     = generateClaimToken(lead.id, next.id);
      const price     = calculateLeadPrice(lead);

      const [newClaim] = await db.insert(homeServiceLeadClaims).values({
        leadId: lead.id, contractorId: next.id, token,
        tier: "pay_per_lead", status: "pending",
        expiresAt: new Date(Date.now() + CLAIM_WINDOW_MS),
        pricePaid: price,
      }).returning();

      await sendLeadSms(next.phone, lead, token);

      // ── Apex: lead cascaded ────────────────────────────────────────────────
      apexReport({
        action:       "lead_cascaded",
        subject:      lead.signalType ?? "home_service_lead",
        result:       `Lead ${lead.id} cascaded to contractor ${next.id}`,
        confidence:   0.8,
        subAccountId,
        metadata: {
          leadId: lead.id, nextContractorId: next.id,
          nextContractorName: next.businessName,
          remainingInQueue: remaining.length,
          county: lead.county, signalType: lead.signalType,
        },
      });

      if (remaining.length > 0) {
        scheduleClaimCascade(lead, newClaim.id, remaining, subAccountId);
      }
    } catch (err: any) {
      console.error(`[HS-DELIVERY] Cascade error lead ${lead.id}: ${err.message}`);
    }
  }, CLAIM_WINDOW_MS);
}

// ── Claim handler (API route calls this when contractor taps SMS link) ────────

export async function claimLead(
  token:        string,
  contractorId: number,
  subAccountId: number = 1,
): Promise<{ success: boolean; message: string; lead?: HomeServiceLead }> {
  try {
    const [claim] = await db
      .select().from(homeServiceLeadClaims)
      .where(and(
        eq(homeServiceLeadClaims.token, token),
        eq(homeServiceLeadClaims.contractorId, contractorId),
      ));

    if (!claim)                   return { success: false, message: "Claim link not found." };
    if (claim.status === "claimed") return { success: false, message: "You already claimed this lead." };
    if (claim.status === "expired" || new Date() > claim.expiresAt) {
      await db.update(homeServiceLeadClaims).set({ status: "expired" }).where(eq(homeServiceLeadClaims.id, claim.id));
      return { success: false, message: "Claim window expired. Check the dashboard for available leads." };
    }

    const [{ salesCount }] = await db
      .select({ salesCount: sql<number>`count(*)::int` })
      .from(homeServiceLeadClaims)
      .where(and(eq(homeServiceLeadClaims.leadId, claim.leadId), eq(homeServiceLeadClaims.status, "claimed")));

    if (Number(salesCount) >= MAX_SALES_PER_LEAD) {
      return { success: false, message: "This lead has reached its maximum buyer count." };
    }

    await db.update(homeServiceLeadClaims)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(eq(homeServiceLeadClaims.id, claim.id));

    const newCount = Number(salesCount) + 1;
    if (newCount >= MAX_SALES_PER_LEAD) {
      await db.update(homeServiceLeads)
        .set({ status: "sold" })
        .where(eq(homeServiceLeads.id, claim.leadId));
    }

    const [lead] = await db
      .select().from(homeServiceLeads)
      .where(eq(homeServiceLeads.id, claim.leadId));

    // ── Apex: lead claimed ─────────────────────────────────────────────────
    apexReport({
      action:       "lead_claimed",
      subject:      lead?.signalType ?? "home_service_lead",
      result:       `Lead ${claim.leadId} claimed by contractor ${contractorId} — sale ${newCount}/${MAX_SALES_PER_LEAD}`,
      confidence:   1.0,
      subAccountId,
      metadata: {
        leadId:         claim.leadId,
        contractorId,
        claimId:        claim.id,
        tier:           claim.tier,
        pricePaid:      claim.pricePaid,
        saleNumber:     newCount,
        maxSales:       MAX_SALES_PER_LEAD,
        fullyBought:    newCount >= MAX_SALES_PER_LEAD,
        county:         lead?.county,
        signalType:     lead?.signalType,
        score:          lead?.score,
        estimatedJobMin: lead?.estimatedJobMin,
        estimatedJobMax: lead?.estimatedJobMax,
      },
    });

    if (newCount >= MAX_SALES_PER_LEAD) {
      // ── Apex: lead sold ────────────────────────────────────────────────
      apexReport({
        action:       "lead_sold",
        subject:      lead?.signalType ?? "home_service_lead",
        result:       `Lead ${claim.leadId} fully sold (${MAX_SALES_PER_LEAD}/${MAX_SALES_PER_LEAD} buyers)`,
        confidence:   1.0,
        subAccountId,
        metadata: {
          leadId:      claim.leadId,
          county:      lead?.county,
          signalType:  lead?.signalType,
          score:       lead?.score,
          totalRevenue: (claim.pricePaid ?? 0) * MAX_SALES_PER_LEAD,
        },
      });
    }

    console.log(`[HS-DELIVERY] Lead ${claim.leadId} claimed by contractor ${contractorId}`);
    return { success: true, message: "Lead claimed. Full details below.", lead };

  } catch (err: any) {
    console.error(`[HS-DELIVERY] Claim error: ${err.message}`);
    return { success: false, message: "Something went wrong. Please try again." };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calculateLeadPrice(lead: HomeServiceLead): number {
  const base: Record<string, number> = {
    noaa_weather_alert: 95, code_enforcement: 60, pre_foreclosure: 75,
    lis_pendens: 75, probate: 85, permit_filing: 45, new_homeowner: 50,
    sinkhole_report: 90, flood_zone_change: 55, short_term_rental: 40,
  };
  let price = base[lead.signalType ?? ""] ?? 45;
  if (lead.scoreTier === "A")      price *= 1.5;
  else if (lead.scoreTier === "B") price *= 1.2;
  else if (lead.scoreTier === "D") price *= 0.7;
  if ((lead.propertyValue ?? 0) > 500_000) price *= 1.3;
  return Math.round(price);
}

function generateClaimToken(leadId: number, contractorId: number): string {
  const secret = process.env.CLAIM_TOKEN_SECRET ?? "apex-hs-secret";
  return require("crypto")
    .createHmac("sha256", secret)
    .update(`${leadId}:${contractorId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 32);
}

function formatCategory(cat: string | null | undefined): string {
  const map: Record<string, string> = {
    roofing: "Roofing", hvac: "HVAC", water_damage: "Water Damage",
    pool: "Pool", solar: "Solar", foundation: "Foundation",
    general_contractor: "General Contracting", electrical: "Electrical",
    plumbing: "Plumbing", landscaping: "Landscaping", painting: "Painting",
  };
  return map[cat ?? ""] ?? "Home Services";
}
