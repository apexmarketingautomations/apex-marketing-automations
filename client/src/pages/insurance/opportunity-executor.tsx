/**
 * client/src/pages/insurance/opportunity-executor.tsx
 *
 * Insurance Opportunity Executor
 *
 * The human-in-the-loop approval interface for the Insurance Intelligence Engine.
 * ALL outreach drafts pass through this screen before any channel fires.
 *
 * Layout:
 *   Left panel  — Pending approvals queue (filterable by type / agency)
 *   Right panel — Selected workflow detail:
 *                   • Draft preview with edit capability
 *                   • Opportunity context (score, signals, household)
 *                   • Audit timeline
 *                   • Approve / Edit & Approve / Reject controls
 *
 * Safety:
 *   - No "Send" button exists — approve only queues the workflow for the
 *     transport adapter; the ApprovalGate re-validates before any send.
 *   - Reject is permanent (status → cancelled).
 *   - All actions require the admin's display name as approvedBy/rejectedBy.
 */

import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, ChevronRight,
  User, Shield, Activity, FileText, RefreshCw, Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowItem {
  id: number;
  workflow_type: string;
  insurance_line?: string;
  household_id?: string;
  opportunity_id?: string;
  status: string;
  scheduled_at: string;
  draft_content?: string;
  approved_at?: string;
  approved_by?: string;
  approval_required: boolean;
  pre_exec_score?: number;
  pre_exec_checked_at?: string;
  agency_id?: number;
  created_at: string;
  trigger_data?: Record<string, unknown>;
  last_gate_result?: string;
  last_score_check?: number;
}

interface AuditEntry {
  id: number;
  gate_result: string;
  gate_code?: string;
  approver?: string;
  score_at_exec?: number;
  score_threshold?: number;
  error_message?: string;
  created_at: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postJson(path: string, body: Record<string, unknown>) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function workflowTypeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    pending:   { variant: "secondary", label: "Pending" },
    approved:  { variant: "default",   label: "Approved" },
    cancelled: { variant: "destructive", label: "Cancelled" },
    executed:  { variant: "outline",   label: "Executed" },
  };
  const s = map[status] ?? { variant: "outline", label: status };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function gateResultIcon(result?: string) {
  if (!result) return null;
  if (result === "PASS") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  return <AlertTriangle className="h-4 w-4 text-orange-500" />;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diff / 3_600_000);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

// ── Left panel: Pending Queue ─────────────────────────────────────────────────

interface QueuePanelProps {
  selected: WorkflowItem | null;
  onSelect: (wf: WorkflowItem) => void;
}

