# APEX REPORT ACQUISITION ARCHITECTURE
**Multi-Source Document Acquisition, Storage, and Queue Management**
Version: 1.0 | Generated: 2026-05-15

---

## Purpose

The Report Acquisition layer is responsible for obtaining source documents from all supported ingestion channels, storing them immutably in Cloudflare R2, and registering them in the `document_ingest` table for downstream processing. Acquisition is the first step in the document intelligence pipeline. Nothing downstream can run until acquisition succeeds.

**Acquisition must be:**
- Idempotent (same document, same SHA256 fingerprint → no duplicate)
- Lawful (only access public records through authorized channels)
- Retryable (transient failures are retried with exponential backoff)
- Auditable (every acquisition attempt logged)
- Deduplication-safe (SHA256 content hash prevents duplicate storage)

---

## Acquisition Channels

### Channel 1 — Scheduled Download (Government Portals)

Automated polling of public government data sources for known document formats.

**Primary targets:**

| Source | Document Type | Method | Frequency | Auth | Proxy |
|--------|--------------|--------|-----------|------|-------|
| FLHSMV CrashReport API | `crash_report` | REST API (JSON + PDF) | Per-incident trigger | None (public) | ScrapingBee (IP-blocked) |
| Hillsborough Clerk bulk | `legal_filing` | Pipe-delimited download | Daily | None (public) | Direct |
| PACER (Phase 5) | `legal_filing` | REST API + PDF | Weekly | Basic auth | Direct |
| CPSC recall docs | `legal_filing` | REST API | 6-hour poll | None (public) | Direct |
| County permit portals | `permit_doc` | HTTP scrape | Weekly | None (public) | ScrapingBee |

**Acquisition worker pattern:**
```typescript
// server/workers/reportAcquisitionWorker.ts

interface AcquisitionJob {
  id: bigint;
  jobType: 'download' | 'upload' | 'email_attachment' | 'public_record';
  sourceType: string;
  sourceUrl: string | null;
  sourceReference: string | null;
  incidentId: number | null;
  useProxy: boolean;
  proxyMode: 'premium' | 'stealth';
  attempts: number;
  maxAttempts: number;
}

async function processAcquisitionJob(job: AcquisitionJob): Promise<void> {
  // Step 1: Fetch the document
  const response = await fetchWithProxy(job.sourceUrl!, {
    useProxy: job.useProxy,
    proxyMode: job.proxyMode,
    timeout: 30_000,
  });

  if (!response.ok) {
    throw new AcquisitionError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }

  const fileBytes = await response.arrayBuffer();
  const fileBuffer = Buffer.from(fileBytes);

  // Step 2: Compute SHA256 fingerprint for dedup
  const fingerprint = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Step 3: Dedup check
  const existing = await db.select({ id: documentIngest.id })
    .from(documentIngest)
    .where(eq(documentIngest.documentFingerprint, fingerprint))
    .limit(1);

  if (existing.length > 0) {
    // Already have this exact document — mark job as deduped
    await markJobDeduped(job.id, existing[0].id);
    return;
  }

  // Step 4: Store to Cloudflare R2
  const storageKey = buildStorageKey(job.sourceType, job.id, response.headers.get('content-type'));
  await uploadToR2(storageKey, fileBuffer, {
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    metadata: {
      sourceUrl: job.sourceUrl ?? '',
      acquisitionJobId: job.id.toString(),
      incidentId: job.incidentId?.toString() ?? '',
    },
  });

  // Step 5: Register in document_ingest
  const [doc] = await db.insert(documentIngest).values({
    documentFingerprint: fingerprint,
    documentType: job.sourceType,
    storageProvider: 'cloudflare_r2',
    storageBucket: process.env.R2_DOCUMENTS_BUCKET!,
    storageKey,
    fileSizeBytes: fileBuffer.length,
    mimeType: detectMimeType(fileBuffer),
    sourceType: job.jobType,
    sourceUrl: job.sourceUrl,
    sourceAgency: job.sourceAgency,
    sourceReference: job.sourceReference,
    sourceRetrievedAt: new Date(),
    sourceConfidence: computeSourceConfidence(job),
    acquisitionJobId: job.id,
    ingestStatus: 'pending',
    subAccountId: job.subAccountId,
  }).returning();

  // Step 6: Establish evidence lineage immediately
  await db.insert(evidenceLineage).values({
    documentId: doc.id,
    sourceType: job.jobType,
    sourceUrl: job.sourceUrl,
    sourceAgency: job.sourceAgency,
    sourceRetrievedAt: new Date(),
    sourceHash: fingerprint,
    custodyChain: [{
      step: 1,
      actor: 'reportAcquisitionWorker',
      action: 'downloaded',
      timestamp: new Date().toISOString(),
      hash: fingerprint,
      sourceUrl: job.sourceUrl,
    }],
    isPublicRecord: job.sourceType === 'public_record',
    isOfficialAgencyDocument: isOfficialAgencySource(job.sourceAgency),
    accessMethod: job.useProxy ? 'public_website_via_proxy' : 'public_api',
    accessAuthorized: true,
  });

  // Step 7: Write audit log entry
  await db.insert(documentAuditLog).values({
    documentId: doc.id,
    eventType: 'acquired',
    actor: 'reportAcquisitionWorker',
    metadata: {
      acquisitionJobId: job.id,
      sourceUrl: job.sourceUrl,
      fileSizeBytes: fileBuffer.length,
      fingerprint,
    },
  });

  // Step 8: Queue OCR jobs
  await queueExtractionJobs(doc.id, detectPageCount(fileBuffer, doc.mimeType));

  // Step 9: Update acquisition job status
  await markJobAcquired(job.id, doc.id);
}
```

