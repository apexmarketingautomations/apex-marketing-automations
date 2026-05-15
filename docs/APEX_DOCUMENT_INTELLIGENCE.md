# APEX DOCUMENT INTELLIGENCE
**Production-Grade Report Acquisition, OCR, and Operational Intelligence**
Version: 1.0 | Generated: 2026-05-15
Phase: 5 (Architecture) → Phase 5A (Implementation)

---

## Purpose

Document Intelligence converts unstructured source documents — crash reports, police reports, insurance filings, legal documents, permits, and public records — into structured operational intelligence that feeds the Apex incident scoring, entity resolution, case intel, and contact enrichment layers.

Every real-world incident produces documents. Those documents contain the most detailed, verifiable information about who was involved, what happened, and what the consequences are. Without document intelligence, Apex captures 20–30% of what is knowable about any given incident. With it, Apex captures 80–95%.

**Current state:** The crash report worker (`crashReportWorker.ts`) fetches FLHSMV incident data as structured JSON via ScrapingBee proxy. Hillsborough reads pipe-delimited bulk files. No OCR pipeline exists. PDF police reports, insurance documents, and legal filings are not parsed at all.

---

## Document Types Supported

| Document Type | `document_type` | Primary Source | Intelligence Value |
|---------------|----------------|----------------|-------------------|
| Crash report (HSMV long form) | `crash_report` | FLHSMV API / upload | ⭐⭐⭐⭐⭐ Names, vehicles, injuries, insurance, citations |
| Police report (narrative) | `police_report` | Agency upload / PACER | ⭐⭐⭐⭐⭐ Officer narrative, witness statements |
| Incident report | `incident_report` | Agency API / upload | ⭐⭐⭐⭐ Event facts, parties involved |
| Intake PDF (client intake) | `intake_pdf` | Operator upload | ⭐⭐⭐⭐ Client-reported facts, injuries, representation |
| Insurance document | `insurance_doc` | Upload / email | ⭐⭐⭐⭐ Policy numbers, coverage, adjuster contacts |
| Legal filing | `legal_filing` | CourtListener / PACER / upload | ⭐⭐⭐⭐ Case facts, parties, attorneys |
| Permit document | `permit_doc` | County portal / upload | ⭐⭐⭐ Property, contractor, scope of work |
| Public records document | `public_record` | Government portal | ⭐⭐⭐ Verified official data |
| Medical record summary | `medical_record` | Operator upload | ⭐⭐⭐⭐⭐ Injury severity, treatment, prognosis |
| Property record | `property_record` | ATTOM / County / upload | ⭐⭐⭐ Ownership, valuation, liens |

---

## Full Architecture Flow

```
SIGNAL
  (sentinel_incidents, legal_signals, home_service_signals)
    │
    ▼
REPORT ACQUISITION QUEUE
  report_acquisition_jobs
  (scheduled download, manual upload, email attachment, public record scrape)
    │
    ▼
DOCUMENT STORAGE
  Cloudflare R2  →  document_ingest registry
  (SHA256 fingerprint dedup, signed URL, access control)
    │
    ├── [parallel]
    │
    ▼                              ▼
OCR PIPELINE                  EVIDENCE LINEAGE
document_ocr_results           evidence_lineage
(Google Document AI)           (chain of custody established at ingest)
    │
    ▼
ENTITY EXTRACTION PIPELINE
document_extracted_entities
(names, phones, addresses, vehicles, injuries, insurance, citations,
 narratives, incident numbers, timestamps, agencies)
    │
    ├── [parallel]
    │
    ▼                              ▼
INCIDENT LINKING            CONTACT RESOLUTION
document_incident_links      document_contact_links
(crash number match,         (entity → existing contact dedup
 location/date match)         → new contact creation if needed)
    │                              │
    └──────────────┬───────────────┘
                   │
                   ▼
         CASE INTEL ENRICHMENT
         case_evidence (existing)
         intelligence_cases (updated)
         (add document as evidence, re-score case)
                   │
                   ▼
         DOCUMENT EMBEDDING
         embedding_store (entity_type='document')
         (semantic search across document corpus)
                   │
                   ▼
         ROUTING / OPPORTUNITY
         (quality score updated, attorney distribution triggered)
```

