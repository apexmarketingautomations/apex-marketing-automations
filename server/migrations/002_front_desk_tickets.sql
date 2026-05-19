-- Front desk intake tickets (hotel kiosk + AI phone agent handoff)
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS front_desk_tickets (
  id             SERIAL PRIMARY KEY,
  sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id),
  type           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  priority       TEXT NOT NULL DEFAULT 'normal',
  source         TEXT NOT NULL DEFAULT 'kiosk',
  guest_name     TEXT,
  guest_phone    TEXT,
  guest_email    TEXT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS front_desk_tickets_sub_account_id_idx
  ON front_desk_tickets(sub_account_id);

CREATE INDEX IF NOT EXISTS front_desk_tickets_created_at_idx
  ON front_desk_tickets(created_at);

