# APEX EVIDENCE LINEAGE
**Chain of Custody, Audit Trail, Source Integrity, and Document Immutability**
Version: 1.0 | Generated: 2026-05-15

---

## Purpose

Evidence Lineage is the trust layer of the Document Intelligence system. It answers four questions for every document in the Apex platform:

1. **Where did this document come from?** (source lineage)
2. **What happened to it after we acquired it?** (chain of custody)
3. **Has it been modified?** (integrity verification)
4. **Who has accessed or used it?** (audit trail)

Without evidence lineage, the platform cannot distinguish between a verified official crash report and an operator-uploaded document of unknown origin. Without an audit trail, there is no accountability for how contact records were created or modified from document data.

**Core rules:**
- `document_audit_log` is append-only. No UPDATE, no DELETE, ever.
- `evidence_lineage.custody_chain` is append-only (JSONB array of ordered steps).
- The SHA256 fingerprint computed at ingest must match the current file hash — if it doesn't, the document has been mutated.
- Verified data extracted from official sources (source_confidence >= 0.85) cannot be overwritten by lower-confidence document extractions.

---

## Evidence Lineage Table

```sql
CREATE TABLE evidence_lineage (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id) UNIQUE,

  -- Original source
  source_type VARCHAR(100) NOT NULL,
  -- 'public_api'         — official government API
  -- 'public_website'     — scraped public government portal
  -- 'court_system'       — PACER, CourtListener, state courts
  -- 'upload'             — operator-uploaded
  -- 'email_attachment'   — received via email
  -- 'api_response'       — embedded in API response payload
  -- 'internal_transfer'  — created from another internal document

  source_url TEXT,                       -- original URL at time of acquisition
  source_agency VARCHAR(200),            -- 'FLHSMV', 'OPD', 'OCSO', 'FHP', 'Hillsborough Clerk'
  source_jurisdiction VARCHAR(100),
  source_retrieved_at TIMESTAMPTZ NOT NULL,

  -- Integrity
  source_hash VARCHAR(64) NOT NULL,      -- SHA256 of original content at acquisition time
  source_hash_algorithm VARCHAR(20) DEFAULT 'sha256',
  current_hash VARCHAR(64),              -- recomputed on periodic verification; must match source_hash

  integrity_status VARCHAR(50) DEFAULT 'unverified',
  -- 'unverified' → 'verified_intact' → 'integrity_failure' (alert!)
  last_integrity_check_at TIMESTAMPTZ,
  integrity_verified_by VARCHAR(100),

  -- Chain of custody (append-only ordered array)
  custody_chain JSONB NOT NULL DEFAULT '[]',
  -- Each step: { step: int, actor: str, action: str, timestamp: ISO, hash?: str, metadata?: {} }

  -- Legal admissibility flags
  is_public_record BOOLEAN DEFAULT false,
  is_official_agency_document BOOLEAN DEFAULT false,
  is_certified_copy BOOLEAN DEFAULT false,
  requires_subpoena BOOLEAN DEFAULT false,
  obtained_by_subpoena BOOLEAN DEFAULT false,

  -- Access authorization
  access_method VARCHAR(100),
  -- 'public_api'           — authorized: always
  -- 'public_website'       — authorized: always (public record)
  -- 'proxy_scrape'         — authorized if site is public record
  -- 'upload'               — authorized by operator
  -- 'subpoena'             — authorized by legal process
  access_authorized BOOLEAN NOT NULL DEFAULT true,
  access_authorization_note TEXT,
  access_restricted BOOLEAN DEFAULT false,  -- if true: require explicit operator confirmation to view

  -- Retention and archival
  retention_policy VARCHAR(50) DEFAULT 'standard',
  -- 'standard'     — retain for 2 years from enriched_at
  -- 'legal_hold'   — retain indefinitely (litigation hold)
  -- 'permanent'    — never delete (official government record)
  -- 'short_term'   — retain for 90 days (low-value supplemental)
  retain_until DATE,
  legal_hold_applied_at TIMESTAMPTZ,
  legal_hold_applied_by VARCHAR(100),
  legal_hold_reason TEXT,

  -- Admissibility notes
  admissibility_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evidence_lineage_source ON evidence_lineage(source_type, source_agency);
CREATE INDEX idx_evidence_lineage_integrity ON evidence_lineage(integrity_status, last_integrity_check_at);
CREATE INDEX idx_evidence_lineage_retention ON evidence_lineage(retention_policy, retain_until);
```