---

## Database Schema

### Core Tables

```sql
-- ── Report Acquisition Queue ─────────────────────────────────────────────────

CREATE TABLE report_acquisition_jobs (
  id BIGSERIAL PRIMARY KEY,

  -- Source description
  job_type VARCHAR(50) NOT NULL,
  -- 'download'         — fetch from URL (FLHSMV, PACER, county portal)
  -- 'upload'           — operator uploaded a file via UI
  -- 'email_attachment' — inbound email attachment (via Resend/Mailgun inbound)
  -- 'public_record'    — scraped from government portal (ScrapingBee/Apify)
  -- 'api_response'     — structured data from API that contains embedded PDF

  source_type VARCHAR(100) NOT NULL,
  -- 'crash_report', 'police_report', 'incident_report', 'intake_pdf',
  -- 'insurance_doc', 'legal_filing', 'permit_doc', 'public_record'

  source_url TEXT,                      -- full URL if downloadable
  source_reference VARCHAR(500),        -- crash#, case#, permit#, HSMV number
  source_agency VARCHAR(200),           -- 'FHP', 'OPD', 'OCSO', 'FLHSMV', 'Hillsborough'
  source_jurisdiction VARCHAR(100),     -- county or district

  -- Linkage (known at acquisition time)
  incident_id INTEGER REFERENCES sentinel_incidents(id),
  legal_signal_id INTEGER REFERENCES legal_signals(id),
  case_id INTEGER REFERENCES intelligence_cases(id),
  contact_id INTEGER REFERENCES contacts(id),
  sub_account_id INTEGER REFERENCES sub_accounts(id),

  -- Queue management
  priority INTEGER DEFAULT 5,           -- 1=highest, 10=lowest
  status VARCHAR(50) DEFAULT 'pending',
  -- pending, acquiring, acquired, failed, skipped, deduped

  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_attempted_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  acquired_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_code VARCHAR(100),
  error_message TEXT,

  -- HTTP request context (for download jobs)
  http_method VARCHAR(10) DEFAULT 'GET',
  request_headers JSONB,
  request_cookies JSONB,
  use_proxy BOOLEAN DEFAULT false,      -- route through ScrapingBee
  proxy_mode VARCHAR(50),               -- 'premium', 'stealth'

  -- Result
  document_id BIGINT,                   -- FK to document_ingest after success

  -- Provenance
  requested_by VARCHAR(200),            -- 'system', user_id, pipeline name
  request_reason TEXT,                  -- why this document was requested

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_acq_jobs_status ON report_acquisition_jobs(status, priority, next_attempt_at);
CREATE INDEX idx_acq_jobs_incident ON report_acquisition_jobs(incident_id, status);
CREATE INDEX idx_acq_jobs_source_ref ON report_acquisition_jobs(source_reference) WHERE source_reference IS NOT NULL;


-- ── Document Registry ────────────────────────────────────────────────────────

CREATE TABLE document_ingest (
  id BIGSERIAL PRIMARY KEY,

  -- Deduplication
  document_fingerprint VARCHAR(64) NOT NULL UNIQUE,  -- SHA256(file_content)
  fingerprint_version INTEGER DEFAULT 1,

  -- Classification
  document_type VARCHAR(100) NOT NULL,
  document_subtype VARCHAR(100),        -- 'long_form', 'short_form', 'supplement', 'amended', 'certified'

  -- Storage
  storage_provider VARCHAR(50) DEFAULT 'cloudflare_r2',
  storage_bucket VARCHAR(200) NOT NULL,
  storage_key TEXT NOT NULL,            -- apex-documents/{doc_type}/{YYYY-MM}/{id}.{ext}
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),
  page_count INTEGER,
  original_filename TEXT,

  -- Source
  source_type VARCHAR(50) NOT NULL,
  source_url TEXT,
  source_agency VARCHAR(200),
  source_jurisdiction VARCHAR(100),
  source_reference VARCHAR(500),        -- the document's own identifier (crash#, case#)
  source_retrieved_at TIMESTAMPTZ,
  source_confidence NUMERIC(4,3) DEFAULT 0.70,
  -- 0.95: official agency API response
  -- 0.85: public government portal
  -- 0.70: proxy-scraped public record
  -- 0.60: third-party aggregator
  -- 0.50: operator upload (unverified provenance)

  -- Acquisition
  acquisition_job_id BIGINT REFERENCES report_acquisition_jobs(id),

  -- Pipeline status
  ingest_status VARCHAR(50) DEFAULT 'pending',
  -- pending → ocr_queued → ocr_processing → ocr_complete
  -- → entity_extraction_queued → entity_extraction_complete
  -- → incident_link_complete → contact_resolve_complete
  -- → embedding_queued → embedding_complete → enriched
  -- → failed | archived

  -- Processing timestamps
  ocr_completed_at TIMESTAMPTZ,
  entities_extracted_at TIMESTAMPTZ,
  incident_linked_at TIMESTAMPTZ,
  contacts_resolved_at TIMESTAMPTZ,
  embedding_created_at TIMESTAMPTZ,
  enriched_at TIMESTAMPTZ,

  -- Aggregated results
  incident_count INTEGER DEFAULT 0,
  contact_count INTEGER DEFAULT 0,
  case_count INTEGER DEFAULT 0,
  entity_count INTEGER DEFAULT 0,
  ocr_overall_confidence NUMERIC(4,3),

  -- Integrity
  content_hash VARCHAR(64),             -- recomputed periodically to verify no mutation
  content_verified BOOLEAN DEFAULT false,
  content_verified_at TIMESTAMPTZ,

  -- Sub-account scope
  sub_account_id INTEGER REFERENCES sub_accounts(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_ingest_status ON document_ingest(ingest_status, created_at DESC);
CREATE INDEX idx_document_ingest_type ON document_ingest(document_type, source_type, created_at DESC);
CREATE INDEX idx_document_ingest_source_ref ON document_ingest(source_reference) WHERE source_reference IS NOT NULL;
CREATE INDEX idx_document_ingest_sub_account ON document_ingest(sub_account_id, ingest_status, created_at DESC);


-- ── OCR Results (per page) ────────────────────────────────────────────────────

CREATE TABLE document_ocr_results (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,

  -- Provider
  ocr_provider VARCHAR(100) NOT NULL,
  -- 'google_document_ai', 'aws_textract', 'azure_document_intelligence', 'tesseract'
  processor_type VARCHAR(100),
  -- 'form_parser', 'ocr_processor', 'layout_parser', 'specialized_crash_report'
  processor_version VARCHAR(50),

  -- Text output
  raw_text TEXT,                        -- full extracted text (all words concatenated)
  structured_fields JSONB,             -- { "DRIVER1_NAME": { value: "John Smith", confidence: 0.97 }, ... }
  layout_blocks JSONB,                 -- bounding box data (for field location debugging)

  -- Quality metrics
  page_confidence NUMERIC(4,3),        -- overall OCR confidence for this page (0–1)
  word_count INTEGER,
  character_count INTEGER,
  handwriting_detected BOOLEAN DEFAULT false,
  image_quality_score NUMERIC(4,3),   -- sharpness, rotation, contrast estimate

  -- Performance
  processing_time_ms INTEGER,
  tokens_used INTEGER DEFAULT 0,       -- if LLM-assisted OCR post-processing

  -- Status
  ocr_status VARCHAR(50) DEFAULT 'pending',
  ocr_completed_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, page_number, ocr_provider)
);

CREATE INDEX idx_ocr_results_document ON document_ocr_results(document_id, page_number);
CREATE INDEX idx_ocr_results_status ON document_ocr_results(ocr_status, document_id);


-- ── Extracted Entities ────────────────────────────────────────────────────────

CREATE TABLE document_extracted_entities (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id) ON DELETE CASCADE,
  ocr_result_id BIGINT REFERENCES document_ocr_results(id),
  page_number INTEGER,

  -- Entity classification
  entity_type VARCHAR(100) NOT NULL,
  -- 'name', 'phone', 'address', 'vehicle', 'injury', 'insurance',
  -- 'citation', 'narrative', 'incident_number', 'timestamp', 'agency',
  -- 'dob', 'license_plate', 'vin', 'case_number', 'policy_number',
  -- 'attorney', 'email', 'ssn_partial'
  entity_subtype VARCHAR(100),         -- 'driver1_name', 'officer_name', 'at_fault'
  entity_role VARCHAR(100),            -- 'driver', 'victim', 'witness', 'officer', 'attorney', 'insurer'

  -- Values (immutable after write)
  raw_value TEXT NOT NULL,             -- exactly as extracted from OCR
  normalized_value TEXT,               -- after normalization
  normalized_at TIMESTAMPTZ,

  -- Confidence scoring
  extraction_confidence NUMERIC(4,3) NOT NULL,
  -- Form field: 0.90–0.98 | Regex: 0.70–0.90 | NLP: 0.65–0.85 | LLM: 0.75–0.92

  normalization_confidence NUMERIC(4,3),

  -- Extraction provenance
  extraction_method VARCHAR(50) NOT NULL,
  -- 'form_field', 'regex', 'nlp', 'llm', 'manual'
  extraction_model VARCHAR(100),        -- model name if llm or nlp
  extraction_rule VARCHAR(200),         -- rule ID if regex
  source_text TEXT,                     -- surrounding context (up to 500 chars)
  source_field VARCHAR(200),            -- form field name if form_field method

  -- Explainability (what evidence supports this extraction)
  extraction_explanation TEXT,
  -- "Field labeled 'DRIVER 1 NAME' on page 2, confidence 0.97"
  -- "Regex match: /\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/ on page 3, line 14"

  -- Human verification
  verified BOOLEAN DEFAULT false,
  verified_by VARCHAR(100),
  verified_at TIMESTAMPTZ,
  override_value TEXT,                  -- if human corrects the extraction
  override_reason TEXT,

  -- Resolution state (was this entity linked to a contact or incident?)
  resolution_status VARCHAR(50) DEFAULT 'unresolved',
  -- unresolved, resolved_existing, resolved_new, could_not_resolve
  resolved_to_contact_id INTEGER REFERENCES contacts(id),
  resolved_to_incident_id INTEGER REFERENCES sentinel_incidents(id),
  resolved_at TIMESTAMPTZ,
  resolution_confidence NUMERIC(4,3),
  resolution_method VARCHAR(50),
  -- 'exact_phone_match', 'exact_email_match', 'fuzzy_name_county', 'incident_number'

  -- Immutability
  is_superseded BOOLEAN DEFAULT false,
  superseded_by BIGINT REFERENCES document_extracted_entities(id),
  superseded_at TIMESTAMPTZ,
  superseded_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_entities_document ON document_extracted_entities(document_id, entity_type, entity_role);
CREATE INDEX idx_entities_type_value ON document_extracted_entities(entity_type, normalized_value) WHERE normalized_value IS NOT NULL;
CREATE INDEX idx_entities_contact ON document_extracted_entities(resolved_to_contact_id) WHERE resolved_to_contact_id IS NOT NULL;
CREATE INDEX idx_entities_incident ON document_extracted_entities(resolved_to_incident_id) WHERE resolved_to_incident_id IS NOT NULL;
CREATE INDEX idx_entities_unresolved ON document_extracted_entities(resolution_status, entity_type, extraction_confidence) WHERE resolution_status = 'unresolved';


-- ── Document Links ────────────────────────────────────────────────────────────

CREATE TABLE document_incident_links (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id),
  incident_id INTEGER NOT NULL REFERENCES sentinel_incidents(id),

  link_type VARCHAR(50) NOT NULL,
  -- 'primary'        — this document IS the report for this incident
  -- 'supplemental'   — additional documentation of the same incident
  -- 'corroborating'  — supports the incident record but is independent
  -- 'contradicting'  — raises a factual conflict (flag for review)

  link_confidence NUMERIC(4,3) NOT NULL,
  link_reason TEXT,
  link_method VARCHAR(50),
  -- 'incident_number_match', 'location_date_match', 'manual', 'llm_inferred'

  flagged_conflict BOOLEAN DEFAULT false,
  conflict_description TEXT,

  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(document_id, incident_id)
);

CREATE INDEX idx_doc_incident_links_incident ON document_incident_links(incident_id, link_type);
CREATE INDEX idx_doc_incident_links_document ON document_incident_links(document_id);


CREATE TABLE document_contact_links (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  entity_id BIGINT REFERENCES document_extracted_entities(id),

  role VARCHAR(100),
  role_confidence NUMERIC(4,3),
  resolution_method VARCHAR(50),

  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(document_id, contact_id, role)
);

CREATE INDEX idx_doc_contact_links_contact ON document_contact_links(contact_id);
CREATE INDEX idx_doc_contact_links_document ON document_contact_links(document_id);


-- ── Extraction Job Queue ───────────────────────────────────────────────────────

CREATE TABLE document_extraction_jobs (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id),

  job_type VARCHAR(50) NOT NULL,
  -- 'ocr'             — run OCR on all pages
  -- 'entity_extract'  — extract entities from OCR results
  -- 'llm_extract'     — LLM-assisted extraction (narratives, complex fields)
  -- 'incident_link'   — attempt to link to sentinel_incidents
  -- 'contact_resolve' — resolve extracted names/phones to contacts
  -- 'embed'           — create document embedding in embedding_store

  -- Dependencies (job DAG)
  depends_on_job_id BIGINT REFERENCES document_extraction_jobs(id),

  priority INTEGER DEFAULT 5,
  status VARCHAR(50) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  last_attempted_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_ms INTEGER,
  error_message TEXT,
  error_code VARCHAR(100),

  result_summary JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extraction_jobs_status ON document_extraction_jobs(status, priority, next_attempt_at);
CREATE INDEX idx_extraction_jobs_document ON document_extraction_jobs(document_id, job_type, status);
```

