# Stage 4A — OCR Orchestration Architecture
**Apex Marketing OS | OCR Infrastructure Foundation**
**Status:** FOUNDATION ONLY — NOT ACTIVATED
**Authored:** 2026-05-15
**Depends on:** Stage 3 (pgvector, 21 operational tables), Stage 4A Queue Architecture (BullMQ + Upstash Redis)
**Activation gate:** Phase 4A infrastructure complete (Redis, BullMQ, workers, observability)
**Full activation:** Phase 4B after 30-day stability observation
**Manual activation:** Feature flag `OCR_WORKER_ENABLED=true`

---

## 1. OCR Activation Status

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STATUS: FOUNDATION ONLY — NOT ACTIVATED                                │
│                                                                         │
│  Current:  Build queue architecture, provider interfaces, storage       │
│            abstraction, and DB schema. No OCR API calls are made.       │
│                                                                         │
│  Gate:     Phase 4A infrastructure complete                             │
│            (Redis connected, BullMQ queues live, DLQ operational,       │
│             Sentry active, Axiom draining logs)                         │
│                                                                         │
│  Phase 4B: Activate with OCR_WORKER_ENABLED=true at 50 docs/day cap.   │
│            Raise to 200/day after 7-day stability window.              │
│                                                                         │
│  Toggle:   env var OCR_WORKER_ENABLED=true in Railway                  │
│            (also check DB flag: feature_flags.ocr_worker_enabled)      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. What "Foundation Only" Means

This document describes infrastructure to build now so OCR activation is safe later. Every component listed below has a clear boundary between "build now" and "activate later."

| Component | Build Now | Activate Later | Notes |
|---|---|---|---|
| Queue architecture (`apex-ocr`) | YES | — | Defined in STAGE_4A_QUEUE_ARCHITECTURE.md, concurrency 2, 200 jobs/hr |
| Worker interfaces | YES | — | No-op handlers that check `OCR_WORKER_ENABLED` flag first |
| Storage abstraction (`documentStorage.ts`) | YES | — | R2 upload/download wrappers, key generation |
| Provider abstraction classes | YES | — | `GoogleDocAIProvider`, `TextractProvider` with stub `extract()` methods |
| DB schema | YES | — | Already designed in APEX_DOCUMENT_INTELLIGENCE.md; tables exist |
| Cost guard (`ocrCostGuard.ts`) | YES | — | Redis counters ready; will enforce limits once Redis is live |
| Error classification | YES | — | Error codes defined; retry/DLQ routing configured in BullMQ |
| OCR API calls to Google Document AI | NO | Phase 4B | Blocked by `OCR_WORKER_ENABLED` flag |
| OCR API calls to AWS Textract | NO | Phase 4B | Blocked by `OCR_WORKER_ENABLED` flag + missing `AWS_ACCESS_KEY_ID` |
| Entity extraction at scale | NO | Phase 4B | Blocked by flag; LLM calls are no-ops until flag is set |
| Contact resolution from documents | NO | Phase 4B | Blocked; creates no contacts until flag + confidence gate |
| Embedding of extracted entities | NO | Phase 5 | Stage 3 still paused; doc embeddings are a Phase 5 concern |

**Why build the foundation first?**

The crash report worker (`server/crashReportWorker.ts`) already demonstrates the cost of activating pipelines without infrastructure: it runs setInterval-based polling with no persistence, no DLQ, no observability, and no backpressure. When Railway restarts, all in-flight FLHSMV requests silently vanish. OCR is 10× more expensive (API cost, latency, failure surface) than crash ingestion. Building the foundation before activation means every failure mode is accounted for before the first real OCR API call.

---

## 3. How This Fits the Broader Pipeline

OCR is Step 2 of the document intelligence pipeline defined in APEX_DOCUMENT_INTELLIGENCE.md. The full chain:

```
REPORT ACQUISITION
  report_acquisition_jobs
  (scheduled download, operator upload, email attachment, public record scrape)
    │
    ▼  [apex-ocr queue: document-ingest job]
DOCUMENT STORAGE
  Cloudflare R2 → apex-documents/{type}/{YYYY-MM}/{id}.pdf
  document_ingest registry (SHA256 dedup, 14-state lifecycle)
    │
    ▼  [apex-ocr queue: ocr-extract job]
OCR EXECUTION         ← NOT ACTIVATED (OCR_WORKER_ENABLED=false)
  Google Document AI (primary)
  AWS Textract (fallback)
  → document_ocr_results
    │
    ▼  [apex-ocr queue: entity-extract job]
ENTITY EXTRACTION     ← NOT ACTIVATED
  EXTRACTION_REGISTRY (regex + form_field)
  LLM extraction (Claude Sonnet 4.6 for narratives)
  → document_extracted_entities
    │
    ▼  [apex-ocr queue: evidence-link job]
EVIDENCE LINKING      ← NOT ACTIVATED
  Incident match → document_incident_links
  Contact match  → document_contact_links
  → evidence_lineage (custody chain updated)
    │
    ▼  [Phase 5: apex-embeddings]
DOCUMENT EMBEDDING    ← PHASE 5 ONLY
  embedding_store (entity_type='document')
```

The pipeline is gated at Step 2. The `document-ingest` step (download to R2 + register in DB) runs without the flag because it makes no external OCR API calls. All subsequent steps check `OCR_WORKER_ENABLED` before proceeding.

---

## 4. OCR Queue Architecture (BullMQ)

The `apex-ocr` queue is defined in the Stage 4A queue hierarchy with the following parameters. This matches the definition in `docs/STAGE_4A_QUEUE_ARCHITECTURE.md` exactly — do not redefine it:

