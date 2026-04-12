# Sentinel Home Services — Level 2 Builder Patch

Apply these changes in order. `sentinel-home-svc.ts` is already in your downloads — copy it to `server/`. Apply the three patch files below to your existing codebase.

---

## STEP 1 — Copy new file

Copy `sentinel-home-svc.ts` into `server/sentinel-home-svc.ts`.
Update line 194 before deploying:
```
const NOAA_USER_AGENT = 'ApexSentinelHomeSvc/2.0 (your@email.com)';
```

---

## STEP 2 — `server/sentinel.ts`

Find the existing `processLiveHomeSvcFeed` stub function and replace its entire body:

```typescript
// REPLACE THIS:
export async function processLiveHomeSvcFeed(): Promise<SentinelIncidentRaw[]> {
  console.log("[SENTINEL HOME SVC] Phase 1 stub — no feed connected, returning empty");
  return [];
}

// WITH THIS:
export async function processLiveHomeSvcFeed(
  targetStates: string[] = [],
): Promise<import('./sentinel-home-svc').HomeSvcSignal[]> {
  const { fetchHomeSvcSignals } = await import('./sentinel-home-svc');
  return fetchHomeSvcSignals(targetStates);
}
```

No other changes to this file.

---

## STEP 3 — `server/routes/sentinel.ts`

### 3a — Update imports at top of file

```typescript
// BEFORE:
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";

// AFTER:
import { processLiveSentinelFeed, deployGeofenceAd } from "../sentinel";
import { fetchHomeSvcSignals } from "../sentinel-home-svc";
import type { HomeSvcSignal } from "../sentinel-home-svc";
```

---

### 3b — Replace the Home Services scan branch

Find the Phase 1 Home Services block inside the `/api/sentinel/scan` handler. It currently looks like:

```typescript
if (niche === 'home_services') {
  await processLiveHomeSvcFeed();
  await storage.createAuditLog({ ... });
  return res.json({ source: "home_svc_stub", found: 0, incidents: [], niche: "home_services" });
}
```

Replace it entirely with:

```typescript
// ─── HOME SERVICES NICHE BRANCH ──────────────────────────────────────────────
if (niche === 'home_services') {
  const targetStates: string[] =
    Array.isArray(config?.targetStates) ? (config!.targetStates as string[]) : [];

  let signals: HomeSvcSignal[] = [];
  try {
    signals = await fetchHomeSvcSignals(targetStates);
  } catch (err: any) {
    console.error('[SENTINEL HOME SVC] fetchHomeSvcSignals threw unexpectedly:', err?.message);
    signals = [];
  }

  const created: any[] = [];

  for (const sig of signals) {
    const hash = Buffer.from(sig.id).toString("base64").substring(0, 64);

    const existing = await storage.getSentinelIncidentByHash(
      parsed.data.subAccountId,
      hash,
    );
    if (existing) continue;

    const record = await storage.createSentinelIncident({
      subAccountId:     parsed.data.subAccountId,
      sourceHash:       hash,
      title:            sig.event,
      description:      sig.headline || null,
      location:         sig.areaDesc || null,
      severity:         sig.severity,
      actionStatus:     'pending',
      smsSent:          false,
      geofenceDeployed: false,
      lat:              sig.lat    ?? null,
      lng:              sig.lng    ?? null,
      rawPayload: {
        source:         'sentinel_home_svc',
        noaaId:         sig.id,
        noaaEvent:      sig.event,
        signalType:     sig.signalType,
        serviceTypes:   sig.serviceTypes,
        noaaSeverity:   sig.noaaSeverity,
        noaaUrgency:    sig.noaaUrgency,
        noaaCertainty:  sig.noaaCertainty,
        expires:        sig.expires,
        onset:          sig.effective,
        state:          sig.state,
        county:         sig.areaDesc,
        received:       sig.sent,
        googleMaps:     sig.googleMaps,
        actionRequired: sig.actionRequired,
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

### 3c — Add source guard to deploy-geofence route

Inside `app.post("/api/sentinel/incidents/:id/deploy-geofence", ...)`, find the incident existence check and add the guard immediately after it:

```typescript
const incident = await storage.getSentinelIncident(id);
if (!incident) return res.status(404).json({ error: "Incident not found" });

