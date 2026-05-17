/**
 * client/src/pages/service/service-business-dashboard.tsx
 *
 * Service Business Operating Dashboard
 *
 * Unified control panel for local service businesses on Apex.
 * Tabs: Overview | Missed Calls | Appointments | Reputation | Retention | Loyalty | AI Receptionist
 *
 * All panels are READ-ONLY or DRAFT-only — no automated sending.
 * Approve buttons require named actor input (≥2 chars).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

// ── Colour helpers ────────────────────────────────────────────────────────────

function scoreBadge(score: number) {
  if (score >= 75) return "bg-green-100 text-green-800";
  if (score >= 50) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function sentimentBadge(s: string) {
  if (s === "positive") return "bg-green-100 text-green-800";
  if (s === "neutral")  return "bg-gray-100 text-gray-700";
  return "bg-red-100 text-red-800";
}

// ── Overview panel ────────────────────────────────────────────────────────────

function OverviewPanel() {
  const { data: mcStats }   = useQuery({ queryKey: ["/api/service/missed-calls/stats"],    refetchInterval: 30_000 });
  const { data: apptStats } = useQuery({ queryKey: ["/api/service/appointments/stats"],    refetchInterval: 30_000 });
  const { data: repStats }  = useQuery({ queryKey: ["/api/service/reputation/stats"],      refetchInterval: 30_000 });
  const { data: retStats }  = useQuery({ queryKey: ["/api/service/retention/stats"],       refetchInterval: 30_000 });
  const { data: recStats }  = useQuery({ queryKey: ["/api/service/receptionist/stats"],    refetchInterval: 30_000 });
  const { data: loyStats }  = useQuery({ queryKey: ["/api/service/loyalty/stats"],         refetchInterval: 30_000 });

  const mc  = (mcStats   as any)?.data  ?? {};
  const ap  = (apptStats as any)?.data  ?? {};
  const rep = (repStats  as any)?.data  ?? {};
  const ret = (retStats  as any)?.data  ?? {};
  const rec = (recStats  as any)?.data  ?? {};
  const loy = (loyStats  as any)?.data  ?? {};

  const kpis = [
    { label: "Missed Call Recovery Rate", value: `${(mc.recoveryRatePct ?? 0).toFixed(1)}%`, sub: `${mc.total ?? 0} total missed calls` },
    { label: "Reputation Score",           value: `${rep.reputationScore ?? 0}/100`,          sub: `${rep.avgRating ?? "—"}★ avg · ${rep.totalReviews ?? 0} reviews` },
    { label: "At-Risk Customers",          value: ap.atRisk ?? 0,                             sub: "61-120 days since last visit" },
    { label: "Pending Retention Drafts",   value: ret.pending ?? 0,                           sub: `${(ret.conversionPct ?? 0).toFixed(1)}% draft → sent rate` },
    { label: "AI Receptionist Sessions",   value: rec.totalSessions ?? 0,                     sub: `${rec.escalations ?? 0} escalations · ${rec.openSessions ?? 0} open` },
    { label: "Loyalty Members",            value: loy.totalMembers ?? 0,                      sub: `${loy.totalPointsIssued ?? 0} pts issued total` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-slate-800">{k.value}</div>
              <div className="text-sm font-medium text-slate-600 mt-1">{k.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold text-slate-600">System Status</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span>Missed Call Engine</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span>AI Receptionist</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span>Retention Automation</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span>Reputation Engine</span>
            </div>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-4">
            ⚠ All outbound messages are DRAFTS — no automated sending. Human approval required before any message is dispatched.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Missed Calls panel ────────────────────────────────────────────────────────

function MissedCallsPanel() {
  const { data: pending } = useQuery({ queryKey: ["/api/service/missed-calls/pending"], refetchInterval: 15_000 });
  const { data: stats }   = useQuery({ queryKey: ["/api/service/missed-calls/stats"],   refetchInterval: 30_000 });
  const qc = useQueryClient();

  const markBooked = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/service/missed-call/${id}/booked`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/service/missed-calls/pending"] }),
  });

  const s   = (stats   as any)?.data ?? {};
  const rows = (pending as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Total",    s.total     ?? 0],
          ["Queued",   s.queued    ?? 0],
          ["Booked",   s.booked    ?? 0],
          ["Recovery", `${(s.recoveryRatePct ?? 0).toFixed(1)}%`],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Pending Recovery Queue</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No pending recoveries</p>
          ) : (
            <div className="divide-y">
              {rows.map((r: any) => (
                <div key={r.missed_call_id} className="py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">{r.caller_phone}</div>
                    <div className="text-xs text-slate-400">{r.called_at ? new Date(r.called_at).toLocaleString() : "—"}</div>
                    {r.draft_content && (
                      <div className="mt-1 text-xs bg-slate-50 border rounded p-2 text-slate-600 line-clamp-2">{r.draft_content}</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <Badge className={scoreBadge(Number(r.recovery_score ?? 0))}>Score {r.recovery_score ?? "—"}</Badge>
                    <Badge variant="outline" className="text-xs">{r.status}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => markBooked.mutate(r.missed_call_id)}
                    >
                      Mark Booked
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Appointments panel ────────────────────────────────────────────────────────

function AppointmentsPanel() {
  const { data: atRisk } = useQuery({ queryKey: ["/api/service/customers/at-risk"], refetchInterval: 60_000 });
  const { data: vip }    = useQuery({ queryKey: ["/api/service/customers/vip"],     refetchInterval: 60_000 });
  const { data: stats }  = useQuery({ queryKey: ["/api/service/appointments/stats"], refetchInterval: 30_000 });

  const s    = (stats  as any)?.data ?? {};
  const risk = (atRisk as any)?.data ?? [];
  const vips = (vip    as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Total Appts",   s.totalAppointments ?? 0],
          ["Completed",     s.completed ?? 0],
          ["No-Shows",      s.noShows ?? 0],
          ["Total Customers", s.totalCustomers ?? 0],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm text-amber-700">⚠ At-Risk Customers ({risk.length})</CardTitle></CardHeader>
          <CardContent>
            {risk.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No at-risk customers</p>
            ) : (
              <div className="divide-y max-h-64 overflow-y-auto">
                {risk.map((c: any) => (
                  <div key={c.customerId} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{c.firstName ?? "Unknown"} {c.lastName ?? ""}</span>
                      <div className="text-xs text-slate-400">{c.phone ?? "No phone"}</div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-xs">{c.lifecycle}</Badge>
                      <div className="text-xs text-slate-400 mt-0.5">Risk {c.churnRiskScore ?? "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm text-purple-700">⭐ VIP Customers ({vips.length})</CardTitle></CardHeader>
          <CardContent>
            {vips.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No VIP customers yet</p>
            ) : (
              <div className="divide-y max-h-64 overflow-y-auto">
                {vips.map((c: any) => (
                  <div key={c.customerId} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{c.firstName ?? "VIP"} {c.lastName ?? ""}</span>
                      <div className="text-xs text-slate-400">{c.visitCount} visits · ${c.totalSpend ?? 0}</div>
                    </div>
                    <Badge className="bg-purple-100 text-purple-800 text-xs">{c.lifecycle}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Reputation panel ──────────────────────────────────────────────────────────

function ReputationPanel() {
  const { data: stats }   = useQuery({ queryKey: ["/api/service/reputation/stats"],   refetchInterval: 30_000 });
  const { data: recent }  = useQuery({ queryKey: ["/api/service/reviews/recent"],     refetchInterval: 60_000 });
  const { data: alerts }  = useQuery({ queryKey: ["/api/service/reviews/alerts"],     refetchInterval: 30_000 });
  const qc = useQueryClient();

  const markAlert = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/service/review/${id}/alert-sent`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/service/reviews/alerts"] }),
  });

  const s       = (stats  as any)?.data ?? {};
  const reviews = (recent as any)?.data ?? [];
  const negAlerts = (alerts as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Reputation Score",   `${s.reputationScore ?? 0}/100`],
          ["Avg Rating",         `${s.avgRating ?? "—"}★`],
          ["Total Reviews",      s.totalReviews ?? 0],
          ["Response Rate",      `${(s.responseRate ?? 0).toFixed(0)}%`],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {negAlerts.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader><CardTitle className="text-sm text-red-700">🔴 Negative Review Alerts ({negAlerts.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-red-100">
              {negAlerts.map((r: any) => (
                <div key={r.reviewId} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{r.reviewerName ?? "Anonymous"}</span>
                      <Badge variant="outline" className="text-xs">{r.platform}</Badge>
                      <span className="text-yellow-500">{"★".repeat(r.rating)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{r.reviewText}</p>
                    {r.responseDraft && (
                      <div className="mt-2 text-xs bg-white border rounded p-2 text-slate-600">{r.responseDraft}</div>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => markAlert.mutate(r.reviewId)}>
                    Dismiss Alert
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent Reviews</CardTitle></CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No reviews ingested yet</p>
          ) : (
            <div className="divide-y max-h-80 overflow-y-auto">
              {reviews.map((r: any) => (
                <div key={r.reviewId} className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{r.reviewerName ?? "Anonymous"}</span>
                    <Badge variant="outline" className="text-xs">{r.platform}</Badge>
                    <Badge className={`text-xs ${sentimentBadge(r.sentiment)}`}>{r.sentiment}</Badge>
                    <span className="text-yellow-500 text-xs">{"★".repeat(r.rating)}</span>
                  </div>
                  {r.reviewText && <p className="text-xs text-slate-500 line-clamp-2">{r.reviewText}</p>}
                  {r.responseDraft && !r.respondedAt && (
                    <div className="mt-1 text-xs bg-blue-50 border border-blue-100 rounded p-2 text-blue-700">
                      Draft response ready (not sent)
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Retention panel ───────────────────────────────────────────────────────────

function RetentionPanel() {
  const { data: pending } = useQuery({ queryKey: ["/api/service/retention/pending"], refetchInterval: 15_000 });
  const { data: stats }   = useQuery({ queryKey: ["/api/service/retention/stats"],   refetchInterval: 30_000 });
  const qc = useQueryClient();
  const [actorName, setActorName] = useState("");

  const approve = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/service/retention/${id}/approve`, { approvedBy: actorName }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/service/retention/pending"] }),
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/service/retention/${id}/reject`, { reason: "rejected_via_dashboard" }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/service/retention/pending"] }),
  });

  const s    = (stats   as any)?.data ?? {};
  const rows = (pending as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Pending Drafts", s.pending ?? 0],
          ["Approved",       s.approved ?? 0],
          ["Sent",           s.sent ?? 0],
          ["Send Rate",      `${(s.conversionPct ?? 0).toFixed(1)}%`],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Pending Retention Drafts</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Your name (required to approve)"
                className="text-xs h-7 w-48"
                value={actorName}
                onChange={e => setActorName(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            Drafts require a named approver (min 2 characters). No messages are sent automatically.
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No pending drafts</p>
          ) : (
            <div className="divide-y">
              {rows.map((r: any) => (
                <div key={r.draft_id} className="py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{r.workflow_type}</Badge>
                    <span className="text-xs text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</span>
                  </div>
                  <div className="text-xs bg-slate-50 border rounded p-2 text-slate-600">{r.draft_content}</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="text-xs h-7"
                      disabled={actorName.trim().length < 2 || approve.isPending}
                      onClick={() => approve.mutate(r.draft_id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs h-7"
                      onClick={() => reject.mutate(r.draft_id)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Loyalty panel ─────────────────────────────────────────────────────────────

function LoyaltyPanel() {
  const { data: stats } = useQuery({ queryKey: ["/api/service/loyalty/stats"], refetchInterval: 60_000 });
  const s = (stats as any)?.data ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Loyalty Members",    s.totalMembers ?? 0],
          ["Points Issued",      s.totalPointsIssued ?? 0],
          ["Points Redeemed",    s.totalRedeemed ?? 0],
          ["Milestones Hit",     s.milestonesHit ?? 0],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Loyalty Program Overview</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-50 rounded p-3">
              <div className="font-medium text-slate-700">Points Model</div>
              <ul className="text-xs text-slate-500 mt-1 space-y-0.5">
                <li>• 1 point per $1 spent</li>
                <li>• +10 pts for leaving a review</li>
                <li>• +25 pts for a referral conversion</li>
              </ul>
            </div>
            <div className="bg-slate-50 rounded p-3">
              <div className="font-medium text-slate-700">Milestones</div>
              <ul className="text-xs text-slate-500 mt-1 space-y-0.5">
                <li>• 100 pts — Bronze reward</li>
                <li>• 250 pts — Silver reward</li>
                <li>• 500 pts — Gold reward</li>
                <li>• 1,000 pts — Platinum reward</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Reward notifications are queued as drafts via the Retention system. No automatic redemption.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── AI Receptionist panel ─────────────────────────────────────────────────────

function ReceptionistPanel() {
  const { data: stats }      = useQuery({ queryKey: ["/api/service/receptionist/stats"],      refetchInterval: 15_000 });
  const { data: escalations} = useQuery({ queryKey: ["/api/service/receptionist/escalations"], refetchInterval: 15_000 });
  const qc = useQueryClient();

  const closeEsc = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/service/receptionist/${id}/close`, { reason: "resolved_via_dashboard" }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["/api/service/receptionist/escalations"] }),
  });

  const s    = (stats      as any)?.data ?? {};
  const escs = (escalations as any)?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Total Sessions",   s.totalSessions ?? 0],
          ["Open Sessions",    s.openSessions ?? 0],
          ["Escalations",      s.escalations ?? 0],
          ["Booking Intents",  s.bookingIntents ?? 0],
        ].map(([label, val]) => (
          <Card key={label as string}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{val}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-orange-200">
        <CardHeader>
          <CardTitle className="text-sm text-orange-800">
            Open Escalations ({escs.length}) — Requires Human Follow-Up
          </CardTitle>
        </CardHeader>
        <CardContent>
          {escs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No open escalations 🎉</p>
          ) : (
            <div className="divide-y">
              {escs.map((s: any) => (
                <div key={s.sessionId} className="py-3 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">{s.callerPhone}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">{s.channel}</Badge>
                      {s.handoffReason && <Badge className="text-xs bg-orange-100 text-orange-800">{s.handoffReason}</Badge>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {s.messageCount} messages · Escalated {s.humanHandoffAt ? new Date(s.humanHandoffAt).toLocaleString() : "—"}
                    </div>
                    {s.auditLog?.length > 0 && (
                      <div className="mt-2 text-xs bg-slate-50 border rounded p-2 max-h-20 overflow-y-auto">
                        {s.auditLog.slice(-3).map((entry: any, i: number) => (
                          <div key={i} className={`mb-0.5 ${entry.role === "ai" ? "text-blue-600" : "text-slate-600"}`}>
                            <span className="font-semibold">{entry.role}:</span> {entry.content}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs shrink-0"
                    onClick={() => closeEsc.mutate(s.sessionId)}
                  >
                    Close Session
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Receptionist Rules</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-xs text-slate-500 space-y-1">
            <li>✅ Delivers booking LINKS only — never books directly</li>
            <li>✅ Enforces business hours — flags after-hours sessions</li>
            <li>✅ Escalates on "human", "manager", "agent", legal threats</li>
            <li>✅ Max 30 messages per session — auto-escalates at cap</li>
            <li>✅ Every message logged in audit trail</li>
            <li>✅ Opt-out ("STOP") immediately closes session</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── New Residents panel ───────────────────────────────────────────────────────

const TENANT_ID = "apex-default";

function NewResidentsPanel() {
  const qc = useQueryClient();
  const [actorName, setActorName] = useState("");
  const [ingestZip, setIngestZip]   = useState("");

  const { data: evtStats }    = useQuery({ queryKey: ["/api/nr/events/stats"],         refetchInterval: 30_000 });
  const { data: households }  = useQuery({ queryKey: ["/api/nr/households"],            refetchInterval: 30_000 });
  const { data: topScores }   = useQuery({ queryKey: ["/api/nr/scores/top"],            refetchInterval: 30_000 });
  const { data: pending }     = useQuery({ queryKey: ["/api/nr/workflow/pending"],       refetchInterval: 15_000 });
  const { data: wfStats }     = useQuery({ queryKey: ["/api/nr/workflow/stats"],         refetchInterval: 30_000 });
  const { data: matches }     = useQuery({ queryKey: ["/api/nr/matches"],               refetchInterval: 30_000 });
  const { data: crossover }   = useQuery({ queryKey: ["/api/nr/crossover"],             refetchInterval: 30_000 });
  const { data: xStats }      = useQuery({ queryKey: ["/api/nr/crossover/stats"],        refetchInterval: 30_000 });
  const { data: recs }        = useQuery({ queryKey: ["/api/nr/recommendations"],       refetchInterval: 30_000 });

  const approveWf = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/nr/workflow/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, approvedBy: actorName }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/nr/workflow/pending"] }),
  });

  const rejectWf = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/nr/workflow/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: TENANT_ID, rejectedBy: actorName, reason: "rejected_via_dashboard" }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/nr/workflow/pending"] }),
  });

  const es  = (evtStats   as any)?.data ?? {};
  const hhs = (households as any)?.data ?? [];
  const ts  = (topScores  as any)?.data ?? [];
  const pw  = (pending    as any)?.data ?? [];
  const ws  = (wfStats    as any)?.data ?? {};
  const mx  = (matches    as any)?.data ?? [];
  const cr  = (crossover  as any)?.data ?? [];
  const xs  = (xStats     as any)?.data ?? {};
  const rs  = (recs       as any)?.data ?? [];

  // Compute ZIP/county frequency from households
  const zipCounts: Record<string, number> = {};
  const countyCounts: Record<string, number> = {};
  for (const h of hhs) {
    if (h.zip)    zipCounts[h.zip]       = (zipCounts[h.zip] ?? 0) + 1;
    if (h.county) countyCounts[h.county] = (countyCounts[h.county] ?? 0) + 1;
  }
  const topZips    = Object.entries(zipCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topCounties = Object.entries(countyCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const homeowners = hhs.filter((h: any) => (h.homeownerLikelihood ?? 0) >= 60).length;
  const renters    = hhs.filter((h: any) => (h.homeownerLikelihood ?? 0) <  60).length;

  function tierBadge(tier: string) {
    if (tier === "high")   return "bg-green-100 text-green-800";
    if (tier === "medium") return "bg-yellow-100 text-yellow-800";
    return "bg-slate-100 text-slate-600";
  }

  return (
    <div className="space-y-6">
      {/* Privacy notice */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
        <strong>Local Welcome Intelligence</strong> — Public-record signals only. No protected attribute inference.
        All outreach requires human approval. Opt-outs honoured permanently. No automated sending.
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Move Events",       value: es.total          ?? 0 },
          { label: "High-Confidence Events",  value: es.highConfidence ?? 0 },
          { label: "Active Households",       value: hhs.length },
          { label: "Pending WF Drafts",       value: ws.pending        ?? 0 },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-slate-800">{k.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Move-ins by ZIP + County */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Move-ins by ZIP Code</CardTitle></CardHeader>
          <CardContent>
            {topZips.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No ZIP data yet</p>
            ) : (
              <div className="space-y-2">
                {topZips.map(([zip, count]) => (
                  <div key={zip} className="flex items-center gap-2">
                    <span className="font-mono text-sm w-16">{zip}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${Math.min(100, (count / (topZips[0]?.[1] ?? 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Move-ins by County</CardTitle></CardHeader>
          <CardContent>
            {topCounties.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No county data yet</p>
            ) : (
              <div className="space-y-2">
                {topCounties.map(([county, count]) => (
                  <div key={county} className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate">{county}</span>
                    <div className="w-24 bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-indigo-500 h-2 rounded-full"
                        style={{ width: `${Math.min(100, (count / (topCounties[0]?.[1] ?? 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Homeowner vs Renter + Opportunity heatmap */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Household Transitions</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-center">
                <div className="text-3xl font-bold text-emerald-700">{homeowners}</div>
                <div className="text-xs text-emerald-600 mt-1">Homeowner Transitions</div>
                <div className="text-xs text-slate-400">≥60% ownership likelihood</div>
              </div>
              <div className="bg-violet-50 border border-violet-200 rounded p-3 text-center">
                <div className="text-3xl font-bold text-violet-700">{renters}</div>
                <div className="text-xs text-violet-600 mt-1">Renter Transitions</div>
                <div className="text-xs text-slate-400">&lt;60% ownership likelihood</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-center">
              <div className="bg-slate-50 rounded p-2">
                <div className="font-semibold text-slate-700">{xs.insuranceOpportunities ?? 0}</div>
                <div className="text-slate-500">Insurance Opps</div>
              </div>
              <div className="bg-slate-50 rounded p-2">
                <div className="font-semibold text-slate-700">{xs.contractorOpportunities ?? 0}</div>
                <div className="text-slate-500">Contractor Opps</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Opportunity Score Heatmap</CardTitle></CardHeader>
          <CardContent>
            {ts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No scored households yet</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {ts.slice(0, 8).map((h: any) => (
                  <div key={h.householdId} className="flex items-center gap-2 text-xs">
                    <span className="font-mono truncate w-24 text-slate-400">{h.householdId.slice(0, 12)}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${h.overallScore >= 70 ? "bg-green-500" : h.overallScore >= 50 ? "bg-yellow-500" : "bg-slate-400"}`}
                        style={{ width: `${h.overallScore}%` }}
                      />
                    </div>
                    <span className={`w-8 text-right font-semibold ${h.overallScore >= 70 ? "text-green-700" : h.overallScore >= 50 ? "text-yellow-700" : "text-slate-500"}`}>
                      {h.overallScore}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Workflow Approval Queue */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">
              Workflow Approval Queue
              {pw.length > 0 && (
                <span className="ml-2 bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pw.length}</span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Your name (required)"
                className="text-xs h-7 w-44"
                value={actorName}
                onChange={e => setActorName(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            Human approval required before any welcome workflow is dispatched. No automated sending.
          </p>
          {pw.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No pending workflow drafts</p>
          ) : (
            <div className="divide-y">
              {pw.map((d: any) => (
                <div key={d.draftId} className="py-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">{d.workflowType}</Badge>
                    <Badge className="text-xs bg-blue-100 text-blue-800">{d.serviceCategory}</Badge>
                    <span className="text-xs text-slate-400">{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—"}</span>
                  </div>
                  <div className="text-xs bg-slate-50 border rounded p-2 text-slate-600 line-clamp-3">
                    {d.draftContent ?? d.messageOptions?.[0]?.message ?? "No content"}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="text-xs h-7 bg-green-600 hover:bg-green-700"
                      disabled={actorName.trim().length < 2 || approveWf.isPending}
                      onClick={() => approveWf.mutate(d.draftId)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-xs h-7"
                      disabled={actorName.trim().length < 2 || rejectWf.isPending}
                      onClick={() => rejectWf.mutate(d.draftId)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business Category Routing */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Business Category Routing</CardTitle></CardHeader>
          <CardContent>
            {mx.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No business matches yet</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {mx.slice(0, 8).map((m: any) => (
                  <div key={m.matchId} className="flex items-center justify-between text-xs border-b pb-1 last:border-0">
                    <div>
                      <span className="font-medium text-slate-700">{m.businessName}</span>
                      <Badge variant="outline" className="ml-1 text-xs">{m.serviceCategory}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold ${m.matchScore >= 70 ? "text-green-600" : m.matchScore >= 50 ? "text-yellow-600" : "text-slate-500"}`}>
                        {m.matchScore}
                      </span>
                      <Badge variant="outline" className="text-xs">{m.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">AI Agent Recommendations</CardTitle></CardHeader>
          <CardContent>
            {rs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No recommendations yet</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {rs.slice(0, 6).map((r: any) => (
                  <div key={r.recommendationId} className="text-xs border-b pb-2 last:border-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge className={`text-xs ${tierBadge(r.priority)}`}>{r.priority}</Badge>
                      <span className="font-medium text-slate-700">{r.recommendationType}</span>
                    </div>
                    <p className="text-slate-500 line-clamp-2">{r.reason}</p>
                    {r.timingWindow && (
                      <p className="text-blue-600 mt-0.5">⏱ {r.timingWindow}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Crossover Opportunities */}
      {cr.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Insurance &amp; Contractor Crossover Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {[
                { label: "Total",     value: xs.totalOpportunities    ?? 0 },
                { label: "Insurance", value: xs.insuranceOpportunities ?? 0 },
                { label: "Contractor",value: xs.contractorOpportunities ?? 0 },
                { label: "High Score",value: xs.highScore              ?? 0 },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 rounded p-2 text-center">
                  <div className="font-bold text-slate-700">{k.value}</div>
                  <div className="text-xs text-slate-500">{k.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {cr.slice(0, 6).map((c: any) => (
                <div key={c.opportunityId} className="flex items-center justify-between text-xs border-b pb-1 last:border-0">
                  <div>
                    <Badge variant="outline" className="text-xs">{c.opportunityType}</Badge>
                    <span className="ml-2 text-slate-500 truncate max-w-xs">{c.rationale}</span>
                  </div>
                  <span className={`font-semibold ml-2 ${c.score >= 70 ? "text-green-600" : "text-yellow-600"}`}>{c.score}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance summary */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Compliance &amp; Privacy Rules</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-xs text-slate-500 space-y-1 grid grid-cols-1 md:grid-cols-2">
            <li>✅ Public-record signals only — no protected attributes</li>
            <li>✅ Quiet hours enforced (8 PM–9 AM local)</li>
            <li>✅ Suppression checked before every household record</li>
            <li>✅ Addresses stored as SHA-256 hashes — no raw PII</li>
            <li>✅ 14-day workflow dedup per household</li>
            <li>✅ Opt-outs honoured permanently — cannot be overridden</li>
            <li>✅ requiresApproval: true on all AI recommendations</li>
            <li>✅ Confidence gate ≥40 required to create household record</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Root dashboard ────────────────────────────────────────────────────────────

export default function ServiceBusinessDashboard() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Service Business OS</h1>
          <p className="text-sm text-slate-500 mt-1">
            Apex local service business operating system — barbers, salons, spas, nail salons, med spas, massage, tattoo, lash, wellness
          </p>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="mb-6 flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="missed-calls">Missed Calls</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="reputation">Reputation</TabsTrigger>
            <TabsTrigger value="retention">Retention</TabsTrigger>
            <TabsTrigger value="loyalty">Loyalty</TabsTrigger>
            <TabsTrigger value="receptionist">AI Receptionist</TabsTrigger>
            <TabsTrigger value="new-residents">New Residents</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">      <OverviewPanel />       </TabsContent>
          <TabsContent value="missed-calls">  <MissedCallsPanel />    </TabsContent>
          <TabsContent value="appointments">  <AppointmentsPanel />   </TabsContent>
          <TabsContent value="reputation">    <ReputationPanel />     </TabsContent>
          <TabsContent value="retention">     <RetentionPanel />      </TabsContent>
          <TabsContent value="loyalty">       <LoyaltyPanel />        </TabsContent>
          <TabsContent value="receptionist">  <ReceptionistPanel />   </TabsContent>
          <TabsContent value="new-residents"> <NewResidentsPanel />   </TabsContent>
        </Tabs>

        <div className="mt-8 text-xs text-slate-400 text-center border-t pt-4">
          Apex Service Business OS — All outbound messages are DRAFTS. No automated sending without human approval.
          Booking links only — no automated bookings.
        </div>
      </div>
    </div>
  );
}
