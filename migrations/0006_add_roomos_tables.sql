-- Migration: Add roomOS (Chaturbate performer tools) schema
-- Adds: cb_username, cb_goal_tokens, cb_pro_mode, cb_persona_prompt to sub_accounts
-- Creates: cb_sessions, cb_commands_fired tables

ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS cb_username text;
ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS cb_goal_tokens integer DEFAULT 500;
ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS cb_pro_mode boolean DEFAULT false;
ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS cb_persona_prompt text;

CREATE TABLE IF NOT EXISTS cb_sessions (
  id serial PRIMARY KEY,
  sub_account_id integer NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  total_tokens integer DEFAULT 0,
  goal_count integer DEFAULT 0,
  tip_count integer DEFAULT 0,
  top_tipper text,
  top_tip_amount integer DEFAULT 0,
  duration_ms integer,
  peak_viewers integer,
  commands_fired integer DEFAULT 0,
  top_command text,
  session_date timestamp DEFAULT now(),
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS cb_commands_fired (
  id serial PRIMARY KEY,
  sub_account_id integer NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
  session_id integer REFERENCES cb_sessions(id) ON DELETE SET NULL,
  category text NOT NULL,
  message_text text,
  fired_at timestamp DEFAULT now(),
  tokens_after integer,
  was_effective boolean
);
