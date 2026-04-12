# Sentinel Home Services — Level 3 Replit Handoff

## Status of all items in this document
**Drafted by Claude only. Nothing here is applied, verified, or compile-checked in the real project.**
Nothing is considered complete until Replit has applied it, confirmed it compiles, and verified it in the live project.

---

## Files in this handoff

| File | Action |
|------|--------|
| `sentinel-home-svc.ts` | Copy to `server/sentinel-home-svc.ts` — replaces current file |
| This document | Step-by-step apply guide |

---

## Apply order — mandatory

Groups must be applied in order. Each group has a gate.
**Do not proceed past a gate without confirming all its bullets in the real project.**

```
Group A → gate → Group B → gate → Group C → gate → Group D → gate → Group E → gate → Group F (required for deployment approval)
```

---

## Group A — Migration and config schema

### Step A1 — SQL migration

Run against the real database:

```sql
ALTER TABLE sentinel_config ADD COLUMN home_svc_config jsonb;
```

Immediately verify:
```sql
SELECT id, sub_account_id, niche, home_svc_config
FROM sentinel_config
LIMIT 20;
```
Every row must show `home_svc_config` as `NULL`. Any non-null value is unexpected — stop and investigate before continuing.

---

### Step A2 — `shared/schema.ts`

**Add one column** to the `sentinelConfig` table definition. Place it before `updatedAt`:

```typescript
homeSvcConfig: jsonb("home_svc_config"),
```

**Add these type definitions** directly in `shared/schema.ts`, below the `sentinelConfig` table definition. No imports from `server/`. These are intentionally duplicated from `server/sentinel-home-svc.ts` to preserve the shared → server boundary.

```typescript
// Sentinel Home Services config types — defined locally in shared/schema.ts
// Do NOT import these from server/sentinel-home-svc.ts (shared → server imports are invalid)

export interface SentinelHomeSvcTerritory {
  name: string;
  stateCodes: string[];   // 2-letter US state codes: ['FL', 'TX']
  counties?: string[];
  cities?: string[];
}

export interface SentinelDeliveryRule {
  id: string;
  name: string;
  serviceTypes?: string[];
  minScore?: number;       // 0–100
  territory?: string;
  signalTypes?: string[];
  action: 'auto_queue';   // only supported Level 3 action
}

export interface SentinelHomeSvcConfig {
  territories?: SentinelHomeSvcTerritory[];
  deliveryRules?: SentinelDeliveryRule[];
}
```

---

### Step A3 — `server/routes/sentinel.ts` — config PUT Zod schema

Find the Zod object inside the config PUT handler. Add `homeSvcConfig` with server-side structural validation:

```typescript
// ADD to the existing config PUT Zod object:
homeSvcConfig: z.object({
  territories: z.array(
    z.object({
      name:       z.string().min(1),
      stateCodes: z.array(z.string().length(2)).min(1),
      counties:   z.array(z.string()).optional(),
      cities:     z.array(z.string()).optional(),
    })
  ).optional(),
  deliveryRules: z.array(
    z.object({
      id:           z.string().min(1),
      name:         z.string().min(1),
      action:       z.literal('auto_queue'),
      serviceTypes: z.array(z.string()).optional(),
      signalTypes:  z.array(z.string()).optional(),
      territory:    z.string().optional(),
      minScore:     z.number().min(0).max(100).optional(),
    })
  ).optional(),
}).optional().nullable(),
```

If `homeSvcConfig` fails this Zod schema, `parsed.success` is `false` and the existing `400` response fires before any write occurs. This is the server-side validation gate.

---

### Group A gate — all bullets required before Group B

- [ ] Migration ran cleanly — all existing rows show `home_svc_config: null`
- [ ] After PUT with valid `homeSvcConfig`, immediately GET config for the same account — confirm the returned `homeSvcConfig` shape matches what was sent (field names, nesting, array contents intact)
- [ ] Round-trip `homeSvcConfig: null` — PUT null, GET returns null (not missing key, not empty object)
- [ ] Round-trip populated object — PUT object with territories and deliveryRules, GET returns identical structure
- [ ] Round-trip empty object `{}` — PUT empty object, GET returns empty object (not null, not missing)
- [ ] Existing accident accounts: GET config before and after migration — shape is identical, `homeSvcConfig` is absent or null, no existing fields disturbed
- [ ] Config PUT with invalid `homeSvcConfig` structure (e.g. territory missing `name`) returns 400
- [ ] Config PUT with syntactically valid but structurally wrong object returns 400 (server-side validation working)
- [ ] `tsc --noEmit` passes

---

## Group B — Backend Level 3 metadata logic

### Pre-conditions Replit must verify before applying