---

## Document Lifecycle States

```
pending               → document registered, jobs not yet queued
ocr_queued            → OCR jobs created, awaiting worker pickup
ocr_processing        → OCR running on one or more pages
ocr_complete          → all pages OCR'd successfully
entity_extraction_queued → extraction jobs created
entity_extraction_complete → all entities extracted and scored
incident_link_complete → document linked (or no match found)
contact_resolve_complete → all person entities resolved against contacts
embedding_queued      → embedding job created
embedding_complete    → document embedded in embedding_store
enriched              → full pipeline complete, all downstream updated
failed                → pipeline failed, error logged, retry scheduled
archived              → document retained but no longer in active pipeline
```

### State Transitions

| From | To | Trigger |
|------|-----|---------|
| pending | ocr_queued | document stored to R2 successfully |
| ocr_queued | ocr_processing | OCR worker picks up job |
| ocr_processing | ocr_complete | all pages processed |
| ocr_processing | failed | OCR fails after max_attempts |
| ocr_complete | entity_extraction_queued | orchestrator creates extraction jobs |
| entity_extraction_complete | incident_link_complete | incident linker runs (match or no-match both advance) |
| incident_link_complete | contact_resolve_complete | resolver runs |
| contact_resolve_complete | embedding_queued | embed job created |
| embedding_complete | enriched | all downstream updated |
| Any | failed | unrecoverable error |
| enriched | archived | retention policy expiry |