// ADD THIS BLOCK:
const incidentRaw = incident.rawPayload as any;
if (incidentRaw?.source === 'sentinel_home_svc') {
  return res.status(400).json({
    error: "Geofence deployment is not available for Home Services incidents.",
    code:  "home_svc_geofence_unavailable",
  });
}
// END ADDED BLOCK

// Existing geofence logic continues unchanged:
const config = await storage.getSentinelConfig(incident.subAccountId);
```

---

### 3d — Branch SMS template

Inside `app.post("/api/sentinel/incidents/:id/send-sms", ...)`, find the `alertMsg` constant and replace it:

```typescript
// REMOVE:
const alertMsg = `🚨 APEX SENTINEL ALERT\n\n${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}\n📍 ${incident.location}\n\n${incident.description}\n\nDeploy geofence ads now from your Sentinel dashboard.`;

// REPLACE WITH:
const smsRaw = incident.rawPayload as any;
const isHomeSvcIncident = smsRaw?.source === 'sentinel_home_svc';

let alertMsg: string;

if (isHomeSvcIncident) {
  const svcList = Array.isArray(smsRaw?.serviceTypes) && smsRaw.serviceTypes.length > 0
    ? (smsRaw.serviceTypes as string[])
        .map((s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))
        .join(', ')
    : 'Home Services';

  const expiresLine = smsRaw?.expires
    ? `Expires: ${new Date(smsRaw.expires).toLocaleString()}`
    : '';

  alertMsg = [
    `🏠 APEX SENTINEL — HOME SERVICES ALERT`,
    ``,
    `${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}`,
    `📍 ${incident.location || 'Area not specified'}`,
    ``,
    `Services: ${svcList}`,
    expiresLine,
    ``,
    `Review this signal in your Sentinel dashboard and flag leads.`,
  ].filter(Boolean).join('\n');

} else {
  alertMsg = `🚨 APEX SENTINEL ALERT\n\n${incident.severity?.toUpperCase()} PRIORITY: ${incident.title}\n📍 ${incident.location}\n\n${incident.description}\n\nDeploy geofence ads now from your Sentinel dashboard.`;
}
```

---

### 3e — Add flag-lead route

Add this after the existing `acknowledge` route inside `registerSentinelRoutes()`:

```typescript
app.post("/api/sentinel/incidents/:id/flag-lead", asyncHandler(async (req, res) => {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const id = parseIntParam(req.params.id, "id");
  const incident = await storage.getSentinelIncident(id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });

  const raw = incident.rawPayload as any;
  if (raw?.source !== 'sentinel_home_svc') {
    return res.status(400).json({
      error: "flag-lead is only available for Home Services incidents.",
      code:  "wrong_niche_for_action",
    });
  }

  if (incident.actionStatus === 'lead_flagged') {
    return res.json({ success: true, incidentId: id, actionStatus: 'lead_flagged', alreadyFlagged: true });
  }

  await storage.updateSentinelIncident(id, { actionStatus: 'lead_flagged' });

  await storage.createAuditLog({
    action:      "SENTINEL_HOME_SVC_LEAD_FLAGGED",
    performedBy: user?.claims?.sub || user?.id || "system",
    details: {
      incidentId:   id,
      signalType:   raw?.signalType,
      serviceTypes: raw?.serviceTypes,
      location:     incident.location,
    },
  });

  res.json({ success: true, incidentId: id, actionStatus: 'lead_flagged' });
}));
```

---

## STEP 4 — `client/src/pages/sentinel.tsx`

### 4a — Add state variables

Add alongside the existing `useState` declarations at the top of the `Sentinel` component:

```typescript
const [originalNiche, setOriginalNiche] = useState<string>("accident");
const [nicheChangeConfirmed, setNicheChangeConfirmed] = useState(false);
```

Add `niche: "accident"` to the existing `configForm` state object:

```typescript
const [configForm, setConfigForm] = useState({
  keywords: "",
  scanInterval: 60,
  enabled: false,
  smsAlertEnabled: true,
  smsAlertPhone: "",
  geofenceEnabled: true,
  geofenceRadiusMiles: 1,
  targetCities: "",
  targetStates: "",
  niche: "accident",   // ADD THIS LINE
});
```

---

### 4b — Update the config sync useEffect

```typescript
// BEFORE:
useEffect(() => {
  if (config) {
    setConfigForm({
      keywords: (config.keywords || []).join(", "),
      scanInterval: config.scanInterval || 60,
      enabled: config.enabled || false,
      smsAlertEnabled: config.smsAlertEnabled !== false,
      smsAlertPhone: config.smsAlertPhone || "",
      geofenceEnabled: config.geofenceEnabled !== false,
      geofenceRadiusMiles: config.geofenceRadiusMiles || 1,
      targetCities: ((config as any).targetCities || []).join(", "),
      targetStates: ((config as any).targetStates || []).join(", "),
    });
  }
}, [config]);

