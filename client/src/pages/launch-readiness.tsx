import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, XCircle, AlertTriangle, Database, Shield, Activity, Clock, Download, RefreshCw } from "lucide-react";
import { useState } from "react";

function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "pass" ? "default" : status === "warn" ? "secondary" : "destructive";
  return <Badge variant={variant} data-testid={`badge-${status}`}>{status.toUpperCase()}</Badge>;
}

export default function LaunchReadiness() {
  const queryClient = useQueryClient();
  const [snapshotResult, setSnapshotResult] = useState<any>(null);

  const readiness = useQuery({
    queryKey: ["/api/admin/launch-readiness"],
    queryFn: () => apiRequest("GET", "/api/admin/launch-readiness").then(r => r.json()),
  });

  const dbHealth = useQuery({
    queryKey: ["/api/admin/db-health"],
    queryFn: () => apiRequest("GET", "/api/admin/db-health").then(r => r.json()),
  });

  const snapshots = useQuery({
    queryKey: ["/api/admin/db-snapshots"],
    queryFn: () => apiRequest("GET", "/api/admin/db-snapshots").then(r => r.json()),
  });

  const systemLogs = useQuery({
    queryKey: ["/api/admin/system-logs"],
    queryFn: () => apiRequest("GET", "/api/admin/system-logs?limit=20").then(r => r.json()),
  });

  const auditLogs = useQuery({
    queryKey: ["/api/admin/audit-logs"],
    queryFn: () => apiRequest("GET", "/api/admin/audit-logs?limit=20").then(r => r.json()),
  });

  const featureFlags = useQuery({
    queryKey: ["/api/admin/feature-flags"],
    queryFn: () => apiRequest("GET", "/api/admin/feature-flags").then(r => r.json()),
  });

  const createSnapshot = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/db-snapshot").then(r => r.json()),
    onSuccess: (data) => {
      setSnapshotResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/db-snapshots"] });
    },
  });

  const toggleFlag = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      apiRequest("PUT", `/api/admin/feature-flags/${name}`, { enabled }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] }),
  });

  const data = readiness.data;
  const categories = data?.checks
    ? Array.from(new Set<string>(data.checks.map((c: any) => c.category as string)))
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="launch-readiness-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Launch Readiness</h1>
          <p className="text-muted-foreground">Production readiness checks, backups, and monitoring</p>
        </div>
        <Button
          variant="outline"
          onClick={() => queryClient.invalidateQueries()}
          data-testid="button-refresh-all"
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh All
        </Button>
      </div>

      {data && (
        <Card data-testid="card-readiness-score">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-4xl font-bold" data-testid="text-score">
                  {Math.round((data.score / data.maxScore) * 100)}%
                </div>
                <div className="text-lg font-medium mt-1" data-testid="text-grade">{data.grade}</div>
                <div className="text-sm text-muted-foreground mt-1" data-testid="text-summary">{data.summary}</div>
              </div>
              <div className="flex gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-500" data-testid="text-pass-count">
                    {data.checks.filter((c: any) => c.status === "pass").length}
                  </div>
                  <div className="text-muted-foreground">Pass</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-500" data-testid="text-warn-count">
                    {data.checks.filter((c: any) => c.status === "warn").length}
                  </div>
                  <div className="text-muted-foreground">Warn</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500" data-testid="text-fail-count">
                    {data.checks.filter((c: any) => c.status === "fail").length}
                  </div>
                  <div className="text-muted-foreground">Fail</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="checks" data-testid="tabs-readiness">
        <TabsList>
          <TabsTrigger value="checks" data-testid="tab-checks">Readiness Checks</TabsTrigger>
          <TabsTrigger value="database" data-testid="tab-database">Database</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">System Logs</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="flags" data-testid="tab-flags">Feature Flags</TabsTrigger>
        </TabsList>

        <TabsContent value="checks" className="space-y-4">
          {categories.map((cat: string) => (
            <Card key={cat} data-testid={`card-category-${cat.toLowerCase()}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{cat}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data?.checks
                    .filter((c: any) => c.category === cat)
                    .map((check: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={check.status} />
                          <span className="font-medium text-sm">{check.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">{check.detail}</span>
                          <StatusBadge status={check.status} />
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <Card data-testid="card-db-health">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" /> Database Health
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dbHealth.data && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-muted rounded-lg">
                      <div className="text-2xl font-bold" data-testid="text-table-count">{dbHealth.data.tableCount}</div>
                      <div className="text-sm text-muted-foreground">Tables</div>
                    </div>
                    <div className="text-center p-3 bg-muted rounded-lg">
                      <div className="text-2xl font-bold" data-testid="text-record-count">{dbHealth.data.totalRecords.toLocaleString()}</div>
                      <div className="text-sm text-muted-foreground">Total Records</div>
                    </div>
                    <div className="text-center p-3 bg-muted rounded-lg">
                      <div className="text-2xl font-bold text-green-500" data-testid="text-db-status">
                        {dbHealth.data.connected ? "Connected" : "Error"}
                      </div>
                      <div className="text-sm text-muted-foreground">Status</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Largest Tables</h4>
                    <div className="space-y-1">
                      {dbHealth.data.largestTables?.slice(0, 8).map((t: any) => (
                        <div key={t.name} className="flex justify-between text-sm py-1 border-b">
                          <span className="font-mono">{t.name}</span>
                          <span className="text-muted-foreground">{t.count.toLocaleString()} rows</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-backups">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-4 w-4" /> Database Snapshots
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => createSnapshot.mutate()}
                  disabled={createSnapshot.isPending}
                  data-testid="button-create-snapshot"
                >
                  {createSnapshot.isPending ? "Creating..." : "Create Snapshot"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {snapshotResult && (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm" data-testid="text-snapshot-result">
                  Snapshot created: {Object.keys(snapshotResult.tables || {}).length} tables captured
                </div>
              )}
              <div className="space-y-2">
                {(snapshots.data || []).map((s: any) => (
                  <div key={s.name} className="flex justify-between text-sm py-1.5 border-b">
                    <span className="font-mono">{s.name}</span>
                    <span className="text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</span>
                  </div>
                ))}
                {(!snapshots.data || snapshots.data.length === 0) && (
                  <p className="text-sm text-muted-foreground">No snapshots yet. Create one before major changes.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card data-testid="card-system-logs">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> Recent System Logs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {(systemLogs.data || []).map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 py-2 border-b text-sm">
                    <Badge variant={log.severity === "error" ? "destructive" : log.severity === "warn" ? "secondary" : "outline"} className="text-xs shrink-0">
                      {log.severity}
                    </Badge>
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground">{log.module}</div>
                      <div className="truncate">{log.message}</div>
                      <div className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
                {(!systemLogs.data || systemLogs.data.length === 0) && (
                  <p className="text-sm text-muted-foreground">No system logs recorded. This is good!</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card data-testid="card-audit-logs">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Audit Trail
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {(auditLogs.data || []).map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b text-sm">
                    <Badge variant="outline" className="text-xs shrink-0">{log.action}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">by {log.performedBy}</div>
                      {log.details && (
                        <pre className="text-xs mt-1 bg-muted p-1 rounded overflow-hidden text-ellipsis">
                          {JSON.stringify(log.details, null, 1).substring(0, 200)}
                        </pre>
                      )}
                      <div className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
                {(!auditLogs.data || auditLogs.data.length === 0) && (
                  <p className="text-sm text-muted-foreground">No audit entries yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flags" className="space-y-4">
          <Card data-testid="card-feature-flags">
            <CardHeader>
              <CardTitle className="text-base">Feature Flags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(featureFlags.data || []).map((flag: any) => (
                  <div key={flag.id} className="flex items-center justify-between py-2 border-b">
                    <div>
                      <div className="font-medium text-sm">{flag.featureName}</div>
                      {flag.description && <div className="text-xs text-muted-foreground">{flag.description}</div>}
                    </div>
                    <Button
                      size="sm"
                      variant={flag.enabled ? "default" : "secondary"}
                      onClick={() => toggleFlag.mutate({ name: flag.featureName, enabled: !flag.enabled })}
                      data-testid={`button-toggle-${flag.featureName}`}
                    >
                      {flag.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                ))}
                {(!featureFlags.data || featureFlags.data.length === 0) && (
                  <p className="text-sm text-muted-foreground">No feature flags configured. Add them via the API.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
