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
          </TabsList>

          <TabsContent value="overview">      <OverviewPanel />     </TabsContent>
          <TabsContent value="missed-calls">  <MissedCallsPanel />  </TabsContent>
          <TabsContent value="appointments">  <AppointmentsPanel /> </TabsContent>
          <TabsContent value="reputation">    <ReputationPanel />   </TabsContent>
          <TabsContent value="retention">     <RetentionPanel />    </TabsContent>
          <TabsContent value="loyalty">       <LoyaltyPanel />      </TabsContent>
          <TabsContent value="receptionist">  <ReceptionistPanel /> </TabsContent>
        </Tabs>

        <div className="mt-8 text-xs text-slate-400 text-center border-t pt-4">
          Apex Service Business OS — All outbound messages are DRAFTS. No automated sending without human approval.
          Booking links only — no automated bookings.
        </div>
      </div>
    </div>
  );
}