```typescript
// server/queues/ocrQueue.ts
// Referenced from: server/queues/index.ts (Phase 4A BullMQ setup)

import { Queue, Worker, QueueEvents } from 'bullmq';
import type { RedisOptions } from 'ioredis';

// These values match STAGE_4A_QUEUE_ARCHITECTURE.md Section 3.4
export const OCR_QUEUE_CONFIG = {
  name: 'apex-ocr',
  concurrency: 2,                         // Low concurrency: OCR jobs are slow + large
  limiter: {
    max: 200,                             // 200 jobs/hour hard ceiling (API rate limit)
    duration: 3_600_000,
  },
  defaultJobOptions: {
    priority: 3,                          // Lower than routing (10) and intake (7)
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 15_000 },
    removeOnComplete: { count: 200, age: 604800 },  // Keep 7 days for audit
    removeOnFail: false,                  // Failed jobs persist for DLQ sweeper
    timeout: 600_000,                     // 10-min timeout: large PDFs can take 3-5 min
  },
};

// Job types within apex-ocr — each maps to a specific handler function
export type OcrJobType =
  | 'document-ingest'    // Download from URL or receive upload → store to R2
  | 'ocr-extract'        // Call OCR provider → store raw results
  | 'entity-extract'     // Extract entities from OCR text → normalized values
  | 'evidence-link'      // Link document to incidents + contacts
  | 'ocr-retry-failed'   // Retry with fallback provider after primary failure
  | 'ocr-backfill';      // Backfill: queue historical documents (Phase 4B only)

// Full job payload — every job type uses this same interface
export interface OcrJobPayload {
  acquisitionJobId: number;       // FK → report_acquisition_jobs.id
  documentId?: number;            // FK → document_ingest.id (set after document-ingest step)
  documentType:                   // From APEX_DOCUMENT_INTELLIGENCE.md Document Types
    | 'crash_report'
    | 'police_report'
    | 'incident_report'
    | 'intake_pdf'
    | 'insurance_doc'
    | 'legal_filing'
    | 'permit_doc'
    | 'public_record';
  storageKey: string;             // R2 key: apex-documents/{type}/{YYYY-MM}/{id}.pdf
  storageBucket: string;          // 'apex-documents'
  pageCount?: number;             // Estimated from file size; actual set after OCR
  sourceConfidence: number;       // From document_ingest.source_confidence (0.40–0.95)
  linkedIncidentId?: number;      // FK → sentinel_incidents.id if known at acquisition
  linkedContactId?: number;       // FK → contacts.id if known at acquisition
  linkedCaseId?: number;          // FK → intelligence_cases.id if known
  ocrProvider?: 'google-docai' | 'textract' | 'auto';  // 'auto' uses selectOcrProvider()
  traceId: string;                // UUID for distributed tracing across all pipeline steps
  priority: number;               // 1=fatal injury, 2=serious injury, 5=default, 10=backfill
}

// Max queue depth: reject new jobs if apex-ocr exceeds this.
// Operator must drain or the queue is in a storm state.
export const OCR_MAX_QUEUE_DEPTH = 500;

export async function enqueueOcrJob(
  queue: Queue,
  jobType: OcrJobType,
  payload: OcrJobPayload,
  options?: { delay?: number }
): Promise<string> {
  // Guard: reject if queue depth exceeded
  const waiting = await queue.getWaitingCount();
  if (waiting >= OCR_MAX_QUEUE_DEPTH) {
    throw new Error(
      `apex-ocr queue depth (${waiting}) exceeds max (${OCR_MAX_QUEUE_DEPTH}). ` +
      `Drain the queue or raise OCR_MAX_QUEUE_DEPTH.`
    );
  }

  const jobId = `${jobType}:${payload.acquisitionJobId}:${payload.traceId}`;
  await queue.add(jobType, payload, {
    ...OCR_QUEUE_CONFIG.defaultJobOptions,
    priority: payload.priority,
    jobId,   // BullMQ dedup: same jobId = ignored if already queued
    delay: options?.delay ?? 0,
  });

  return jobId;
}
```

---

## 5. Document Ingest → OCR → Extract Pipeline (Step-by-Step)

Each step is a separate BullMQ job in `apex-ocr`. A step completes by enqueueing the next step. If any step fails, BullMQ retries with exponential backoff (15s base, 3 attempts). After 3 failures the job goes to `failed` state for the DLQ sweeper.

### Step 1: document-ingest

**Trigger:** `report_acquisition_jobs` record with `status='pending'`
**Handler:** `server/ocr/handlers/documentIngestHandler.ts`
**Feature flag check:** None — this step makes no external OCR calls.

```
document-ingest
  ├── Mark acquisition_job status: 'acquiring'
  ├── Fetch document bytes:
  │     IF job_type='download': fetch(source_url) via ScrapingBee if use_proxy=true
  │     IF job_type='upload':   retrieve from temp upload location (R2 or multipart)
  ├── Validate file:
  │     - Size <= 50MB (maxFileSizeBytes)
  │     - MIME type in: application/pdf, image/tiff, image/jpeg, image/png
  │     - source_confidence >= 0.40 (minSourceConfidence)
  ├── Compute SHA256 fingerprint
  ├── Dedup check: SELECT id FROM document_ingest WHERE document_fingerprint = $hash
  │     IF found: mark acquisition_job as 'deduped', link to existing document_id, exit
  ├── Upload to Cloudflare R2:
  │     key = generateR2Key(document_type, acquisition_job_id)
  │     → apex-documents/{type}/{YYYY-MM}/{id}.pdf
  ├── INSERT INTO document_ingest (all fields, ingest_status='stored')
  ├── INSERT INTO evidence_lineage (custody_chain = [{ step:1, actor:'apex-system', action:'acquired', ... }])
  ├── Mark acquisition_job status: 'acquired', link document_id
  └── Enqueue: ocr-extract job (same traceId, documentId now set)
```

