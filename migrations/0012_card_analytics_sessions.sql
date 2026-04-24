-- Task #146: Digital card lead intelligence — per-visitor sessions table
-- and session-aware fields on the existing event log.

ALTER TABLE card_analytics_events
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS scroll_depth integer,
  ADD COLUMN IF NOT EXISTS time_on_page integer;

CREATE TABLE IF NOT EXISTS card_analytics_sessions (
  id serial PRIMARY KEY,
  session_id text NOT NULL UNIQUE,
  card_id integer NOT NULL REFERENCES digital_cards(id),
  visitor_id text,
  referrer text,
  user_agent text,
  device_type text,
  browser text,
  country text,
  region text,
  ip_hash text,
  started_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  total_time_ms integer NOT NULL DEFAULT 0,
  max_scroll_depth integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  return_visit boolean NOT NULL DEFAULT false,
  intent_score integer NOT NULL DEFAULT 0,
  lead_tier text NOT NULL DEFAULT 'cold'
);

CREATE INDEX IF NOT EXISTS idx_card_analytics_sessions_card_id
  ON card_analytics_sessions(card_id);
CREATE INDEX IF NOT EXISTS idx_card_analytics_sessions_visitor
  ON card_analytics_sessions(card_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_card_analytics_events_session
  ON card_analytics_events(session_id);
