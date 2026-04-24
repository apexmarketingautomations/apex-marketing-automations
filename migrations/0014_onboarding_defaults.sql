-- Operator-editable templates seeded into every new sub-account.
-- Single-row table (id = 1). Falls back to in-code defaults when missing.
CREATE TABLE IF NOT EXISTS "onboarding_defaults" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "pipeline_stages" jsonb,
  "workflows" jsonb,
  "brand_voice_system_prompt" text,
  "welcome_sms_body" text,
  "updated_at" timestamp DEFAULT now(),
  "updated_by_user_id" text
);