### Step 2: ocr-extract

**Trigger:** Enqueued by document-ingest step.
**Handler:** `server/ocr/handlers/ocrExtractHandler.ts`
**Feature flag check:** `OCR_WORKER_ENABLED` — if false, mark `ingest_status='queued_inactive'` and exit cleanly (no error, no retry).

```
ocr-extract
  ├── CHECK: OCR_WORKER_ENABLED env var + DB feature flag
  │     IF either is false:
  │       UPDATE document_ingest SET ingest_status='queued_inactive'
  │       console.info('[OCR] Skipping OCR: OCR_WORKER_ENABLED=false')
  │       exit with SUCCESS (no retry)
  ├── Check OCR budget (checkOcrBudget())
  │     IF daily limit reached: throw retryable error (delay until midnight)
  ├── Select OCR provider (selectOcrProvider(document_type))
  │     Primary: GoogleDocAIProvider (google-docai)
  │     Fallback: TextractProvider (textract)
  ├── Download document bytes from R2 (downloadFromR2(storage_key))
  ├── Call provider.extract(storage_key, document_type)
  │     Returns: OcrResult { rawText, pages, formFields, confidence, processingTimeMs }
  ├── INSERT INTO document_ocr_results:
  │     raw_text, pages_json, form_fields_json, provider_name, confidence,
  │     processing_time_ms, page_count
  ├── Increment Redis counter: apex:ocr:daily:docs:{YYYY-MM-DD}
  ├── UPDATE document_ingest SET ingest_status='ocr_complete', ocr_completed_at=NOW()
  ├── Append to evidence_lineage.custody_chain: { step:2, action:'ocr_extracted', provider, confidence }
  └── Enqueue: entity-extract job
```

### Step 3: entity-extract

**Trigger:** Enqueued by ocr-extract step.
**Handler:** `server/ocr/handlers/entityExtractHandler.ts`
**Feature flag check:** Inherits from ocr-extract — only reachable if OCR_WORKER_ENABLED=true.

```
entity-extract
  ├── Fetch document_ocr_results for this document_id
  ├── Run EXTRACTION_REGISTRY against raw_text + form_fields:
  │     For each entity type in ENTITY_TYPES:
  │       1. form_field extraction (highest confidence: 0.92)
  │          → check form_fields_json for known field names per document_type
  │       2. regex extraction (confidence: 0.78–0.85 depending on pattern specificity)
  │          → run compiled RegExp patterns from EXTRACTION_REGISTRY
  │       3. LLM extraction (confidence: 0.60–0.75, slowest path)
  │          → only if form_field + regex both missed the field
  │          → Claude Sonnet 4.6 (ANTHROPIC_API_KEY) for narrative fields
  │          → gpt-4o fallback if Claude unavailable
  ├── For each extracted entity:
  │     normalize(entity)          — E.164 phones, uppercase VINs, proper case names
  │     score(entity)              — assign confidence based on method + context
  │     INSERT INTO document_extracted_entities
  ├── Increment Redis counter: apex:ocr:daily:llm:{YYYY-MM-DD} (if LLM was used)
  ├── UPDATE document_ingest SET ingest_status='entities_extracted'
  ├── Append to evidence_lineage.custody_chain: { step:3, action:'entities_extracted', entity_count }
  └── Enqueue: evidence-link job
```

### Step 4: evidence-link

**Trigger:** Enqueued by entity-extract step.
**Handler:** `server/ocr/handlers/evidenceLinkHandler.ts`

```
evidence-link
  ├── Fetch all extracted entities for document_id
  ├── Incident matching (in priority order):
  │     1. incident_number_match: extracted incident_number vs sentinel_incidents.report_number
  │        → confidence threshold: 0.95 (exact match)
  │     2. location_date_match: extracted address + date vs sentinel_incidents
  │        → confidence threshold: 0.72 (fuzzy)
  │     3. crash_number_match: extracted HSMV crash# vs crash_reports.crash_number
  │        → confidence threshold: 0.98 (exact)
  │   IF match found (confidence >= threshold):
  │     INSERT INTO document_incident_links (document_id, incident_id, match_method, confidence)
  │     UPDATE sentinel_incidents SET document_count = document_count + 1
  ├── Contact matching (per person entity in extracted entities):
  │     1. Phone match: extracted phone (E.164) vs contacts.phone
  │        → confidence threshold: 0.80
  │     2. Name + date-of-birth match: extracted name + DOB vs contacts
  │        → confidence threshold: 0.75
  │   IF match found (confidence >= 0.75):
  │     INSERT INTO document_contact_links (document_id, contact_id, match_method, confidence)
  │   IF no match AND confidence >= 0.75 AND OCR confidence >= 0.70:
  │     Create new contact (source_pipeline='document_extraction')
  │     INSERT INTO document_contact_links
  ├── Case linkage (if case_id in payload OR via incident_id lookup):
  │     INSERT INTO case_evidence (case_id, document_id, evidence_type='document')
  ├── UPDATE evidence_lineage:
  │     integrity_status='verified_intact' (hash recheck)
  │     Append custody_chain: { step:4, action:'evidence_linked', incidents, contacts }
  ├── UPDATE document_ingest SET ingest_status='enriched', enriched_at=NOW()
  └── [Phase 5 hook — NOT ACTIVATED]:
      IF embedding workers active AND linked_contact_id is new:
        Enqueue: contact-embed job in apex-embeddings queue
```