// AFTER:
useEffect(() => {
  if (config) {
    const resolvedNiche = (config as any).niche || "accident";
    setOriginalNiche(resolvedNiche);
    setNicheChangeConfirmed(false);
    setConfigForm({
      keywords: (config.keywords || []).join(", "),
      scanInterval: config.scanInterval || 60,
      enabled: config.enabled || false,
      smsAlertEnabled: config.smsAlertEnabled !== false,
      smsAlertPhone: config.smsAlertPhone || "",
      geofenceEnabled: config.geofenceEnabled !== false,
      geofenceRadiusMiles: config.geofenceRadiusMiles || 1,
      targetCities: ((config as any).targetCities || []).join(", "),
      targetStates: ((config as any).targetStates || []).join(", "),
      niche: resolvedNiche,
    });
  }
}, [config]);
```

---

### 4c — Add markLeadMutation

Add after the existing `ackMutation`:

```typescript
const markLeadMutation = useMutation({
  mutationFn: async (incidentId: number) => {
    const res = await apiRequest("POST", `/api/sentinel/incidents/${incidentId}/flag-lead`);
    return res.json();
  },
  onSuccess: () => {
    toast({ title: "Lead flagged", description: "Incident marked for follow-up." });
    queryClient.invalidateQueries({ queryKey: ["/api/sentinel/incidents", currentAccount?.id] });
  },
  onError: (err: any) => {
    toast({
      title:       "Could not flag lead",
      description: err.message || "Check incident type and try again.",
      variant:     "destructive",
    });
  },
});
```

---

### 4d — Update configMutation

Add `niche` to the PUT payload and reset the guard on success:

```typescript
const configMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("PUT", "/api/sentinel/config", {
      subAccountId: currentAccount!.id,
      keywords: configForm.keywords.split(",").map(k => k.trim()).filter(Boolean),
      scanInterval: configForm.scanInterval,
      enabled: configForm.enabled,
      smsAlertEnabled: configForm.smsAlertEnabled,
      smsAlertPhone: configForm.smsAlertPhone || null,
      geofenceEnabled: configForm.geofenceEnabled,
      geofenceRadiusMiles: configForm.geofenceRadiusMiles,
      targetCities: configForm.targetCities.split(",").map(c => c.trim()).filter(Boolean),
      targetStates: configForm.targetStates.split(",").map(s => s.trim()).filter(Boolean),
      niche: configForm.niche,   // ADD THIS LINE
    });
    return res.json();
  },
  onSuccess: () => {
    toast({ title: "Sentinel config saved!" });
    queryClient.invalidateQueries({ queryKey: ["/api/sentinel/config", currentAccount?.id] });
    setOriginalNiche(configForm.niche);   // ADD
    setNicheChangeConfirmed(false);       // ADD
    setShowConfig(false);
  },
});
```

---

### 4e — Update liveSelectedIncident early return

```typescript
// REPLACE the existing liveSelectedIncident early return with:
if (liveSelectedIncident) {
  const isHomeSvcIncident =
    (liveSelectedIncident.rawPayload as any)?.source === 'sentinel_home_svc';

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {isHomeSvcIncident ? (
        <HomeSvcIncidentDetailView
          incident={liveSelectedIncident}
          onBack={() => setSelectedIncident(null)}
          onSms={() => smsMutation.mutate(liveSelectedIncident.id)}
          onAck={() => { ackMutation.mutate(liveSelectedIncident.id); setSelectedIncident(null); }}
          onMarkLead={() => markLeadMutation.mutate(liveSelectedIncident.id)}
          smsPending={smsMutation.isPending}
          markLeadPending={markLeadMutation.isPending}
        />
      ) : (
        <IncidentDetailView
          incident={liveSelectedIncident}
          onBack={() => setSelectedIncident(null)}
          onGeofence={() => geofenceMutation.mutate(liveSelectedIncident.id)}
          onSms={() => smsMutation.mutate(liveSelectedIncident.id)}
          onAck={() => { ackMutation.mutate(liveSelectedIncident.id); setSelectedIncident(null); }}
          geofencePending={geofenceMutation.isPending}
          smsPending={smsMutation.isPending}
        />
      )}
    </div>
  );
}
```

---

### 4f — Hide accident-specific header buttons from Home Services accounts

In the header button group, wrap two existing buttons:

```tsx
{/* WRAP existing Crash Reports button: */}
{(config as any)?.niche !== 'home_services' && (
  <Button
    variant="outline"
    onClick={() => navigate("/crash-reports")}
    className="border-white/10 text-white hover:bg-white/10 gap-2"
    data-testid="button-crash-reports"
  >
    <Eye size={16} /> Crash Reports
  </Button>
)}

