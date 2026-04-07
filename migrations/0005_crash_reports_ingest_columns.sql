-- Migration: Add ingest pipeline columns to crash_reports
-- Adds: source, processed_to_lead, ingest_trace_id, raw_payload
-- UP

ALTER TABLE crash_reports ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE crash_reports ADD COLUMN IF NOT EXISTS processed_to_lead boolean NOT NULL DEFAULT false;
ALTER TABLE crash_reports ADD COLUMN IF NOT EXISTS ingest_trace_id text;
ALTER TABLE crash_reports ADD COLUMN IF NOT EXISTS raw_payload json;