---

## 6. Entity Types and Extraction Registry

The extraction registry (`server/ocr/extractionRegistry.ts`) defines patterns for all entity types relevant to Apex's document corpus. This is build-now infrastructure; pattern execution is gated by `OCR_WORKER_ENABLED`.

```typescript
// server/ocr/extractionRegistry.ts

export const ENTITY_TYPES = [
  'person_name',      // Driver, passenger, witness, officer, attorney names
  'phone',            // All phone numbers in document
  'address',          // Incident location, home address, business address
  'vehicle_vin',      // 17-character VIN (uppercase, alphanumeric)
  'vehicle_plate',    // License plate (FL: 7 chars, other states vary)
  'injury_kabco',     // KABCO scale: K(fatal), A(incapacitating), B(non-incap), C(possible), O(none)
  'insurance_policy', // Policy number + carrier name
  'fl_statute',       // Florida Statute citations (e.g., 316.183, 627.736)
  'narrative',        // Free-text narrative fields (officer narrative, witness statement)
  'incident_number',  // HSMV crash#, OPD report#, etc.
  'timestamp',        // Date and time of incident
  'agency',           // Law enforcement agency (FHP, OPD, OCSO, FHP Troop D)
  'dob',              // Date of birth (driver, occupant)
  'insurance_carrier',// Carrier name extracted from insurance doc
  'adjuster_name',    // Insurance adjuster
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

interface ExtractionPattern {
  method: 'form_field' | 'regex' | 'llm';
  fieldNames?: string[];    // Form field key names to check (form_field method)
  patterns?: RegExp[];      // Compiled regex patterns (regex method)
  baseConfidence: number;   // Confidence when this method produces a match
  normalizer?: (raw: string) => string;
}

export const EXTRACTION_REGISTRY: Record<EntityType, ExtractionPattern[]> = {
  vehicle_vin: [
    {
      method: 'form_field',
      fieldNames: ['VIN', 'Vehicle Identification Number', 'VIN Number'],
      baseConfidence: 0.92,
      normalizer: (v) => v.replace(/[^A-Z0-9]/g, '').toUpperCase().slice(0, 17),
    },
    {
      method: 'regex',
      // VIN: 17 chars, no I/O/Q, alphanumeric
      patterns: [/\b([A-HJ-NPR-Z0-9]{17})\b/g],
      baseConfidence: 0.85,
      normalizer: (v) => v.toUpperCase(),
    },
  ],
  phone: [
    {
      method: 'form_field',
      fieldNames: ['Phone', 'Telephone', 'Cell', 'Phone Number', 'Driver Phone'],
      baseConfidence: 0.92,
      normalizer: (v) => normalizeToE164(v),
    },
    {
      method: 'regex',
      patterns: [
        /\b(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
      ],
      baseConfidence: 0.80,
      normalizer: (v) => normalizeToE164(v),
    },
  ],
  injury_kabco: [
    {
      method: 'form_field',
      fieldNames: ['Injury Severity', 'Injury Code', 'KABCO', 'Injury Type'],
      baseConfidence: 0.95,
      normalizer: (v) => v.trim().toUpperCase().charAt(0),  // 'K', 'A', 'B', 'C', 'O'
    },
    {
      method: 'regex',
      // Match KABCO codes in context: "Injury: K" or "Severity: Incapacitating"
      patterns: [
        /\b(?:KABCO|Injury Severity)[:\s]+([KABCO])\b/gi,
        /\b(Fatal|Incapacitating|Non-incapacitating|Possible|No injury)\b/gi,
      ],
      baseConfidence: 0.78,
    },
  ],
  fl_statute: [
    {
      method: 'regex',
      // FL statutes: 3-3 digit pattern with optional subsections
      patterns: [
        /\b(\d{3}\.\d{3,4}(?:\(\d+\))?(?:\([a-z]\))?)\b/g,
      ],
      baseConfidence: 0.88,
    },
  ],
  narrative: [
    {
      method: 'form_field',
      fieldNames: ['Narrative', 'Officer Narrative', 'Description', 'Witness Statement'],
      baseConfidence: 0.85,
    },
    {
      method: 'llm',
      // LLM is the fallback for narrative: extract key facts from free text
      baseConfidence: 0.65,
    },
  ],
  // ... remaining entity types omitted for brevity — see APEX_OCR_PIPELINE.md
};
```

---

## 7. Provider Abstraction Layer

Two providers are defined. Neither makes actual API calls until `OCR_WORKER_ENABLED=true` and credentials are present.

```typescript
// server/ocr/providers/OcrProvider.ts

export interface OcrPage {
  pageNumber: number;
  rawText: string;
  confidence: number;
  width?: number;
  height?: number;
}

export interface FormField {
  name: string;
  value: string;
  confidence: number;
  boundingBox?: number[];
}

export interface OcrResult {
  rawText: string;           // Full concatenated text across all pages
  pages: OcrPage[];          // Per-page breakdown
  formFields: FormField[];   // Structured form key-value pairs
  confidence: number;        // Overall document confidence (0.0–1.0)
  processingTimeMs: number;
  provider: 'google-docai' | 'textract' | 'manual';
  processorId?: string;      // Google DocAI processor ID used
  tokensConsumed?: number;   // For cost tracking
}

export interface OcrProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  extract(storageKey: string, documentType: string): Promise<OcrResult>;
  getHealthStatus(): Promise<{ healthy: boolean; latencyMs: number }>;
}
```