**B-PRE-1 — Storage method signature**
Open the real `storage.ts`. Find `getSentinelIncidentsFiltered`. Confirm:
- It accepts `{ since?: Date; status?: string; limit?: number }`
- `limit` is applied server-side (not post-query truncation)
- It uses `detectedAt` for the `since` filter (not a different timestamp field)

If the signature differs from the above, do not apply Group B. Bring the actual signature back — Claude will adapt the patch.

**B-PRE-2 — Dedup hash decision**
Check whether any Home Services incidents already exist in the real database:

```sql
SELECT COUNT(*) FROM sentinel_incidents
WHERE raw_payload->>'source' = 'sentinel_home_svc';
```

- If **zero**: Replit may optionally use `createHash('sha256').update(sig.id).digest('hex').substring(0, 64)` for stronger dedup. Must decide before first Home Services incident is created.
- If **non-zero**: use `Buffer.from(sig.id).toString("base64").substring(0, 64)` to match the existing records exactly.

**B-PRE-3 — Level 2 scan branch presence**
Confirm the `if (niche === 'home_services')` early-return block exists in the real project's `routes/sentinel.ts` scan handler. If it does not, Level 2 must be applied and verified first. Group B cannot be applied on top of a missing Level 2.

---

### Step B1 — `server/sentinel-home-svc.ts`

Replace the current file with the `sentinel-home-svc.ts` from this handoff. It contains Level 2 content (unchanged) plus Level 3 additions appended at the bottom.

Verify the file landed correctly:
```bash
grep -c "export function\|export interface\|export const\|export type" server/sentinel-home-svc.ts
# Expected: 16
```

---

### Step B2 — `server/routes/sentinel.ts` — imports

```typescript
// BEFORE:
import { fetchHomeSvcSignals } from "../sentinel-home-svc";
import type { HomeSvcSignal } from "../sentinel-home-svc";

// AFTER:
import {
  fetchHomeSvcSignals,
  scoreHomeSvcOpportunity,
  resolveTerritory,
  findClusterMetadata,
  evaluateDeliveryRules,
  aggregateMarketHeat,
} from "../sentinel-home-svc";
import type { HomeSvcSignal, HomeSvcConfigShape } from "../sentinel-home-svc";
```

---

### Step B3 — `server/routes/sentinel.ts` — replace Home Services scan branch

Find the existing `if (niche === 'home_services') { ... }` block in the scan handler. Replace its entire body with the following. The accident code after this block does not change.

```typescript
// ─── HOME SERVICES NICHE BRANCH — Level 3 ────────────────────────────────────
if (niche === 'home_services') {
  const targetStates: string[] =
    Array.isArray(config?.targetStates) ? (config!.targetStates as string[]) : [];

  // Load Level 3 config — safe no-op if null or missing
  const homeSvcConfig: HomeSvcConfigShape = (config as any)?.homeSvcConfig ?? {};
  const territories   = homeSvcConfig.territories   ?? [];
  const deliveryRules = homeSvcConfig.deliveryRules  ?? [];

  let signals: HomeSvcSignal[] = [];
  try {
    signals = await fetchHomeSvcSignals(targetStates);
  } catch (err: any) {
    console.error('[SENTINEL HOME SVC] fetchHomeSvcSignals threw unexpectedly:', err?.message);
    signals = [];
  }

  // Pre-fetch recent incidents for cluster matching.
  // ONE query before the loop. Scoped to subAccountId + last 24 hours + capped at 100 rows.
  // Filtered to Home Services source only — accident incidents are never included.
  // NOTE: verify storage.getSentinelIncidentsFiltered signature before applying (B-PRE-1).
  let recentIncidents: any[] = [];
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const all = await storage.getSentinelIncidentsFiltered(parsed.data.subAccountId, {
      since: since24h,
      limit: 100,
    });
    recentIncidents = all.filter(
      i => (i.rawPayload as any)?.source === 'sentinel_home_svc'
    );
  } catch (err: any) {
    console.warn('[SENTINEL HOME SVC] Cluster pre-query failed — clustering disabled this scan:', err?.message);
    recentIncidents = [];
  }

  const created: any[] = [];
  let autoQueuedCount = 0;

  for (const sig of signals) {
    // NOTE: verify dedup hash strategy (B-PRE-2) before applying.
    const hash = Buffer.from(sig.id).toString("base64").substring(0, 64);

    const existing = await storage.getSentinelIncidentByHash(
      parsed.data.subAccountId,
      hash,
    );
    if (existing) continue;

    // Level 3 metadata — computed in dependency order
    const territory = resolveTerritory(sig, territories);
    const cluster   = findClusterMetadata(sig, recentIncidents);
    const scoring   = scoreHomeSvcOpportunity(sig, {
      territory,
      clusterSize: cluster.clusterSize,
      sentAtIso:   sig.sent,
    });
    const delivery  = evaluateDeliveryRules(
      sig,
      scoring.opportunityScore,
      territory,
      deliveryRules,
    );

    if (delivery.actionStatus === 'auto_queued') autoQueuedCount++;

    const record = await storage.createSentinelIncident({
      subAccountId:     parsed.data.subAccountId,
      sourceHash:       hash,
      title:            sig.event,
      description:      sig.headline || null,
      location:         sig.areaDesc || null,
      severity:         sig.severity,
      actionStatus:     delivery.actionStatus,
      smsSent:          false,
      geofenceDeployed: false,
      lat:              sig.lat ?? null,
      lng:              sig.lng ?? null,
      rawPayload: {
        // Level 2 fields — unchanged
        source:          'sentinel_home_svc',
        noaaId:          sig.id,
        noaaEvent:       sig.event,
        signalType:      sig.signalType,
        serviceTypes:    sig.serviceTypes,
        noaaSeverity:    sig.noaaSeverity,
        noaaUrgency:     sig.noaaUrgency,
        noaaCertainty:   sig.noaaCertainty,
        expires:         sig.expires,
        onset:           sig.effective,
        state:           sig.state,
        county:          sig.areaDesc,
        received:        sig.sent,
        googleMaps:      sig.googleMaps,
        actionRequired:  sig.actionRequired,
        // Level 3 fields
        opportunityScore:          scoring.opportunityScore,
        scoreBreakdown:            scoring.scoreBreakdown,
        scoreTier:                 scoring.scoreTier,
        scoreTierLabel:            scoring.scoreTierLabel,
        leadReadiness:             scoring.leadReadiness,
        serviceValueTier:          scoring.serviceValueTier,
        territory,
        clusterId:                 cluster.clusterId,
        clusterSize:               cluster.clusterSize,
        clusterDominantSignalType: cluster.clusterDominantSignalType,
        clusterOpportunityScore:   cluster.clusterOpportunityScore,
      },
    });

    created.push(record);
  }

  await storage.createAuditLog({
    action:      "SENTINEL_SCAN",
    performedBy: user?.claims?.sub || user?.id || "system",
    details: {
      subAccountId:  parsed.data.subAccountId,
      niche:         "home_services",
      source:        "noaa_nws",
      targetStates,
      signalsFound:  signals.length,
      newIncidents:  created.length,
      autoQueued:    autoQueuedCount,
    },
  });

  return res.json({
    source:    "noaa_nws",
    found:     created.length,
    incidents: created,
    niche:     "home_services",
  });
}
// ─── END HOME SERVICES BRANCH — accident code continues below, unchanged ──────
```