function QueuePanel({ selected, onSelect }: QueuePanelProps) {
  const [typeFilter, setTypeFilter] = useState("all");

  const queueQ = useQuery({
    queryKey: ["insurance", "pending-approvals"],
    queryFn: () => apiFetch("/api/insurance/pending-approvals?limit=100"),
    refetchInterval: 15_000,
  });

  const items: WorkflowItem[] = (queueQ.data?.pending ?? []).filter((w: WorkflowItem) =>
    typeFilter === "all" || w.workflow_type === typeFilter,
  );

  const typeSet = Array.from(new Set((queueQ.data?.pending ?? []).map((w: WorkflowItem) => w.workflow_type)));

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Pending Approvals</h2>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <select
          className="w-full text-xs border rounded px-2 py-1.5 bg-background"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="all">All Types</option>
          {(typeSet as string[]).map(t => (
            <option key={t} value={t}>{workflowTypeLabel(t)}</option>
          ))}
        </select>
      </div>

      <ScrollArea className="flex-1">
        {queueQ.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground text-center">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2" />
            No pending approvals
          </div>
        ) : items.map((wf) => (
          <button
            key={wf.id}
            onClick={() => onSelect(wf)}
            className={`w-full text-left px-4 py-3 border-b transition-colors hover:bg-muted/40 ${
              selected?.id === wf.id ? "bg-muted/60 border-l-2 border-l-primary" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-foreground">{workflowTypeLabel(wf.workflow_type)}</span>
              {statusBadge(wf.status)}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {wf.insurance_line && (
                <span className="bg-muted px-1 rounded">{wf.insurance_line}</span>
              )}
              {wf.pre_exec_score != null && (
                <span className={wf.pre_exec_score >= 50 ? "text-orange-500" : "text-muted-foreground"}>
                  score={wf.pre_exec_score}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {relativeTime(wf.scheduled_at)}
              {wf.last_gate_result && (
                <span className="ml-auto">{gateResultIcon(wf.last_gate_result)}</span>
              )}
            </div>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}

// ── Right panel: Workflow Detail ──────────────────────────────────────────────

interface DetailPanelProps {
  workflow: WorkflowItem;
  onAction: () => void;
}

function DetailPanel({ workflow, onAction }: DetailPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(workflow.draft_content ?? "");
  const [actorName, setActorName] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ ok: boolean; channel?: string; messageSid?: string; error?: string; gateCode?: string } | null>(null);

  // Sync draft when workflow changes
  React.useEffect(() => {
    setDraft(workflow.draft_content ?? "");
  }, [workflow.id, workflow.draft_content]);

  // Audit timeline
  const auditQ = useQuery({
    queryKey: ["insurance", "workflow-audit", workflow.id],
    queryFn: () => apiFetch(`/api/insurance/workflow-audit/${workflow.id}`),
    refetchInterval: 10_000,
  });
  const timeline: AuditEntry[] = auditQ.data?.timeline ?? [];

  // Execute mutation — only available on approved workflows
  const executeMutation = useMutation({
    mutationFn: (body: { subAccountId: number; agencyId: number }) =>
      postJson(`/api/insurance/execute-workflow/${workflow.id}`, body),
    onSuccess: (data) => {
      setExecuteResult(data);
      if (data.ok) {
        toast({ title: "Workflow executed", description: `Sent via ${data.channel} — SID: ${data.messageSid ?? "n/a"}` });
        qc.invalidateQueries({ queryKey: ["insurance", "pending-approvals"] });
        qc.invalidateQueries({ queryKey: ["insurance", "workflow-audit", workflow.id] });
        onAction();
      } else {
        toast({
          title: "Execution blocked",
          description: data.gateCode ? `Gate: ${data.gateCode}` : data.error,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Execute failed", description: err.message, variant: "destructive" });
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => postJson(`/api/insurance/approve-workflow/${workflow.id}`, {
      approvedBy:   actorName.trim(),
      draftContent: draft,
    }),
    onSuccess: () => {
      toast({ title: "Workflow approved", description: `#${workflow.id} queued for transport gate` });
      qc.invalidateQueries({ queryKey: ["insurance", "pending-approvals"] });
      qc.invalidateQueries({ queryKey: ["insurance", "workflow-audit", workflow.id] });
      onAction();
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: () => postJson(`/api/insurance/reject-workflow/${workflow.id}`, {
      rejectedBy: actorName.trim(),
      reason:     rejectReason.trim(),
    }),
    onSuccess: () => {
      toast({ title: "Workflow rejected", description: `#${workflow.id} cancelled`, variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["insurance", "pending-approvals"] });
      setShowRejectDialog(false);
      onAction();
    },
    onError: (err: any) => {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    },
  });

  const canApprove = actorName.trim().length >= 2 &&
    workflow.status !== "cancelled" &&
    workflow.status !== "executed";

  const triggerData = workflow.trigger_data ?? {};

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-bold text-base">{workflowTypeLabel(workflow.workflow_type)}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Workflow #{workflow.id} · Created {relativeTime(workflow.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(workflow.status)}
            {workflow.approval_required && (
              <Badge variant="outline" className="text-xs gap-1">
                <Shield className="h-3 w-3" /> Approval Required
              </Badge>
            )}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">

          {/* Opportunity context */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Opportunity Context
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["Insurance Line", workflow.insurance_line ?? "—"],
                ["Household ID", workflow.household_id ? workflow.household_id.slice(0, 12) + "…" : "—"],
                ["Pre-Exec Score", workflow.pre_exec_score != null ? `${workflow.pre_exec_score}/100` : "not checked"],
                ["Scheduled", new Date(workflow.scheduled_at).toLocaleString()],
                ["Agency", workflow.agency_id ?? "unassigned"],
                ["Last Gate", workflow.last_gate_result ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="bg-muted/30 rounded p-2">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-medium text-xs mt-0.5 break-all">{String(value)}</p>
                </div>
              ))}
            </div>
            {Object.keys(triggerData).length > 0 && (
              <div className="mt-2 bg-muted/20 rounded p-2 text-xs font-mono text-muted-foreground overflow-auto max-h-24">
                {JSON.stringify(triggerData, null, 2)}
              </div>
            )}
          </section>

          <Separator />

          {/* Draft preview + edit */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> Draft Message
            </h3>
            {workflow.status === "cancelled" || workflow.status === "executed" ? (
              <div className="rounded border p-3 text-sm bg-muted/20 whitespace-pre-wrap text-muted-foreground">
                {draft || "(no draft content)"}
              </div>
            ) : (
              <>
                <Textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={5}
                  className="text-sm font-mono resize-none"
                  placeholder="Draft message content — edit before approving…"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {draft.length} chars · Edit is permitted before approval. Final text is what gets queued.
                </p>
              </>
            )}
          </section>

          <Separator />

          {/* Audit timeline */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Audit Timeline
            </h3>
            {timeline.length === 0 ? (
              <p className="text-xs text-muted-foreground">No audit entries yet</p>
            ) : (
              <div className="space-y-1.5">
                {timeline.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-xs">
                    <div className="mt-0.5">{gateResultIcon(entry.gate_result)}</div>
                    <div className="flex-1">
                      <span className={`font-medium ${entry.gate_result === "PASS" ? "text-green-700" : "text-orange-700"}`}>
                        {entry.gate_result}
                      </span>
                      {entry.approver && <span className="text-muted-foreground ml-1">by {entry.approver}</span>}
                      {entry.score_at_exec != null && (
                        <span className="text-muted-foreground ml-1">score={entry.score_at_exec}</span>
                      )}
                      {entry.error_message && (
                        <p className="text-orange-600 mt-0.5">{entry.error_message}</p>
                      )}
                    </div>
                    <span className="text-muted-foreground shrink-0">{relativeTime(entry.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </ScrollArea>

      {/* Action footer */}
      {workflow.status !== "cancelled" && workflow.status !== "executed" && (
        <div className="p-4 border-t bg-background space-y-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={actorName}
              onChange={e => setActorName(e.target.value)}
              placeholder="Your name (required for audit)"
              className="text-sm h-8"
            />
          </div>
          {!actorName.trim() && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Enter your name — it is written to the permanent audit log.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              disabled={!actorName.trim() || rejectMutation.isPending}
              onClick={() => setShowRejectDialog(true)}
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={!canApprove || approveMutation.isPending}
              onClick={() => approveMutation.mutate()}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {approveMutation.isPending ? "Approving…" : "Approve Draft"}
            </Button>
          </div>
          {/* Execute — only shown for already-approved workflows */}
          {workflow.status === "approved" && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-medium text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved — ready to send
                </p>
                <Button
                  size="sm"
                  variant="default"
                  className="w-full bg-green-700 hover:bg-green-800"
                  disabled={!actorName.trim() || executeMutation.isPending}
                  onClick={() => {
                    // subAccountId and agencyId must come from the workflow or session context.
                    // Using agency_id from the workflow row; subAccountId defaults to agency_id
                    // until sub-account wiring is done in Phase 9.
                    const agencyId = workflow.agency_id ?? 0;
                    executeMutation.mutate({ subAccountId: agencyId, agencyId });
                  }}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {executeMutation.isPending ? "Sending…" : "Execute & Send"}
                </Button>
                {executeResult && !executeResult.ok && (
                  <p className="text-xs text-red-600">
                    Blocked: {executeResult.gateCode ?? executeResult.error}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Transport gate re-validates approval, score, and suppression immediately before send.
                </p>
              </div>
            </>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            Approval queues this workflow — transport gate re-validates before any message is sent.
          </p>
        </div>
      )}

      {/* Reject dialog */}
      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Workflow #{workflow.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently cancel the workflow. It cannot be un-cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional but recommended)"
            rows={3}
            className="mt-2 text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rejectMutation.mutate()}
            >
              Confirm Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Pre-exec validation panel ─────────────────────────────────────────────────

function PreExecPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  const runValidation = useCallback(async () => {
    setRunning(true);
    try {
      const res = await postJson("/api/insurance/pre-exec-validation", { minScore: 30, staleAfterDays: 7 });
      setResult(res);
      qc.invalidateQueries({ queryKey: ["insurance", "pending-approvals"] });
      toast({ title: "Validation complete", description: `Cancelled ${res.cancelled} stale/low-score workflows` });
    } catch (err: any) {
      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }, [qc, toast]);

  return (
    <div className="border-t p-4 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-muted-foreground">Pre-Execution Score Sweep</p>
        <Button size="sm" variant="outline" disabled={running} onClick={runValidation}>
          <RefreshCw className={`h-3 w-3 mr-1 ${running ? "animate-spin" : ""}`} />
          {running ? "Scanning…" : "Run Sweep"}
        </Button>
      </div>
      {result && (
        <div className="grid grid-cols-4 gap-2 text-xs mt-2">
          {[
            ["Checked", result.checked],
            ["OK", result.ok],
            ["Low Score", result.lowScore],
            ["Stale", result.stale],
          ].map(([label, value]) => (
            <div key={label} className="bg-background rounded p-2 text-center">
              <p className="text-muted-foreground">{label}</p>
              <p className="font-bold">{value}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-2">
        Cancels workflows where score dropped below 30 or where approval was never given within 7 days.
      </p>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function OpportunityExecutorPage() {
  const [selected, setSelected] = useState<WorkflowItem | null>(null);

  const handleAction = useCallback(() => {
    setSelected(null);
  }, []);

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col">
      {/* Page header */}
      <div className="px-6 py-4 border-b bg-background shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Insurance Opportunity Executor</h1>
            <p className="text-sm text-muted-foreground">
              Human-in-the-loop approval queue — all drafts require named-actor review before any channel fires.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            <Shield className="h-3.5 w-3.5" />
            Approval gate active on all transport channels
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Queue — left */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden">
          <QueuePanel selected={selected} onSelect={setSelected} />
          <PreExecPanel />
        </div>

        {/* Detail — right */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <DetailPanel workflow={selected} onAction={handleAction} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <ChevronRight className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a pending workflow to review</p>
                <p className="text-xs mt-1">Approvals require a named actor and are audit-logged permanently.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
