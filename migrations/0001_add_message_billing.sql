CREATE TABLE IF NOT EXISTS "message_billing" (
  "id" serial PRIMARY KEY NOT NULL,
  "sub_account_id" integer NOT NULL REFERENCES "sub_accounts"("id"),
  "message_id" integer REFERENCES "messages"("id"),
  "channel" text NOT NULL,
  "provider" text NOT NULL,
  "provider_cost" real NOT NULL DEFAULT 0,
  "billed_amount" real NOT NULL,
  "margin" real NOT NULL,
  "external_message_id" text,
  "direction" text NOT NULL DEFAULT 'outbound',
  "message_type" text NOT NULL DEFAULT 'customer',
  "billing_exempt" boolean NOT NULL DEFAULT false,
  "exempt_reason" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