---

## Document Audit Log (Append-Only)

```sql
CREATE TABLE document_audit_log (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES document_ingest(id),

  event_type VARCHAR(100) NOT NULL,
  -- Acquisition events:
  --   'acquired'            — document downloaded/uploaded and stored
  --   'upload_attempted'    — operator attempted upload
  --   'acquisition_failed'  — download failed
  --   'deduped'             — fingerprint already existed

  -- Processing events:
  --   'ocr_started'         — OCR job began
  --   'ocr_completed'       — OCR finished, page confidence recorded
  --   'ocr_failed'          — OCR error
  --   'entity_extracted'    — extraction complete (N entities)
  --   'entity_overridden'   — human corrected an extraction
  --   'incident_linked'     — linked to sentinel_incidents
  --   'incident_link_failed' — no incident match found
  --   'contact_resolved'    — person entity resolved to contact
  --   'contact_created'     — new contact created from document
  --   'embedded'            — document embedding created

  -- Access events:
  --   'viewed'              — document viewed by user
  --   'signed_url_issued'   — signed R2 URL generated for viewing
  --   'exported'            — included in a data export
  --   'access_denied'       — attempted access without authorization

  -- Lifecycle events:
  --   'archived'            — moved to archived state
  --   'legal_hold_applied'  — legal hold placed on document
  --   'legal_hold_released' — legal hold removed
  --   'integrity_verified'  — hash check passed
  --   'integrity_failed'    — hash mismatch detected (CRITICAL)
  --   'retention_extended'  — retain_until date extended
  --   'deleted'             — soft-delete (reference record remains)

  actor VARCHAR(200) NOT NULL,           -- 'system', 'user:123', 'crashIngestPipeline', 'reportAcquisitionWorker'
  actor_ip INET,                         -- IP address for human actor events
  actor_session_id TEXT,                 -- session ID for human actor events

  -- State snapshots (for diffing)
  before_state JSONB,                    -- relevant fields before the event
  after_state JSONB,                     -- relevant fields after the event

  -- Supplemental context
  metadata JSONB,

  -- This column MUST always be the current time — never backfilled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

  -- No updates, no deletes ever on this table
  -- Enforced by: row-level security policy + app-level constraint
);

-- Disable updates and deletes via trigger
CREATE RULE no_update_audit_log AS ON UPDATE TO document_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO document_audit_log DO INSTEAD NOTHING;

CREATE INDEX idx_doc_audit_log_document ON document_audit_log(document_id, created_at DESC);
CREATE INDEX idx_doc_audit_log_event ON document_audit_log(event_type, created_at DESC);
CREATE INDEX idx_doc_audit_log_actor ON document_audit_log(actor, event_type, created_at DESC);
CREATE INDEX idx_doc_audit_log_integrity ON document_audit_log(event_type) WHERE event_type IN ('integrity_failed', 'access_denied');
```

---

## Chain of Custody Construction

The custody chain is a JSONB array appended with each significant step in the document's lifecycle. Each step is immutable once written.

### Chain Step Schema

```typescript
interface CustodyStep {
  step: number;                  // sequential step number (1, 2, 3...)
  actor: string;                 // who performed this step
  action: CustodyAction;
  timestamp: string;             // ISO 8601
  hash?: string;                 // SHA256 of document at this step (if material)
  location?: string;             // where the document was at this step
  metadata?: Record<string, unknown>;
}

type CustodyAction =
  | 'downloaded'
  | 'uploaded'
  | 'stored_to_r2'
  | 'ocr_processed'
  | 'entities_extracted'
  | 'linked_to_incident'
  | 'contact_resolved'
  | 'embedded'
  | 'archived'
  | 'hash_verified'
  | 'viewed_by_operator'
  | 'exported';
```

### Example Chain for a Crash Report

