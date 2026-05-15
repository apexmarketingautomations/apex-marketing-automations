# APEX OCR PIPELINE
**Extraction, Entity Recognition, Confidence Scoring, and LLM Enrichment**
Version: 1.0 | Generated: 2026-05-15

---

## Purpose

The OCR Pipeline converts acquired document images and PDFs into structured, confidence-scored data about the real-world event they describe. It is not a generic OCR system — it is a domain-specific extraction engine tuned for crash reports, police reports, legal filings, insurance documents, and public records.

**Design philosophy:**
- Form field extraction first (highest confidence, deterministic)
- Regex patterns second (high confidence, fast)
- NLP/LLM third (lower confidence, slowest — reserved for narratives and ambiguous fields)
- Every extracted value carries an explicit confidence score and extraction explanation
- No field is ever overwritten by a lower-confidence extraction

---

## Pipeline Architecture

```
document_ingest (ingest_status = 'ocr_queued')
    │
    ▼
STEP 1: PRE-PROCESSING
  detectDocumentOrientation()
  estimateImageQuality()
  splitMultiPageDocument()
  → queue one OCR job per page
    │
    ▼
STEP 2: OCR EXECUTION (per page, parallel)
  Google Document AI (primary)
    ├── Form Parser processor — for structured crash/police/insurance forms
    ├── OCR Processor — for scanned narrative text and handwriting
    └── Document AI Specialized processor (if available for crash reports)
  → document_ocr_results (one row per page)
    │
    ▼
STEP 3: STRUCTURED FIELD EXTRACTION
  extractFormFields()     — direct form field key-value pairs
  extractRegexEntities()  — pattern matching on full text
  → document_extracted_entities (form_field + regex rows)
    │
    ▼
STEP 4: LLM-ASSISTED EXTRACTION (conditional)
  Triggered for: narrative fields, ambiguous names, incomplete forms
  Model: claude-sonnet-4-6 (primary) / gpt-4o (fallback)
  → document_extracted_entities (llm rows)
    │
    ▼
STEP 5: NORMALIZATION
  normalizePhone()    → E.164 format
  normalizeAddress()  → USPS standardization
  normalizeName()     → proper case, remove suffixes
  normalizeVin()      → 17-char uppercase
  normalizePlate()    → uppercase, no spaces
  normalizeDob()      → ISO date
    │
    ▼
STEP 6: CONFIDENCE SCORING
  computeEntityConfidence()
  computeDocumentOverallConfidence()
  flagLowConfidenceForReview()
    │
    ▼
STEP 7: INCIDENT LINKING
  matchByIncidentNumber()
  matchByLocationAndDate()
  matchByCrashNumber()
  → document_incident_links
    │
    ▼
STEP 8: CONTACT RESOLUTION
  resolvePersonEntities()
  dedupAgainstExistingContacts()
  createOrUpdateContacts()  (confidence-guarded)
  → document_contact_links
    │
    ▼
STEP 9: DOCUMENT EMBEDDING
  buildDocumentEmbeddingContent()
  openai.embeddings.create()
  → embedding_store (entity_type = 'document')
    │
    ▼
document_ingest (ingest_status = 'enriched')
```

---

## OCR Provider Configuration

### Primary: Google Document AI

**Processor selection by document type:**

| Document Type | Processor | Reason |
|---------------|-----------|--------|
| `crash_report` | Form Parser | HSMV forms are highly structured with labeled fields |
| `police_report` | OCR Processor | Mixed: form header + narrative text body |
| `insurance_doc` | Form Parser | Declaration pages are structured forms |
| `legal_filing` | OCR Processor | Free-form legal text |
| `intake_pdf` | Form Parser | Intake forms are structured |
| `permit_doc` | Form Parser | Permit applications are structured |
| Handwritten | OCR Processor | Enable `enable_symbol: true` |
| Mixed content | Document AI Splitter | Split before routing to Form or OCR |

