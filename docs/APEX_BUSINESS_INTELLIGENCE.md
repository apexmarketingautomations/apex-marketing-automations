# APEX BUSINESS INTELLIGENCE
**Niche Vertical Opportunity Scoring**
Version: 1.0 | Generated: 2026-05-15
Phase: 6 (Planned)

---

## Purpose

Business Intelligence converts regulatory and administrative signals — DBPR license changes, building permits, business inspections, Yelp/Google review spikes, and code enforcement actions — into scored, territory-matched opportunities for niche vertical operators.

This system serves home service contractors, roofers, restoration companies, salons, gyms, and other businesses that profit from knowing when a competitor is struggling, a neighborhood is being redeveloped, or a business is newly licensed.

Business signals are never promoted into the personal injury CRM. They route to a separate vertical operator layer.

---

## Vertical Signal Types

| Signal | Source | Vertical | Opportunity |
|--------|--------|----------|-------------|
| Roofing permit | County permit APIs | Roofing / restoration | Job in progress nearby |
| Building permit (residential) | County permit APIs | Remodeling / HVAC | Homeowner spending |
| DBPR new license | Florida DBPR | Competitive intel | New competitor opened |
| DBPR license suspension | Florida DBPR | Competitive intel | Competitor in trouble |
| Code enforcement action | County portals | Restoration / repair | Compliance repair needed |
| Health inspection failure | County health dept | Restaurant / food service | Compliance gap |
| Review spike (negative) | Google Maps API | Reputation management | Opportunity to pitch |
| Review spike (positive) | Google Maps API | Referral / partnership | High performer to partner |
| Business opening | SOS / Yelp / Google | All verticals | New prospect entering market |
| Storm event | NWS / NOAA | Restoration / roofing | Post-storm demand surge |

---

## Current State

**`home_service_signals`** — permit activity and DBPR licensing events (variable volume).

Problems:
1. No scoring or classification
2. Not linked to territory intelligence
3. No operator-facing view
4. No ICP (Ideal Customer Profile) matching per client vertical

---

## Business Signal Requirements

### 1. Permit Clustering

Individual permits in the same geography and time window should be clustered into a single opportunity:

```sql
CREATE TABLE permit_clusters (
  id SERIAL PRIMARY KEY,
  cluster_type VARCHAR(100) NOT NULL,      -- 'roofing_cluster', 'hvac_cluster'
  county VARCHAR(100),
  zip_code VARCHAR(20),
  lat_center REAL,
  lng_center REAL,
  radius_km REAL DEFAULT 0.5,
  time_window_start DATE,
  time_window_end DATE,
  permit_count INTEGER DEFAULT 1,
  total_valuation BIGINT,                  -- in cents
  dominant_trade VARCHAR(100),             -- most common permit type in cluster
  opportunity_score NUMERIC(4,3),
  territory_id INTEGER REFERENCES territories(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE home_service_signals
  ADD COLUMN IF NOT EXISTS permit_cluster_id INTEGER REFERENCES permit_clusters(id),
  ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS vertical VARCHAR(100);
```

### 2. Business Opportunity Scoring

Each business signal receives an opportunity score based on vertical-specific factors:

**Roofing opportunity score:**
| Factor | Weight | Scoring |
|--------|--------|---------|
| Permit count in cluster | 30% | >10 permits = 1.0, 5–9 = 0.6, 1–4 = 0.3 |
| Permit valuation | 20% | >$50K total = high |
| Storm event in same area | 25% | Storm within 14 days = +0.30 bonus |
| Territory match | 15% | In active roofing contractor territory |
| Recency | 10% | Permits filed within 7 days = max score |

**DBPR license suspension score:**
| Factor | Weight | Notes |
|--------|--------|-------|
| License category | 40% | Contractor / trade license vs. cosmetic |
| Active customer count estimate | 30% | Derived from business size data |
| Geographic density | 20% | Suspended license + active territory |
| Competitor proximity | 10% | Are you in the same market? |

### 3. ICP Matching

Each sub-account in a business vertical defines its Ideal Customer Profile:

