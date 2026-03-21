CREATE TABLE IF NOT EXISTS "webhook_delivery_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "webhook_id" integer NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "sub_account_id" integer NOT NULL REFERENCES "sub_accounts"("id"),
  "target_url" text NOT NULL,
  "event_type" text NOT NULL,
  "status_code" integer,
  "response_body" text,
  "latency_ms" integer,
  "success" boolean NOT NULL,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_wdl_webhook_id" ON "webhook_delivery_logs" ("webhook_id");
CREATE INDEX IF NOT EXISTS "idx_wdl_sub_account" ON "webhook_delivery_logs" ("sub_account_id");
CREATE INDEX IF NOT EXISTS "idx_wdl_created_at" ON "webhook_delivery_logs" ("created_at");
