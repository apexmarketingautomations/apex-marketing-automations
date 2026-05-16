# Sentinel Skip Trace Optimization

> Engineering reference for the BatchData cost-control system inside the Apex Signal Engine.

---

## Why This Matters

BatchData skip trace costs $0.02–0.05 per call. At scale (hundreds of crash contacts per day) this becomes a meaningful line item. The Source Intelligence Guard ensures we never pay BatchData for a phone number we already have from a better source.

---

## The 3-Layer Guard Architecture

Every skip trace request passes through three gates in sequence. A `false` at any gate short-circuits the pipeline — BatchData is never called.

### Layer 1 — Kill Switch

```typescript
if (isBatchDataDisabled()) {
  console.log(`[ENRICHMENT-WORKER] BatchData disabled — skipping`);
  return { enriched: false };
}
```

**Trigger**: `BATCHDATA_DISABLED=true` env var (Railway variable).  
**Use case**: Billing pause, API outage, emergency cost stop.  
**Recovery**: Remove env var → all pending contacts auto-process on next retry.

### Layer 2 — Source Phone Guard

```typescript
if (!force && contact.phone) {
  const alreadySourceMatched = contact.skipTraceStatus === "source_matched";
  if (!alreadySourceMatched) {
    await db.update(contacts)
      .set({ skipTraceStatus: "source_matched" })
      .where(eq(contacts.id, contactId));
  }
  return { enriched: false };
}
```

**Trigger**: `contact.phone` is non-null (populated by FLHSMV, DMV plate lookup, or CAD ingest).  
**Effect**: Sets `skipTraceStatus = "source_matched"` (terminal) and returns without calling BatchData.  
**Semantic**: "We already have a phone from a first-party government source — BatchData would be redundant spend."

### Layer 3 — Idempotency Guard

```typescript
if (!force && contact.skipTraceStatus === "matched") {
  return { enriched: false };
}
```

**Trigger**: Contact was already successfully skip-traced in a previous run.  
**Effect**: No-op.  
**Note**: Use `force: true` in the job payload to bypass this gate (e.g., when re-enriching after a name correction).

---

## Phone Confidence Scale

When multiple sources compete for `contact.phone`, the highest-confidence value wins. BatchData (0.72) never overwrites a registration (0.90) or FLHSMV (0.85) phone.

| Confidence | Source | `skipTraceStatus` set to |
|------------|--------|--------------------------|
| 0.95 | Google geocode (verified address only, no phone) | — |
| 0.90 | DMV plate-to-owner registration | `source_matched` |
| 0.88 | Driver license record | `source_matched` |
| 0.85 | FLHSMV crash report | `source_matched` |
| 0.72 | BatchData skip trace | `matched` |
| 0.30 | Plaintiff self-assertion | `source_matched` (if phone present) |

---

## BatchData Response Parsing

The response schema has evolved across BatchData API versions. The worker tries three known paths:

```typescript
const phone =
  data?.results?.[0]?.phones?.[0]?.number ||   // v2 phones array
  data?.results?.[0]?.phone                  ||   // v1 flat phone
  data?.phone                                ||   // root-level fallback
  null;
```

A `null` phone sets `skipTraceStatus = "no_match"`. This is **not** a failure — it means BatchData had no record, not that the API errored.

### Mailing Address Extraction

```typescript
const mailingAddress =
  data?.results?.[0]?.mailingAddress ||
  data?.results?.[0]?.address?.full  ||
  null;
```

If found, `mailingAddress` is written to both `contact.mailingAddress` and `contact.probableResidence`. It also upgrades `contact.address` if its confidence (0.72) exceeds the existing `addressConfidence`.

---

## Status State Machine

```
null ──────────────────────────────────────→ source_matched  (Layer 2 fired)
null ──→ pending ──→ matched                                 (BatchData found phone)
null ──→ pending ──→ no_match                                (BatchData: no record)
null ──→ pending ──→ failed ──(retry)──→ matched/no_match    (transient error)
matched ──────────────────────────────────→ matched          (idempotent, Layer 3)
```

`source_matched` and `matched` are both **terminal** — no further skip trace will run unless `force: true` is passed.

---

## Dead Letter Queue Handling

If BatchData returns a non-2xx response or times out after 20 seconds, the job throws and BullMQ retries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | 5 s |
| 2 | 25 s |
| 3 | 125 s |

After 3 failed attempts, the `failed` event fires and:

1. `captureWorkerError("ENRICHMENT-WORKER", "skip_trace", err, { contactId, jobId, attempts })` → Sentry
2. `sendToDeadLetterQueue({ sourceQueue: "apex-enrichment", ... })` → `apex-dead-letters` queue
3. `contact.skipTraceStatus` is set to `"failed"` (not `"no_match"` — this is a recoverable error)

Operators can replay dead-lettered skip trace jobs via:

```
POST /api/admin/dead-letters/:jobId/replay
POST /api/admin/dead-letters/replay-all?sourceQueue=apex-enrichment
```

---

## Forcing Re-Enrichment

To bypass all three guard layers for a specific contact:

```typescript
await enqueueEnrichment({
  jobType: "skip_trace",
  contactId: 12345,
  subAccountId: 1,
  force: true,  // bypasses Layers 2 and 3
});
```

`force: true` does **not** bypass Layer 1 (kill switch). The kill switch is absolute.

---

## Monitoring

Key log lines to watch in Axiom (`apex-logs` dataset):

| Event | Meaning |
|-------|---------|
| `Contact X already skip-traced — skipping` | Layer 3 fired (idempotent) |
| `Contact X already has source phone — promoted to source_matched` | Layer 2 fired (cost saved) |
| `BatchData disabled — skipping skip_trace` | Layer 1 kill switch active |
| `✓ skip_trace contact=X phone=found` | Success — phone acquired |
| `✓ skip_trace contact=X phone=not found` | Success — no BatchData record |
| `BatchData HTTP 4xx/5xx for contact X` | API error — will retry |
| `Job enrich-skip_trace-X failed (3/3)` | Exhausted — sent to DLQ |

---

## Cost Projection

At 200 crash contacts/day with a 40% source-phone hit rate (Layer 2):

| Scenario | Daily calls | Monthly cost (@ $0.03/call) |
|----------|-------------|------------------------------|
| No guard | 200 | ~$180 |
| With Source Intelligence Guard | 120 | ~$108 |
| Savings | 80 calls | ~$72/month |

At higher volumes the savings scale linearly. The kill switch provides an emergency stop at $0.