```sql
CREATE TABLE vertical_icp_configs (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  vertical VARCHAR(100) NOT NULL,           -- 'roofing', 'hvac', 'salon', 'gym'
  min_opportunity_score NUMERIC(4,3) DEFAULT 0.50,
  signal_types TEXT[],                      -- which signal types to receive
  min_permit_valuation BIGINT,              -- minimum job size in cents
  county_filter TEXT[],                     -- restrict to these counties
  zip_filter TEXT[],                        -- restrict to these ZIPs
  max_daily_leads INTEGER DEFAULT 20,       -- throttle per sub-account per day
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. Business Opportunity Routing

```
BusinessSignal received
  → normalize and compute opportunity_score
  → cluster with nearby permits (if applicable)
  → match against vertical_icp_configs
  → route to matching sub-accounts
  → create lead record in business_opportunities table
  → emit business_opportunity_created event
```

### 5. Business Opportunities Table

```sql
CREATE TABLE business_opportunities (
  id BIGSERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  signal_type VARCHAR(100) NOT NULL,
  vertical VARCHAR(100),
  
  -- Geography
  county VARCHAR(100),
  zip_code VARCHAR(20),
  address TEXT,
  lat REAL,
  lng REAL,
  territory_id INTEGER REFERENCES territories(id),
  
  -- Signal details
  business_name VARCHAR(500),
  license_number VARCHAR(100),
  permit_number VARCHAR(100),
  signal_date DATE,
  
  -- Scoring
  opportunity_score NUMERIC(4,3),
  icp_match_score NUMERIC(4,3),
  cluster_id INTEGER REFERENCES permit_clusters(id),
  
  -- Lifecycle
  status VARCHAR(50) DEFAULT 'new',        -- new, contacted, converted, dead
  contacted_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_business_opps_sub_account ON business_opportunities(sub_account_id, opportunity_score DESC, created_at DESC);
CREATE INDEX idx_business_opps_territory ON business_opportunities(territory_id, status, signal_date DESC);
```

---

## Storm Event Integration

Storm events are the highest-value trigger for roofing and restoration verticals:

**Storm signal processing:**
```
NWS/NOAA storm event received (Phase 6 connector)
  → Identify affected counties (storm track + radius)
  → Find all active roofing/restoration sub-accounts in those counties
  → Pull recent permit clusters in those counties
  → Boost opportunity_score for all clusters in storm-affected area
  → Create storm_event_alert for all matching sub-accounts
  → Emit storm_opportunity_spike event
```

**Storm opportunity query:**
```sql
SELECT po.*, ic.permit_count, ic.total_valuation
FROM business_opportunities po
JOIN permit_clusters ic ON po.cluster_id = ic.id
WHERE po.county = ANY($stormCounties)
  AND po.signal_date >= $stormDate - INTERVAL '14 days'
  AND po.opportunity_score >= 0.60
ORDER BY po.opportunity_score DESC;
```

---

## Business Intelligence UI (Phase 6)

### Opportunity Feed

- Shows all `business_opportunities` for the sub-account's vertical
- Grouped by: county → opportunity type → score
- Columns: Type, County/ZIP, Business Name, Score, Cluster Size, Date, Status
- Quick filters: Storm Opportunities, High Score, New This Week, Permits Only

### Opportunity Detail

- Signal source and raw data
- Cluster map (permit locations within 0.5km)
- ICP match breakdown
- Contact information (business owner if resolved)
- Competitor context (other businesses in same area)
- Actions: Contact, Assign, Convert, Archive

---

## Phase 6 Deliverables (Business Intelligence)

- [ ] `permit_clusters` table + clustering algorithm
- [ ] `vertical_icp_configs` table + admin UI
- [ ] `business_opportunities` table + routing pipeline
- [ ] DBPR ingestion connector (Phase 6 — refresh existing)
- [ ] County permit API connectors (Orange, Hillsborough, Pinellas)
- [ ] Storm event connector (NWS / NOAA)
- [ ] Business opportunity scoring (deterministic, vertical-specific)
- [ ] ICP matching engine
- [ ] `GET /api/business-opportunities` endpoint
- [ ] Opportunity feed UI (vertical operator view)
- [ ] Storm event alerting
