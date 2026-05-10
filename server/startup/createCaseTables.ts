/**
 * createCaseTables.ts
 * Creates intelligence_entities, intelligence_cases, case_signals
 * if they don't exist. Safe to run every boot (IF NOT EXISTS).
 */
import pg from "pg";

export async function createCaseTables(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS intelligence_entities (
        id              SERIAL PRIMARY KEY,
        canonical_name  TEXT NOT NULL,
        normalized_key  TEXT NOT NULL UNIQUE,
        entity_type     TEXT NOT NULL DEFAULT 'company',
        domain          TEXT,
        address         TEXT,
        county          TEXT,
        state           TEXT DEFAULT 'FL',
        aliases         JSONB NOT NULL DEFAULT '[]',
        profile_data    JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS intelligence_cases (
        id                   SERIAL PRIMARY KEY,
        entity_id            INTEGER NOT NULL REFERENCES intelligence_entities(id) ON DELETE CASCADE,
        case_key             TEXT NOT NULL UNIQUE,
        title                TEXT NOT NULL,
        category             TEXT NOT NULL,
        incident_window      TEXT NOT NULL,
        signal_count         INTEGER NOT NULL DEFAULT 0,
        latest_signal_at     TIMESTAMPTZ,
        opportunity_score    INTEGER NOT NULL DEFAULT 0,
        urgency_score        INTEGER NOT NULL DEFAULT 0,
        financial_score      INTEGER NOT NULL DEFAULT 0,
        outreach_viability   INTEGER NOT NULL DEFAULT 0,
        consumer_impact      INTEGER NOT NULL DEFAULT 0,
        legal_severity       INTEGER NOT NULL DEFAULT 0,
        local_relevance      INTEGER NOT NULL DEFAULT 0,
        composite_score      INTEGER NOT NULL DEFAULT 0,
        actionable           BOOLEAN NOT NULL DEFAULT FALSE,
        ai_summary           TEXT,
        outreach_angle       TEXT,
        recommended_vertical TEXT,
        status               TEXT NOT NULL DEFAULT 'open',
        operator_notes       TEXT,
        source_links         JSONB NOT NULL DEFAULT '[]',
        affected_products    JSONB NOT NULL DEFAULT '[]',
        timeline             JSONB NOT NULL DEFAULT '[]',
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS case_signals (
        id           SERIAL PRIMARY KEY,
        case_id      INTEGER NOT NULL REFERENCES intelligence_cases(id) ON DELETE CASCADE,
        signal_id    INTEGER NOT NULL,
        signal_table TEXT NOT NULL,
        signal_type  TEXT NOT NULL,
        detected_at  TIMESTAMPTZ,
        summary      TEXT,
        source_url   TEXT,
        added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ic_entity_idx    ON intelligence_cases(entity_id);
      CREATE INDEX IF NOT EXISTS ic_score_idx     ON intelligence_cases(composite_score);
      CREATE INDEX IF NOT EXISTS ic_actionable_idx ON intelligence_cases(actionable);
      CREATE INDEX IF NOT EXISTS cs_case_idx      ON case_signals(case_id);
    `);
    console.log("[CASE-TABLES] intelligence_entities / intelligence_cases / case_signals ready");
  } catch (err: any) {
    console.error("[CASE-TABLES] Failed to create tables:", err?.message);
  } finally {
    client.release();
    await pool.end();
  }
}