```typescript
// server/services/ocrService.ts

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

const PROCESSORS: Record<string, string> = {
  crash_report:    process.env.GOOGLE_DOCAI_FORM_PARSER_ID!,
  police_report:   process.env.GOOGLE_DOCAI_OCR_PROCESSOR_ID!,
  insurance_doc:   process.env.GOOGLE_DOCAI_FORM_PARSER_ID!,
  legal_filing:    process.env.GOOGLE_DOCAI_OCR_PROCESSOR_ID!,
  intake_pdf:      process.env.GOOGLE_DOCAI_FORM_PARSER_ID!,
  permit_doc:      process.env.GOOGLE_DOCAI_FORM_PARSER_ID!,
  public_record:   process.env.GOOGLE_DOCAI_OCR_PROCESSOR_ID!,
};

async function runOcr(
  documentId: bigint,
  pageNumber: number,
  pageBytes: Buffer,
  documentType: string,
  mimeType: string,
): Promise<OcrResult> {
  const client = new DocumentProcessorServiceClient();
  const processorId = PROCESSORS[documentType] ?? PROCESSORS.public_record;

  const startMs = Date.now();

  const [result] = await client.processDocument({
    name: processorId,
    rawDocument: {
      content: pageBytes.toString('base64'),
      mimeType,
    },
    processOptions: {
      formExtractionParams: {
        enabled: isFormDocument(documentType),
      },
      ocrConfig: {
        enableImageQualityScores: true,
        enableSymbol: pageBytes.length < 500_000,  // symbols for cleaner pages
      },
    },
  });

  const doc = result.document!;
  const latencyMs = Date.now() - startMs;

  // Extract structured form fields
  const structuredFields: Record<string, { value: string; confidence: number }> = {};
  for (const field of doc.pages?.[0]?.formFields ?? []) {
    const key = field.fieldName?.textAnchor?.content?.trim() ?? '';
    const value = field.fieldValue?.textAnchor?.content?.trim() ?? '';
    const confidence = field.fieldValue?.confidence ?? 0;
    if (key && value) structuredFields[normalizeFieldKey(key)] = { value, confidence };
  }

  // Full page text
  const rawText = doc.text ?? '';
  const pageConfidence = doc.pages?.[0]?.imageQualityScores?.qualityScore ?? 0;

  // Persist result
  await db.insert(documentOcrResults).values({
    documentId,
    pageNumber,
    ocrProvider: 'google_document_ai',
    processorType: isFormDocument(documentType) ? 'form_parser' : 'ocr_processor',
    rawText,
    structuredFields,
    pageConfidence,
    wordCount: rawText.split(/\s+/).length,
    characterCount: rawText.length,
    processingTimeMs: latencyMs,
    ocrStatus: 'complete',
    ocrCompletedAt: new Date(),
  });
}
```

### Fallback: AWS Textract

Used when Google Document AI is unavailable or returns confidence < 0.50 on critical pages:

```typescript
async function runTextractFallback(
  pageBytes: Buffer,
  mimeType: string
): Promise<TextractResult> {
  const { TextractClient, AnalyzeDocumentCommand } = await import('@aws-sdk/client-textract');
  const client = new TextractClient({ region: 'us-east-1' });

  const response = await client.send(new AnalyzeDocumentCommand({
    Document: { Bytes: pageBytes },
    FeatureTypes: ['FORMS', 'TABLES'],
  }));

  return parseTextractResponse(response);
}
```

---

## Entity Extraction Rules

### Entity Type Registry

For each entity type, we define extraction strategies in priority order:

