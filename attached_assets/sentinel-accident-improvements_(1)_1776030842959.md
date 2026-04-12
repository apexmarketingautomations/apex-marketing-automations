# Sentinel Accident — Improvement Patches

Five improvement areas. Apply in order.
`sentinel-accident-v2.ts` is your new utility module — copy it to `server/`.

---

## Before you start

These changes touch the accident side only.
Home Services niche is not affected.
The Phase 1 niche branch remains in place.

Files changed:
- `server/sentinel-accident-v2.ts` — new utility module (copy from downloads)
- `server/sentinel.ts` — scheduler replaced, feed function updated
- `server/routes/sentinel.ts` — scan handler gets merge path + filtering
- `client/src/pages/sentinel.tsx` — action queue, priority sort, triage UI

---

## PATCH 1 — Resilient scraper

### 1a — Replace `processFHPHSMVFeed` in `server/sentinel.ts`

The existing function uses hardcoded column indices. Replace it with a call
to the new v2 function that detects headers at runtime.

```typescript
// ADD at top of server/sentinel.ts with other imports:
import {
  processFHPHSMVFeedV2,
  buildCrashMergeUpdate,
  resolveGeofenceTarget,
  getPollSchedule,
  classifyCrashSeverity,
} from './sentinel-accident-v2';

// REPLACE the existing processFHPHSMVFeed function body.
// Keep the function name and export signature — do not change the call sites.
// The v2 function returns { incidents, health } — adapt the wrapper:

export async function processFHPHSMVFeed(): Promise<SentinelIncidentRaw[]> {
  const { incidents, health } = await processFHPHSMVFeedV2();

  if (!health.ok) {
    console.warn('[SENTINEL] Scraper health degraded:', health.warnings);
    // health warnings are logged — return whatever was parsed
    // Callers get partial results rather than silent empty
  }

  // Map CrashIncidentRaw back to SentinelIncidentRaw shape
  // so existing callers are unaffected
  return incidents.map(inc => ({
    id:             inc.id,
    type:           inc.type,
    location:       inc.location,
    lat:            inc.lat,
    lng:            inc.lng,
    severity:       inc.severity,
    actionRequired: inc.actionRequired,
    source:         inc.source,
    state:          inc.state,
    county:         inc.county,
    remarks:        inc.remarks,
    received:       inc.received,
    distanceMiles:  inc.distanceMiles,
    googleMaps:     inc.googleMaps,
    // New fields — downstream code reads from rawPayload so these are additive
    _operatorPriority: inc.operatorPriority,
    _priorityScore:    inc.priorityScore,
  })) as unknown as SentinelIncidentRaw[];
}
```

### 1b — Health logging in `processLiveSentinelFeed`

Add structured health logging after the feed call:

```typescript
export async function processLiveSentinelFeed(): Promise<SentinelIncidentRaw[]> {
  const { incidents, health } = await processFHPHSMVFeedV2();

  // Log scraper health for ops visibility
  if (!health.ok) {
    console.error('[SENTINEL LIVE FEED] Scraper health DEGRADED:', {
      warnings:           health.warnings,
      dataRowCount:       health.dataRowCount,
      usingFallback:      health.usingFallbackColumns,
      detectedHeaders:    health.detectedHeaders,
    });
  } else {
    console.log(`[SENTINEL LIVE FEED] Scraper OK — ${health.dataRowCount} rows parsed`);
  }

  // Map to SentinelIncidentRaw shape (same as above)
  const results = incidents.map(inc => ({
    ...inc,
    _operatorPriority: inc.operatorPriority,
    _priorityScore:    inc.priorityScore,
  })) as unknown as SentinelIncidentRaw[];

  console.log(`[SENTINEL] Live scan complete — ${results.length} FL crashes found`);

  // Existing webhook logic unchanged
  const webhookUrl = process.env.APEX_WEBHOOK_URL;
  if (webhookUrl && results.length > 0) {
    for (const crash of results) {
      try {
        await axios.post(webhookUrl, {
          type:           crash.type,
          county:         crash.county,
          distance_miles: crash.distanceMiles,
          google_maps:    crash.googleMaps,
          timestamp:      crash.received,
          lat:            crash.lat,
          lng:            crash.lng,
          severity:       crash.severity,
          location:       crash.location,
          remarks:        crash.remarks,
        });
      } catch (e: any) {
        console.error('[SENTINEL] Webhook fire failed:', e.message);
      }
    }
  }

  return results;
}
```

