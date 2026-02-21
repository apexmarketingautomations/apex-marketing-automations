import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plug, CalendarDays, Mail, FileSpreadsheet, MessageSquare, Zap, Receipt, Phone, CreditCard, HardDrive, Users, Globe, Check, X, MapPin, BarChart3, Building2, FileText, Info } from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { INTEGRATIONS_STEPS } from "@/components/tutorial-steps";

const INTEGRATIONS = [
  { provider: "google-maps", name: "Google Maps", description: "Embed maps, directions, and location services", icon: MapPin, color: "bg-green-500/20", iconColor: "text-green-400", category: "google" },
  { provider: "google-business", name: "Google Business Profile", description: "Manage your business listing, hours, and reviews", icon: Building2, color: "bg-blue-500/20", iconColor: "text-blue-400", category: "google" },
  { provider: "google-analytics", name: "Google Analytics", description: "Track website traffic and visitor behavior", icon: BarChart3, color: "bg-orange-500/20", iconColor: "text-orange-400", category: "google" },
  { provider: "google-calendar", name: "Google Calendar", description: "Sync appointments and schedule", icon: CalendarDays, color: "bg-blue-500/20", iconColor: "text-blue-400", category: "google" },
  { provider: "gmail", name: "Gmail", description: "Send and receive email campaigns", icon: Mail, color: "bg-red-500/20", iconColor: "text-red-400", category: "google" },
  { provider: "google-sheets", name: "Google Sheets", description: "Export data and reports", icon: FileSpreadsheet, color: "bg-green-500/20", iconColor: "text-green-400", category: "google" },
  { provider: "google-drive", name: "Google Drive", description: "File storage and sharing", icon: HardDrive, color: "bg-yellow-500/20", iconColor: "text-yellow-400", category: "google" },
  { provider: "google-docs", name: "Google Docs", description: "Create and collaborate on documents", icon: FileText, color: "bg-blue-400/20", iconColor: "text-blue-300", category: "google" },
  { provider: "slack", name: "Slack", description: "Team notifications and alerts", icon: MessageSquare, color: "bg-purple-500/20", iconColor: "text-purple-400", category: "tools" },
  { provider: "zapier", name: "Zapier", description: "Connect 5,000+ apps", icon: Zap, color: "bg-orange-500/20", iconColor: "text-orange-400", category: "tools" },
  { provider: "quickbooks", name: "QuickBooks", description: "Accounting and invoicing", icon: Receipt, color: "bg-emerald-500/20", iconColor: "text-emerald-400", category: "tools" },
  { provider: "twilio", name: "Twilio", description: "SMS and voice communications", icon: Phone, color: "bg-cyan-500/20", iconColor: "text-cyan-400", category: "tools" },
  { provider: "stripe", name: "Stripe", description: "Payment processing", icon: CreditCard, color: "bg-indigo-500/20", iconColor: "text-indigo-400", category: "tools" },
  { provider: "hubspot", name: "HubSpot", description: "CRM sync", icon: Users, color: "bg-pink-500/20", iconColor: "text-pink-400", category: "tools" },
  { provider: "mailchimp", name: "Mailchimp", description: "Email marketing", icon: Mail, color: "bg-amber-500/20", iconColor: "text-amber-400", category: "tools" },
  { provider: "facebook", name: "Facebook", description: "Social media management", icon: Globe, color: "bg-sky-500/20", iconColor: "text-sky-400", category: "tools" },
];

interface IntegrationStatus {
  provider: string;
  connected: boolean;
}