---

### Channel 2 — Operator Upload

Operators upload crash reports, police reports, intake PDFs, and insurance documents through the Apex UI. These are trusted-source documents verified by the operator.

**Upload endpoint:**
```typescript
// POST /api/documents/upload
// Multipart/form-data: file, document_type, incident_id?, sub_account_id, notes?

router.post('/upload',
  requireAuth,
  upload.single('file'),           // multer: 50MB limit, PDF + images only
  async (req, res) => {
    const { documentType, incidentId, notes } = req.body;
    const file = req.file!;

    // Validate mime type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Only PDF, PNG, JPG, TIFF accepted' });
    }

    // Compute fingerprint
    const fingerprint = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Dedup
    const existing = await db.select({ id: documentIngest.id })
      .from(documentIngest)
      .where(eq(documentIngest.documentFingerprint, fingerprint))
      .limit(1);

    if (existing.length > 0) {
      return res.json({ documentId: existing[0].id, isDuplicate: true });
    }

    // Store
    const storageKey = buildStorageKey(documentType, Date.now(), file.mimetype);
    await uploadToR2(storageKey, file.buffer, { contentType: file.mimetype });

    // Register
    const [doc] = await db.insert(documentIngest).values({
      documentFingerprint: fingerprint,
      documentType,
      storageKey,
      storageBucket: process.env.R2_DOCUMENTS_BUCKET!,
      fileSizeBytes: file.size,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      sourceType: 'upload',
      sourceRetrievedAt: new Date(),
      sourceConfidence: 0.50,           // operator upload: lower provenance confidence
      incidentId: incidentId ? parseInt(incidentId) : null,
      subAccountId: req.subAccountId,
    }).returning();

    // Lineage (upload is source = operator)
    await db.insert(evidenceLineage).values({
      documentId: doc.id,
      sourceType: 'upload',
      sourceRetrievedAt: new Date(),
      sourceHash: fingerprint,
      custodyChain: [{
        step: 1,
        actor: `user:${req.user.id}`,
        action: 'uploaded',
        timestamp: new Date().toISOString(),
        originalFilename: file.originalname,
      }],
      isPublicRecord: false,
      accessMethod: 'upload',
      accessAuthorized: true,
    });

    // Audit
    await db.insert(documentAuditLog).values({
      documentId: doc.id,
      eventType: 'uploaded',
      actor: `user:${req.user.id}`,
      actorIp: req.ip,
      actorSessionId: req.session?.id,
      metadata: { originalFilename: file.originalname, documentType, incidentId },
    });

    // Queue
    await queueExtractionJobs(doc.id, 0);  // page_count determined by OCR

    res.json({ documentId: doc.id, isDuplicate: false });
  }
);
```

