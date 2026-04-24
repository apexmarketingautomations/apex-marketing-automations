import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, Plus, RotateCcw, Save } from "lucide-react";

interface StageDef {
  name: string;
  position: number;
}
interface WorkflowDef {
  name: string;
  trigger: string;
  enabled: boolean;
  smsBody: string;
}
interface DefaultsPayload {
  pipelineStages: StageDef[];
  workflows: WorkflowDef[];
  brandVoiceSystemPrompt: string;
  welcomeSmsBody: string;
}
interface DefaultsResponse {
  effective: DefaultsPayload;
  inCodeDefaults: DefaultsPayload;
  hasOverride: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

type AuthUser = User & { role?: string; authProvider?: string };

function userIsAdminFlag(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  return user.isAdmin === "true";
}

export default function OnboardingDefaultsAdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAdminFlag = userIsAdminFlag(user as AuthUser);

  const { data, isLoading, error, refetch, isFetching } = useQuery<DefaultsResponse, Error>({
    queryKey: ["/api/admin/onboarding-defaults"],
    queryFn: async () => {
      const res = await fetch("/api/admin/onboarding-defaults", { credentials: "include" });
      if (res.status === 401) throw new Error("You are not signed in.");
      if (res.status === 403) throw new Error("Admin access required to edit onboarding defaults.");
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed with status ${res.status}`);
      }
      return res.json() as Promise<DefaultsResponse>;
    },
    enabled: isAdminFlag,
    retry: false,
  });

  const [form, setForm] = useState<DefaultsPayload | null>(null);

  useEffect(() => {
    if (data && !form) setForm(structuredClone(data.effective));
  }, [data, form]);

  const saveMutation = useMutation<unknown, Error, DefaultsPayload>({
    mutationFn: async (payload: DefaultsPayload) => {
      const res = await apiRequest("PUT", "/api/admin/onboarding-defaults", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "New sub-accounts will use these templates." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/onboarding-defaults"] });
    },
    onError: (e) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation<unknown, Error>({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/onboarding-defaults");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reset", description: "Reverted to in-code defaults." });
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/onboarding-defaults"] });
    },
    onError: (e) => {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    },
  });

  if (!isAdminFlag) {
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="text-not-authorized">
        Admin access required.
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4" data-testid="state-error">
        <h1 className="text-xl font-bold">Default Onboarding Templates</h1>
        <p className="text-sm text-destructive" data-testid="text-error-message">
          {error.message}
        </p>
        <Button onClick={() => refetch()} disabled={isFetching} data-testid="button-retry">
          Try again
        </Button>
      </div>
    );
  }

  if (isLoading || !form || !data) {
    return <div className="p-8 text-muted-foreground" data-testid="text-loading">Loading...</div>;
  }

  const updateStage = (i: number, patch: Partial<StageDef>) => {
    setForm({ ...form, pipelineStages: form.pipelineStages.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  };
  const addStage = () => {
    const nextPos = form.pipelineStages.length;
    setForm({ ...form, pipelineStages: [...form.pipelineStages, { name: "New Stage", position: nextPos }] });
  };
  const removeStage = (i: number) => {
    setForm({ ...form, pipelineStages: form.pipelineStages.filter((_, idx) => idx !== i) });
  };

  const updateWorkflow = (i: number, patch: Partial<WorkflowDef>) => {
    setForm({ ...form, workflows: form.workflows.map((w, idx) => idx === i ? { ...w, ...patch } : w) });
  };
  const addWorkflow = () => {
    setForm({ ...form, workflows: [...form.workflows, { name: "New Workflow", trigger: "new_lead", enabled: true, smsBody: "" }] });
  };
  const removeWorkflow = (i: number) => {
    setForm({ ...form, workflows: form.workflows.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6" data-testid="page-onboarding-defaults">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Default Onboarding Templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit the pipeline stages, seeded workflows, brand-voice prompt, and welcome SMS that every new sub-account starts with. Changes apply to the next account created.
          </p>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-status">
            {data.hasOverride
              ? `Custom overrides active${data.updatedAt ? ` (last updated ${new Date(data.updatedAt).toLocaleString()})` : ""}.`
              : "Using built-in defaults — no custom overrides saved."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setForm(structuredClone(data.inCodeDefaults))}
            data-testid="button-load-builtin"
          >
            <RotateCcw className="w-4 h-4 mr-1" /> Load built-in
          </Button>
          {data.hasOverride && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              data-testid="button-reset-override"
            >
              Reset to built-in
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            <Save className="w-4 h-4 mr-1" /> Save
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline Stages</CardTitle>
          <CardDescription>Stages created in each new sub-account's deal pipeline.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {form.pipelineStages.map((s, i) => (
            <div key={i} className="flex items-center gap-2" data-testid={`row-stage-${i}`}>
              <Input
                type="number"
                value={s.position}
                onChange={(e) => updateStage(i, { position: Number(e.target.value) })}
                className="w-20"
                data-testid={`input-stage-position-${i}`}
              />
              <Input
                value={s.name}
                onChange={(e) => updateStage(i, { name: e.target.value })}
                className="flex-1"
                data-testid={`input-stage-name-${i}`}
              />
              <Button variant="ghost" size="icon" onClick={() => removeStage(i)} data-testid={`button-remove-stage-${i}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addStage} data-testid="button-add-stage">
            <Plus className="w-4 h-4 mr-1" /> Add stage
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seeded Workflows</CardTitle>
          <CardDescription>Each workflow sends one SMS when its trigger fires.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.workflows.map((w, i) => (
            <div key={i} className="border rounded p-3 space-y-2" data-testid={`row-workflow-${i}`}>
              <div className="flex items-center gap-2">
                <Input
                  value={w.name}
                  onChange={(e) => updateWorkflow(i, { name: e.target.value })}
                  placeholder="Name"
                  className="flex-1"
                  data-testid={`input-workflow-name-${i}`}
                />
                <Input
                  value={w.trigger}
                  onChange={(e) => updateWorkflow(i, { trigger: e.target.value })}
                  placeholder="Trigger"
                  className="w-48"
                  data-testid={`input-workflow-trigger-${i}`}
                />
                <div className="flex items-center gap-1">
                  <Switch
                    checked={w.enabled}
                    onCheckedChange={(v) => updateWorkflow(i, { enabled: v })}
                    data-testid={`switch-workflow-enabled-${i}`}
                  />
                  <Label className="text-xs">Enabled</Label>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeWorkflow(i)} data-testid={`button-remove-workflow-${i}`}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <Textarea
                value={w.smsBody}
                onChange={(e) => updateWorkflow(i, { smsBody: e.target.value })}
                placeholder="SMS body"
                rows={3}
                data-testid={`textarea-workflow-sms-${i}`}
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addWorkflow} data-testid="button-add-workflow">
            <Plus className="w-4 h-4 mr-1" /> Add workflow
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Brand-Voice System Prompt</CardTitle>
          <CardDescription>Seeded as the AI assistant's system prompt for every new account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={form.brandVoiceSystemPrompt}
            onChange={(e) => setForm({ ...form, brandVoiceSystemPrompt: e.target.value })}
            rows={5}
            data-testid="textarea-brand-voice"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Welcome SMS Body</CardTitle>
          <CardDescription>Sent to the owner's phone right after a sub-account is created.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={form.welcomeSmsBody}
            onChange={(e) => setForm({ ...form, welcomeSmsBody: e.target.value })}
            rows={3}
            data-testid="textarea-welcome-sms"
          />
        </CardContent>
      </Card>
    </div>
  );
}