```typescript
interface ExtractionStrategy {
  method: 'form_field' | 'regex' | 'nlp' | 'llm';
  fieldNames?: string[];    // form field names to check (for form_field method)
  patterns?: RegExp[];      // regex patterns (for regex method)
  prompt?: string;          // LLM prompt fragment (for llm method)
  baseConfidence: number;   // confidence assigned when this method produces a match
}

const EXTRACTION_REGISTRY: Record<string, ExtractionStrategy[]> = {

  name: [
    {
      method: 'form_field',
      fieldNames: [
        'DRIVER1_NAME', 'DRIVER 1 NAME', 'DRIVER ONE NAME',
        'DRIVER2_NAME', 'DRIVER 2 NAME', 'DRIVER TWO NAME',
        'OFFICER_NAME', 'INVESTIGATING OFFICER',
        'PASSENGER_NAME', 'WITNESS_NAME',
        'PLAINTIFF', 'DEFENDANT', 'PARTY NAME',
        'INSURED NAME', 'POLICY HOLDER', 'CLIENT NAME',
      ],
      baseConfidence: 0.93,
    },
    {
      method: 'regex',
      patterns: [
        // "Driver 1: SMITH, JOHN MICHAEL" pattern
        /(?:driver\s*[12]|witness|officer|plaintiff|defendant)[:\s]+([A-Z][A-Z\s,'-]{2,50})/gi,
        // "Name: John Smith" pattern
        /(?:name|full name)[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
      ],
      baseConfidence: 0.75,
    },
    {
      method: 'llm',
      prompt: 'Extract all person names from this text. For each name, identify their role (driver1, driver2, passenger, witness, officer, attorney, other). Return as JSON array.',
      baseConfidence: 0.80,
    },
  ],

  phone: [
    {
      method: 'form_field',
      fieldNames: [
        'DRIVER1_PHONE', 'DRIVER 1 PHONE', 'CONTACT PHONE',
        'DRIVER2_PHONE', 'WITNESS_PHONE', 'OFFICER_PHONE',
        'INSURED_PHONE', 'ADJUSTER_PHONE', 'ATTORNEY_PHONE',
      ],
      baseConfidence: 0.95,
    },
    {
      method: 'regex',
      patterns: [
        // Standard US formats: (407) 555-1234, 407-555-1234, 4075551234, +1 407 555 1234
        /(?:\+1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g,
      ],
      baseConfidence: 0.82,
    },
  ],

  address: [
    {
      method: 'form_field',
      fieldNames: [
        'DRIVER1_ADDRESS', 'DRIVER 1 ADDRESS', 'HOME ADDRESS',
        'DRIVER2_ADDRESS', 'WITNESS_ADDRESS',
        'CRASH_LOCATION', 'ACCIDENT LOCATION', 'LOCATION OF CRASH',
        'INSURED_ADDRESS', 'PROPERTY_ADDRESS',
      ],
      baseConfidence: 0.92,
    },
    {
      method: 'regex',
      patterns: [
        // "123 Main St, Orlando, FL 32801"
        /\d+\s+[A-Z][a-zA-Z\s]{3,50},\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/g,
        // "I-4 mm 85" (highway milepost)
        /(?:I-|US-|SR-|FL-|HWY\s+)\d+(?:[A-Z])?\s*(?:mm|mp|milepost)\s*\d+(?:\.\d+)?/gi,
      ],
      baseConfidence: 0.78,
    },
  ],

  vehicle: [
    {
      method: 'form_field',
      fieldNames: [
        'VIN', 'VIN_NUMBER', 'VEHICLE_ID_NUMBER',
        'LICENSE_PLATE', 'TAG_NUMBER', 'PLATE',
        'VEHICLE_MAKE', 'MAKE', 'VEH_MAKE',
        'VEHICLE_MODEL', 'MODEL', 'VEH_MODEL',
        'VEHICLE_YEAR', 'YEAR', 'VEH_YEAR',
        'VEHICLE_COLOR', 'COLOR', 'VEH_COLOR',
        'VEHICLE_TYPE', 'BODY_TYPE',
      ],
      baseConfidence: 0.94,
    },
    {
      method: 'regex',
      patterns: [
        // VIN: 17 chars, no I/O/Q
        /\b([A-HJ-NPR-Z0-9]{17})\b/g,
        // FL plate: 3 letters + 4 numbers (most common format)
        /\b([A-Z]{3}[\s-]?\d{4}|[A-Z]{2}\d[A-Z]\d{3})\b/g,
        // Year Make Model: "2019 Toyota Camry"
        /\b((?:19|20)\d{2})\s+([A-Z][a-zA-Z]+)\s+([A-Z][a-zA-Z]+)\b/g,
      ],
      baseConfidence: 0.80,
    },
  ],

  injury: [
    {
      method: 'form_field',
      fieldNames: [
        'INJURY_TYPE', 'INJURY_SEVERITY', 'INJURY_STATUS',
        'AIRBAG_DEPLOYED', 'RESTRAINT_USED',
        'TRANSPORTED_BY', 'TRANSPORTED_TO', 'EMS_RESPONSE',
      ],
      baseConfidence: 0.90,
    },
    {
      method: 'regex',
      patterns: [
        // KABCO scale (standard crash report injury codes)
        /(?:injury|inj|severity)[\s:]+([KABCOU]|killed|incapacitating|non-incapacitating|possible|no injury)/gi,
        // Medical transport
        /(?:transported|taken|transported to)\s+(?:by\s+)?([A-Za-z\s]+(?:hospital|medical|trauma|ems|fire))/gi,
      ],
      baseConfidence: 0.82,
    },
    {
      method: 'llm',
      prompt: 'Extract all injury information from this text. Include: injury type, severity (fatal/serious/moderate/minor/none), body parts affected, whether EMS responded, and hospital destination. Return as structured JSON.',
      baseConfidence: 0.78,
    },
  ],

  insurance: [
    {
      method: 'form_field',
      fieldNames: [
        'INSURANCE_COMPANY', 'INSURER', 'INSURANCE_CO',
        'POLICY_NUMBER', 'POLICY_NO', 'POLICY_#',
        'POLICY_EXPIRATION', 'POLICY_EXP',
        'ADJUSTER_NAME', 'CLAIM_NUMBER',
      ],
      baseConfidence: 0.93,
    },
    {
      method: 'regex',
      patterns: [
        // Policy number: alphanumeric with dashes
        /(?:policy|pol|policy\s*no|policy\s*#)[:\s]+([A-Z0-9]{5,20}(?:-[A-Z0-9]{2,10})*)/gi,
        // Insurance company name patterns
        /(?:insurer|insurance\s+company|carrier)[:\s]+([A-Z][A-Za-z\s&,.']{5,60}(?:insurance|mutual|indemnity|casualty|life))/gi,
      ],
      baseConfidence: 0.78,
    },
  ],

  citation: [
    {
      method: 'regex',
      patterns: [
        // Florida statute reference: "FS 316.183" or "F.S. 316.183"
        /(?:F\.?S\.?|Florida\s+Statute)[\s]+(\d+\.\d+(?:\(\d+\))?(?:\([a-z]\))?)/gi,
        // Citation number: "Citation #FL123456"
        /(?:citation|ticket|infraction)[:\s#]+([A-Z]{0,3}\d{4,12})/gi,
        // Charge description
        /(?:charged\s+with|violation|infraction)[:\s]+([A-Za-z\s\-,]+(?:speed|signal|stop|lane|right.of.way|DUI|reckless))/gi,
      ],
      baseConfidence: 0.84,
    },
  ],

  narrative: [
    {
      method: 'form_field',
      fieldNames: [
        'NARRATIVE', 'OFFICER_NARRATIVE', 'CRASH_NARRATIVE',
        'DESCRIPTION', 'HOW_CRASH_OCCURRED', 'CIRCUMSTANCES',
        'STATEMENT', 'REMARKS', 'NOTES', 'ADDITIONAL_INFO',
      ],
      baseConfidence: 0.88,
    },
    {
      method: 'llm',
      prompt: 'This is the narrative section of a crash/police report. Extract: (1) a 2-3 sentence summary of what happened, (2) the sequence of events, (3) any contributing factors mentioned, (4) any disputed facts. Return as JSON with fields: summary, sequence, factors, disputes.',
      baseConfidence: 0.82,
    },
  ],

  incident_number: [
    {
      method: 'form_field',
      fieldNames: [
        'CRASH_NUMBER', 'HSMV_NUMBER', 'CASE_NUMBER', 'REPORT_NUMBER',
        'INCIDENT_NUMBER', 'EVENT_NUMBER', 'RMS_NUMBER', 'CAD_NUMBER',
      ],
      baseConfidence: 0.97,
    },
    {
      method: 'regex',
      patterns: [
        // HSMV number: FL crash report number format
        /(?:HSMV|crash\s+report\s+no|report\s+number)[:\s]+(\d{8,12})/gi,
        // Generic case number
        /(?:case\s+(?:no|number|#)|incident\s+(?:no|number|#))[:\s]+([A-Z0-9]{5,20}(?:-\d{4})?)/gi,
      ],
      baseConfidence: 0.90,
    },
  ],

  timestamp: [
    {
      method: 'form_field',
      fieldNames: [
        'CRASH_DATE', 'CRASH_TIME', 'DATE_OF_CRASH', 'TIME_OF_CRASH',
        'DATE', 'TIME', 'INCIDENT_DATE', 'DATE_OCCURRED',
        'DATE_OF_REPORT', 'REPORT_DATE',
      ],
      baseConfidence: 0.95,
    },
    {
      method: 'regex',
      patterns: [
        // MM/DD/YYYY or MM-DD-YYYY
        /\b((?:0?[1-9]|1[012])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)\d{2})\b/g,
        // HH:MM AM/PM
        /\b((?:0?[0-9]|1[0-2]):[0-5]\d\s*(?:AM|PM|am|pm))\b/g,
        // Military time
        /\b((?:[01]\d|2[0-3])[0-5]\d)\s*(?:hours|hrs|HRS)?\b/g,
      ],
      baseConfidence: 0.88,
    },
  ],

  agency: [
    {
      method: 'form_field',
      fieldNames: [
        'REPORTING_AGENCY', 'AGENCY', 'LAW_ENFORCEMENT_AGENCY',
        'DEPARTMENT', 'JURISDICTION', 'TROOP', 'DISTRICT',
      ],
      baseConfidence: 0.95,
    },
    {
      method: 'regex',
      patterns: [
        // Florida agencies
        /\b(FHP|Florida\s+Highway\s+Patrol|OPD|Orlando\s+Police|OCSO|Orange\s+County\s+Sheriff|HCSO|Hillsborough\s+County\s+Sheriff)\b/gi,
        // Generic pattern
        /\b([A-Z][a-zA-Z\s]+(?:Police|Sheriff|Troopers|Department|Agency|Division))\b/g,
      ],
      baseConfidence: 0.85,
    },
  ],

  dob: [
    {
      method: 'form_field',
      fieldNames: ['DOB', 'DATE_OF_BIRTH', 'BIRTH_DATE', 'BIRTHDATE'],
      baseConfidence: 0.96,
    },
    {
      method: 'regex',
      patterns: [
        /(?:DOB|date\s+of\s+birth|born)[:\s]+((?:0?[1-9]|1[012])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)\d{2})/gi,
      ],
      baseConfidence: 0.87,
    },
  ],

};
```