```json
[
  {
    "step": 1,
    "actor": "reportAcquisitionWorker",
    "action": "downloaded",
    "timestamp": "2026-05-15T14:23:11.000Z",
    "hash": "a3f4c9d1e2b8f7c6...",
    "location": "https://services.flhsmv.gov/CRRService/api/CrashReport/GetReport?reportNumber=2026482194",
    "metadata": {
      "httpStatus": 200,
      "contentType": "application/pdf",
      "fileSizeBytes": 425843,
      "proxyUsed": true,
      "proxyMode": "premium"
    }
  },
  {
    "step": 2,
    "actor": "cloudflare_r2",
    "action": "stored_to_r2",
    "timestamp": "2026-05-15T14:23:14.000Z",
    "location": "r2://apex-documents/crash_reports/2026-05/1234567.pdf",
    "metadata": {
      "bucket": "apex-documents",
      "storageKey": "crash_reports/2026-05/1234567.pdf",
      "eTag": "\"a3f4c9d1e2b8f7c6\""
    }
  },
  {
    "step": 3,
    "actor": "ocrPipeline",
    "action": "ocr_processed",
    "timestamp": "2026-05-15T14:24:02.000Z",
    "metadata": {
      "provider": "google_document_ai",
      "processorType": "form_parser",
      "pageCount": 4,
      "overallConfidence": 0.94,
      "entitiesExtracted": 31
    }
  },
  {
    "step": 4,
    "actor": "documentIncidentLinker",
    "action": "linked_to_incident",
    "timestamp": "2026-05-15T14:24:08.000Z",
    "metadata": {
      "incidentId": 4521,
      "linkType": "primary",
      "linkConfidence": 0.95,
      "linkMethod": "incident_number_match",
      "matchedReference": "HSMV-2026-482194"
    }
  },
  {
    "step": 5,
    "actor": "documentContactResolver",
    "action": "contact_resolved",
    "timestamp": "2026-05-15T14:24:15.000Z",
    "metadata": {
      "personsFound": 2,
      "contactsCreated": 1,
      "contactsLinkedExisting": 1,
      "exportEligibleSet": true
    }
  }
]
```

### Appending to the Chain

```typescript
// server/services/evidenceLineageService.ts

export async function appendCustodyStep(
  documentId: bigint,
  step: Omit<CustodyStep, 'step'>
): Promise<void> {
  await db.execute(sql`
    UPDATE evidence_lineage
    SET
      custody_chain = custody_chain || ${JSON.stringify({
        ...step,
        step: sql`jsonb_array_length(custody_chain) + 1`
      })}::jsonb,
      updated_at = NOW()
    WHERE document_id = ${documentId}
  `);

  // Mirror to audit log
  await db.insert(documentAuditLog).values({
    documentId,
    eventType: step.action,
    actor: step.actor,
    metadata: step.metadata ?? null,
    createdAt: new Date(step.timestamp),
  });
}
```

---

## Integrity Verification

The SHA256 fingerprint computed at ingest is the source of truth for document integrity. Periodic verification confirms the stored document matches the original.

### Verification Schedule

```
On ingest:           SHA256 computed, stored as source_hash
After OCR:           content_hash re-verified
Weekly cron:         all documents with integrity_status='unverified' verified
On legal_hold apply: immediate verification required
On export:           verification required before export
```

### Verification Logic

```typescript
// server/workers/documentIntegrityWorker.ts

async function verifyDocumentIntegrity(documentId: bigint): Promise<IntegrityResult> {
  const [doc] = await db.select({
    storageKey: documentIngest.storageKey,
    storageBucket: documentIngest.storageBucket,
  })
    .from(documentIngest)
    .where(eq(documentIngest.id, documentId))
    .limit(1);

  const [lineage] = await db.select({
    sourceHash: evidenceLineage.sourceHash,
  })
    .from(evidenceLineage)
    .where(eq(evidenceLineage.documentId, documentId))
    .limit(1);

  // Download current file from R2
  const currentBytes = await downloadFromR2(doc.storageBucket, doc.storageKey);
  const currentHash = crypto.createHash('sha256').update(currentBytes).digest('hex');

  const isIntact = currentHash === lineage.sourceHash;

  // Update lineage
  await db.update(evidenceLineage)
    .set({
      currentHash,
      integrityStatus: isIntact ? 'verified_intact' : 'integrity_failure',
      lastIntegrityCheckAt: new Date(),
      integrityVerifiedBy: 'documentIntegrityWorker',
    })
    .where(eq(evidenceLineage.documentId, documentId));

  // Always append to custody chain
  await appendCustodyStep(documentId, {
    actor: 'documentIntegrityWorker',
    action: 'hash_verified',
    timestamp: new Date().toISOString(),
    metadata: {
      expectedHash: lineage.sourceHash,
      currentHash,
      result: isIntact ? 'PASS' : 'FAIL',
    },
  });

  if (!isIntact) {
    // CRITICAL: document has been mutated — alert immediately
    await logSystemEvent('critical', 'evidence_lineage',
      `INTEGRITY FAILURE: document ${documentId} hash mismatch`, {
        documentId,
        expectedHash: lineage.sourceHash,
        actualHash: currentHash,
      }
    );

    // Write to audit log as critical event
    await db.insert(documentAuditLog).values({
      documentId,
      eventType: 'integrity_failed',
      actor: 'documentIntegrityWorker',
      metadata: { expectedHash: lineage.sourceHash, actualHash: currentHash },
    });
  }

  return { isIntact, sourceHash: lineage.sourceHash, currentHash };
}
```