export default function IntegrationsPage() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_integrations_tutorial_completed");

  const { data: connections = [] } = useQuery<IntegrationStatus[]>({
    queryKey: ["/api/integrations", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/${subAccountId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      await apiRequest("POST", `/api/integrations/${subAccountId}/connect`, { provider });
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Integration connected successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (provider: string) => {
      await apiRequest("POST", `/api/integrations/${subAccountId}/disconnect`, { provider });
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Integration disconnected." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", subAccountId] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isConnected = (provider: string) =>
    connections.some((c) => c.provider === provider && c.connected);

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400" data-testid="text-no-account">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-integrations-title">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
            <Plug size={20} className="text-white" />
          </div>
          Integrations Hub
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-slate-400">Connect third-party services to supercharge your workflow</p>
          <button onClick={startTutorial} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5" data-testid="button-start-tutorial"><Info size={14} className="mr-1" /> Tutorial</button>
        </div>
      </div>

      <div className="space-y-6" data-testid="integrations-grid">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <h2 className="text-lg font-bold text-white">Google Workspace & Business</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {INTEGRATIONS.filter(i => i.category === "google").map((integration, idx) => {
              const connected = isConnected(integration.provider);
              const isPending = connectMutation.isPending || disconnectMutation.isPending;
              return (
                <motion.div key={integration.provider} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all" data-testid={`card-integration-${integration.provider}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-12 h-12 rounded-xl ${integration.color} flex items-center justify-center`}>
                          <integration.icon size={24} className={integration.iconColor} />
                        </div>
                        <Badge className={connected ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-white/5 text-slate-400 border-white/10"} data-testid={`badge-status-${integration.provider}`}>
                          {connected ? <span className="flex items-center gap-1"><Check size={12} /> Connected</span> : <span className="flex items-center gap-1"><X size={12} /> Disconnected</span>}
                        </Badge>
                      </div>
                      <h3 className="text-white font-bold text-base mb-1" data-testid={`text-name-${integration.provider}`}>{integration.name}</h3>
                      <p className="text-slate-400 text-sm mb-4" data-testid={`text-desc-${integration.provider}`}>{integration.description}</p>
                      {connected ? (
                        <Button variant="ghost" className="w-full border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-bold" onClick={() => disconnectMutation.mutate(integration.provider)} disabled={isPending} data-testid={`button-disconnect-${integration.provider}`}>Disconnect</Button>
                      ) : (
                        <Button className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold" onClick={() => connectMutation.mutate(integration.provider)} disabled={isPending} data-testid={`button-connect-${integration.provider}`}>Connect</Button>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-4">
            <Plug size={20} className="text-indigo-400" />
            <h2 className="text-lg font-bold text-white">Other Integrations</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {INTEGRATIONS.filter(i => i.category === "tools").map((integration, idx) => {
          const connected = isConnected(integration.provider);
          const isPending = connectMutation.isPending || disconnectMutation.isPending;
          return (
            <motion.div
              key={integration.provider}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card
                className="bg-black/40 border-white/10 hover:border-white/20 transition-all"
                data-testid={`card-integration-${integration.provider}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 rounded-xl ${integration.color} flex items-center justify-center`}>
                      <integration.icon size={24} className={integration.iconColor} />
                    </div>
                    <Badge
                      className={
                        connected
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-white/5 text-slate-400 border-white/10"
                      }
                      data-testid={`badge-status-${integration.provider}`}
                    >
                      {connected ? (
                        <span className="flex items-center gap-1"><Check size={12} /> Connected</span>
                      ) : (
                        <span className="flex items-center gap-1"><X size={12} /> Disconnected</span>
                      )}
                    </Badge>
                  </div>
                  <h3 className="text-white font-bold text-base mb-1" data-testid={`text-name-${integration.provider}`}>
                    {integration.name}
                  </h3>
                  <p className="text-slate-400 text-sm mb-4" data-testid={`text-desc-${integration.provider}`}>
                    {integration.description}
                  </p>
                  {connected ? (
                    <Button
                      variant="ghost"
                      className="w-full border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-bold"
                      onClick={() => disconnectMutation.mutate(integration.provider)}
                      disabled={isPending}
                      data-testid={`button-disconnect-${integration.provider}`}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold"
                      onClick={() => connectMutation.mutate(integration.provider)}
                      disabled={isPending}
                      data-testid={`button-connect-${integration.provider}`}
                    >
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
          </div>
        </div>
      </div>
      {showTutorial && <TutorialOverlay steps={INTEGRATIONS_STEPS} storageKey="apex_integrations_tutorial_completed" onClose={closeTutorial} accentColor="emerald" finishLabel="Start Connecting" />}
    </motion.div>
  );
}