---

## Confidence Scoring System

### Per-Entity Confidence

```typescript
interface EntityConfidenceFactors {
  extractionMethodBase: number;   // from EXTRACTION_REGISTRY
  ocrPageConfidence: number;      // OCR quality for this page
  fieldLabelMatch: number;        // 1.0 if exact match, 0.7 if fuzzy
  valueValidation: number;        // 1.0 if validated (phone format, VIN check digit), 0.8 if not
  crossValidation?: number;       // boost if same value found in multiple places
}

function computeEntityConfidence(factors: EntityConfidenceFactors): number {
  const base = factors.extractionMethodBase;
  const ocrPenalty = Math.max(0, (factors.ocrPageConfidence - 0.7) * 0.5);  // penalize low OCR confidence
  const validationBoost = (factors.valueValidation - 0.9) * 0.15;
  const crossBoost = factors.crossValidation ? (factors.crossValidation - 1.0) * 0.05 : 0;

  return Math.min(1.0, Math.max(0.0, base + ocrPenalty + validationBoost + crossBoost));
}
```

### Confidence Thresholds

| Confidence | Action |
|-----------|--------|
| >= 0.90 | Accept automatically — use in contact/incident update |
| 0.75–0.89 | Accept with flag — surfaced in UI for operator review |
| 0.50–0.74 | Hold — do not update contact/incident until reviewed |
| < 0.50 | Reject — log but do not use; flag for manual entry |