---

## Access Control and Authorization

### Access Restriction Rules

| Document Type | Access | Who Can View | Requires Verification |
|---------------|--------|-------------|----------------------|
| `crash_report` (official FLHSMV) | Open to sub-account | Any authenticated operator | No |
| `police_report` | Restricted | Admin + assigned attorney | Yes |
| `intake_pdf` | Restricted | Admin + case attorney | Yes |
| `insurance_doc` | Restricted | Admin + assigned operator | Yes |
| `medical_record` | Highly restricted | Admin only | Yes, + explicit consent log |
| `legal_filing` (public court) | Open | Any authenticated operator | No |
| `public_record` | Open | Any authenticated operator | No |

### Signed URL Audit

Every signed URL generation is logged — an auditor can reconstruct exactly who viewed what and when:

```typescript
// POST /api/documents/:id/signed-url

async function issueSignedUrl(
  documentId: bigint,
  requestingUser: AuthUser
): Promise<string> {
  // Check access authorization
  const [doc] = await db.select({
    storageKey: documentIngest.storageKey,
    documentType: documentIngest.documentType,
    subAccountId: documentIngest.subAccountId,
  })
    .from(documentIngest)
    .where(eq(documentIngest.id, documentId))
    .limit(1);

  if (!canUserAccessDocument(requestingUser, doc)) {
    // Log denied access attempt
    await db.insert(documentAuditLog).values({
      documentId,
      eventType: 'access_denied',
      actor: `user:${requestingUser.id}`,
      actorIp: requestingUser.ip,
      actorSessionId: requestingUser.sessionId,
      metadata: {
        reason: 'insufficient_permissions',
        documentType: doc.documentType,
        subAccountId: doc.subAccountId,
      },
    });
    throw new AuthorizationError('Access denied to document');
  }

  // Generate signed URL (1-hour expiry)
  const signedUrl = await getDocumentSignedUrl(doc.storageKey, 3600);

  // Log the access
  await db.insert(documentAuditLog).values({
    documentId,
    eventType: 'signed_url_issued',
    actor: `user:${requestingUser.id}`,
    actorIp: requestingUser.ip,
    actorSessionId: requestingUser.sessionId,
    metadata: {
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      documentType: doc.documentType,
    },
  });

  // Append to custody chain
  await appendCustodyStep(documentId, {
    actor: `user:${requestingUser.id}`,
    action: 'viewed_by_operator',
    timestamp: new Date().toISOString(),
    metadata: { userName: requestingUser.email },
  });

  return signedUrl;
}
```

---

## Source Lineage Classification

### Lawful Access Matrix

Every document source must be classified for lawfulness before acquisition proceeds:

```typescript
interface SourceLawfulnessCheck {
  sourceType: string;
  isPublicRecord: boolean;
  requiresAuth: boolean;
  requiresSubpoena: boolean;
  authorizationNote: string;
}

const SOURCE_LAWFULNESS: Record<string, SourceLawfulnessCheck> = {
  flhsmv_crash_report: {
    sourceType: 'public_api',
    isPublicRecord: true,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'FLHSMV crash reports are public records under Florida Statute 316.066(2)(a). Available to any person upon request.',
  },
  hillsborough_clerk_bulk: {
    sourceType: 'public_website',
    isPublicRecord: true,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'Hillsborough County official records are public under Florida Public Records Law (F.S. Chapter 119). Bulk files published by Clerk of Courts.',
  },
  courtlistener: {
    sourceType: 'court_system',
    isPublicRecord: true,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'Federal court filings via CourtListener are public under PACER system (28 U.S.C. § 1913 note). CourtListener re-publishes under open access license.',
  },
  pacer: {
    sourceType: 'court_system',
    isPublicRecord: true,
    requiresAuth: true,         // PACER requires registered account
    requiresSubpoena: false,
    authorizationNote: 'PACER documents are public federal court records. Access requires PACER registered account per 28 U.S.C. § 1913 note.',
  },
  cpsc_recall: {
    sourceType: 'public_api',
    isPublicRecord: true,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'CPSC recall data is public under 15 U.S.C. § 2064 (CPSA). Published at api.cpsc.gov.',
  },
  operator_upload: {
    sourceType: 'upload',
    isPublicRecord: false,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'Document uploaded by authenticated operator. Provenance and authorization is operator responsibility.',
  },
  email_attachment: {
    sourceType: 'email_attachment',
    isPublicRecord: false,
    requiresAuth: false,
    requiresSubpoena: false,
    authorizationNote: 'Document received via inbound email. Provenance and authorization is sender responsibility.',
  },
};

// NEVER acquire from these sources without explicit legal authorization:
const PROHIBITED_SOURCES = [
  'medical_records_without_consent',
  'sealed_court_records',
  'law_enforcement_internal_systems',
  'private_communications_without_warrant',
  'financial_records_without_consent',
];
```

