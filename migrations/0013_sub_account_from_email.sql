-- Task #140: Per-account sender email
-- Adds a nullable from_email column on sub_accounts so each business can
-- configure its own verified SendGrid sender. When NULL, sendEmail falls
-- back to the platform-level SENDGRID_FROM_EMAIL.

ALTER TABLE sub_accounts
  ADD COLUMN IF NOT EXISTS from_email text;
