-- Migration: Add is_protected column to sub_accounts and meta_messaging_2027 feature flag
-- UP

ALTER TABLE sub_accounts ADD COLUMN IF NOT EXISTS is_protected boolean DEFAULT false;

UPDATE sub_accounts SET is_protected = true WHERE id IN (22, 13);

INSERT INTO feature_flags (feature_name, enabled, description)
VALUES ('meta_messaging_2027', false, 'Meta Messaging 2027 product layer - controls access to /api/meta-messaging/product/* routes')
ON CONFLICT (feature_name) DO NOTHING;