```typescript
// server/ocr/providers/GoogleDocAIProvider.ts
// Google Document AI — primary OCR provider for structured crash/police/insurance forms.
// Form Parser processor: crash_report, intake_pdf, insurance_doc, permit_doc
// OCR Processor: police_report, legal_filing, incident_report, public_record
// Credentials: GOOGLE_APPLICATION_CREDENTIALS (service account JSON path)
// Processor IDs: GOOGLE_DOCAI_FORM_PROCESSOR_ID, GOOGLE_DOCAI_OCR_PROCESSOR_ID

export class GoogleDocAIProvider implements OcrProvider {
  name = 'google-docai';

  private getProcessorId(documentType: string): string {
    // Form Parser: structured forms with labeled fields
    const FORM_PROCESSOR_TYPES = new Set([
      'crash_report', 'intake_pdf', 'insurance_doc', 'permit_doc',
    ]);
    // OCR Processor: narrative text, mixed content, handwriting
    const OCR_PROCESSOR_TYPES = new Set([
      'police_report', 'legal_filing', 'incident_report', 'public_record',
    ]);

    if (FORM_PROCESSOR_TYPES.has(documentType)) {
      return process.env.GOOGLE_DOCAI_FORM_PROCESSOR_ID!;
    }
    if (OCR_PROCESSOR_TYPES.has(documentType)) {
      return process.env.GOOGLE_DOCAI_OCR_PROCESSOR_ID!;
    }
    // Default to OCR processor for unknown types
    return process.env.GOOGLE_DOCAI_OCR_PROCESSOR_ID!;
  }

  async isAvailable(): Promise<boolean> {
    // Must have credentials file AND feature flag enabled
    return (
      !!process.env.GOOGLE_APPLICATION_CREDENTIALS &&
      (process.env.OCR_WORKER_ENABLED === 'true' ||
       await isFeatureEnabled('ocr_worker_enabled'))
    );
  }

  async extract(storageKey: string, documentType: string): Promise<OcrResult> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'GoogleDocAI not activated. ' +
        'Set OCR_WORKER_ENABLED=true and GOOGLE_APPLICATION_CREDENTIALS in Railway.'
      );
    }
    // NOT IMPLEMENTED until Phase 4B.
    // Implementation requires: @google-cloud/documentai npm package
    // Pattern: download from R2 → base64 encode → documentai.processDocument()
    throw new Error('[OCR] GoogleDocAI extraction not yet implemented (Phase 4B).');
  }

  async getHealthStatus(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const available = await this.isAvailable();
      return { healthy: available, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
```

```typescript
// server/ocr/providers/TextractProvider.ts
// AWS Textract — fallback OCR provider.
// Used when Google Document AI is unavailable or returns < 0.60 confidence.
// Credentials: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION
// Cost: ~$1.50/1000 pages (AnalyzeDocument), ~$0.65/1000 pages (DetectDocumentText)
// NOT INTEGRATED: credentials not yet provisioned.

export class TextractProvider implements OcrProvider {
  name = 'textract';

  async isAvailable(): Promise<boolean> {
    return (
      !!process.env.AWS_ACCESS_KEY_ID &&
      !!process.env.AWS_SECRET_ACCESS_KEY &&
      (process.env.OCR_WORKER_ENABLED === 'true' ||
       await isFeatureEnabled('ocr_worker_enabled'))
    );
  }

  async extract(storageKey: string, documentType: string): Promise<OcrResult> {
    if (!(await this.isAvailable())) {
      throw new Error(
        'Textract not activated. ' +
        'Set OCR_WORKER_ENABLED=true, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in Railway.'
      );
    }
    throw new Error('[OCR] Textract extraction not yet implemented (Phase 4B).');
  }

  async getHealthStatus(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: await this.isAvailable(), latencyMs: 0 };
  }
}
```

```typescript
// server/ocr/ocrRouter.ts
// Provider selection: try primary → try fallback → throw if neither available.
// This is the single entry point for all OCR provider decisions.

import { GoogleDocAIProvider } from './providers/GoogleDocAIProvider';
import { TextractProvider } from './providers/TextractProvider';
import type { OcrProvider } from './providers/OcrProvider';

export async function selectOcrProvider(documentType: string): Promise<OcrProvider> {
  const primary = new GoogleDocAIProvider();
  const fallback = new TextractProvider();

  if (await primary.isAvailable()) {
    console.log(`[OCR-ROUTER] Using primary provider: google-docai (documentType=${documentType})`);
    return primary;
  }

  if (await fallback.isAvailable()) {
    console.warn('[OCR-ROUTER] Primary (google-docai) unavailable — using fallback: textract');
    return fallback;
  }

  throw new Error(
    'No OCR provider available. ' +
    'Check OCR_WORKER_ENABLED=true, GOOGLE_APPLICATION_CREDENTIALS, or AWS credentials.'
  );
}
```

---

## 8. Storage Abstraction

Cloudflare R2 is already configured for Apex (used by existing pipelines). The abstraction layer below isolates all storage I/O for the OCR pipeline behind typed functions, enabling a future provider swap (e.g., S3, GCS) with a one-file change.