---

## Retention Policy

### Default Retention Schedule

| Document Type | Retention | Notes |
|---------------|-----------|-------|
| `crash_report` (official) | Permanent | Official government record |
| `police_report` | 5 years | Matches Florida records retention law |
| `intake_pdf` | 7 years | Matches legal representation retention standard |
| `insurance_doc` | 5 years | Matches insurance claims retention standard |
| `legal_filing` (public) | Permanent | Court records are permanent public record |
| `permit_doc` | 7 years | Matches FL building record retention |
| `public_record` | 2 years | Standard retention |
| `medical_record` | 7 years | HIPAA minimum |
| Low-value supplemental | 90 days | `retention_policy = 'short_term'` |

### Legal Hold

When a case enters litigation, all related documents must be placed on legal hold:

```typescript
async function applyLegalHold(
  documentIds: bigint[],
  reason: string,
  appliedBy: string
): Promise<void> {
  await db.update(evidenceLineage)
    .set({
      retentionPolicy: 'legal_hold',
      retainUntil: null,  // indefinite
      legalHoldAppliedAt: new Date(),
      legalHoldAppliedBy: appliedBy,
      legalHoldReason: reason,
    })
    .where(inArray(evidenceLineage.documentId, documentIds));

  for (const documentId of documentIds) {
    await db.insert(documentAuditLog).values({
      documentId,
      eventType: 'legal_hold_applied',
      actor: appliedBy,
      metadata: { reason },
    });
  }
}
```

---

## Report Status Tracking API

```typescript
// GET /api/documents/:id/lineage
// Returns the full evidence lineage and chain of custody

interface DocumentLineageResponse {
  documentId: bigint;
  documentType: string;
  ingestStatus: string;

  // Source
  sourceType: string;
  sourceAgency: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  sourceRetrievedAt: string;
  sourceConfidence: number;
  isPublicRecord: boolean;
  isOfficialAgencyDocument: boolean;
  accessAuthorized: boolean;
  accessAuthorizationNote: string | null;

  // Integrity
  integrityStatus: string;
  sourceHash: string;
  currentHash: string | null;
  lastIntegrityCheckAt: string | null;

  // Custody chain
  custodyChain: CustodyStep[];

  // Extraction results
  entityCount: number;
  highConfidenceEntities: number;
  incidentsLinked: number;
  contactsResolved: number;
  overallDocumentConfidence: number | null;

  // Retention
  retentionPolicy: string;
  retainUntil: string | null;
  legalHoldApplied: boolean;

  // Audit summary (count by event type)
  auditEventCounts: Record<string, number>;
}
```

---

## Evidence Lineage for Contact Records

When a contact is created or modified from document data, the `contact_enrichment_events` table records the evidence trail back to the source document:

```sql
INSERT INTO contact_enrichment_events (
  contact_id,
  event_type,
  field_changed,
  old_value,
  new_value,
  source,
  confidence,
  triggered_by,
  metadata,
  created_at
) VALUES (
  $contactId,
  'phone_appended_from_document',
  'phone',
  NULL,
  '+14075551234',
  'document_intelligence',
  0.92,
  'documentContactResolver',
  JSON.stringify({
    documentId: 1234567,
    documentType: 'crash_report',
    pageNumber: 2,
    entityId: 9876543,
    extractionMethod: 'form_field',
    fieldName: 'DRIVER1_PHONE',
    rawValue: '(407) 555-1234',
    extractionConfidence: 0.95,
    sourceAgency: 'FLHSMV',
    sourceReference: 'HSMV-2026-482194',
  }),
  NOW()
);
```

