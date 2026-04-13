-- Autonomy Layer: autonomy_actions + autonomy_policy_rules
-- Additive migration only — no drops, no force

CREATE TABLE IF NOT EXISTS "autonomy_actions" (
  "id" serial PRIMARY KEY,
  "account_id" integer NOT NULL REFERENCES "sub_accounts"("id") ON DELETE CASCADE,
  "action_type" text NOT NULL,
  "action_category" text NOT NULL,
  "target_module" text,
  "target_entity_type" text,
  "target_entity_id" text,
  "safety_class" text NOT NULL,
  "confidence_score" real NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'proposed',
  "reason" text,
  "explanation" text,
  "prepared_payload" jsonb,
  "execution_result" jsonb,
  "rollback_payload" jsonb,
  "created_by_system" boolean NOT NULL DEFAULT true,
  "depends_on_action_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "executed_at" timestamp,
  "resolved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "aa_account_status_idx" ON "autonomy_actions" ("account_id", "status");
CREATE INDEX IF NOT EXISTS "aa_safety_class_idx" ON "autonomy_actions" ("safety_class");
CREATE INDEX IF NOT EXISTS "aa_action_type_idx" ON "autonomy_actions" ("action_type");
CREATE INDEX IF NOT EXISTS "aa_created_at_idx" ON "autonomy_actions" ("created_at");

CREATE TABLE IF NOT EXISTS "autonomy_policy_rules" (
  "id" serial PRIMARY KEY,
  "action_type" text NOT NULL UNIQUE,
  "default_safety_class" text NOT NULL,
  "requires_external_auth" boolean NOT NULL DEFAULT false,
  "requires_payment" boolean NOT NULL DEFAULT false,
  "is_destructive" boolean NOT NULL DEFAULT false,
  "is_reversible" boolean NOT NULL DEFAULT true,
  "max_confidence_for_auto_exec" real NOT NULL DEFAULT 0.85,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "apr_action_type_idx" ON "autonomy_policy_rules" ("action_type");
CREATE INDEX IF NOT EXISTS "apr_active_idx" ON "autonomy_policy_rules" ("active");