---

### Group B gate — all bullets required before Group C

- [ ] B-PRE-1 confirmed: storage method signature matches
- [ ] B-PRE-2 confirmed: dedup hash strategy decided and applied
- [ ] B-PRE-3 confirmed: Level 2 scan branch was present in real project before applying
- [ ] Manual scan on a Home Services account (with `targetStates` set) creates incidents
- [ ] Each new incident's `rawPayload` contains: `opportunityScore`, `scoreBreakdown`, `scoreTier`, `leadReadiness`, `serviceValueTier`, `territory`, `clusterId`, `clusterSize`
- [ ] Second scan on same data creates zero new incidents (dedup intact)
- [ ] When anchor incidents from a previous scan already exist in the database, new signals of the same signal family within 15 miles or matching area description are assigned the same `clusterId` as those anchors. Note: same-batch clustering within a single scan is an accepted Level 3 approximation and is not required to pass this gate.
- [ ] Delivery rule configured with `minScore: 70, action: 'auto_queue'` fires `auto_queued` status on qualifying incidents
- [ ] No delivery rules configured: all incidents get `actionStatus: 'pending'`
- [ ] `homeSvcConfig: null` in config: all incidents created with `actionStatus: 'pending'`, no crash
- [ ] Accident scan server logs show zero calls to Level 3 functions
- [ ] `tsc --noEmit` passes

---

## Group C — Market heat endpoint

### Step C1 — `server/routes/sentinel.ts` — add market heat route

Add inside `registerSentinelRoutes()`, after the `flag-lead` route:

```typescript
// ─── HOME SERVICES ONLY: Market heat — query-time aggregation, no stored tables ──
app.get("/api/sentinel/home-svc/market-heat", asyncHandler(async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const subAccountId = parseInt(req.query.subAccountId as string);
  if (!subAccountId || isNaN(subAccountId)) {
    return res.status(400).json({ error: "subAccountId query parameter required" });
  }

  if (!(await verifyAccountOwnership(req, res, subAccountId))) return;

  const { allowed } = await requirePlanFeature(subAccountId, 'sentinel');
  if (!allowed) {
    return res.status(403).json({ error: "upgrade_required", feature: "sentinel" });
  }

  const config = await storage.getSentinelConfig(subAccountId);
  if ((config as any)?.niche !== 'home_services') {
    return res.status(400).json({
      error: "market-heat is only available for Home Services accounts.",
      code:  "wrong_niche",
    });
  }

  // Tightly scoped: subAccountId + 72-hour window + 200-row cap
  const since72h = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const incidents = await storage.getSentinelIncidentsFiltered(subAccountId, {
    since: since72h,
    limit: 200,
  });

  const heat = aggregateMarketHeat(
    subAccountId,
    incidents.map(i => ({ rawPayload: (i.rawPayload as any) ?? null })),
    72,
  );

  return res.json(heat);
}));
```

