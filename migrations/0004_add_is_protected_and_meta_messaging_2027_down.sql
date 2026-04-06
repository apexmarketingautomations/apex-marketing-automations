-- Migration ROLLBACK: Remove is_protected column and meta_messaging_2027 feature flag
-- DOWN

DELETE FROM feature_flags WHERE feature_name = 'meta_messaging_2027';

UPDATE sub_accounts SET is_protected = false WHERE id IN (22, 13);

ALTER TABLE sub_accounts DROP COLUMN IF EXISTS is_protected;