This creates a **bidirectional** evidence trail:
- Document → contact: `document_contact_links`
- Contact field change → document: `contact_enrichment_events.metadata.documentId`
- Any downstream audit can trace a contact's phone number back to the exact field on the exact page of the exact official document.

---

## Audit Report Queries

```sql
-- 1. Full audit trail for a document
SELECT event_type, actor, metadata, created_at
FROM document_audit_log
WHERE document_id = $documentId
ORDER BY created_at ASC;

-- 2. All documents accessed by an operator in the last 30 days
SELECT d.id, d.document_type, d.source_reference, al.created_at
FROM document_audit_log al
JOIN document_ingest d ON d.id = al.document_id
WHERE al.actor = 'user:' || $userId
  AND al.event_type IN ('viewed', 'signed_url_issued', 'exported')
  AND al.created_at >= NOW() - INTERVAL '30 days'
ORDER BY al.created_at DESC;

-- 3. All contacts whose phone was derived from a specific document
SELECT c.id, c.first_name, c.last_name, c.phone, ee.extraction_confidence
FROM document_extracted_entities ee
JOIN contacts c ON c.id = ee.resolved_to_contact_id
WHERE ee.document_id = $documentId
  AND ee.entity_type = 'phone';

-- 4. Integrity failures in the last 7 days
SELECT al.document_id, d.document_type, d.source_reference, al.metadata, al.created_at
FROM document_audit_log al
JOIN document_ingest d ON d.id = al.document_id
WHERE al.event_type = 'integrity_failed'
  AND al.created_at >= NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;

-- 5. Chain of custody for a contact's phone number
SELECT
  cee.event_type,
  cee.old_value,
  cee.new_value,
  cee.source,
  cee.confidence,
  cee.metadata->>'documentId' AS source_document_id,
  cee.metadata->>'documentType' AS document_type,
  cee.metadata->>'sourceAgency' AS source_agency,
  cee.metadata->>'sourceReference' AS source_reference,
  cee.metadata->>'extractionMethod' AS extraction_method,
  cee.created_at
FROM contact_enrichment_events cee
WHERE cee.contact_id = $contactId
  AND cee.field_changed = 'phone'
ORDER BY cee.created_at DESC;

-- 6. Documents not yet integrity-verified (weekly audit target)
SELECT di.id, di.document_type, el.source_retrieved_at, el.integrity_status
FROM document_ingest di
JOIN evidence_lineage el ON el.document_id = di.id
WHERE el.integrity_status = 'unverified'
  OR el.last_integrity_check_at < NOW() - INTERVAL '7 days'
ORDER BY el.source_retrieved_at ASC
LIMIT 500;
```

---

## Compliance Notes

**What Apex Document Intelligence does:**
- Accesses only public records through authorized channels
- Maintains an immutable audit trail of every action on every document
- Never retains sealed, restricted, or court-protected documents
- Verifies document integrity on a periodic basis
- Applies retention schedules aligned with Florida records law

**What Apex Document Intelligence does NOT do:**
- Access medical records without authorization or consent
- Access sealed court records
- Bypass authentication systems
- Acquire documents that require subpoenas without one
- Remove or modify audit trail entries
- Overwrite verified human identity data with lower-confidence document extractions
- Store sensitive PII (SSN, full financial account numbers) extracted from documents
- Share documents across sub-account boundaries

**On SSN partial matches:**
- OCR may detect SSN patterns — these are flagged as `entity_type = 'ssn_partial'`
- SSN values are never written to `document_extracted_entities.raw_value` or `normalized_value`
- A redacted indicator is stored: `extraction_method = 'regex', raw_value = 'SSN_DETECTED_REDACTED'`
- Operators see only "SSN present in document" — not the value

---

## Phase 5A Implementation Checklist

- [ ] `evidence_lineage` table + trigger (no UPDATE, no DELETE on audit log)
- [ ] `document_audit_log` table + PostgreSQL rules (append-only enforcement)
- [ ] `appendCustodyStep()` service function
- [ ] Integrity verification worker (weekly cron)
- [ ] Source lawfulness check before every acquisition
- [ ] Legal hold API (`POST /api/documents/legal-hold`)
- [ ] Retention policy cron (archive expired documents)
- [ ] `GET /api/documents/:id/lineage` endpoint
- [ ] `GET /api/documents/:id/audit-trail` endpoint
- [ ] Contact enrichment event with document backlink
- [ ] SSN detection + automatic redaction in extraction pipeline
- [ ] Access control enforcement + denied access logging