---

## Entity Extraction Coverage Matrix

| Entity Type | HSMV Crash Report | Police Report | Insurance Doc | Legal Filing | Permit |
|-------------|------------------|---------------|---------------|--------------|--------|
| `name` | ✅ Form field | ✅ Narrative + form | ✅ Policy holder | ✅ Party names | ✅ Owner |
| `phone` | ✅ Form field | ✅ Form field | ✅ Adjuster phone | 🟡 Sometimes | ❌ Rare |
| `address` | ✅ Form field | ✅ Form field | ✅ Insured address | ✅ Party addresses | ✅ Property |
| `vehicle` | ✅ VIN + plate + make/model | ✅ Description | ✅ Policy vehicle | 🟡 Sometimes | ❌ |
| `injury` | ✅ Injury codes + description | ✅ Narrative | 🟡 Claim type | 🟡 Alleged damages | ❌ |
| `insurance` | ✅ Form field | 🟡 Sometimes | ✅ Full policy | 🟡 Sometimes | ❌ |
| `citation` | ✅ Statute citations | ✅ Citations | ❌ | ✅ Case citations | ✅ Code refs |
| `narrative` | ✅ Officer narrative | ✅ Full narrative | 🟡 Claim notes | ✅ Complaint text | 🟡 Notes |
| `incident_number` | ✅ HSMV number | ✅ Case number | 🟡 Claim number | ✅ Docket number | ✅ Permit number |
| `timestamp` | ✅ Crash date/time | ✅ Incident time | ✅ Policy dates | ✅ Filing date | ✅ Issue date |
| `agency` | ✅ Responding agency | ✅ Department | ✅ Insurance company | ✅ Court | ✅ Issuing agency |
| `dob` | ✅ Form field | 🟡 Sometimes | ✅ Policyholder | 🟡 Sometimes | ❌ |
| `license_plate` | ✅ Form field | ✅ Form field | ✅ Registered plate | ❌ | ❌ |
| `vin` | ✅ Form field | 🟡 Sometimes | ✅ Policy vehicle | ❌ | ❌ |

