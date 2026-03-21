CREATE TABLE IF NOT EXISTS mailchimp_email_logs (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  contact_id INTEGER REFERENCES contacts(id),
  email TEXT NOT NULL,
  template_key TEXT NOT NULL,
  campaign_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  event_type TEXT NOT NULL,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS mailchimp_sync_logs (
  id SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  contact_id INTEGER REFERENCES contacts(id),
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mc_email_logs_sub ON mailchimp_email_logs(sub_account_id);
CREATE INDEX IF NOT EXISTS idx_mc_email_logs_contact ON mailchimp_email_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_mc_sync_logs_sub ON mailchimp_sync_logs(sub_account_id);
