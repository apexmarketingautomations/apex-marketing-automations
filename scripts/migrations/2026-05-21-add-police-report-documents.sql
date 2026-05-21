BEGIN;

CREATE TABLE IF NOT EXISTS police_report_documents (
  id                     SERIAL PRIMARY KEY,
  sub_account_id         INTEGER NOT NULL REFERENCES sub_accounts(id),
  official_report_number TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PENDING',
  source                 TEXT NOT NULL DEFAULT 'local_agent',
  storage_mode           TEXT NOT NULL DEFAULT 'local_uploads',
  storage_path           TEXT,
  file_name              TEXT,
  mime_type              TEXT,
  sha256                 TEXT,
  byte_size              INTEGER,
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  last_attempt_at        TIMESTAMP,
  next_attempt_at        TIMESTAMP,
  fetched_at             TIMESTAMP,
  locked_at              TIMESTAMP,
  locked_by              TEXT,
  error_log              TEXT,
  metadata               JSONB,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS police_report_documents_sub_account_official_uniq
  ON police_report_documents(sub_account_id, official_report_number);

CREATE INDEX IF NOT EXISTS police_report_documents_status_idx
  ON police_report_documents(status);

CREATE INDEX IF NOT EXISTS police_report_documents_next_attempt_idx
  ON police_report_documents(next_attempt_at);

ALTER TABLE crash_reports
  ADD COLUMN IF NOT EXISTS police_report_document_id INTEGER REFERENCES police_report_documents(id);

CREATE INDEX IF NOT EXISTS crash_reports_police_report_document_id_idx
  ON crash_reports(police_report_document_id);

COMMIT;