---

## PATCH 2 — Severity reclassification

The v2 module's `classifyCrashSeverity()` now drives severity.
The old `determineSeverity()` can remain for backward compatibility
but is no longer called by the main feed path.

No additional code changes needed beyond Patch 1 — the new feed
function already uses `classifyCrashSeverity()` internally.

**What changed in practice:**
- A fender bender in Lee County is now `medium` severity, not `critical`
- `critical` is reserved for fatalities, entrapments, extrications
- `high` covers serious injuries, rollovers, fire rescue responses
- `operatorPriority` (urgent/standard/monitor) carries the territory signal

**rawPayload additions** — add these when creating incidents in the scan route:

```typescript
rawPayload: {
  // ... existing fields ...
  operatorPriority: inc._operatorPriority ?? 'monitor',
  priorityScore:    inc._priorityScore    ?? 0,
},
```

---

## PATCH 3 — Merge path for existing incidents

### In `server/routes/sentinel.ts` scan handler

Find the accident incident creation loop. It currently does:

```typescript
const existing = await storage.getSentinelIncidentByHash(parsed.data.subAccountId, hash);
if (!existing) {
  const record = await storage.createSentinelIncident({ ... });
  created.push(record);
}
```

Replace with the merge-aware version:

```typescript
const existing = await storage.getSentinelIncidentByHash(
  parsed.data.subAccountId,
  hash,
);

if (!existing) {
  // New incident — create as before
  const record = await storage.createSentinelIncident({
    subAccountId:     parsed.data.subAccountId,
    sourceHash:       hash,
    title:            inc.type,
    description:      `${inc.type} at ${inc.location}. ${inc.distanceMiles !== 'unknown' ? inc.distanceMiles + ' mi from HQ.' : ''} County: ${inc.county || 'FL'}. ${inc.remarks || ''} [${inc.source.toUpperCase()}]`,
    location:         inc.location,
    severity:         inc.severity || 'medium',
    rawPayload: {
      id:               inc.rawPayload?.id,
      lat:              inc.lat,
      lng:              inc.lng,
      type:             inc.type,
      source:           inc.source,
      state:            inc.state,
      county:           inc.county,
      remarks:          inc.remarks,
      received:         inc.received,
      distanceMiles:    inc.distanceMiles,
      googleMaps:       inc.googleMaps,
      operatorPriority: (inc as any)._operatorPriority ?? 'monitor',
      priorityScore:    (inc as any)._priorityScore    ?? 0,
    },
    actionStatus:     'pending',
    smsSent:          false,
    geofenceDeployed: false,
  });
  created.push(record);

} else {
  // Existing incident — check for severity upgrade
  const mergeResult = buildCrashMergeUpdate({
    existingSeverity:     existing.severity || 'low',
    existingActionStatus: existing.actionStatus || 'pending',
    newSeverity:          inc.severity || 'low',
    newDescription:       inc.remarks || null,
    newRawPayload: {
      ...(existing.rawPayload as object || {}),
      remarks:   inc.remarks,
      received:  inc.received,
      priorityScore: (inc as any)._priorityScore ?? 0,
    },
  });

  if (
    mergeResult &&
    (mergeResult.action === 'severity_upgraded' || mergeResult.action === 're_pended') &&
    Object.keys(mergeResult.updates).length > 0
  ) {
    const updated = await storage.updateSentinelIncident(existing.id, mergeResult.updates);
    console.log(
      `[SENTINEL MERGE] Incident ${existing.id} — ${mergeResult.action}: ` +
      `${existing.severity} → ${inc.severity}`
    );
    if (mergeResult.action === 're_pended') {
      // Count as a "found" incident since it re-enters the action queue
      created.push(updated);
    }
  }
  // severity_downgraded_skip and skipped: do nothing
}
```

---

## PATCH 4 — Smart polling scheduler

### In `server/sentinel.ts`, replace `startSentinelScheduler`

