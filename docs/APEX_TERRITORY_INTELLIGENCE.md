# APEX TERRITORY INTELLIGENCE
**Geo-Aware Routing, Territory Definitions, and Operator Assignment**
Version: 1.0 | Generated: 2026-05-15
Phase: 4D (Planned)

---

## Purpose

Territory Intelligence makes the platform geo-aware. Instead of global contact dumps, operators work within defined geographic territories. Signals, incidents, and contacts are automatically tagged to the correct territory and routed to the right operator or attorney.

Every contact, incident, and opportunity must carry a territory assignment. Every operator must work within a defined territory. Routing rules must be territory-aware.

---

## Territory Definition

A territory is a named geographic scope tied to a sub-account or operator:

```sql
CREATE TABLE territories (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  territory_name VARCHAR(200) NOT NULL,
  territory_type VARCHAR(50) NOT NULL,    -- 'county', 'zip', 'radius', 'dma', 'state'
  
  -- County-based territory
  counties TEXT[],                         -- ['Orange', 'Osceola', 'Seminole']
  
  -- ZIP-based territory
  zip_codes TEXT[],                        -- ['32801', '32802', '32803']
  
  -- Radius-based territory
  center_lat REAL,
  center_lng REAL,
  radius_km REAL,
  
  -- DMA (Designated Market Area)
  dma_code VARCHAR(20),                   -- Nielsen DMA code
  dma_name VARCHAR(200),                  -- 'Orlando-Daytona Beach-Melbourne'
  
  -- State-level
  state_code VARCHAR(5),                  -- 'FL'
  
  -- Territory metadata
  active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 5,             -- 1 = highest, lower priority yields first
  practice_areas TEXT[],                  -- ['personal_injury', 'workers_comp']
  vertical VARCHAR(100),                  -- 'pi_attorney', 'roofing', 'home_service'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_territories_sub_account ON territories(sub_account_id, active);
CREATE INDEX idx_territories_counties ON territories USING gin(counties);
CREATE INDEX idx_territories_zips ON territories USING gin(zip_codes);
```

---

## Territory Assignment

Every contact and incident must be tagged with a `territory_id` at the time of creation:

### Assignment Algorithm

```
1. Check county match: does contact.county ∈ territory.counties?
   → Direct match: assign territory
   
2. Check ZIP match: does contact.zip_code ∈ territory.zip_codes?
   → ZIP match: assign territory
   
3. Check radius match:
   distance = haversine(contact.lat, contact.lng, territory.center_lat, territory.center_lng)
   if distance <= territory.radius_km → assign territory
   
4. If multiple matches: use territory.priority to select winner
5. If no match: assign to default (sub-account's primary territory)
6. If sub-account has no territories: leave territory_id = NULL
```

### Schema Changes (Phase 4D)

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS territory_assigned_at TIMESTAMPTZ;

ALTER TABLE sentinel_incidents
  ADD COLUMN IF NOT EXISTS territory_id INTEGER REFERENCES territories(id);

CREATE INDEX idx_contacts_territory ON contacts(territory_id, export_eligible, created_at DESC);
CREATE INDEX idx_incidents_territory ON sentinel_incidents(territory_id, severity, incident_date DESC);
```

---

## Territory Summary API

The primary operator-facing territory view:

```
GET /api/territory/:id/summary

Response:
{
  territory: {
    id: 42,
    name: "Orange County — PI",
    counties: ["Orange", "Osceola"],
    vertical: "pi_attorney"
  },
  contacts: {
    total: 342,
    export_eligible: 89,
    new_today: 7,
    hot_leads: 12,         // quality_grade IN ('A+', 'A')
    needs_skip_trace: 23,  // no phone/email, individual
    enriching: 15          // skip trace in progress
  },
  incidents: {
    total: 418,
    scored_today: 31,
    high_severity: 14,     // severity_score >= 0.70
    pending_enrichment: 67
  },
  pipeline: {
    new: 45,
    enriched: 28,
    contacted: 16,
    engaged: 8,
    retained: 3
  },
  quality_breakdown: {
    "A+": 5,
    "A": 7,
    "B": 19,
    "C": 34,
    "D": 24
  }
}
```

---

## Territory-Aware Routing

The existing `contact_routing_rules` table must be extended to include territory awareness:

```sql
ALTER TABLE contact_routing_rules
  ADD COLUMN IF NOT EXISTS match_territory_id INTEGER REFERENCES territories(id),
  ADD COLUMN IF NOT EXISTS match_state VARCHAR(5),
  ADD COLUMN IF NOT EXISTS match_zip TEXT[];
```

### Routing Priority Stack

```
1. match_county = contact.county AND match_niche = contact.niche  → highest priority
2. match_county = contact.county AND match_lead_type = contact.lead_type
3. match_county = contact.county
4. match_territory_id = contact.territory_id
5. match_source_pipeline = contact.source_pipeline
6. match_lead_type = contact.lead_type
7. match_sub_account_id (default catch-all)
```

---

## Territory Heatmaps (Phase 4D)

Each territory should produce a heatmap-ready data structure showing signal density by geo-bucket:

```
GET /api/territory/:id/heatmap?entity=incidents&days=30

Response:
[
  { lat_bucket: 28.5, lng_bucket: -81.4, count: 14, max_severity: "serious" },
  { lat_bucket: 28.5, lng_bucket: -81.3, count: 9, max_severity: "moderate" },
  ...
]
```

**Heatmap SQL:**
```sql
SELECT
  ROUND(lat::numeric, 1)::float AS lat_bucket,
  ROUND(lng::numeric, 1)::float AS lng_bucket,
  COUNT(*) AS count,
  MAX(severity) AS max_severity
FROM sentinel_incidents
WHERE territory_id = $territoryId
  AND incident_date >= NOW() - INTERVAL '30 days'
GROUP BY lat_bucket, lng_bucket
ORDER BY count DESC;
```

---

## Sub-Account Territory Configuration

Sub-accounts must be able to configure their territories in the admin panel:

```
Admin → Sub-Account Settings → Territories
  → Add Territory (name, type, counties/zips/radius, practice areas)
  → Set priority order
  → Assign default territory for unmatched signals
  → View territory coverage map
```

**Validation rules:**
- A sub-account may have up to 20 territories
- Two territories in the same sub-account may not have the same county and vertical combination unless one is explicitly set as subordinate
- Every sub-account must have at least one territory or a default county assignment

---

## Territory Intelligence Tables Summary

```
territories                — territory definitions
contacts.territory_id      — contact → territory link
sentinel_incidents.territory_id — incident → territory link
contact_routing_rules.match_territory_id — routing by territory
```

---

## Phase 4D Deliverables

- [ ] `territories` table (create + seed from existing routing rules)
- [ ] `territory_id` column on contacts + backfill
- [ ] `territory_id` column on sentinel_incidents + backfill
- [ ] Territory assignment service — runs on contact/incident creation
- [ ] `GET /api/territory/:id/summary` endpoint
- [ ] `GET /api/territory/:id/heatmap` endpoint
- [ ] Admin UI: territory configuration screen
- [ ] Territory-aware routing rule matching
- [ ] `match_territory_id` column on contact_routing_rules