**Allowed file types:**
```typescript
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;  // 50 MB
const MAX_PAGES_PER_DOCUMENT = 200;              // Google Document AI limit: 15MB or 200 pages
```

---

### Channel 3 — Email Attachments

Inbound email processing for insurance documents, attorney correspondence, and intake forms sent to a dedicated acquisition email address.

**Architecture:**
```
Email → Resend Inbound Webhook → POST /api/webhooks/document-email
→ Extract attachments (PDF, TIFF, JPG)
→ Create upload-type acquisition job per attachment
→ Link to incident/contact if email subject contains reference number
→ Queue for OCR pipeline
```

**Email webhook handler:**
```typescript
// POST /api/webhooks/document-email (authenticated with RESEND_WEBHOOK_SECRET)

interface InboundEmailPayload {
  from: string;
  subject: string;
  text: string;
  attachments: Array<{
    filename: string;
    content: string;    // base64
    contentType: string;
  }>;
}

async function processDocumentEmail(payload: InboundEmailPayload): Promise<void> {
  // Extract reference numbers from subject line
  // e.g., "Re: Claim #INS-2026-4521 — John Smith Crash 05/10/2026"
  const incidentRef = extractIncidentReference(payload.subject + ' ' + payload.text);
  const incidentId = incidentRef ? await resolveIncidentByReference(incidentRef) : null;

  for (const attachment of payload.attachments) {
    if (!ALLOWED_MIME_TYPES.includes(attachment.contentType)) continue;

    const fileBuffer = Buffer.from(attachment.content, 'base64');

    await createAcquisitionJob({
      jobType: 'email_attachment',
      sourceType: detectDocumentTypeFromFilename(attachment.filename),
      sourceUrl: `email://${payload.from}/${payload.subject}`,
      incidentId,
      requestedBy: 'email_inbound_webhook',
      requestReason: `Email from ${payload.from}: ${payload.subject}`,
      // Pass buffer directly — no download needed
      preloadedBuffer: fileBuffer,
    });
  }
}
```

---

### Channel 4 — Manual Acquisition Request (Queue-Based)

Operators or pipelines can request acquisition of a specific document URL or reference number. This creates a job in `report_acquisition_jobs` which the acquisition worker processes.

**API endpoint:**
```
POST /api/documents/acquire
{
  "sourceUrl": "https://flhsmv.gov/...",
  "sourceType": "crash_report",
  "sourceReference": "HSMV-2026-482194",
  "incidentId": 4521,
  "priority": 1,
  "notes": "High-severity crash — expedite"
}
```

**Internal trigger (from crash ingest pipeline):**
```typescript
// In crashIngestPipeline.ts, when a crash qualifies for report acquisition:
async function queueCrashReportAcquisition(incident: SentinelIncident): Promise<void> {
  if (!incident.hsmvCrashNumber) return;

  await db.insert(reportAcquisitionJobs).values({
    jobType: 'download',
    sourceType: 'crash_report',
    sourceUrl: buildFlhsmvReportUrl(incident.hsmvCrashNumber),
    sourceReference: incident.hsmvCrashNumber,
    sourceAgency: 'FLHSMV',
    sourceJurisdiction: incident.county,
    incidentId: incident.id,
    priority: incidentSeverityToPriority(incident.severity),
    // priority 1 for fatal, 2 for serious, 3 for moderate
    useProxy: true,
    proxyMode: 'premium',
    requestedBy: 'crashIngestPipeline',
    requestReason: `Auto-triggered for ${incident.severity} crash in ${incident.county} county`,
  });
}