{/* WRAP existing Report button: */}
{(config as any)?.niche !== 'home_services' && (
  <Button
    variant="outline"
    onClick={() => setShowReportDialog(true)}
    className="border-white/10 text-white hover:bg-white/10 gap-2"
    data-testid="button-report-incident"
  >
    <Plus size={16} /> Report
  </Button>
)}
```

---

### 4g — Branch main content area

In the main return, locate the stats grid and live stream section. Wrap both in a niche conditional. The existing JSX content does not change — only the wrapper is added:

```tsx
{(config as any)?.niche === 'home_services' ? (

  <HomeSvcSentinelView
    incidents={incidents}
    loadingIncidents={loadingIncidents}
    currentAccount={currentAccount}
    onSms={(id) => smsMutation.mutate(id)}
    onAck={(id) => ackMutation.mutate(id)}
    onMarkLead={(id) => markLeadMutation.mutate(id)}
    smsPending={smsMutation.isPending}
    markLeadPending={markLeadMutation.isPending}
    onSelectIncident={setSelectedIncident}
  />

) : (
  <>
    {/* EXISTING stats grid — paste existing <div className="grid ..."> here, unchanged */}
    {/* EXISTING live stream — paste existing <motion.div ...> here, unchanged */}
  </>
)}

{/* Config Dialog, Report Dialog, Tutorial remain below — unchanged, always present */}
```

---

### 4h — Update Config Dialog

Inside the Config Dialog `<div className="space-y-5">`, add the niche selector at the very top, before all other fields:

```tsx
{/* NICHE SELECTOR — add at top of config dialog space-y-5 div */}
<div>
  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
    Sentinel Mode
  </label>
  <select
    value={configForm.niche}
    onChange={(e) => {
      setNicheChangeConfirmed(false);
      setConfigForm(f => ({ ...f, niche: e.target.value }));
    }}
    className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm"
    data-testid="select-sentinel-niche"
  >
    <option value="accident">Accident / Crash</option>
    <option value="home_services">Home Services</option>
  </select>
  <p className="text-[10px] text-slate-600 mt-1">
    Changing niche mode alters all Sentinel behavior for this account.
  </p>
</div>