---

### Group C gate — all bullets required before Group D

- [ ] Verify the market heat route enforces authentication and Sentinel plan protection using the same pattern as existing Sentinel routes in the real project — inspect `verifyAccountOwnership` and `requirePlanFeature` usage in adjacent routes and verify the new route calls them in the same order and handles their responses the same way. If any divergence is found, align the route to the project's existing protection pattern before approving Group C.
- [ ] Returns structured aggregate JSON for a Home Services account with existing incidents
- [ ] Returns zero-state object (not an error) when no incidents exist in the 72-hour window
- [ ] Returns 400 with `wrong_niche` code for accident-niche accounts
- [ ] Returns 401 for unauthenticated requests
- [ ] Returns 403 for accounts without sentinel plan feature
- [ ] Response is scoped to `subAccountId` — confirmed no cross-account data in response
- [ ] Response time acceptable at current incident volume (flag if consistently > 500ms)

---

## Group D — Home Services queue status fix

**Deploy at the same time as Group B or immediately after. If Group B is live and Group D is not, `auto_queued` incidents are invisible to operators.**

### Step D1 — `client/src/pages/sentinel.tsx` — status filter

Inside `HomeSvcSentinelView`, replace the pending/actioned filter logic:

```typescript
// BEFORE:
const pendingSignals  = incidents.filter(i => i.actionStatus === 'pending');
const actionedSignals = incidents.filter(i => i.actionStatus !== 'pending');

// AFTER:
const isActive = (status: string | null | undefined) =>
  status === 'pending' || status === 'auto_queued';

const pendingSignals = incidents
  .filter(i => isActive(i.actionStatus))
  .sort((a, b) => {
    // auto_queued sorts before pending; within same status, sort by score descending
    if (a.actionStatus === 'auto_queued' && b.actionStatus !== 'auto_queued') return -1;
    if (b.actionStatus === 'auto_queued' && a.actionStatus !== 'auto_queued') return  1;
    return (
      ((b.rawPayload as any)?.opportunityScore ?? 0) -
      ((a.rawPayload as any)?.opportunityScore ?? 0)
    );
  });

const actionedSignals = incidents.filter(i => !isActive(i.actionStatus));
const autoQueuedCount = incidents.filter(i => i.actionStatus === 'auto_queued').length;
```

### Step D2 — `client/src/pages/sentinel.tsx` — updated stat cards

Replace the 4 stat cards inside `HomeSvcSentinelView`:

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
    className="bg-[#0a0a0a] border border-amber-500/30 p-4 rounded-2xl">
    <div className="flex items-center gap-2 mb-1">
      <AlertTriangle size={14} className="text-amber-500" />
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Signals</p>
    </div>
    <p className="text-3xl font-black text-white">{incidents.length}</p>
  </motion.div>

  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
    className="bg-[#0a0a0a] border border-red-500/30 p-4 rounded-2xl">
    <div className="flex items-center gap-2 mb-1">
      <Zap size={14} className="text-red-400" />
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Auto-Queued</p>
    </div>
    <p className="text-3xl font-black text-white">{autoQueuedCount}</p>
    <p className="text-[9px] text-slate-600 mt-0.5">delivery rules fired</p>
  </motion.div>

  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
    className="bg-[#0a0a0a] border border-cyan-500/30 p-4 rounded-2xl">
    <div className="flex items-center gap-2 mb-1">
      <Clock size={14} className="text-cyan-500" />
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Active Queue</p>
    </div>
    <p className="text-3xl font-black text-white">{pendingSignals.length}</p>
  </motion.div>

  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
    className="bg-[#0a0a0a] border border-green-500/30 p-4 rounded-2xl">
    <div className="flex items-center gap-2 mb-1">
      <CheckCircle2 size={14} className="text-green-500" />
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Flagged</p>
    </div>
    <p className="text-3xl font-black text-white">{flaggedCount}</p>
  </motion.div>