```typescript
function determineExtractionAction(confidence: number): ExtractionAction {
  if (confidence >= 0.90) return { action: 'accept', requiresReview: false };
  if (confidence >= 0.75) return { action: 'accept', requiresReview: true };
  if (confidence >= 0.50) return { action: 'hold', requiresReview: true };
  return { action: 'reject', requiresReview: true };
}
```

### Document-Level Confidence

```typescript
function computeDocumentConfidence(
  pageConfidences: number[],
  entityCount: number,
  highConfidenceEntityCount: number,
): number {
  const avgPageConfidence = pageConfidences.reduce((a, b) => a + b, 0) / pageConfidences.length;
  const highConfidenceRatio = highConfidenceEntityCount / Math.max(entityCount, 1);
  return (avgPageConfidence * 0.4) + (highConfidenceRatio * 0.6);
}
```

---

## LLM-Assisted Extraction

LLM extraction is triggered for:
1. Narrative fields (officer narrative, incident description)
2. Any page where form field extraction yields < 5 entities
3. Pages with OCR confidence < 0.70 (likely handwritten or degraded)
4. Explicit retry when regex extraction confidence < 0.60 for critical fields

```typescript
// server/services/documentExtractionService.ts

async function runLlmExtraction(
  documentId: bigint,
  pageText: string,
  documentType: string,
  missingEntityTypes: string[],
): Promise<LlmExtractionResult> {
  const systemPrompt = `You are a document intelligence system specialized in extracting structured data from ${documentType} documents. 