{/* NICHE CHANGE GUARD — shows only when niche is being changed */}
{configForm.niche !== originalNiche && (
  <div className="border border-orange-500/40 bg-orange-500/10 rounded-lg p-4">
    <p className="text-orange-400 text-xs font-black uppercase tracking-widest mb-1">
      ⚠️ Operational Change
    </p>
    <p className="text-slate-300 text-xs mb-3">
      Switching from <strong>{originalNiche}</strong> to <strong>{configForm.niche}</strong> will
      immediately change the scan feed, UI, and all Sentinel behavior for this account.
    </p>
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={nicheChangeConfirmed}
        onChange={(e) => setNicheChangeConfirmed(e.target.checked)}
        className="w-4 h-4 accent-orange-500"
        data-testid="checkbox-niche-change-confirm"
      />
      <span className="text-white text-xs font-bold">
        I understand this changes live Sentinel behavior for this account
      </span>
    </label>
  </div>
)}

{/* HOME SERVICES CONFIG FIELDS — shown instead of accident fields */}
{configForm.niche === 'home_services' ? (
  <div className="space-y-4">
    <div>
      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
        Target States for NOAA Alerts
      </label>
      <Input
        value={configForm.targetStates}
        onChange={(e) => setConfigForm(f => ({ ...f, targetStates: e.target.value }))}
        placeholder="FL, TX, GA, NC"
        className="bg-white/5 border-white/10 text-white"
        data-testid="input-target-states-home-svc"
      />
      <p className="text-[10px] text-amber-500/70 mt-1">
        Required — 2-letter state codes, comma-separated. Scans return nothing if empty.
      </p>
    </div>
    <div>
      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">
        Scan Interval (sec)
      </label>
      <Input
        type="number"
        value={configForm.scanInterval}
        onChange={(e) => setConfigForm(f => ({ ...f, scanInterval: parseInt(e.target.value) || 60 }))}
        className="bg-white/5 border-white/10 text-white"
      />
      <p className="text-[10px] text-slate-600 mt-1">Manual scan only — no scheduler in Level 2.</p>
    </div>
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">SMS Alerts</span>
        <Switch checked={configForm.smsAlertEnabled} onCheckedChange={(v) => setConfigForm(f => ({ ...f, smsAlertEnabled: v }))} />
      </div>
      {configForm.smsAlertEnabled && (
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">Alert Phone Number</label>
          <Input
            value={configForm.smsAlertPhone}
            onChange={(e) => setConfigForm(f => ({ ...f, smsAlertPhone: e.target.value }))}
            placeholder="+1 (555) 123-4567"
            className="bg-white/5 border-white/10 text-white"
          />
        </div>
      )}
    </div>
    <div className="text-[10px] text-slate-700 border border-white/5 rounded-lg p-3">
      Keywords, Geofence, and advanced targeting are not active in Home Services Level 2.
    </div>
  </div>
) : (
  <>
    {/* EXISTING accident config fields — leave everything here exactly as it was */}
  </>
)}
```

Update the save button `disabled` condition:

```tsx
// BEFORE:
disabled={configMutation.isPending}

// AFTER:
disabled={
  configMutation.isPending ||
  (configForm.niche !== originalNiche && !nicheChangeConfirmed)
}
```

---

### 4i — Add new components at bottom of sentinel.tsx

Paste these after the existing `DetailField` component, at the very end of the file.

```tsx
// ─── HOME SERVICES UTILITY ────────────────────────────────────────────────────

const HOME_SVC_LABEL: Record<string, string> = {
  roofing:           'Roofing',
  gutters:           'Gutters',
  siding:            'Siding',
  tree_removal:      'Tree Removal',
  fencing:           'Fencing',
  storm_cleanup:     'Storm Cleanup',
  water_restoration: 'Water Restoration',
  plumbing:          'Plumbing',
  mold_remediation:  'Mold Remediation',
  hvac:              'HVAC',
  electrical:        'Electrical',
};

