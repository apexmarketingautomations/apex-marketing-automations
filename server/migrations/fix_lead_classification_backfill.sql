-- Idempotent backfill: fix contacts misrouted to legal_pipeline
-- Only touches system-generated records (source=legal_pipeline) where tags indicate wrong pipeline
-- Does NOT touch manually edited records

BEGIN;

-- Log counts before
DO $$
DECLARE
  home_count INTEGER;
  local_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO home_count FROM contacts 
    WHERE source = 'legal_pipeline' AND 'home_service' = ANY(tags);
  SELECT COUNT(*) INTO local_count FROM contacts 
    WHERE source = 'legal_pipeline' AND 'local_service' = ANY(tags);
  RAISE NOTICE '[BACKFILL] Contacts to fix: home_service=%, local_service=%', home_count, local_count;
END $$;

-- Fix home_service contacts incorrectly in legal_pipeline
UPDATE contacts
SET 
  source  = 'home_service_pipeline',
  channel = 'home_service'
WHERE 
  source = 'legal_pipeline'
  AND 'home_service' = ANY(tags)
  AND NOT 'manual-override' = ANY(tags);  -- preserve manual edits

-- Fix local_service contacts incorrectly in legal_pipeline  
UPDATE contacts
SET 
  source  = 'local_service_pipeline',
  channel = 'local_service'
WHERE 
  source = 'legal_pipeline'
  AND 'local_service' = ANY(tags)
  AND NOT 'manual-override' = ANY(tags);

-- Fix business_growth_signal contacts without legal tags in legal_pipeline
UPDATE contacts
SET 
  source  = 'growth_pipeline',
  channel = 'growth'
WHERE 
  source = 'legal_pipeline'
  AND 'business_growth_signal' = ANY(tags)
  AND NOT 'legal-lead' = ANY(tags)
  AND NOT 'personal_injury' = ANY(tags)
  AND NOT 'cpsc_recall' = ANY(tags)
  AND NOT 'manual-override' = ANY(tags);

-- Log counts after
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM contacts WHERE source = 'legal_pipeline';
  RAISE NOTICE '[BACKFILL] Remaining legal_pipeline contacts (true legal leads): %', remaining;
END $$;

COMMIT;