function incidentSeverityToPriority(severity: string): number {
  const map: Record<string, number> = {
    fatal: 1, serious: 2, moderate: 3, minor: 5, property_only: 8
  };
  return map[severity] ?? 5;
}
```

---

## Cloudflare R2 Storage Architecture

### Bucket Structure

```
apex-documents/                          (R2 bucket — private, no public access)
  crash_reports/
    2026-05/
      1234567.pdf
      1234568.pdf
  police_reports/
    2026-05/
      9876543.pdf
  intake_pdfs/
    2026-05/
      1111111.pdf
  legal_filings/
    2026-05/
      5555555.pdf
  insurance_docs/
    2026-05/
      3333333.pdf
  permits/
    2026-05/
      7777777.pdf
```

### Storage Key Schema

```typescript
function buildStorageKey(
  documentType: string,
  jobId: bigint | number,
  mimeType: string
): string {
  const ext = mimeTypeToExtension(mimeType);
  const yearMonth = new Date().toISOString().slice(0, 7);  // "2026-05"
  return `${documentType}s/${yearMonth}/${jobId}.${ext}`;
}
```

### R2 Access Pattern

```typescript
// All access via signed URLs — never expose bucket or key directly
async function getDocumentSignedUrl(
  storageKey: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  // Cloudflare R2 signed URL via Workers API or SDK
  const url = await r2Client.getSignedUrl('GetObject', {
    Bucket: process.env.R2_DOCUMENTS_BUCKET!,
    Key: storageKey,
    Expires: expiresInSeconds,
  });
  return url;
}
```

**Security rules:**
- Bucket: private (no public access policy)
- All access via signed URLs (max 1-hour expiry for client-side rendering)
- Object paths contain only numeric IDs — no PII in key names
- Versioning enabled (R2 supports object versioning for immutability)
- Lifecycle rule: move to Infrequent Access after 90 days

---

## Retry Logic

### Exponential Backoff Schedule

```
Attempt 1: immediately
Attempt 2: 5 minutes later
Attempt 3: 30 minutes later
→ After 3 failures: status = 'failed', alert operator via agent_outcome_log
```

```typescript
function computeNextAttemptAt(attempts: number): Date {
  const delaysMs = [
    0,               // attempt 1: immediate
    5 * 60_000,      // attempt 2: 5 minutes
    30 * 60_000,     // attempt 3: 30 minutes
  ];
  const delay = delaysMs[attempts] ?? 60 * 60_000;  // default: 1 hour
  return new Date(Date.now() + delay);
}
```

### Error Classification

| HTTP Status | Error Code | Retry? | Action |
|-------------|-----------|--------|--------|
| 200 | — | — | Success |
| 404 | NOT_FOUND | ❌ No | Mark skipped — document doesn't exist |
| 403 | ACCESS_DENIED | ❌ No | Log access restriction, do not retry |
| 429 | RATE_LIMITED | ✅ Yes | Retry with doubled delay |
| 503 | SERVICE_UNAVAILABLE | ✅ Yes | Retry with exponential backoff |
| Timeout | TIMEOUT | ✅ Yes | Retry with premium proxy on attempt 2 |
| Parse error | PARSE_ERROR | ✅ Yes | Retry once with stealth proxy |
| Invalid PDF | INVALID_FORMAT | ❌ No | Mark failed — unprocessable |

---

## Priority Queue Management

The acquisition worker processes jobs in priority order. Priority is set at job creation time based on incident severity and operator context.

| Priority | Trigger | Source | Target SLA |
|----------|---------|--------|-----------|
| 1 | Fatal crash report | System (auto-triggered) | Acquire within 15 minutes |
| 2 | Serious injury crash report | System | Acquire within 1 hour |
| 3 | Manual acquisition request (operator) | Operator | Acquire within 2 hours |
| 4 | Moderate crash report | System | Acquire within 6 hours |
| 5 | Default | Any | Acquire within 24 hours |
| 8 | Minor/property-only crash | System | Acquire within 72 hours |
| 10 | Batch backfill | System (background) | Best effort |

**Worker concurrency:**
```typescript
const ACQUISITION_WORKER_CONCURRENCY = 3;  // max parallel acquisitions
const ACQUISITION_RATE_LIMIT = 10;          // max acquisitions per minute
```

---

## Source Confidence Assignment

Every acquired document receives a `source_confidence` score based on its origin:

```typescript
function computeSourceConfidence(job: AcquisitionJob): number {
  const baseConfidence: Record<string, number> = {
    'flhsmv_api': 0.95,        // Official FL Highway Safety API
    'pacer': 0.92,             // Federal court system
    'county_court_bulk': 0.88, // Official county bulk export
    'official_agency_portal': 0.85, // Government portal (scraped)
    'public_record_scrape': 0.75,   // Public but scraped
    'operator_upload': 0.50,   // Unverified — trust but verify
    'email_attachment': 0.55,  // Unknown original source
    'third_party_api': 0.65,   // Third-party data source
  };

  return baseConfidence[job.sourceAgencyCode] ?? 0.50;
}
```

---

## Report Acquisition — Document Type Routing

When a document is acquired, the system must detect its type if not explicitly specified:

```typescript
function detectDocumentType(
  mimeType: string,
  sourceUrl: string | null,
  originalFilename: string | null,
  firstPageText: string | null  // from OCR preview
): string {
  // URL-based detection (highest confidence)
  if (sourceUrl?.includes('flhsmv.gov')) return 'crash_report';
  if (sourceUrl?.includes('pacer.gov')) return 'legal_filing';
  if (sourceUrl?.includes('hillsclerk.com')) return 'legal_filing';

  // Filename-based detection
  if (originalFilename) {
    const lower = originalFilename.toLowerCase();
    if (lower.includes('crash') || lower.includes('hsmv')) return 'crash_report';
    if (lower.includes('police') || lower.includes('incident')) return 'police_report';
    if (lower.includes('insurance') || lower.includes('policy')) return 'insurance_doc';
    if (lower.includes('permit')) return 'permit_doc';
    if (lower.includes('intake') || lower.includes('retainer')) return 'intake_pdf';
  }

  // Text-based detection (requires partial OCR)
  if (firstPageText) {
    if (/florida\s+traffic\s+crash\s+report/i.test(firstPageText)) return 'crash_report';
    if (/police\s+report|incident\s+report|case\s+number/i.test(firstPageText)) return 'police_report';
    if (/insurance\s+policy|declaration\s+page/i.test(firstPageText)) return 'insurance_doc';
  }

  return 'public_record';  // fallback
}
```

---

## Acquisition Observability

Every acquisition run logs to `enrichment_provider_log`:

```sql
INSERT INTO enrichment_provider_log (
  contact_id, provider, request_type, status,
  response_time_ms, credits_used, error_code, created_at
) VALUES (
  NULL,
  CASE job_type
    WHEN 'download' THEN source_agency
    ELSE 'operator_upload'
  END,
  'document_acquisition',
  CASE WHEN success THEN 'success' ELSE 'error' END,
  latency_ms,
  CASE WHEN use_proxy THEN 1 ELSE 0 END,
  error_code,
  NOW()
);
```

And to `agent_outcome_log`:
```sql
INSERT INTO agent_outcome_log (
  agent_type, entity_id, action, status, latency_ms, error_message
) VALUES (
  'report_acquisition_worker',
  document_id,
  'acquire_' || source_type,
  status,
  latency_ms,
  error_message
);
```

---

## API Endpoints

```
POST /api/documents/upload              — operator file upload (multipart)
POST /api/documents/acquire             — queue a URL for acquisition
GET  /api/documents                     — list documents (filtered by sub_account, type, status)
GET  /api/documents/:id                 — document detail + extraction status
GET  /api/documents/:id/signed-url      — get time-limited R2 signed URL for viewing
GET  /api/incidents/:id/documents       — all documents linked to incident
GET  /api/acquisition-jobs             — queue status (admin)
GET  /api/acquisition-jobs/:id         — single job status
POST /api/acquisition-jobs/:id/retry   — manually retry a failed job (admin)
DELETE /api/documents/:id              — soft-delete (audit log + archive, never purge)
```