```typescript
// server/ocr/documentStorage.ts
// All document I/O goes through this module — never call R2 SDK directly from OCR handlers.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// R2 uses S3-compatible API. Credentials set in Railway env:
// CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY
// CLOUDFLARE_R2_ENDPOINT (https://<account_id>.r2.cloudflarestorage.com)
// CLOUDFLARE_R2_BUCKET (default: 'apex-documents')

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const DEFAULT_BUCKET = process.env.CLOUDFLARE_R2_BUCKET ?? 'apex-documents';

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
  bucket: string = DEFAULT_BUCKET,
): Promise<{ url: string; bucket: string; key: string }> {
  await r2Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    // No public access — documents are private; access via signed URLs only
  }));

  // Internal reference URL — not publicly accessible
  const url = `r2://${bucket}/${key}`;
  return { url, bucket, key };
}

export async function downloadFromR2(
  key: string,
  bucket: string = DEFAULT_BUCKET,
): Promise<Buffer> {
  const response = await r2Client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  if (!response.Body) {
    throw new Error(`[R2] Empty body for key: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Key format: apex-documents/{document_type}/{YYYY-MM}/{acquisition_job_id}.{ext}
// Example:    apex-documents/crash_report/2026-05/12345.pdf
// Rationale:  Date prefix enables lifecycle rules (archive > 2 years to Infrequent Access)
//             Document type prefix enables per-type access policies
export function generateR2Key(
  documentType: string,
  acquisitionJobId: number,
  extension: string = 'pdf',
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `apex-documents/${documentType}/${year}-${month}/${acquisitionJobId}.${extension}`;
}

// Compute SHA256 fingerprint for document deduplication
// This matches the field document_ingest.document_fingerprint (VARCHAR(64))
export function computeFingerprint(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
```

---

## 9. Cost Controls and Guards

All budget enforcement relies on Redis counters (Upstash). The counters are ready when Redis is provisioned in Phase 4A. Before Redis is live, the cost guard fails open (allows all documents) with a console warning.

```typescript
// server/ocr/ocrCostGuard.ts

import { getRedisClient } from '../queues/redisClient';

// All limits configurable via Railway env vars — start conservative, raise after validation
const OCR_LIMITS = {
  maxDocsPerDay:     parseInt(process.env.OCR_DAILY_DOC_LIMIT    ?? '500'),
  maxLlmCallsPerDay: parseInt(process.env.OCR_DAILY_LLM_LIMIT    ?? '200'),
  maxPagesPerDoc:    parseInt(process.env.OCR_MAX_PAGES_PER_DOC   ?? '50'),
  minSourceConfidence: parseFloat(process.env.OCR_MIN_SOURCE_CONFIDENCE ?? '0.40'),
  maxFileSizeBytes:  parseInt(process.env.OCR_MAX_FILE_BYTES       ?? String(50 * 1024 * 1024)),
};

// Redis counter keys — TTL 48 hours ensures cleanup without a cron dependency
const redisKey = {
  docs:  (date: string) => `apex:ocr:daily:docs:${date}`,
  llm:   (date: string) => `apex:ocr:daily:llm:${date}`,
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkOcrBudget(): Promise<{ allowed: boolean; reason?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    // Redis not yet live (pre-Phase 4A). Fail open with warning.
    console.warn('[OCR-GUARD] Redis unavailable — budget enforcement disabled. Do not activate OCR_WORKER_ENABLED until Redis is live.');
    return { allowed: true };
  }

  const date = todayDate();
  const [rawDocs, rawLlm] = await redis.mget(redisKey.docs(date), redisKey.llm(date));
  const docCount = parseInt(rawDocs ?? '0');
  const llmCount = parseInt(rawLlm ?? '0');

  if (docCount >= OCR_LIMITS.maxDocsPerDay) {
    return { allowed: false, reason: `Daily doc limit reached: ${docCount}/${OCR_LIMITS.maxDocsPerDay}. Resets at midnight UTC.` };
  }
  if (llmCount >= OCR_LIMITS.maxLlmCallsPerDay) {
    return { allowed: false, reason: `Daily LLM limit reached: ${llmCount}/${OCR_LIMITS.maxLlmCallsPerDay}. Resets at midnight UTC.` };
  }

  return { allowed: true };
}

export async function recordOcrDocUsage(docCount = 1): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const date = todayDate();
  const pipeline = redis.pipeline();
  pipeline.incrby(redisKey.docs(date), docCount);
  pipeline.expire(redisKey.docs(date), 172_800);  // 48-hour TTL
  await pipeline.exec();
}

export async function recordOcrLlmUsage(callCount = 1): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const date = todayDate();
  const pipeline = redis.pipeline();
  pipeline.incrby(redisKey.llm(date), callCount);
  pipeline.expire(redisKey.llm(date), 172_800);
  await pipeline.exec();
}

// Pre-flight validation before accepting a document for ingestion
export function validateDocumentForIngest(
  sourceConfidence: number,
  fileSizeBytes: number,
  pageCount?: number,
): { valid: boolean; reason?: string } {
  if (sourceConfidence < OCR_LIMITS.minSourceConfidence) {
    return { valid: false, reason: `Source confidence ${sourceConfidence} below minimum ${OCR_LIMITS.minSourceConfidence}` };
  }
  if (fileSizeBytes > OCR_LIMITS.maxFileSizeBytes) {
    return { valid: false, reason: `File size ${fileSizeBytes} exceeds max ${OCR_LIMITS.maxFileSizeBytes} (50MB)` };
  }
  if (pageCount && pageCount > OCR_LIMITS.maxPagesPerDoc) {
    return { valid: false, reason: `Page count ${pageCount} exceeds max ${OCR_LIMITS.maxPagesPerDoc}` };
  }
  return { valid: true };
}
```

---

## 10. Error Classification

BullMQ retry behavior depends on error classification. Every error thrown by an OCR handler must be typed so the retry logic knows what to do.

```typescript
// server/ocr/ocrErrors.ts

export class OcrError extends Error {
  constructor(
    public readonly code: OcrErrorCode,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OcrError';
  }
}

export type OcrErrorCode = keyof typeof OCR_ERROR_CLASSIFICATION;

export const OCR_ERROR_CLASSIFICATION = {
  PROVIDER_UNAVAILABLE: {
    // Google DocAI / Textract returned 503 or connection refused
    retry: true,
    backoffMs: 300_000,   // Wait 5 minutes — provider may be recovering
    dlq: false,
    notify: true,         // Alert via Sentry: provider is down
    fallbackProvider: true,
  },
  QUOTA_EXCEEDED: {
    // Daily quota hit on Google DocAI project
    retry: true,
    backoffMs: 3_600_000, // Wait 1 hour — quota resets hourly or daily
    dlq: false,
    notify: true,         // Alert: set OCR_DAILY_DOC_LIMIT lower or request quota increase
    fallbackProvider: true,
  },
  DOCUMENT_CORRUPTED: {
    // SHA256 mismatch, truncated PDF, or DocAI parse error
    retry: false,
    dlq: true,            // Send to DLQ for human review
    notify: false,        // Normal operational failure — no alert needed
    fallbackProvider: false,
  },
  DOCUMENT_TOO_LARGE: {
    // File > 50MB or > 50 pages after actual inspection
    retry: false,
    dlq: true,
    notify: false,
    fallbackProvider: false,
  },
  EXTRACTION_CONFIDENCE_TOO_LOW: {
    // OCR returned < 0.40 overall confidence — document quality unusable
    retry: false,
    dlq: false,           // Don't fill DLQ with bad-quality docs — just mark and skip
    skip: true,           // UPDATE document_ingest SET ingest_status='low_confidence'
    notify: false,
  },
  PROVIDER_TIMEOUT: {
    // OCR call exceeded 600s timeout (very large PDF)
    retry: true,
    backoffMs: 60_000,
    dlq: false,
    notify: false,        // Common for large PDFs — not alertable unless persistent
    fallbackProvider: true,
  },
  BUDGET_EXHAUSTED: {
    // Daily doc or LLM limit reached
    retry: true,
    backoffMs: 0,         // Calculate delay to midnight UTC dynamically
    dlq: false,
    notify: true,         // Alert: may need to raise limits
    fallbackProvider: false,
  },
  R2_UPLOAD_FAILED: {
    // Cloudflare R2 returned error on upload
    retry: true,
    backoffMs: 30_000,
    dlq: false,
    notify: true,
  },
  DEDUP_COLLISION: {
    // Document fingerprint already exists — not an error, just informational
    retry: false,
    dlq: false,
    skip: true,
    notify: false,
  },
} as const;

// BullMQ will read this to determine retry behavior
export function isRetryableOcrError(error: unknown): boolean {
  if (error instanceof OcrError) {
    return OCR_ERROR_CLASSIFICATION[error.code]?.retry === true;
  }
  // Unknown errors: retry by default (BullMQ will apply backoff)
  return true;
}
```

---

## 11. OCR Worker Registration

The OCR worker is registered at application startup alongside other BullMQ workers. It uses the same pattern as `server/intelligence/worker.ts` (the intelligence worker that runs rollup and scoring cycles), but with BullMQ instead of the current `setInterval` + `jobQueue` approach.

```typescript
// server/ocr/ocrWorker.ts
// Registered by: server/startup/workerRegistry.ts (Phase 4A)
// Pattern: mirrors server/intelligence/worker.ts but uses BullMQ Worker class

import { Worker, type Job } from 'bullmq';
import { OCR_QUEUE_CONFIG } from './ocrQueue';
import { documentIngestHandler } from './handlers/documentIngestHandler';
import { ocrExtractHandler } from './handlers/ocrExtractHandler';
import { entityExtractHandler } from './handlers/entityExtractHandler';
import { evidenceLinkHandler } from './handlers/evidenceLinkHandler';
import type { OcrJobType, OcrJobPayload } from './ocrQueue';

const JOB_HANDLERS: Record<OcrJobType, (job: Job<OcrJobPayload>) => Promise<void>> = {
  'document-ingest':  documentIngestHandler,
  'ocr-extract':      ocrExtractHandler,
  'entity-extract':   entityExtractHandler,
  'evidence-link':    evidenceLinkHandler,
  'ocr-retry-failed': ocrExtractHandler,  // Same handler, different error context
  'ocr-backfill':     documentIngestHandler, // Backfill uses same ingest path
};

export function startOcrWorker(redisOptions: RedisOptions): Worker {
  const worker = new Worker<OcrJobPayload>(
    OCR_QUEUE_CONFIG.name,
    async (job) => {
      const handler = JOB_HANDLERS[job.name as OcrJobType];
      if (!handler) {
        throw new Error(`[OCR-WORKER] No handler for job type: ${job.name}`);
      }
      console.log(`[OCR-WORKER] Processing ${job.name} | acqJobId=${job.data.acquisitionJobId} | traceId=${job.data.traceId}`);
      await handler(job);
    },
    {
      connection: redisOptions,
      concurrency: OCR_QUEUE_CONFIG.concurrency,
      limiter: OCR_QUEUE_CONFIG.limiter,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[OCR-WORKER] Completed ${job.name} | id=${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[OCR-WORKER] Failed ${job?.name} | id=${job?.id} | err=${err.message}`);
    // Sentry capture (Phase 4A observability)
    // Sentry.captureException(err, { tags: { jobType: job?.name, traceId: job?.data?.traceId } });
  });

  console.log('[OCR-WORKER] Worker registered for apex-ocr queue (FOUNDATION ONLY — OCR_WORKER_ENABLED=false)');
  return worker;
}
```

---

## 12. Activation Checklist

An operator MUST complete all steps below before setting `OCR_WORKER_ENABLED=true` in Railway.

**Infrastructure Prerequisites**
- [ ] Phase 4A infrastructure complete: Upstash Redis connected, BullMQ queues live
- [ ] `apex-ocr` queue visible in @bull-board dashboard with 0 failed jobs
- [ ] Dead letter queue (`apex-dlq`) operational — test with a synthetic failing job
- [ ] `getRedisClient()` returns a connected client (not null) in production

**Observability Prerequisites**
- [ ] Sentry DSN set in Railway — test with `Sentry.captureMessage('OCR pre-activation test')`
- [ ] Axiom log drain active — verify documents appear in Axiom within 60 seconds of creation
- [ ] `/api/internal/queue-health` endpoint returning correct job counts for `apex-ocr`
- [ ] No unresolved Sentry errors in past 72 hours from any worker

**Google Document AI Prerequisites**
- [ ] Google Cloud project created with Document AI API enabled
- [ ] Service account created with `roles/documentai.apiUser` role
- [ ] Service account JSON key file deployed to Railway as `GOOGLE_APPLICATION_CREDENTIALS`
- [ ] `GOOGLE_DOCAI_FORM_PROCESSOR_ID` set (Form Parser processor, US region)
- [ ] `GOOGLE_DOCAI_OCR_PROCESSOR_ID` set (Document OCR processor, US region)
- [ ] Manual test: `provider.isAvailable()` returns `true` in production console

**Cloudflare R2 Prerequisites**
- [ ] R2 bucket `apex-documents` created in Cloudflare dashboard
- [ ] CORS policy configured (allow POST/GET from Railway service origin)
- [ ] `CLOUDFLARE_R2_ACCESS_KEY_ID` and `CLOUDFLARE_R2_SECRET_ACCESS_KEY` set in Railway
- [ ] `CLOUDFLARE_R2_ENDPOINT` set (format: `https://<account_id>.r2.cloudflarestorage.com`)
- [ ] Manual test: `uploadToR2(testBuffer, 'test/test.pdf', 'application/pdf')` succeeds

