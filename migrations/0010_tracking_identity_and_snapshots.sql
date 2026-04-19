-- Tracking subsystem Phase 2: identity stitching + per-card snapshot.
--
-- Adds identity columns to tracking_visits (contact_id, email_hash,
-- phone_hash, identified_at, is_repeat) plus indexes, and creates the
-- card_intelligence_snapshots table used by GET /api/track/analytics/cards/:id.

ALTER TABLE tracking_visits
  ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS phone_hash TEXT,
  ADD COLUMN IF NOT EXISTS identified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_repeat BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS tv_contact_idx ON tracking_visits(contact_id);
CREATE INDEX IF NOT EXISTS tv_email_hash_idx ON tracking_visits(email_hash);
CREATE INDEX IF NOT EXISTS tv_phone_hash_idx ON tracking_visits(phone_hash);

CREATE TABLE IF NOT EXISTS card_intelligence_snapshots (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL UNIQUE REFERENCES digital_cards(id) ON DELETE CASCADE,
  sub_account_id INTEGER REFERENCES sub_accounts(id) ON DELETE CASCADE,
  taps INTEGER NOT NULL DEFAULT 0,
  qr_scans INTEGER NOT NULL DEFAULT 0,
  page_views INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  form_starts INTEGER NOT NULL DEFAULT 0,
  lead_submits INTEGER NOT NULL DEFAULT 0,
  booked_calls INTEGER NOT NULL DEFAULT 0,
  qualified_leads INTEGER NOT NULL DEFAULT 0,
  closed_sales INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  repeat_visitors INTEGER NOT NULL DEFAULT 0,
  identified_visitors INTEGER NOT NULL DEFAULT 0,
  tap_to_lead_rate REAL NOT NULL DEFAULT 0,
  click_to_lead_rate REAL NOT NULL DEFAULT 0,
  lead_to_sale_rate REAL NOT NULL DEFAULT 0,
  total_revenue REAL NOT NULL DEFAULT 0,
  avg_attribution_confidence REAL NOT NULL DEFAULT 0,
  first_event_at TIMESTAMP,
  last_event_at TIMESTAMP,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cis_card_idx ON card_intelligence_snapshots(card_id);
CREATE INDEX IF NOT EXISTS cis_sub_account_idx ON card_intelligence_snapshots(sub_account_id);
