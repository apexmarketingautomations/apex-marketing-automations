-- Phase 3: high-intent flags on tracking_visits.
-- A visit becomes "high intent" when behavioral signals (repeat visit + CTA
-- engagement, or multi-session activity) indicate the visitor is actively
-- evaluating. The flag is set by sendIntentAlert() so downstream systems
-- (alerts, CRM, automations) can react without re-running detection.

ALTER TABLE tracking_visits
  ADD COLUMN IF NOT EXISTS is_high_intent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS high_intent_at timestamp,
  ADD COLUMN IF NOT EXISTS high_intent_reason text;

CREATE INDEX IF NOT EXISTS tv_high_intent_idx
  ON tracking_visits(is_high_intent)
  WHERE is_high_intent = true;