**Limit Configuration (Start Conservative)**
- [ ] `OCR_DAILY_DOC_LIMIT=50` (start here — raise after 7 days if stable)
- [ ] `OCR_DAILY_LLM_LIMIT=20` (Claude Sonnet calls for narrative extraction)
- [ ] `OCR_MAX_PAGES_PER_DOC=50` (default — raise if legitimate multi-page docs are rejected)

**Validation Run**
- [ ] Manually enqueue 1 `document-ingest` job with a real crash report URL
- [ ] Verify full pipeline: ingest → ocr-extract → entity-extract → evidence-link completes
- [ ] Check `document_ingest.ingest_status = 'enriched'` after pipeline completes
- [ ] Inspect `document_extracted_entities` — verify VIN, phone, KABCO extracted correctly
- [ ] Inspect `document_incident_links` — verify incident linked if crash# present
- [ ] Confirm `evidence_lineage.custody_chain` has 4 steps

**Accuracy Validation**
- [ ] Run 5 sample crash reports through pipeline (manually enqueue)
- [ ] Spot-check extracted entity confidence scores — target > 0.75 for name, phone, VIN
- [ ] Verify no false contacts created (check `document_contact_links` + `contacts` for test run)
- [ ] Verify OCR confidence score from Google DocAI > 0.70 for all 5 samples