</div>
```

---

### Group D gate — all bullets required before Group E

- [ ] `auto_queued` incidents appear in the active queue (not filtered out)
- [ ] `auto_queued` incidents sort above `pending` incidents
- [ ] `auto_queued` incidents move to actioned list after acknowledge or flag-lead
- [ ] Pre-Level-3 incidents (`pending` status, no `opportunityScore` in rawPayload) still render correctly — no crash on missing fields
- [ ] Accident UI: confirm `pendingIncidents` filter in the accident branch is unchanged

---

## Group E — Home Services UI enhancements

**Pre-condition: Groups A, B, C, D all confirmed complete.**

### Step E1 — `client/src/pages/sentinel.tsx` — state for homeSvcConfig editor

Add alongside existing state declarations:

```typescript
const [homeSvcConfigRaw, setHomeSvcConfigRaw] = useState<string>('');
const [homeSvcConfigError, setHomeSvcConfigError] = useState<string | null>(null);
```

Add `homeSvcConfig: null as any` to `configForm` initial state.

In the config sync `useEffect`, add:
```typescript
setHomeSvcConfigRaw(
  (config as any)?.homeSvcConfig
    ? JSON.stringify((config as any).homeSvcConfig, null, 2)
    : ''
);
setHomeSvcConfigError(null);
setConfigForm(f => ({ ...f, homeSvcConfig: (config as any)?.homeSvcConfig ?? null }));
```

Add handler:
```typescript
const handleHomeSvcConfigChange = (val: string) => {
  setHomeSvcConfigRaw(val);
  if (!val.trim()) {
    setHomeSvcConfigError(null);
    setConfigForm(f => ({ ...f, homeSvcConfig: null }));
    return;
  }
  try {
    const parsed = JSON.parse(val);
    setHomeSvcConfigError(null);
    setConfigForm(f => ({ ...f, homeSvcConfig: parsed }));
  } catch {
    setHomeSvcConfigError('Invalid JSON — correct before saving');
    // Do NOT update configForm.homeSvcConfig while invalid
  }
};
```

Add `homeSvcConfig: configForm.homeSvcConfig ?? null` to configMutation PUT payload.

Add `homeSvcConfigError !== null` to save button disabled condition.

---

### Step E2 — `client/src/pages/sentinel.tsx` — market heat query

Add inside `HomeSvcSentinelView` component body:

```typescript
const marketHeatQuery = useQuery({
  queryKey: ["/api/sentinel/home-svc/market-heat", currentAccount?.id],
  enabled: !!currentAccount?.id,
  queryFn: async () => {
    const res = await fetch(
      `/api/sentinel/home-svc/market-heat?subAccountId=${currentAccount!.id}`
    );
    if (!res.ok) return null;
    return res.json();
  },
  refetchInterval: 5 * 60 * 1000,
  staleTime:       4 * 60 * 1000,
});
const marketHeat = marketHeatQuery.data ?? null;
```

---

### Step E3 — `client/src/pages/sentinel.tsx` — cluster grouping utility

Add at bottom of file, before the closing export, or as a local function inside `HomeSvcSentinelView`:

```typescript
function groupByCluster(incidents: SentinelIncident[]): Array<{
  clusterId: string;
  topScore: number;
  incidents: SentinelIncident[];
}> {
  const groups = new Map<string, SentinelIncident[]>();
  for (const inc of incidents) {
    const cid = (inc.rawPayload as any)?.clusterId ?? `solo-${inc.id}`;
    if (!groups.has(cid)) groups.set(cid, []);
    groups.get(cid)!.push(inc);
  }
  return Array.from(groups.entries())
    .map(([clusterId, incs]) => ({
      clusterId,
      topScore: Math.max(0, ...incs.map(i => (i.rawPayload as any)?.opportunityScore ?? 0)),
      incidents: [...incs].sort((a, b) => {
        if (a.actionStatus === 'auto_queued' && b.actionStatus !== 'auto_queued') return -1;
        if (b.actionStatus === 'auto_queued' && a.actionStatus !== 'auto_queued') return  1;
        return ((b.rawPayload as any)?.opportunityScore ?? 0) - ((a.rawPayload as any)?.opportunityScore ?? 0);
      }),
    }))
    .sort((a, b) => b.topScore - a.topScore);
}
```

---

### Step E4 — `client/src/pages/sentinel.tsx` — new components

Append all three components at the bottom of `sentinel.tsx`, after existing Home Services components.

**MarketHeatPanel:**

```tsx
const SCORE_TIER_COLORS: Record<string, string> = {
  immediate: 'text-red-400 bg-red-500/10 border-red-500/30',
  strong:    'text-amber-400 bg-amber-500/10 border-amber-500/30',
  standard:  'text-blue-400 bg-blue-500/10 border-blue-500/30',
  monitor:   'text-slate-500 bg-slate-500/10 border-slate-500/20',
};

const SERVICE_DISPLAY: Record<string, string> = {
  roofing:           'Roofing',
  water_restoration: 'Water Restoration',
  tree_removal:      'Tree Removal',
  storm_cleanup:     'Storm Cleanup',
  gutters:           'Gutters',
  siding:            'Siding',
  hvac:              'HVAC',
  plumbing:          'Plumbing',
  electrical:        'Electrical',
  mold_remediation:  'Mold Remediation',
  fencing:           'Fencing',
};