```typescript
// REPLACE startSentinelScheduler with this version:

export function startSentinelScheduler(): void {
  if (sentinelScanTimer) {
    console.log("[SENTINEL] Scheduler already running");
    return;
  }

  const BASE_INTERVAL_MS = 15 * 60 * 1000; // 15 min base, compressed during peak hours

  console.log("[SENTINEL] Background scheduler started with smart polling");

  const runScan = () => {
    processLiveSentinelFeed()
      .then(results => {
        const schedule = getPollSchedule(BASE_INTERVAL_MS);
        console.log(
          `[SENTINEL] Scheduled scan complete: ${results.length} incident(s). ` +
          `Next poll in ${Math.round(schedule.intervalMs / 60000)}m (${schedule.reason})`
        );
        // Reschedule dynamically based on current peak status
        sentinelScanTimer = setTimeout(runScan, schedule.intervalMs) as any;
      })
      .catch(err => {
        console.error(`[SENTINEL] Scheduled scan error: ${err.message}`);
        // On error, retry after 5 minutes regardless of peak status
        sentinelScanTimer = setTimeout(runScan, 5 * 60_000) as any;
      });
  };

  // Initial delay: 30 seconds after startup (unchanged from original)
  sentinelScanTimer = setTimeout(runScan, 30_000) as any;
}

export function stopSentinelScheduler(): void {
  if (sentinelScanTimer) {
    clearTimeout(sentinelScanTimer);  // Note: now using timeout not interval
    sentinelScanTimer = null;
  }
  console.log("[SENTINEL] Scheduler stopped");
}
```

**Note for builder:** The scheduler type changes from `setInterval` to `setTimeout`
(recursive) so the interval can be dynamic. Change the type declaration:

```typescript
// CHANGE:
let sentinelScanTimer: ReturnType<typeof setInterval> | null = null;
// TO:
let sentinelScanTimer: ReturnType<typeof setTimeout> | null = null;
```

---

## PATCH 5 — Geofence coordinate validation

### In `server/routes/sentinel.ts` deploy-geofence route

After the Home Services source guard (from Level 2), add coordinate validation:

```typescript
// After the Home Services guard, before calling deployGeofenceAd:

import { resolveGeofenceTarget } from '../sentinel-accident-v2';

// Resolve the best available targeting input
const geoTarget = resolveGeofenceTarget({
  lat:      rawPayload?.lat,
  lng:      rawPayload?.lng,
  location: incident.location,
});

if (!geoTarget) {
  return res.status(400).json({
    error:  "Cannot deploy geofence — no valid coordinates or address available for this incident.",
    code:   "geofence_no_target",
  });
}

// Pass resolved target to deployGeofenceAd
const geoResult = await deployGeofenceAd({
  id:       incident.id,
  location: incident.location || "",
  // Use validated coordinates if available, otherwise null (address fallback handled in deployGeofenceAd)
  lat:      geoTarget.type === 'coordinates' ? geoTarget.lat : null,
  lng:      geoTarget.type === 'coordinates' ? geoTarget.lng : null,
  title:    incident.title || undefined,
}, radius, metaCreds);

// Log which targeting type was used
console.log(
  `[SENTINEL GEOFENCE] Deployed via ${geoTarget.type} targeting to ${incident.location}`
);
```

---

## PATCH 6 — Operator action queue (frontend)

### In `client/src/pages/sentinel.tsx`

#### 6a — Sort incidents by priority score before rendering

Find where `pendingIncidents` and `actionedIncidents` are computed and add sort:

```typescript
// REPLACE:
const pendingIncidents  = filteredIncidents.filter(i => i.actionStatus === 'pending');
const actionedIncidents = filteredIncidents.filter(i => i.actionStatus !== 'pending');
const criticalCount     = filteredIncidents.filter(i => i.severity === 'critical' || i.severity === 'high').length;

// WITH:
const getPriorityScore = (i: SentinelIncident) =>
  (i.rawPayload as any)?.priorityScore ?? 0;

const pendingIncidents = filteredIncidents
  .filter(i => i.actionStatus === 'pending')
  .sort((a, b) => getPriorityScore(b) - getPriorityScore(a));  // highest score first

const actionedIncidents = filteredIncidents
  .filter(i => i.actionStatus !== 'pending')
  .sort((a, b) => new Date(b.detectedAt as any).getTime() - new Date(a.detectedAt as any).getTime());

const criticalCount  = filteredIncidents.filter(i => i.severity === 'critical' || i.severity === 'high').length;
const urgentCount    = filteredIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'urgent').length;
```