Extract the following entity types: ${missingEntityTypes.join(', ')}.

Rules:
- Only extract information that is clearly stated in the document. Never infer or fabricate.
- For each extracted entity, provide:
  1. The exact raw value as it appears in the document
  2. A normalized version
  3. Your confidence (0.00–1.00)
  4. The exact quote from the document that supports this extraction
- If an entity type is not present, return null for that field.
- Never merge information from multiple unrelated people.`;

  const userPrompt = `Document text:\n\n${pageText.slice(0, 6000)}\n\nExtract the requested entities. Return valid JSON only.`;

  const response = await callAnthropic(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: 2048, jsonMode: true }
  );

  const parsed = JSON.parse(response.content);

  // Write to document_extracted_entities with method='llm'
  for (const [entityType, data] of Object.entries(parsed)) {
    if (!data) continue;
    const entity = data as any;

    await db.insert(documentExtractedEntities).values({
      documentId,
      entityType,
      entityRole: entity.role ?? null,
      rawValue: entity.raw_value,
      normalizedValue: entity.normalized_value,
      extractionConfidence: entity.confidence,
      extractionMethod: 'llm',
      extractionModel: 'claude-sonnet-4-6',
      sourceText: entity.source_quote,
      extractionExplanation: `LLM extracted "${entity.raw_value}" from passage: "${entity.source_quote}"`,
    });
  }

  // Log cost
  await db.insert(agentOutcomeLog).values({
    agentType: 'document_extraction_llm',
    entityId: documentId,
    action: `extract_${missingEntityTypes.join('+')}`,
    status: 'success',
    tokensUsed: response.tokensUsed,
    latencyMs: response.latencyMs,
  });
}
```

---

## Normalization Functions