---

## Integration with Existing Apex Modules

### → `sentinel_incidents`

When a crash report document is ingested and linked:
```sql
-- Update incident with document-derived data (confidence-guarded)
UPDATE sentinel_incidents SET
  persons_identified = persons_identified + (new_persons_from_doc),
  enrichment_status = 'partially_enriched'
WHERE id = $incidentId;

-- Log to incident_timeline
INSERT INTO incident_timeline (incident_id, event_type, actor, metadata)
VALUES ($id, 'document_linked', 'document_intelligence', { document_id, page_count, entities_extracted });
```

### → `contacts`

Person entities from documents feed the Entity Resolution Engine:
- Extracted name + phone/email → dedup check → `upsertContact()`
- Confidence from document extraction → `source_confidence` on contact record
- Document-derived identity NEVER overwrites verified (skip-traced) identity
- `contact_enrichment_events` records every field update from document source

### → `intelligence_cases`

Every enriching document becomes case evidence:
```sql
INSERT INTO case_evidence (case_id, evidence_type, entity_type, entity_id, title, confidence, added_by)
VALUES ($caseId, 'document', 'document_ingest', $documentId, $documentType, $sourceConfidence, 'document_intelligence');
```

### → `embedding_store`

Document text embedded for semantic retrieval:
```sql
INSERT INTO embedding_store (entity_type, entity_id, embedding_model, embedding, content_snapshot)
VALUES ('document', $documentId, 'text-embedding-3-small', $vector, $contentSummary);
```

---

## Phase 5A Implementation Targets

- [ ] `report_acquisition_jobs` table + acquisition worker
- [ ] `document_ingest` table + Cloudflare R2 upload handler
- [ ] `document_ocr_results` table + Google Document AI integration
- [ ] `document_extracted_entities` table + extraction pipeline
- [ ] `document_incident_links` + `document_contact_links` tables
- [ ] `document_extraction_jobs` queue (Inngest-orchestrated)
- [ ] `document_audit_log` table + write-on-every-state-change
- [ ] `evidence_lineage` table + chain of custody at ingest
- [ ] `POST /api/documents/upload` — operator upload endpoint
- [ ] `POST /api/documents/acquire` — queue a URL for acquisition
- [ ] `GET /api/documents/:id` — document detail with extraction results
- [ ] `GET /api/incidents/:id/documents` — documents linked to an incident
- [ ] Document list view in UI (Phase 5A UI)