**Clearance**
- [ ] All above boxes checked
- [ ] Sentry showing no errors from `OCR-WORKER` for 24 hours post-validation
- [ ] `checkOcrBudget()` returning `{ allowed: true }` in Redis

**Then activate:**
```bash
# In Railway dashboard → Service → Variables
OCR_WORKER_ENABLED=true
# Redeploy service
# Monitor apex-ocr queue in @bull-board for 1 hour
# Raise OCR_DAILY_DOC_LIMIT to 200 after 7-day stability window
```

---

## 13. Cross-References

| Document | Relationship |
|---|---|
| `docs/APEX_DOCUMENT_INTELLIGENCE.md` | Full DB schema: `document_ingest`, `document_ocr_results`, `document_extracted_entities`, `document_incident_links`, `document_contact_links`, `report_acquisition_jobs` |
| `docs/APEX_OCR_PIPELINE.md` | Detailed extraction patterns, confidence scoring formulas, LLM prompts |
| `docs/APEX_EVIDENCE_LINEAGE.md` | `evidence_lineage` table schema and chain-of-custody rules |
| `docs/APEX_REPORT_ACQUISITION_ARCHITECTURE.md` | Acquisition channels, ScrapingBee proxy usage, SHA256 dedup |
| `docs/STAGE_4A_QUEUE_ARCHITECTURE.md` | `apex-ocr` queue parameters (authoritative source) |
| `docs/STAGE_4A_SEMANTIC_THROTTLING.md` | Embedding of extracted entities (Phase 5 dependency) |
| `server/intelligence/worker.ts` | Pattern reference for worker registration and scoring cycle |
| `server/crashReportWorker.ts` | Pattern reference for ScrapingBee proxy usage and FLHSMV fetch |
| `server/featureFlags.ts` | `isFeatureEnabled('ocr_worker_enabled')` — DB-backed flag check |
| `server/jobQueue.ts` | Legacy queue being replaced by BullMQ in Phase 4A |
