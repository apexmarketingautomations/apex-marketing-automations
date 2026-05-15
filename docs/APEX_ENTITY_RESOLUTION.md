# APEX ENTITY RESOLUTION ENGINE
**Verified Identity from Raw Signals**
Version: 1.0 | Generated: 2026-05-15
Phase: 4A (Partial — lead_type + export_eligible live)

---

## Purpose

The Entity Resolution Engine is the layer that converts raw signal participants into verified, deduplicated, confidence-scored entities. It sits between Incident Intelligence and CRM Intelligence.

A signal says "a crash happened involving a vehicle registered to someone." Entity Resolution answers: "Who exactly? Are they already in our system? Is this record strong enough to act on?"

**Core guarantee:** A verified human entity — not a placeholder, not an attorney, not a business record — with a real name, real contact method, and a confidence score that reflects the quality of that identity.

---

## Entity Types

| Type | `lead_type` Value | Export Eligible | Description |
|------|------------------|----------------|-------------|
| Individual | `individual` | ✅ Yes | Real human with verified name + phone/email |
| Placeholder | `placeholder` | ❌ No | Signal participant with no identity resolved |
| Recall Entity | `recall_entity` | ❌ No | CPSC/product recall claimant or affected party |
| OSHA Entity | `osha_entity` | ❌ No | OSHA violation-linked party, not a direct victim |
| Local Business | `local_business` | ❌ No | Business license or permit record |
| Attorney | `attorney` | ❌ No | Legal professional identified in a filing |

**Only `individual` entities are export-eligible. All others are operational records.**

---

## Entity Resolution Requirements

### 1. Identity Confidence Scoring

Every resolved entity must carry a confidence score (0.000–1.000) derived from:

| Factor | Max Score | Notes |
|--------|-----------|-------|
| First name present and not placeholder | +0.20 | "John" scores; "Unknown", "Driver", blank do not |
| Last name present | +0.15 | |
| Phone present and normalized | +0.25 | E.164 format, not a toll-free or fake number |
| Email present and normalized | +0.20 | Must pass format + domain validation |
| Address present | +0.10 | Street + city + state minimum |
| Skip trace verified | +0.10 | BatchData confirmed the identity |
| DOB or age present | +0.05 | Tiebreaker for common names |
| Source confidence | ×0.90 to ×1.00 | Multiplier based on source_confidence of originating signal |

**Identity confidence thresholds:**
```
>= 0.80  → Verified entity — export_eligible = true (if lead_type = individual)
0.50–0.79 → Partial identity — hold for enrichment, not export_eligible
< 0.50   → Placeholder — do not promote to contact layer
```

### 2. Placeholder Detection

A contact is a **placeholder** if any of the following are true:

```typescript
const PLACEHOLDER_NAMES = [
  "unknown", "driver", "victim", "occupant", "passenger",
  "injured", "pedestrian", "claimant", "defendant", "party",
  "male", "female", "adult", "juvenile", "n/a", "na", "none", ""
];

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const normalized = name.toLowerCase().trim();
  return PLACEHOLDER_NAMES.includes(normalized) || normalized.length < 2;
}
```

Placeholders must be set as `lead_type = 'placeholder'` and `export_eligible = false`.

### 3. Duplicate Detection

Before creating a new contact, the resolution engine must check for existing matches:

**Exact match (high confidence):**
```sql
SELECT id FROM contacts
WHERE sub_account_id = $subAccountId
  AND (
    (phone IS NOT NULL AND phone = $normalizedPhone)
    OR (email IS NOT NULL AND email = $normalizedEmail)
  )
LIMIT 1;
```

**Fuzzy match (medium confidence — requires human review):**
```sql
SELECT id, first_name, last_name, phone, email FROM contacts
WHERE sub_account_id = $subAccountId
  AND LOWER(first_name) = LOWER($firstName)
  AND LOWER(last_name) = LOWER($lastName)
  AND (
    county = $county
    OR source_pipeline = $sourcePipeline
  )
LIMIT 5;
```

**Merge rule:**
- Exact phone or email match → merge (update existing, do not create new)
- Name + county + pipeline match → flag for manual review
- No match → create new contact

### 4. Enrichment Lineage

Every identity mutation must be traceable. The `contact_enrichment_events` table records:

```
event_type:
  'skip_trace_attempt'     — skip trace triggered
  'phone_appended'         — phone number added
  'email_appended'         — email address added
  'address_verified'       — address confirmed
  'identity_confirmed'     — confidence score crossed 0.80
  'identity_downgraded'    — subsequent lookup returned weaker data (blocked)
  'lead_type_changed'      — entity type reclassified
  'export_eligible_set'    — export_eligible flipped to true
  'export_eligible_cleared' — export_eligible flipped to false (rare)
  'duplicate_merged'       — this contact merged into an existing record
```