#### 6b — Add operator priority badge to IncidentCard

Inside the existing `IncidentCard` component, after the severity badge, add:

```tsx
{/* Operator priority badge — add after the existing severity span */}
{(() => {
  const priority = (incident.rawPayload as any)?.operatorPriority;
  if (priority === 'urgent') return (
    <span className="text-[8px] bg-red-500/30 text-red-300 px-1.5 py-0.5 rounded font-black border border-red-500/40">
      IN TERRITORY
    </span>
  );
  if (priority === 'monitor') return (
    <span className="text-[8px] bg-slate-500/20 text-slate-500 px-1.5 py-0.5 rounded font-bold">
      STATEWIDE
    </span>
  );
  return null;
})()}
```

#### 6c — Update stat cards to show urgent count

Replace the "High Priority" stat card:

```tsx
// REPLACE the existing "High Priority" card:
<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
  className="bg-[#0a0a0a] border border-orange-500/30 p-4 rounded-2xl"
  data-testid="card-urgent-incidents"
>
  <div className="flex items-center gap-2 mb-1">
    <Shield size={14} className="text-orange-500" />
    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">In Territory</p>
  </div>
  <p className="text-3xl font-black text-white">{urgentCount}</p>
  <p className="text-[9px] text-slate-600 mt-1">urgent priority</p>
</motion.div>
```

#### 6d — Add bulk acknowledge for monitor-only incidents

Add a button above the "Previously Actioned" divider in the main return:

```tsx
{/* Bulk acknowledge statewide-only incidents */}
{pendingIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor').length > 3 && (
  <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 mb-2">
    <p className="text-slate-400 text-xs">
      {pendingIncidents.filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor').length} statewide-only crashes pending
    </p>
    <button
      onClick={() => {
        const monitorIds = pendingIncidents
          .filter(i => (i.rawPayload as any)?.operatorPriority === 'monitor')
          .map(i => i.id);
        // Acknowledge each monitor-only incident
        Promise.all(monitorIds.map(id =>
          apiRequest("POST", `/api/sentinel/incidents/${id}/acknowledge`)
        )).then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
          toast({ title: `${monitorIds.length} statewide incidents acknowledged` });
        });
      }}
      className="text-xs text-slate-500 hover:text-white border border-white/10 px-3 py-1 rounded-lg hover:bg-white/5 transition-all"
    >
      Acknowledge all statewide
    </button>
  </div>
)}
```

---

## Verification checklist

- [ ] `tsc --noEmit` passes after adding import from `sentinel-accident-v2`
- [ ] Scraper logs show column detection results on first scan
- [ ] Logs say "Scraper OK" when page structure is healthy
- [ ] Logs say "USING FALLBACK COLUMN INDICES" when headers not found — not a crash
- [ ] A new crash gets `severity` based on crash type, not county
- [ ] A property-damage-only crash in Lee County shows `medium` severity, `urgent` priority
- [ ] A fatality outside territory shows `critical` severity, `monitor` priority
- [ ] Running scan twice on same data does not create duplicate incidents
- [ ] An incident that moves from `high` to `critical` between scans gets updated
- [ ] An acknowledged incident that upgrades to `critical` re-appears as pending
- [ ] Pending incidents sort by priority score — urgent/critical at top
- [ ] Geofence deploy fails cleanly (400) if no valid coords and no address
- [ ] Scheduler logs show interval compressed during evening rush
- [ ] Home Services niche accounts are not affected by any of these changes

---

## What is still out of scope (Level 3)

- Real-time push from FHP (no public WebSocket API exists — CAD ingest is the push path)
- Road-segment aware geofence ellipses (requires HERE or Google Roads API)
- Per-operator scheduler (requires multi-tenant scheduler redesign)
- Automatic incident aging / expiry (requires a background job or cron)
- Operator notes on incidents (requires a new DB column or notes table)