```typescript
// server/services/documentNormalizationService.ts

export function normalizeExtractedPhone(raw: string): string | null {
  // Remove all non-digits
  const digits = raw.replace(/\D/g, '');
  // US number: 10 digits, or 11 with leading 1
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;  // not a valid US number
}

export function normalizeExtractedName(raw: string): string {
  // Remove titles, excess whitespace, handle "LAST, FIRST" format
  let name = raw.trim();

  // Handle "SMITH, JOHN MICHAEL" → "John Michael Smith"
  if (/^[A-Z]+,\s+[A-Z]/.test(name)) {
    const [last, ...firstParts] = name.split(',').map(s => s.trim());
    name = `${firstParts.join(' ')} ${last}`;
  }

  // Remove common prefixes/suffixes that are not part of the name
  name = name.replace(/\b(MR|MRS|MS|DR|JR|SR|II|III|IV)\b\.?/gi, '').trim();

  // Proper case
  return name.split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeExtractedVin(raw: string): string | null {
  const vin = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (vin.length !== 17) return null;
  if (!isValidVinCheckDigit(vin)) return null;
  return vin;
}

export function normalizeExtractedPlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-\.]/g, '');
}

export function normalizeExtractedDate(raw: string): string | null {
  // Handle MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
  const patterns = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,  // MM/DD/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,    // MM-DD-YYYY
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,    // YYYY-MM-DD (already ISO)
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      const [, a, b, c] = match;
      const date = pattern === patterns[2]
        ? new Date(`${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`)
        : new Date(`${c}-${a.padStart(2,'0')}-${b.padStart(2,'0')}`);

      if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    }
  }
  return null;
}
```

---

## Incident Linking Logic

```typescript
// server/services/documentIncidentLinker.ts

async function linkDocumentToIncidents(documentId: bigint): Promise<void> {
  // Get all extracted entities for this document
  const entities = await db.select()
    .from(documentExtractedEntities)
    .where(eq(documentExtractedEntities.documentId, documentId));

  const incidentNumbers = entities
    .filter(e => e.entityType === 'incident_number' && e.extractionConfidence >= 0.75)
    .map(e => e.normalizedValue ?? e.rawValue);

  const crashDates = entities
    .filter(e => e.entityType === 'timestamp' && e.entitySubtype === 'crash_date')
    .map(e => e.normalizedValue);

  const locations = entities
    .filter(e => e.entityType === 'address' && e.entitySubtype?.includes('crash_location'))
    .map(e => e.normalizedValue ?? e.rawValue);

  // Strategy 1: Direct incident number match (highest confidence)
  for (const ref of incidentNumbers) {
    const incidents = await db.select({ id: sentinelIncidents.id })
      .from(sentinelIncidents)
      .where(
        or(
          sql`raw_data->>'hsmv_number' = ${ref}`,
          sql`raw_data->>'case_number' = ${ref}`,
          sql`raw_data->>'incident_number' = ${ref}`,
        )
      )
      .limit(5);

    for (const incident of incidents) {
      await db.insert(documentIncidentLinks).values({
        documentId,
        incidentId: incident.id,
        linkType: 'primary',
        linkConfidence: 0.95,
        linkReason: `Incident number "${ref}" matched sentinel_incidents.raw_data`,
        linkMethod: 'incident_number_match',
        createdBy: 'document_intelligence',
      }).onConflictDoNothing();
    }
  }

  // Strategy 2: Location + date match (medium confidence)
  if (locations.length > 0 && crashDates.length > 0) {
    for (const county of extractCountiesFromLocations(locations)) {
      for (const date of crashDates) {
        const incidents = await db.select({ id: sentinelIncidents.id })
          .from(sentinelIncidents)
          .where(and(
            sql`LOWER(county) = LOWER(${county})`,
            sql`DATE(incident_date) = DATE(${date})`,
          ))
          .limit(10);

        for (const incident of incidents) {
          await db.insert(documentIncidentLinks).values({
            documentId,
            incidentId: incident.id,
            linkType: 'corroborating',
            linkConfidence: 0.72,
            linkReason: `County "${county}" + date "${date}" matched`,
            linkMethod: 'location_date_match',
            createdBy: 'document_intelligence',
          }).onConflictDoNothing();
        }
      }
    }
  }
}
```

---

## Contact Resolution from Document Entities

```typescript
// server/services/documentContactResolver.ts

async function resolvePersonEntitiesFromDocument(documentId: bigint): Promise<void> {
  const personEntities = await db.select()
    .from(documentExtractedEntities)
    .where(and(
      eq(documentExtractedEntities.documentId, documentId),
      inArray(documentExtractedEntities.entityType, ['name']),
      sql`extraction_confidence >= 0.70`,
    ));

  for (const nameEntity of personEntities) {
    // Find associated phone and address for this person (same role)
    const associatedPhone = entities.find(e =>
      e.entityType === 'phone' && e.entityRole === nameEntity.entityRole
    );
    const associatedAddress = entities.find(e =>
      e.entityType === 'address' && e.entityRole === nameEntity.entityRole
    );

    // Attempt exact match on phone (highest confidence dedup)
    if (associatedPhone?.normalizedValue) {
      const existing = await db.select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.phone, associatedPhone.normalizedValue))
        .limit(1);

      if (existing.length > 0) {
        // Link document to existing contact
        await db.insert(documentContactLinks).values({
          documentId,
          contactId: existing[0].id,
          entityId: nameEntity.id,
          role: nameEntity.entityRole ?? 'unknown',
          roleConfidence: nameEntity.extractionConfidence,
          resolutionMethod: 'exact_phone_match',
          createdBy: 'document_intelligence',
        }).onConflictDoNothing();

        // Update entity resolution state
        await db.update(documentExtractedEntities)
          .set({
            resolutionStatus: 'resolved_existing',
            resolvedToContactId: existing[0].id,
            resolvedAt: new Date(),
            resolutionConfidence: 0.95,
            resolutionMethod: 'exact_phone_match',
          })
          .where(eq(documentExtractedEntities.id, nameEntity.id));

        continue;
      }
    }

    // No existing contact — create new if sufficient confidence
    const shouldCreate = nameEntity.extractionConfidence >= 0.75
      && !isPlaceholderName(nameEntity.normalizedValue);

    if (shouldCreate) {
      const [newContact] = await upsertContact({
        firstName: parseFirstName(nameEntity.normalizedValue!),
        lastName: parseLastName(nameEntity.normalizedValue!),
        phone: associatedPhone?.normalizedValue ?? null,
        address: associatedAddress?.normalizedValue ?? null,
        leadType: 'individual',
        sourcePipeline: 'document_intelligence',
        sourceConfidence: nameEntity.extractionConfidence,
        subAccountId: await getDocumentSubAccount(documentId),
      });

      await db.insert(documentContactLinks).values({
        documentId,
        contactId: newContact.id,
        entityId: nameEntity.id,
        role: nameEntity.entityRole ?? 'unknown',
        resolutionMethod: 'new_contact_from_document',
        createdBy: 'document_intelligence',
      });

      // Record enrichment event
      await db.insert(contactEnrichmentEvents).values({
        contactId: newContact.id,
        eventType: 'contact_created_from_document',
        source: 'document_intelligence',
        confidence: nameEntity.extractionConfidence,
        triggeredBy: 'document_intelligence',
        metadata: { documentId, entityId: nameEntity.id, documentType: 'crash_report' },
      });
    }
  }
}
```

---

## Extraction Observability

Every OCR and extraction operation logs to `agent_outcome_log`:

```sql
-- OCR job completion
INSERT INTO agent_outcome_log (agent_type, entity_id, action, status, latency_ms, tokens_used, metadata)
VALUES ('ocr_pipeline', $documentId, 'ocr_page_' || $pageNumber, $status, $latencyMs, 0,
  '{ "provider": "google_document_ai", "page_confidence": 0.94, "word_count": 412 }');

-- Entity extraction completion
INSERT INTO agent_outcome_log (agent_type, entity_id, action, status, latency_ms, tokens_used)
VALUES ('entity_extraction', $documentId, 'extract_entities', 'success', $latencyMs, 0);

-- LLM extraction
INSERT INTO agent_outcome_log (agent_type, entity_id, action, status, latency_ms, tokens_used)
VALUES ('llm_extraction', $documentId, 'llm_extract_narrative', 'success', $latencyMs, $tokens);
```

---

## Cost Controls

```typescript
const OCR_COST_GUARDS = {
  maxPagesPerDocument: 200,           // hard limit per document
  maxDocumentsPerDay: 500,            // daily cap across all documents
  minSeverityScoreForOcr: 0.40,      // don't OCR low-importance documents
  llmExtractionDailyCap: 200,        // max LLM calls per day
  llmExtractionTokenCap: 100_000,    // max tokens per day
};

// Before running OCR:
async function shouldRunOcr(documentId: bigint, incidentId?: number): Promise<boolean> {
  // Check daily document cap
  const todayCount = await getDailyOcrCount();
  if (todayCount >= OCR_COST_GUARDS.maxDocumentsPerDay) {
    await logSystemEvent('warn', 'ocr_pipeline', `Daily OCR cap reached: ${todayCount}`);
    return false;
  }

  // Check incident severity if linked
  if (incidentId) {
    const [incident] = await db.select({ severity: sentinelIncidents.severity })
      .from(sentinelIncidents)
      .where(eq(sentinelIncidents.id, incidentId))
      .limit(1);

    const severityScore = severityToScore(incident?.severity);
    if (severityScore < OCR_COST_GUARDS.minSeverityScoreForOcr) return false;
  }

  return true;
}
```
