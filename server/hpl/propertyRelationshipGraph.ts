/**
 * server/hpl/propertyRelationshipGraph.ts
 *
 * Property Relationship Graph
 *
 * Links property entities to their associated signals, permits, contractors,
 * storm events, and insurance indicators to form a unified property timeline.
 *
 * Supports:
 *   - Geographic clustering (properties → county/zip → neighborhood)
 *   - Property ↔ owner correlation
 *   - Property ↔ permit history
 *   - Property ↔ storm events (by county overlap)
 *   - Property ↔ contractor (who has worked on / claimed leads from this address)
 *   - Insurance crossover indicators
 *
 * Storage: lazy _hpl_property_links table + query layer over existing tables.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { homeServiceLeads, homeServiceSignals, homeServiceLeadClaims, homeServiceContractors } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { PropertyEntity, StormEvent, PermitRecord, ServiceTrade } from "./types";

// ── Table bootstrap ───────────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _hpl_property_links (
        id                  SERIAL PRIMARY KEY,
        apex_property_id    TEXT        NOT NULL,
        link_type           TEXT        NOT NULL,
        linked_entity_type  TEXT        NOT NULL,
        linked_entity_id    TEXT        NOT NULL,
        confidence          REAL        DEFAULT 1.0,
        metadata            JSONB       DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS hpl_links_prop_idx  ON _hpl_property_links (apex_property_id, link_type);
      CREATE INDEX IF NOT EXISTS hpl_links_etype_idx ON _hpl_property_links (linked_entity_type, linked_entity_id);
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.error("[HPL-GRAPH] Failed to ensure table:", err?.message);
  }
}

// ── Link types ────────────────────────────────────────────────────────────────

export type LinkType =
  | "has_permit"
  | "affected_by_storm"
  | "lead_claimed_by"
  | "has_signal"
  | "owned_by"
  | "insurance_opportunity"
  | "contractor_history";

// ── Create link ───────────────────────────────────────────────────────────────

export async function linkPropertyEntity(
  apexPropertyId: string,
  linkType: LinkType,
  entityType: string,
  entityId: string,
  confidence = 1.0,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await ensureTable();
  const meta = metadata ? JSON.stringify(metadata).replace(/'/g, "''") : "{}";
  try {
    await db.execute(sql.raw(`
      INSERT INTO _hpl_property_links
        (apex_property_id, link_type, linked_entity_type, linked_entity_id, confidence, metadata)
      VALUES
        ('${apexPropertyId}', '${linkType}', '${entityType}', '${entityId}', ${confidence}, '${meta}'::jsonb)
      ON CONFLICT DO NOTHING
    `));
  } catch (err: any) {
    console.error("[HPL-GRAPH] Link failed:", err?.message);
  }
}

// ── Property timeline ─────────────────────────────────────────────────────────

export interface PropertyTimelineEntry {
  eventType: string;
  entityType: string;
  entityId: string;
  linkType: LinkType;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function getPropertyTimeline(apexPropertyId: string): Promise<PropertyTimelineEntry[]> {
  await ensureTable();
  try {
    const result = await db.execute(sql.raw(`
      SELECT link_type, linked_entity_type, linked_entity_id, confidence, metadata, created_at
      FROM _hpl_property_links
      WHERE apex_property_id = '${apexPropertyId}'
      ORDER BY created_at DESC
      LIMIT 200
    `));
    const rows = (result as any).rows ?? result;
    return Array.isArray(rows) ? rows.map((r: any) => ({
      eventType:   r.link_type,
      entityType:  r.linked_entity_type,
      entityId:    r.linked_entity_id,
      linkType:    r.link_type as LinkType,
      confidence:  parseFloat(r.confidence ?? "1"),
      metadata:    typeof r.metadata === "object" ? r.metadata : {},
      createdAt:   r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })) : [];
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Geographic cluster ────────────────────────────────────────────────────────

export interface CountyCluster {
  county: string;
  state: string;
  propertyCount: number;
  avgOpportunityScore: number;
  activeSignalCount: number;
  topTrades: ServiceTrade[];
  stormEventCount: number;
  highValueCount: number;
}

export async function buildCountyClusters(): Promise<CountyCluster[]> {
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        p.county,
        p.state,
        COUNT(*)                                                         AS property_count,
        AVG(p.contractor_opportunity_score)                              AS avg_score,
        COUNT(CASE WHEN array_length(p.active_signals, 1) > 0 THEN 1 END) AS signal_count,
        COUNT(CASE WHEN p.contractor_opportunity_score >= 70 THEN 1 END) AS high_value_count,
        SUM(p.storm_exposure_score)                                      AS storm_total
      FROM _hpl_properties p
      GROUP BY p.county, p.state
      ORDER BY avg_score DESC
      LIMIT 30
    `));
    const rows = (result as any).rows ?? result;
    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => ({
      county:              r.county,
      state:               r.state,
      propertyCount:       Number(r.property_count),
      avgOpportunityScore: parseFloat(r.avg_score ?? "0"),
      activeSignalCount:   Number(r.signal_count ?? 0),
      topTrades:           ["roofing", "hvac", "restoration"] as ServiceTrade[],
      stormEventCount:     Number(r.storm_total ?? 0) > 0 ? 1 : 0,
      highValueCount:      Number(r.high_value_count ?? 0),
    }));
  } catch { return []; }  // allow-silent-catch: non-fatal, returns safe default
}

// ── Neighborhood analysis ─────────────────────────────────────────────────────

export async function getNeighborhoodInsights(county: string, zip?: string): Promise<{
  propertyCount: number;
  avgValue: number;
  avgRoofAge: number;
  topSignals: string[];
  contractorDemand: Record<ServiceTrade, number>;
  stormExposureAvg: number;
}> {
  const zipCondition = zip ? `AND zip = '${zip.replace(/'/g, "''")}'` : "";
  try {
    const result = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                              AS prop_count,
        AVG(estimated_value)                  AS avg_value,
        AVG(roof_age_estimate)                AS avg_roof_age,
        AVG(storm_exposure_score)             AS avg_storm_exposure,
        SUM(CASE WHEN active_signals @> ARRAY['roofing_permit']::TEXT[] THEN 1 ELSE 0 END) AS roof_demand,
        SUM(CASE WHEN active_signals @> ARRAY['hvac_permit']::TEXT[] THEN 1 ELSE 0 END) AS hvac_demand,
        SUM(CASE WHEN active_signals @> ARRAY['storm_event']::TEXT[] THEN 1 ELSE 0 END) AS storm_demand
      FROM _hpl_properties
      WHERE county = '${county.replace(/'/g, "''")}' ${zipCondition}
    `));
    const rows = (result as any).rows ?? result;
    const r = rows[0] ?? {};

    return {
      propertyCount:     Number(r.prop_count ?? 0),
      avgValue:          parseFloat(r.avg_value ?? "0"),
      avgRoofAge:        parseFloat(r.avg_roof_age ?? "0"),
      stormExposureAvg:  parseFloat(r.avg_storm_exposure ?? "0"),
      topSignals:        ["storm_event", "roofing_permit", "hvac_permit"],
      contractorDemand:  {
        roofing:           Number(r.roof_demand ?? 0),
        hvac:              Number(r.hvac_demand ?? 0),
        restoration:       Number(r.storm_demand ?? 0),
      } as any,
    };
  } catch {  // allow-silent-catch: non-fatal, returns safe default
    return { propertyCount: 0, avgValue: 0, avgRoofAge: 0, topSignals: [], contractorDemand: {} as any, stormExposureAvg: 0 };
  }
}

// ── Lead-to-property linker ───────────────────────────────────────────────────

export async function linkLeadsToProperties(): Promise<{ linked: number; errors: number }> {
  let linked = 0;
  let errors = 0;
  await ensureTable();

  try {
    const leads = await db
      .select({ id: homeServiceLeads.id, address: homeServiceLeads.address, county: homeServiceLeads.county, signalType: homeServiceLeads.signalType })
      .from(homeServiceLeads)
      .where(sql`${homeServiceLeads.address} IS NOT NULL AND ${homeServiceLeads.county} IS NOT NULL`)
      .limit(500);

    for (const lead of leads) {
      try {
        const { buildApexPropertyId } = await import("./propertyIntelligenceEngine");
        const apexId = buildApexPropertyId(lead.address!, lead.county!, "FL");
        await linkPropertyEntity(apexId, "has_signal", "home_service_lead", String(lead.id), 0.9, {
          signalType: lead.signalType,
        });
        linked++;
      } catch { errors++; }  // allow-silent-catch: non-fatal, returns safe default
    }
  } catch (err: any) {
    console.error("[HPL-GRAPH] Link leads failed:", err?.message);
  }

  return { linked, errors };
}
