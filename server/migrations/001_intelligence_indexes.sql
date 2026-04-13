-- Apex Intelligence: additive-only index migration
-- Safe: CREATE INDEX IF NOT EXISTS — no destructive changes

-- universal_events indexes
CREATE INDEX IF NOT EXISTS ue_event_type_idx ON universal_events (event_type);
CREATE INDEX IF NOT EXISTS ue_account_idx ON universal_events (account_id);
CREATE INDEX IF NOT EXISTS ue_sub_account_idx ON universal_events (sub_account_id);
CREATE INDEX IF NOT EXISTS ue_contact_idx ON universal_events (contact_id);
CREATE INDEX IF NOT EXISTS ue_occurred_idx ON universal_events (occurred_at);

-- entity_identity_map indexes
CREATE INDEX IF NOT EXISTS eim_entity_lookup ON entity_identity_map (account_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS eim_linked_lookup ON entity_identity_map (account_id, linked_entity_type, linked_entity_id);

-- entity_activity_rollups indexes
CREATE INDEX IF NOT EXISTS ear_lookup ON entity_activity_rollups (account_id, entity_type, entity_id, metric_name);
CREATE INDEX IF NOT EXISTS ear_period_idx ON entity_activity_rollups (period_type, period_start);

-- intelligence_scores indexes
CREATE INDEX IF NOT EXISTS is_lookup ON intelligence_scores (account_id, entity_type, entity_id, score_type);
CREATE INDEX IF NOT EXISTS is_band_idx ON intelligence_scores (score_band);

-- intelligence_recommendations indexes
CREATE INDEX IF NOT EXISTS ir_lookup ON intelligence_recommendations (account_id, status, priority);
CREATE INDEX IF NOT EXISTS ir_entity_idx ON intelligence_recommendations (entity_type, entity_id);

-- integration_health_state indexes
CREATE INDEX IF NOT EXISTS ihs_lookup ON integration_health_state (account_id, integration_type, integration_key);

-- execution_timeline indexes
CREATE INDEX IF NOT EXISTS et_lookup ON execution_timeline (account_id, created_at);
CREATE INDEX IF NOT EXISTS et_entity_idx ON execution_timeline (related_entity_type, related_entity_id);

-- Add FK constraints that drizzle-kit may have skipped
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'universal_events_account_id_sub_accounts_id_fk') THEN
    ALTER TABLE universal_events ADD CONSTRAINT universal_events_account_id_sub_accounts_id_fk
      FOREIGN KEY (account_id) REFERENCES sub_accounts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'universal_events_sub_account_id_sub_accounts_id_fk') THEN
    ALTER TABLE universal_events ADD CONSTRAINT universal_events_sub_account_id_sub_accounts_id_fk
      FOREIGN KEY (sub_account_id) REFERENCES sub_accounts(id) ON DELETE CASCADE;
  END IF;
END $$;