function serviceLabel(key: string): string {
  return HOME_SVC_LABEL[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatExpiry(expires: string | null | undefined): string | null {
  if (!expires) return null;
  try {
    const d = new Date(expires);
    return `Expires ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  } catch { return null; }
}

// ─── HomeSvcSentinelView ──────────────────────────────────────────────────────

function HomeSvcSentinelView({
  incidents,
  loadingIncidents,
  currentAccount,
  onSms,
  onAck,
  onMarkLead,
  smsPending,
  markLeadPending,
  onSelectIncident,
}: {
  incidents: SentinelIncident[];
  loadingIncidents: boolean;
  currentAccount: SubAccount | undefined;
  onSms: (id: number) => void;
  onAck: (id: number) => void;
  onMarkLead: (id: number) => void;
  smsPending: boolean;
  markLeadPending: boolean;
  onSelectIncident: (incident: SentinelIncident) => void;
}) {
  const pendingSignals  = incidents.filter(i => i.actionStatus === 'pending');
  const actionedSignals = incidents.filter(i => i.actionStatus !== 'pending');
  const actionRequired  = incidents.filter(i => (i.rawPayload as any)?.actionRequired === true).length;
  const flaggedCount    = incidents.filter(i => i.actionStatus === 'lead_flagged').length;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-[#0a0a0a] border border-amber-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Total Signals</p>
          </div>
          <p className="text-3xl font-black text-white">{incidents.length}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[#0a0a0a] border border-orange-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-orange-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Action Required</p>
          </div>
          <p className="text-3xl font-black text-white">{actionRequired}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-[#0a0a0a] border border-cyan-500/30 p-4 rounded-2xl">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-cyan-500" />
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Pending</p>
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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-[#0a0a0a] border border-amber-500/30 p-6 rounded-2xl mb-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-amber-500 font-black tracking-widest uppercase flex items-center gap-2">
            <Radio size={16} /> Home Services Signal Stream
          </h2>
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">
            {incidents.length} signal{incidents.length !== 1 ? 's' : ''} · NOAA NWS
          </span>
        </div>

        {loadingIncidents ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl animate-pulse" />)}
          </div>
        ) : incidents.length === 0 ? (
          <div className="text-center py-12">
            <Radar size={48} className="mx-auto text-slate-700 mb-4" />
            <h3 className="text-white font-bold text-lg mb-2">No Signals Detected</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              Click Scan Now to check NOAA for active alerts in your target states.
              Ensure target states are configured in Settings.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {pendingSignals.map((incident, i) => (
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
            </AnimatePresence>

            {actionedSignals.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-6 mb-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-slate-600 uppercase tracking-widest font-bold">Previously Actioned</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                {actionedSignals.slice(0, 10).map((incident, i) => (
                  <HomeSvcIncidentCard
                    key={incident.id}
                    incident={incident}
                    index={i}
                    onSms={() => onSms(incident.id)}
                    onAck={() => onAck(incident.id)}
                    onMarkLead={() => onMarkLead(incident.id)}
                    onClick={() => onSelectIncident(incident)}
                    smsPending={false}
                    markLeadPending={false}
                    dimmed
                  />
                ))}
              </>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}

// ─── HomeSvcIncidentCard ──────────────────────────────────────────────────────

function HomeSvcIncidentCard({
  incident, index, onSms, onAck, onMarkLead, onClick, smsPending, markLeadPending, dimmed,
}: {
  incident: SentinelIncident;
  index: number;
  onSms: () => void;
  onAck: () => void;
  onMarkLead: () => void;
  onClick?: () => void;
  smsPending: boolean;
  markLeadPending: boolean;
  dimmed?: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || 'medium'] || SEVERITY_COLORS.medium;
  const raw = incident.rawPayload as any;
  const isPending = incident.actionStatus === 'pending';
  const serviceTypes: string[] = Array.isArray(raw?.serviceTypes) ? raw.serviceTypes : [];
  const expiryLabel = formatExpiry(raw?.expires);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: dimmed ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ delay: index * 0.03 }}
      className="border-b border-white/5 pb-4 last:border-0 last:pb-0 cursor-pointer hover:bg-white/[0.02] rounded-lg p-2 -mx-2 transition-colors"
      onClick={onClick}
      data-testid={`card-home-svc-incident-${incident.id}`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-white font-bold text-sm truncate">{incident.title}</p>
            {raw?.signalType && (
              <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-amber-500/30">
                {raw.signalType.replace(/_/g, ' ')}
              </span>
            )}
            {incident.actionStatus === 'lead_flagged' && (
              <span className="text-[8px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold">FLAGGED</span>
            )}
            {incident.smsSent && (
              <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">SMS SENT</span>
            )}
          </div>
          <p className="text-gray-500 text-xs flex items-center gap-1 mb-1">
            <MapPin size={10} /> {incident.location || 'Area not specified'}
          </p>
          {serviceTypes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {serviceTypes.slice(0, 4).map(svc => (
                <span key={svc} className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded border border-white/10">
                  {serviceLabel(svc)}
                </span>
              ))}
            </div>
          )}
          {expiryLabel && <p className="text-[10px] text-slate-600 mt-1">{expiryLabel}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <span className={`${sev.bg} ${sev.text} text-[10px] px-2 py-1 rounded font-black tracking-wider`}>
            {sev.label}
          </span>
          <p className="text-gray-600 text-[9px] mt-1">
            {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
      </div>

      {isPending && (
        <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onMarkLead}
            disabled={incident.actionStatus === 'lead_flagged' || markLeadPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-flag-lead-${incident.id}`}
          >
            <Target size={12} />
            {incident.actionStatus === 'lead_flagged' ? 'Flagged' : 'Flag as Lead'}
          </button>
          <button
            onClick={onSms}
            disabled={incident.smsSent || smsPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            data-testid={`button-sms-home-svc-${incident.id}`}
          >
            <Send size={12} /> {incident.smsSent ? 'Sent' : 'SMS Alert'}
          </button>
          <button
            onClick={onAck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
            data-testid={`button-ack-home-svc-${incident.id}`}
          >
            <Eye size={12} /> Acknowledge
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── HomeSvcIncidentDetailView ────────────────────────────────────────────────

function HomeSvcIncidentDetailView({
  incident, onBack, onSms, onAck, onMarkLead, smsPending, markLeadPending,
}: {
  incident: SentinelIncident;
  onBack: () => void;
  onSms: () => void;
  onAck: () => void;
  onMarkLead: () => void;
  smsPending: boolean;
  markLeadPending: boolean;
}) {
  const sev = SEVERITY_COLORS[incident.severity || 'medium'] || SEVERITY_COLORS.medium;
  const raw = incident.rawPayload as any;
  const isPending = incident.actionStatus === 'pending';
  const serviceTypes: string[] = Array.isArray(raw?.serviceTypes) ? raw.serviceTypes : [];
  const expiryLabel = formatExpiry(raw?.expires);
  const effectiveLabel = raw?.onset ? formatDateTime(raw.onset) : null;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      <Button variant="ghost" onClick={onBack} className="text-slate-400 hover:text-white mb-4">
        <ChevronLeft size={16} className="mr-1" /> Back to Signals
      </Button>

      <div className="text-xs font-bold uppercase tracking-widest mb-3 text-amber-400">
        Source: NOAA NWS — Home Services Signal
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-black text-white">{incident.title}</h2>
          <p className="text-slate-500 text-sm">
            Detected {formatDateTime(incident.detectedAt as unknown as string)} · {timeAgo(incident.detectedAt as unknown as string)}
          </p>
        </div>
        <span className={`${sev.bg} ${sev.text} text-xs px-3 py-1.5 rounded-full font-black tracking-wider border ${sev.border}`}>
          {sev.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Radio size={14} className="text-amber-400" /> Signal Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <DetailField label="NOAA Event"    value={raw?.noaaEvent}                        testId="text-home-svc-event" />
            <DetailField label="Signal Type"   value={raw?.signalType?.replace(/_/g, ' ')}   testId="text-home-svc-signal" />
            <DetailField label="NOAA Severity" value={raw?.noaaSeverity}                     testId="text-home-svc-noaa-sev" />
            <DetailField label="Urgency"       value={raw?.noaaUrgency}                      testId="text-home-svc-urgency" />
            <DetailField label="Certainty"     value={raw?.noaaCertainty}                    testId="text-home-svc-certainty" />
            <DetailField label="State"         value={raw?.state}                            testId="text-home-svc-state" />
          </div>
          {expiryLabel && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
              <p className="text-amber-400 text-xs font-bold">{expiryLabel}</p>
            </div>
          )}
          {effectiveLabel && <DetailField label="Effective From" value={effectiveLabel} testId="text-home-svc-effective" />}
          <div className="mt-4">
            <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Affected Area</p>
            <p className="text-sm text-white font-medium">{incident.location || '—'}</p>
          </div>
          {incident.description && (
            <div className="mt-4">
              <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest mb-1">Headline</p>
              <p className="text-sm text-slate-300">{incident.description}</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Target size={14} className="text-amber-400" /> Likely Service Demand
            </h3>
            {serviceTypes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {serviceTypes.map(svc => (
                  <span key={svc} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 text-xs font-bold border border-amber-500/30">
                    {serviceLabel(svc)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No service categories inferred.</p>
            )}
            <p className="text-[10px] text-slate-600 mt-3">
              Categories are inferred from signal type. Verify demand before routing.
            </p>
          </div>

          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Globe size={14} className="text-cyan-400" /> Approximate Location
            </h3>
            {raw?.googleMaps ? (
              <>
                <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center mb-4">
                  <MapPin size={36} className="mx-auto text-amber-400 mb-2" />
                  <p className="text-white font-bold text-sm mb-1">{incident.location}</p>
                  {incident.lat && incident.lng && (
                    <p className="text-slate-500 text-xs">{incident.lat.toFixed(4)}, {incident.lng.toFixed(4)}</p>
                  )}
                  <p className="text-slate-600 text-[10px] mt-2">Centroid of alert polygon — not a precise point.</p>
                </div>
                <a
                  href={raw.googleMaps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-bold hover:bg-blue-500/20 transition-all w-full justify-center"
                >
                  <ExternalLink size={14} /> Open in Google Maps
                </a>
              </>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
                <MapPin size={36} className="mx-auto text-slate-600 mb-2" />
                <p className="text-slate-500 text-sm">No coordinates available for this alert.</p>
              </div>
            )}
          </div>

          <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Shield size={14} className="text-emerald-400" /> Response Status
            </h3>
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-sm text-white">Lead Status</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.actionStatus === 'lead_flagged' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-500'}`}>
                  {incident.actionStatus === 'lead_flagged' ? 'Flagged for Follow-up' : 'Not Flagged'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <span className="text-sm text-white">SMS Alert</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${incident.smsSent ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-500'}`}>
                  {incident.smsSent ? 'Sent' : 'Not Sent'}
                </span>
              </div>
            </div>
            {isPending && (
              <div className="flex gap-2">
                <button
                  onClick={onMarkLead}
                  disabled={incident.actionStatus === 'lead_flagged' || markLeadPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Target size={12} /> {markLeadPending ? 'Flagging...' : 'Flag as Lead'}
                </button>
                <button
                  onClick={onSms}
                  disabled={incident.smsSent || smsPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send size={12} /> {smsPending ? 'Sending...' : 'Send SMS'}
                </button>
                <button
                  onClick={onAck}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 transition-all"
                >
                  <Eye size={12} /> Acknowledge
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
```

---

## STEP 5 — Verify before deploying

- [ ] `tsc --noEmit` passes with zero errors
- [ ] `targetStates` set on test Home Services account (e.g. `FL`)
- [ ] Manual scan returns NOAA alerts and creates incidents
- [ ] Second scan does not duplicate existing incidents
- [ ] Accident account shows zero UI or behavior change
- [ ] Deploy-geofence returns 400 for Home Services incidents
- [ ] Flag-lead route sets `actionStatus: 'lead_flagged'` only — no CRM record created
- [ ] SMS to Home Services incident uses Home Services template, not crash copy