**Critical constraint:** Verified identity CANNOT be overwritten by weaker data.

```typescript
export function shouldUpdateField(
  existing: string | null,
  incoming: string | null,
  existingConfidence: number,
  incomingConfidence: number,
): boolean {
  // Never overwrite a verified value with nothing
  if (existing && !incoming) return false;
  // Never overwrite high-confidence with low-confidence
  if (existing && incomingConfidence < existingConfidence - 0.1) return false;
  // Accept upgrade
  return true;
}
```

### 5. Source Confidence

Every enrichment source has a known reliability rating:

| Source | `source_confidence` | Notes |
|--------|-------------------|-------|
| BatchData skip trace | 0.85 | High-quality people data |
| Sentinel / FDOT crash reports | 0.70 | Official source, but limited PII |
| Hillsborough court filings | 0.80 | Verified court data |
| CourtListener | 0.75 | Public court records |
| Apify scraped data | 0.55 | Variable — depends on source site |
| Manual entry (operator) | 0.90 | Operator-verified, highest trust |
| Unknown / unset | 0.50 | Default — treat with caution |

---

## Entity Resolution Pipeline

```
Incident created
  → Parse participants from raw_data
  → For each participant:
      1. Check lead_type eligibility (is this a person?)
      2. Run isPlaceholderName() check
      3. Compute initial identity_confidence
      4. Dedup check (exact → fuzzy)
      5. If new: INSERT into contacts (export_eligible = false)
      6. If existing: merge fields (confidence-guarded)
      7. Emit contact_created or contact_merged event
      8. Queue for enrichment if confidence < 0.80
  → After enrichment:
      9. Re-run identity_confidence computation
      10. If >= 0.80 and lead_type = individual:
          SET export_eligible = true
          Emit export_eligible_set event
```

---

## Entity Resolution Tables

### `contact_ai_profiles` (Stage 3 — schema live, 0 rows)

Stores entity-level intelligence, including resolution confidence:

```sql
CREATE TABLE contact_ai_profiles (
  id BIGSERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  intent_confidence NUMERIC(5,4),         -- 0.0000–1.0000 overall entity confidence
  intent_signals JSONB,                    -- raw factors that drove the score
  persona_tag VARCHAR(100),               -- 'crash_victim_individual', 'legal_claimant'
  enrichment_summary TEXT,                -- human-readable summary of resolved identity
  quality_grade VARCHAR(5),               -- A+, A, B, C, D
  last_scored_at TIMESTAMPTZ,
  scoring_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `contact_enrichment_events` (Live)

```sql
-- Already created in Stage 3.5 recovery
-- event_type, field_changed, old_value, new_value, source, confidence_before, confidence_after
```

---

## Entity Classification Rules

### Crash Signal Entity Classification

```typescript
function classifyCrashParticipant(participant: RawParticipant): LeadType {
  if (participant.role === 'attorney' || participant.isLegalRepresentative) {
    return 'attorney';
  }
  if (participant.entityType === 'business' || participant.isCompany) {
    return 'local_business';
  }
  if (isPlaceholderName(participant.firstName)) {
    return 'placeholder';
  }
  return 'individual';
}
```

### Legal Signal Entity Classification

```typescript
function classifyLegalParticipant(party: LegalParty): LeadType {
  if (party.partyType === 'attorney' || party.barNumber) return 'attorney';
  if (party.isOrganization || party.entityType === 'corporation') return 'local_business';
  if (party.signalType === 'recall') return 'recall_entity';
  if (party.signalType === 'osha') return 'osha_entity';
  if (isPlaceholderName(party.name)) return 'placeholder';
  return 'individual';
}
```

---

## Phase 4A Deliverables (Entity Resolution)

- [x] `lead_type` column on contacts (live, backfilled)
- [x] `export_eligible` boolean on contacts (live, 990 true)
- [x] `deriveExportEligible()` in contactUpsertService
- [x] `isPlaceholderName()` helper function
- [ ] `identity_confidence` column on contacts (Phase 4B)
- [ ] `contact_ai_profiles` population — confidence scoring job
- [ ] Duplicate detection in contactUpsertService (dedup check before INSERT)
- [ ] `enrichment_lineage` — shouldUpdateField() guard on every merge
- [ ] `GET /api/contacts/:id/entity-confidence` endpoint