function MarketHeatPanel({ heat, loading }: { heat: any; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-5 mb-6 animate-pulse">
        <div className="h-4 bg-white/5 rounded w-32 mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!heat || heat.totalSignals === 0) {
    return (
      <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-5 mb-6">
        <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-2">Market Heat · 72h</p>
        <p className="text-slate-600 text-sm">No signals in the last 72 hours. Run a scan to populate.</p>
      </div>
    );
  }

  const dist  = heat.scoreDistribution ?? {};
  const total = heat.totalSignals;

  return (
    <div className="bg-[#0a0a0a] border border-amber-500/10 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] text-amber-500/70 uppercase font-bold tracking-widest flex items-center gap-1.5">
          <Zap size={11} /> Market Heat · 72h · {total} signal{total !== 1 ? 's' : ''}
        </p>
        {heat.activeClusters > 0 && (
          <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded font-bold">
            {heat.activeClusters} active cluster{heat.activeClusters !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-2">Opportunity Mix</p>
          <div className="space-y-1.5">
            {(['immediate', 'strong', 'standard', 'monitor'] as const).map(key => (
              <div key={key} className="flex items-center justify-between">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${SCORE_TIER_COLORS[key]}`}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </span>
                <span className="text-slate-400 text-[10px] font-bold">{dist[key] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-2">Top Services</p>
          <div className="space-y-1.5">
            {(heat.topServiceTypes ?? []).slice(0, 4).map((svc: any) => (
              <div key={svc.name} className="flex items-center justify-between">
                <span className="text-slate-300 text-[10px]">{SERVICE_DISPLAY[svc.name] ?? svc.name}</span>
                <span className="text-amber-400 text-[10px] font-bold">{svc.count}</span>
              </div>
            ))}
            {(!heat.topServiceTypes || heat.topServiceTypes.length === 0) && (
              <p className="text-slate-600 text-[10px]">No data yet</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-2">Top Territories</p>
          <div className="space-y-1.5">
            {(heat.topTerritories ?? []).slice(0, 4).map((t: any) => (
              <div key={t.name} className="flex items-center justify-between">
                <span className="text-slate-300 text-[10px]">{t.name}</span>
                <span className="text-cyan-400 text-[10px] font-bold">{t.count}</span>
              </div>
            ))}
            {(!heat.topTerritories || heat.topTerritories.length === 0) && (
              <p className="text-slate-600 text-[10px]">Configure territories in Settings</p>
            )}
          </div>
        </div>
      </div>

      <p className="text-[9px] text-slate-700 text-right">
        Generated {new Date(heat.generatedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
```

---

### Step E5 — `client/src/pages/sentinel.tsx` — HomeSvcSentinelView render updates

Replace the flat `pendingSignals.map(...)` render with cluster-grouped render. Add `<MarketHeatPanel>` before stat cards:

```tsx
{/* Market heat panel — add before stat cards */}
<MarketHeatPanel heat={marketHeat} loading={marketHeatQuery.isLoading} />

{/* In the signal list, replace flat map with: */}
{groupByCluster(pendingSignals).map(group => (
  <div key={group.clusterId}>
    {group.incidents.length > 1 && (
      <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
        <div className="flex-1 h-px bg-amber-500/10" />
        <span className="text-[9px] text-amber-500/60 uppercase font-bold tracking-widest whitespace-nowrap">
          {group.incidents.length} signals · same event cluster
        </span>
        <div className="flex-1 h-px bg-amber-500/10" />
      </div>
    )}
    {group.incidents.map((incident, i) => (
      <HomeSvcIncidentCard
        key={incident.id}
        incident={incident}
        index={i}
        onSms={() => onSms(incident.id)}
        onAck={() => onAck(incident.id)}
        onMarkLead={() => onMarkLead(incident.id)}
        onClick={() => onSelectIncident(incident)}
        smsPending={smsPending}
        markLeadPending={markLeadPending}
      />
    ))}
  </div>
))}
```

---

### Step E6 — `client/src/pages/sentinel.tsx` — HomeSvcIncidentCard Level 3 badges

Inside `HomeSvcIncidentCard`, after existing title/signalType badges, add:

```tsx
{/* Opportunity score badge */}
{(() => {
  const score = (incident.rawPayload as any)?.opportunityScore;
  const tier  = (incident.rawPayload as any)?.scoreTier ?? 'monitor';
  if (score === undefined || score === null) return null;
  const colors: Record<string, string> = {
    immediate: 'bg-red-500/20 text-red-300 border-red-500/30',
    strong:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
    standard:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    monitor:   'bg-slate-500/20 text-slate-400 border-slate-500/20',
  };
  return (
    <span className={`text-[8px] px-1.5 py-0.5 rounded font-black border ${colors[tier]}`}>
      {score}
    </span>
  );
})()}

{/* auto_queued badge */}
{incident.actionStatus === 'auto_queued' && (
  <span className="text-[8px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded font-black border border-orange-500/30">
    AUTO-QUEUED
  </span>
)}

{/* Territory badge */}
{(() => {
  const territory = (incident.rawPayload as any)?.territory;
  if (!territory || territory === 'unassigned') return null;
  return (
    <span className="text-[8px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded font-bold border border-cyan-500/20">
      {territory}
    </span>
  );
})()}
```

Also update the card container `motion.div` className to show amber highlight for `auto_queued`:

```tsx
className={`border-b border-white/5 pb-4 last:border-0 last:pb-0 cursor-pointer rounded-lg p-2 -mx-2 transition-colors ${
  incident.actionStatus === 'auto_queued'
    ? 'border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10'
    : 'hover:bg-white/[0.02]'
}`}
```

---

### Step E7 — `client/src/pages/sentinel.tsx` — HomeSvcIncidentDetailView Level 3 sections

Add score breakdown card and territory/cluster card inside `HomeSvcIncidentDetailView`. Place inside the grid, alongside existing Signal Details card:

```tsx
{/* Opportunity score breakdown */}
{(() => {
  const raw       = incident.rawPayload as any;
  const score     = raw?.opportunityScore;
  const tier      = raw?.scoreTier ?? 'monitor';
  const label     = raw?.scoreTierLabel;
  const readiness = raw?.leadReadiness;
  const breakdown = raw?.scoreBreakdown;
  if (score === undefined || score === null) return null;

  const tierColor: Record<string, string> = {
    immediate: 'text-red-400 border-red-500/30 bg-red-500/10',
    strong:    'text-amber-400 border-amber-500/30 bg-amber-500/10',
    standard:  'text-blue-400 border-blue-500/30 bg-blue-500/10',
    monitor:   'text-slate-400 border-slate-500/20 bg-slate-500/10',
  };

  return (
    <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Zap size={14} className="text-amber-400" /> Opportunity Score
      </h3>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center border ${tierColor[tier] ?? tierColor.monitor}`}>
          <span className="text-2xl font-black">{score}</span>
        </div>
        <div>
          <p className="text-white font-bold text-sm">{label ?? tier}</p>
          <p className="text-slate-500 text-xs">
            Lead readiness: <span className="text-white font-semibold capitalize">{readiness ?? '—'}</span>
          </p>
        </div>
      </div>
      {breakdown && (
        <div className="space-y-1.5">
          {([
            { label: 'Severity',      value: breakdown.severityPoints,     max: 30 },
            { label: 'Urgency',       value: breakdown.urgencyPoints,      max: 20 },
            { label: 'Signal Type',   value: breakdown.signalTypePoints,   max: 20 },
            { label: 'Service Value', value: breakdown.serviceValuePoints, max: 15 },
            { label: 'Territory',     value: breakdown.territoryPoints,    max: 10 },
            { label: 'Freshness',     value: breakdown.freshnessPoints,    max: 5  },
            { label: 'Cluster',       value: breakdown.clusterBonus,       max: 5  },
          ]).map(({ label, value, max }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[9px] text-slate-600 w-20 text-right flex-shrink-0">{label}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full">
                <div
                  className="h-1.5 bg-amber-500/60 rounded-full"
                  style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
                />
              </div>
              <span className="text-[9px] text-slate-400 w-8 text-right">{value}/{max}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
})()}

{/* Territory and cluster */}
{(() => {
  const raw       = incident.rawPayload as any;
  const territory = raw?.territory;
  const clusterSz = raw?.clusterSize;
  const hasTerr   = territory && territory !== 'unassigned';
  const hasClust  = clusterSz && clusterSz > 1;
  if (!hasTerr && !hasClust) return null;
  return (
    <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-4">
      <div className="grid grid-cols-2 gap-4">
        {hasTerr && (
          <div>
            <p className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-1">Territory</p>
            <p className="text-white font-bold text-sm">{territory}</p>
            <p className="text-[9px] text-slate-600 mt-0.5">Operator ranking only — approximate</p>
          </div>
        )}
        {hasClust && (
          <div>
            <p className="text-[9px] text-slate-600 uppercase font-bold tracking-widest mb-1">Cluster</p>
            <p className="text-white font-bold text-sm">{clusterSz} signal{clusterSz !== 1 ? 's' : ''} · same event</p>
          </div>
        )}
      </div>
    </div>
  );
})()}
```

---

### Step E8 — `client/src/pages/sentinel.tsx` — homeSvcConfig editor in config dialog

Inside the `configForm.niche === 'home_services'` branch of the Config Dialog, add at the bottom of the Home Services fields section:

```tsx
<div>
  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
    Level 3 Config (JSON)
  </label>
  <textarea
    value={homeSvcConfigRaw}
    onChange={(e) => handleHomeSvcConfigChange(e.target.value)}
    placeholder={'{\n  "territories": [],\n  "deliveryRules": []\n}'}
    rows={8}
    className={`w-full bg-white/5 border rounded-md px-3 py-2 text-xs font-mono text-white ${
      homeSvcConfigError ? 'border-red-500/60' : 'border-white/10'
    }`}
    data-testid="textarea-home-svc-config"
  />
  {homeSvcConfigError && (
    <p className="text-[10px] text-red-400 mt-1 font-bold">{homeSvcConfigError}</p>
  )}
  <p className="text-[10px] text-slate-600 mt-1">
    Territories and delivery rules. Invalid JSON blocks save.
  </p>
</div>
```

---

### Group E gate — all bullets required before Group F

- [ ] UI renders without crash when incident `rawPayload` has no Level 3 fields
- [ ] MarketHeatPanel renders real data after a scan
- [ ] MarketHeatPanel renders safe empty state before first scan
- [ ] Score breakdown bars render correctly; no crash when `scoreBreakdown` is missing
- [ ] Config textarea shows error for invalid JSON and blocks save button
- [ ] Config textarea accepts null (empty input clears config)
- [ ] Config textarea accepts valid `homeSvcConfig` object, saves, round-trips correctly
- [ ] Accident UI: confirmed zero visual or behavioral change
- [ ] `tsc --noEmit` passes

---

## Group F — Contamination verification

**Group F is mandatory. Level 3 is not approved for production deployment until all items below are confirmed in the real project.**

Groups A–E may be applied to a staging environment before Group F is complete. Group F must be resolved before any production deployment.

For each item: Replit inspects the real project. If a risk is found, bring it back — Claude will draft a targeted fix.

| Item | What to inspect | Risk if present |
|------|----------------|-----------------|
| F-C1 | Any file outside `storage.ts` and `routes/sentinel.ts` calling `getSentinelIncidents()` or `getSentinelIncidentsFiltered()` without explicit niche scope | Accident semantics applied to Home Services incidents |
| F-C2 | `startSentinelScheduler()` in real project — confirm it only calls `processLiveSentinelFeed()` and does not write to `sentinel_incidents` | Scheduler accidentally processes Home Services data |
| F-C3 | Level 2 SMS branch (`isHomeSvcIncident` check on `rawPayload.source`) present in real `routes/sentinel.ts` | Accident-framed SMS sent to Home Services operators |
| F-C4 | Level 2 deploy-geofence source guard present in real `routes/sentinel.ts` | Home Services incident ID triggers live Meta ad deployment |
| F-C5 | Whether any Home Services account `subAccountId` could legally receive a CAD ingest payload | CAD-created incident lacks Home Services metadata, becomes invisible to UI filter |
| F-C6 | Any code path reading `actionStatus === 'pending'` on sentinel incidents without niche scope | `auto_queued` incidents invisible to that flow |
| F-C7 | Any background job or hook reading `notificationPreferences.incidentPush` / `incidentSms` on sentinel incident creation | Accident-framed push notification sent for Home Services incidents |
| F-C8 | Any webhook or event integration firing on `sentinel_incidents` row creation or status change | Home Services incidents sent to accident-oriented external systems |
| F-C9 | Any push notification subscriber path reading sentinel incidents globally | Niche-unaware push delivery |

---

## Accepted Level 3 limitations

These are deliberate decisions, not bugs. They are documented here so they are not mistaken for regressions.

**Stale score after severity merge**
Opportunity scores are computed once at incident creation. If the accident improvement patch upgrades an existing Home Services incident's severity, `rawPayload.opportunityScore` is not recomputed. The displayed score reflects the original signal. Market heat aggregates may slightly lag post-merge changes. A recompute-on-merge patch requires explicit approval before implementation.

**Territory matching is approximate operator-ranking metadata**
Territory resolution uses substring matching against NOAA's free-text `areaDesc`. A territory configured with county `"Lee"` will match any `areaDesc` containing "Lee". Territory assignment is appropriate for operator prioritization and delivery rule evaluation only. It is not authoritative geographic truth and must not be used for legal, dispatch-grade, or exclusive-area targeting. Exact FIPS-code matching is Level 4.

**Same-batch clustering is approximate**
Cluster assignment runs against existing database incidents only. Signals created in the same scan batch are not clustered against each other. A large storm producing many simultaneous NOAA alerts may appear as multiple single-element clusters on first scan, then merge correctly on subsequent scans. This is an accepted approximation, not data corruption.

**`homeSvcConfig` delivery rule validation is structural, not semantic**
Zod validates types and required fields. A `territory` value in a delivery rule that does not match any territory in the `territories` array will cause the rule to silently never fire — it will not error. Acceptable for Level 3.
