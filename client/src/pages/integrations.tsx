import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Plug, CalendarDays, Mail, FileSpreadsheet, MessageSquare, Zap, Receipt,
  Phone, CreditCard, HardDrive, Users, Globe, Check, X, MapPin, BarChart3,
  Building2, FileText, Info, Settings, Key, ExternalLink, Target, Mic,
  ShoppingCart, Volume2, MessageCircle, Copy, CheckCircle, AlertTriangle,
  XCircle, Loader2, ChevronDown, ChevronUp, Shield, Link2, Clock, Activity,
  RefreshCw, Instagram, Megaphone, FileSearch, ChevronRight,
  Briefcase, Video, PlayCircle, LayoutGrid, TrendingUp, Calendar,
  MailOpen, BookOpen, Contact, Radio,
  type LucideIcon
} from "lucide-react";
import { TutorialOverlay, useTutorial } from "@/components/tutorial-overlay";
import { INTEGRATIONS_STEPS } from "@/components/tutorial-steps";

interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  required?: boolean;
}

const LEGACY_PROVIDER_CREDENTIALS: Record<string, { fields: CredentialField[]; helpUrl?: string; helpText?: string }> = {
  "slack": {
    fields: [
      { key: "webhookUrl", label: "Slack Webhook URL", placeholder: "https://hooks.slack.com/services/..." },
      { key: "botToken", label: "Bot Token (optional)", placeholder: "xoxb-...", type: "password", required: false },
    ],
    helpUrl: "https://api.slack.com/apps",
    helpText: "Create a Slack app and get an incoming webhook URL",
  },
  "zapier": {
    fields: [
      { key: "webhookUrl", label: "Zapier Webhook URL", placeholder: "https://hooks.zapier.com/hooks/catch/..." },
    ],
    helpUrl: "https://zapier.com/app/zaps",
    helpText: "Create a Zap with a Webhook trigger to get your URL",
  },
  "quickbooks": {
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "Your QuickBooks app client ID" },
      { key: "clientSecret", label: "Client Secret", placeholder: "Your client secret", type: "password" },
      { key: "realmId", label: "Company ID (Realm ID)", placeholder: "123456789" },
    ],
    helpUrl: "https://developer.intuit.com/app/developer/dashboard",
  },
  "twilio": {
    fields: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "authToken", label: "Auth Token", placeholder: "Your auth token", type: "password" },
    ],
    helpUrl: "https://console.twilio.com",
    helpText: "Find your credentials in the Twilio Console",
  },
  "stripe": {
    fields: [
      { key: "publishableKey", label: "Publishable Key", placeholder: "pk_live_..." },
      { key: "secretKey", label: "Secret Key", placeholder: "sk_live_...", type: "password" },
    ],
    helpUrl: "https://dashboard.stripe.com/apikeys",
    helpText: "Get your API keys from the Stripe Dashboard",
  },
  "hubspot": {
    fields: [
      { key: "apiKey", label: "Private App Access Token", placeholder: "pat-...", type: "password" },
    ],
    helpUrl: "https://app.hubspot.com/",
    helpText: "Create a Private App in HubSpot to get your access token",
  },
  "mailchimp": {
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "xxxxxxxx-us1", type: "password" },
      { key: "serverPrefix", label: "Server Prefix", placeholder: "us1" },
    ],
    helpUrl: "https://mailchimp.com/developer/",
  },
  "vapi": {
    fields: [
      { key: "privateKey", label: "Private Key", placeholder: "Your Vapi private API key", type: "password" },
      { key: "publicKey", label: "Public Key", placeholder: "Your Vapi public key (for browser calls)", type: "password" },
      { key: "orgId", label: "Organization ID", placeholder: "Your Vapi org ID" },
      { key: "phoneNumberId", label: "Default Phone Number ID", placeholder: "Auto-injected for outbound calls" },
    ],
    helpUrl: "https://dashboard.vapi.ai",
    helpText: "Powers voice AI agents, outbound calling, and browser demo calls.",
  },
  "shopify": {
    fields: [
      { key: "storeDomain", label: "Store Domain", placeholder: "your-store.myshopify.com" },
      { key: "accessToken", label: "Admin API Access Token", placeholder: "shpat_...", type: "password" },
      { key: "webhookSecret", label: "Webhook Secret (optional)", placeholder: "For verifying webhook signatures", type: "password", required: false },
    ],
    helpUrl: "https://admin.shopify.com/store/YOUR_STORE/settings/apps/development",
    helpText: "Create a custom app in your Shopify admin to get your Admin API access token.",
  },
  "elevenlabs": {
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Your ElevenLabs API key", type: "password" },
    ],
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
    helpText: "High-quality AI voice synthesis for text-to-speech.",
  },
  "skip-trace": {
    fields: [
      { key: "apiKey", label: "BatchData API Key", placeholder: "Your BatchData API key", type: "password" },
    ],
    helpUrl: "https://app.batchdata.com/",
    helpText: "Powers skip trace / people data lookups for Property Radar.",
  },
  "whatsapp-business": {
    fields: [
      { key: "whatsappNumber", label: "WhatsApp Business Number", placeholder: "+1234567890 (with country code)" },
      { key: "accountSid", label: "Twilio Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
      { key: "authToken", label: "Twilio Auth Token", placeholder: "Your Twilio auth token", type: "password" },
      { key: "messagingServiceSid", label: "Messaging Service SID (optional)", placeholder: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", required: false },
    ],
    helpUrl: "https://www.twilio.com/docs/whatsapp",
    helpText: "Connect your WhatsApp Business number through Twilio.",
  },
};

const GOOGLE_CHILD_SERVICES = [
  { id: "gmail", name: "Gmail", description: "Send and receive emails", icon: Mail, scope: "gmail.readonly gmail.send", usedBy: ["Email Campaigns", "Conversations"] },
  { id: "google-calendar", name: "Calendar", description: "Sync appointments and events", icon: CalendarDays, scope: "calendar.readonly calendar.events", usedBy: ["Appointments", "Scheduling"] },
  { id: "google-sheets", name: "Sheets", description: "Export data and reports", icon: FileSpreadsheet, scope: "spreadsheets.readonly spreadsheets", usedBy: ["Reports", "Data Export"] },
  { id: "google-drive", name: "Drive", description: "File storage and sharing", icon: HardDrive, scope: "drive.readonly", usedBy: ["File Manager", "Attachments"] },
  { id: "google-business", name: "Business Profile", description: "Manage listing and reviews", icon: Building2, scope: "business.manage", usedBy: ["Reviews", "Local SEO"] },
];

const GOOGLE_YOUTUBE_SERVICES = [
  { id: "youtube-analytics", name: "Analytics", description: "Video performance and audience insights", icon: TrendingUp, scope: "youtube.readonly yt-analytics.readonly" },
  { id: "youtube-manage", name: "Channel Management", description: "Upload and manage video content", icon: Video, scope: "youtube youtube.upload" },
];

const META_CHILD_SERVICES = [
  { id: "facebook-pages", name: "Facebook Pages", description: "Manage your business pages", icon: Globe, scope: "pages_manage_posts pages_read_engagement" },
  { id: "instagram", name: "Instagram", description: "Business account management", icon: Instagram, scope: "instagram_basic instagram_content_publish" },
  { id: "meta-ads", name: "Meta Ads", description: "Ad campaign management", icon: Megaphone, scope: "ads_management ads_read" },
  { id: "meta-leads", name: "Lead Forms", description: "Capture and manage leads", icon: FileSearch, scope: "leads_retrieval" },
];

const LINKEDIN_CHILD_SERVICES = [
  { id: "linkedin-profile", name: "Profile", description: "Access profile and connections", icon: Contact, scope: "openid profile email" },
  { id: "linkedin-posts", name: "Posts & Sharing", description: "Share updates and content", icon: FileText, scope: "w_member_social" },
  { id: "linkedin-pages", name: "Company Pages", description: "Manage organization pages", icon: Building2, scope: "w_organization_social r_organization_social" },
  { id: "linkedin-leads", name: "Lead Gen Forms", description: "Capture leads from ads", icon: FileSearch, scope: "r_marketing_leadgen_automation" },
];

const TIKTOK_CHILD_SERVICES = [
  { id: "tiktok-ads", name: "Ad Management", description: "Create and manage ad campaigns", icon: Megaphone, scope: "ad.operation.read ad.operation.write" },
  { id: "tiktok-audience", name: "Audiences", description: "Custom and lookalike audiences", icon: Users, scope: "audience.read audience.write" },
  { id: "tiktok-reporting", name: "Reporting", description: "Campaign analytics and insights", icon: BarChart3, scope: "report.read" },
];

const MICROSOFT_CHILD_SERVICES = [
  { id: "outlook-mail", name: "Outlook Mail", description: "Send and receive emails", icon: Mail, scope: "Mail.ReadWrite Mail.Send" },
  { id: "outlook-calendar", name: "Outlook Calendar", description: "Sync events and appointments", icon: Calendar, scope: "Calendars.ReadWrite" },
  { id: "onedrive", name: "OneDrive", description: "File storage and sharing", icon: HardDrive, scope: "Files.ReadWrite" },
  { id: "teams", name: "Teams", description: "Team messaging and notifications", icon: MessageSquare, scope: "ChannelMessage.Send" },
];

const CALENDLY_CHILD_SERVICES = [
  { id: "calendly-events", name: "Events", description: "View and manage scheduled events", icon: Calendar, scope: "events" },
  { id: "calendly-scheduling", name: "Scheduling", description: "Booking links and availability", icon: Clock, scope: "scheduling_links" },
];

interface LegacyIntegration {
  provider: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  iconColor: string;
  category: "communication" | "tools";
}

const LEGACY_INTEGRATIONS: LegacyIntegration[] = [
  { provider: "twilio", name: "Twilio", description: "SMS and voice communications", icon: Phone, color: "bg-cyan-500/20", iconColor: "text-cyan-400", category: "communication" },
  { provider: "whatsapp-business", name: "WhatsApp Business", description: "WhatsApp messaging with templates", icon: MessageCircle, color: "bg-green-600/20", iconColor: "text-green-400", category: "communication" },
  { provider: "vapi", name: "Vapi", description: "Voice AI agents and outbound calling", icon: Mic, color: "bg-teal-500/20", iconColor: "text-teal-400", category: "communication" },
  { provider: "slack", name: "Slack", description: "Team notifications and alerts", icon: MessageSquare, color: "bg-purple-500/20", iconColor: "text-purple-400", category: "tools" },
  { provider: "zapier", name: "Zapier", description: "Connect 5,000+ apps", icon: Zap, color: "bg-orange-500/20", iconColor: "text-orange-400", category: "tools" },
  { provider: "quickbooks", name: "QuickBooks", description: "Accounting and invoicing", icon: Receipt, color: "bg-emerald-500/20", iconColor: "text-emerald-400", category: "tools" },
  { provider: "stripe", name: "Stripe", description: "Payment processing", icon: CreditCard, color: "bg-indigo-500/20", iconColor: "text-indigo-400", category: "tools" },
  { provider: "hubspot", name: "HubSpot", description: "CRM sync", icon: Users, color: "bg-pink-500/20", iconColor: "text-pink-400", category: "tools" },
  { provider: "mailchimp", name: "Mailchimp", description: "Email marketing only", icon: Mail, color: "bg-amber-500/20", iconColor: "text-amber-400", category: "tools" },
  { provider: "shopify", name: "Shopify", description: "E-commerce automation", icon: ShoppingCart, color: "bg-green-600/20", iconColor: "text-green-400", category: "tools" },
  { provider: "elevenlabs", name: "ElevenLabs", description: "AI voice synthesis", icon: Volume2, color: "bg-fuchsia-500/20", iconColor: "text-fuchsia-400", category: "tools" },
  { provider: "skip-trace", name: "Skip Trace (BatchData)", description: "People data lookup", icon: Users, color: "bg-violet-500/20", iconColor: "text-violet-400", category: "tools" },
];

interface ProviderAsset {
  id: string;
  name?: string;
  summary?: string;
  description?: string;
}

interface IntegrationConnection {
  provider: string;
  connected: boolean;
  config?: Record<string, string>;
  status?: "connected" | "disconnected" | "needs_reconnect";
  accountEmail?: string;
  accountName?: string;
  scopes?: string[];
  lastSynced?: string;
  connectionType?: "oauth" | "legacy";
}

interface IntegrationEvent {
  id: string;
  type: string;
  provider: string;
  message: string;
  timestamp: string;
  status: "success" | "error" | "info";
}

function OnboardingChecklist({
  connections,
}: {
  connections: IntegrationConnection[];
}) {
  const items = [
    { key: "google", label: "Connect Google", description: "Gmail, Calendar, Sheets, Drive, Business Profile", provider: "google" },
    { key: "meta", label: "Connect Meta", description: "Facebook Pages, Instagram, Meta Ads, Lead Forms", provider: "meta" },
    { key: "twilio", label: "Connect Twilio", description: "SMS and voice communications", provider: "twilio" },
    { key: "stripe", label: "Connect Stripe", description: "Payment processing", provider: "stripe" },
  ];

  const isProviderConnected = (provider: string) =>
    connections.some((c) => c.provider === provider && c.connected);

  const completed = items.filter((item) => isProviderConnected(item.provider)).length;
  const percentage = Math.round((completed / items.length) * 100);

  if (percentage === 100) return null;

  return (
    <Card className="bg-gradient-to-br from-slate-900/80 to-indigo-950/40 border-indigo-500/20" data-testid="card-onboarding-checklist">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white" data-testid="text-checklist-title">Recommended Setup</h2>
            <p className="text-slate-400 text-sm" data-testid="text-checklist-subtitle">Complete these steps to get the most out of your platform</p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-black text-white" data-testid="text-checklist-percentage">{percentage}%</span>
            <p className="text-xs text-slate-400">complete</p>
          </div>
        </div>
        <Progress
          value={percentage}
          className="h-2 mb-5 bg-white/10"
          data-testid="progress-onboarding"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {items.map((item) => {
            const done = isProviderConnected(item.provider);
            return (
              <div
                key={item.key}
                className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                  done ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-white/5 border border-white/10"
                }`}
                data-testid={`checklist-item-${item.key}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  done ? "bg-emerald-500/20" : "bg-white/10"
                }`}>
                  {done ? (
                    <Check size={16} className="text-emerald-400" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border-2 border-slate-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${done ? "text-emerald-300" : "text-white"}`} data-testid={`text-checklist-label-${item.key}`}>{item.label}</p>
                  <p className="text-xs text-slate-500 truncate" data-testid={`text-checklist-desc-${item.key}`}>{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function OAuthConnectionCard({
  provider,
  title,
  description,
  icon,
  gradientFrom,
  gradientTo,
  childServices,
  connection,
  subAccountId,
  onSettingsOpen,
  onDisconnect,
  onReconnect,
}: {
  provider: "google" | "meta";
  title: string;
  description: string;
  icon: React.ReactNode;
  gradientFrom: string;
  gradientTo: string;
  childServices: Array<{ id: string; name: string; description: string; icon: LucideIcon; scope: string; usedBy?: string[] }>;
  connection: IntegrationConnection | undefined;
  subAccountId: number;
  onSettingsOpen: (serviceId: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isConnected = connection?.connected ?? false;
  const status = connection?.status ?? (isConnected ? "connected" : "disconnected");

  const { data: verificationData, isLoading: isVerifying, error: verificationError } = useQuery<{ results: Record<string, { verified: boolean; lastVerified: string; reconnectRequired: boolean; error: string | null }> }>({
    queryKey: [`/api/integrations/${subAccountId}/${provider}/verify`],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/${subAccountId}/${provider}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Verification request failed" }));
        const errorMsg = typeof errData.error === "string" ? errData.error : `Verification failed (${res.status})`;
        const failedResults: Record<string, any> = {};
        for (const s of ["gmail", "google-calendar", "google-sheets", "google-drive", "google-business"]) {
          failedResults[s] = { verified: false, lastVerified: new Date().toISOString(), reconnectRequired: res.status === 401, error: errorMsg };
        }
        return { results: failedResults };
      }
      return res.json();
    },
    enabled: !!subAccountId && isConnected && provider === "google",
    staleTime: 5 * 60 * 1000,
  });

  const verifyAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/integrations/${subAccountId}/${provider}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Verification failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Verification Complete", description: "All services have been checked." });
      queryClient.invalidateQueries({ queryKey: [`/api/integrations/${subAccountId}/${provider}/verify`] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const verifySingleMutation = useMutation({
    mutationFn: async (serviceId: string) => {
      const res = await fetch(`/api/integrations/${subAccountId}/${provider}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Verification failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/integrations/${subAccountId}/${provider}/verify`] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleConnect = () => {
    window.location.href = `/api/oauth/${provider}/authorize/${subAccountId}`;
  };

  const statusBadge = () => {
    if (status === "connected") {
      return (
        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30" data-testid={`badge-status-${provider}`}>
          <CheckCircle size={12} className="mr-1" /> Connected
        </Badge>
      );
    }
    if (status === "needs_reconnect") {
      return (
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30" data-testid={`badge-status-${provider}`}>
          <AlertTriangle size={12} className="mr-1" /> Needs Reconnect
        </Badge>
      );
    }
    return (
      <Badge className="bg-white/5 text-slate-400 border-white/10" data-testid={`badge-status-${provider}`}>
        <XCircle size={12} className="mr-1" /> Disconnected
      </Badge>
    );
  };

  const hasScope = (scope: string) => {
    if (!connection?.scopes || connection.scopes.length === 0) return false;
    const normalizedScopes = connection.scopes.map((s: string) => {
      const match = s.match(/googleapis\.com\/auth\/(.+)/);
      return match ? match[1] : s;
    });
    return scope.split(" ").some((s) => 
      normalizedScopes.includes(s) || connection.scopes!.includes(s)
    );
  };

  const getServiceVerification = (serviceId: string) => {
    return verificationData?.results?.[serviceId];
  };

  return (
    <Card className="bg-black/40 border-white/10 overflow-hidden" data-testid={`card-oauth-${provider}`}>
      <div className={`h-1 bg-gradient-to-r ${gradientFrom} ${gradientTo}`} />
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center shadow-lg`}>
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white" data-testid={`text-title-${provider}`}>{title}</h2>
                <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]" data-testid={`badge-managed-${provider}`}>
                  <Shield size={10} className="mr-1" /> Platform Managed
                </Badge>
              </div>
              <p className="text-slate-400 text-sm mt-0.5" data-testid={`text-desc-${provider}`}>{description}</p>
              {isConnected && connection?.accountEmail && (
                <p className="text-xs text-slate-500 mt-1" data-testid={`text-account-${provider}`}>
                  {connection.accountName ? `${connection.accountName} • ` : ""}{connection.accountEmail}
                </p>
              )}
              {isConnected && connection?.lastSynced && (
                <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5" data-testid={`text-last-synced-${provider}`}>
                  <Clock size={10} /> Last synced: {new Date(connection.lastSynced).toLocaleString()}
                </p>
              )}
              {isConnected && connection?.scopes && connection.scopes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5" data-testid={`scopes-list-${provider}`}>
                  {connection.scopes.map((scope) => (
                    <Badge
                      key={scope}
                      className="bg-white/5 text-slate-500 border-white/5 text-[9px] px-1.5 py-0"
                      data-testid={`badge-scope-${scope}`}
                    >
                      {scope}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge()}
          </div>
        </div>

        {isConnected && provider === "google" && (
          <div className="mb-4 p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10" data-testid="info-google-shared-connection">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-indigo-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-400">
                Google is a shared master connection used across multiple platform modules. Each service below powers specific features throughout the platform.
              </p>
            </div>
          </div>
        )}

        {!isConnected ? (
          <Button
            className={`w-full bg-gradient-to-r ${gradientFrom} ${gradientTo} hover:opacity-90 text-white font-bold py-5 text-base`}
            onClick={handleConnect}
            data-testid={`button-connect-${provider}`}
          >
            <Link2 size={18} className="mr-2" /> Connect {title}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              {provider === "google" && (
                <Button
                  variant="ghost"
                  className="flex-1 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 font-semibold"
                  onClick={() => verifyAllMutation.mutate()}
                  disabled={verifyAllMutation.isPending}
                  data-testid={`button-verify-all-${provider}`}
                >
                  {verifyAllMutation.isPending ? (
                    <><Loader2 size={14} className="mr-1 animate-spin" /> Verifying...</>
                  ) : (
                    <><Activity size={14} className="mr-1" /> Test Google Connection</>
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                className="flex-1 border border-white/10 text-slate-300 hover:bg-white/5 font-semibold"
                onClick={onReconnect}
                data-testid={`button-reconnect-${provider}`}
              >
                <RefreshCw size={14} className="mr-1" /> Reconnect
              </Button>
              <Button
                variant="ghost"
                className="flex-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-semibold"
                onClick={onDisconnect}
                data-testid={`button-disconnect-${provider}`}
              >
                <X size={14} className="mr-1" /> Disconnect
              </Button>
            </div>

            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-white transition-colors py-1"
              data-testid={`button-toggle-services-${provider}`}
            >
              <span className="font-medium">Connected Services</span>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  {childServices.map((service) => {
                    const verification = provider === "google" ? getServiceVerification(service.id) : null;
                    const hasVerificationData = !!verification;
                    const isVerified = verification?.verified ?? false;
                    const reconnectRequired = verification?.reconnectRequired ?? false;

                    const scopeActive = hasScope(service.scope);
                    const useVerification = provider === "google" && hasVerificationData;
                    const isActive = useVerification ? isVerified : scopeActive;

                    return (
                      <div
                        key={service.id}
                        className={`p-3 rounded-xl transition-colors ${
                          useVerification
                            ? isVerified
                              ? "bg-white/5 border border-emerald-500/15"
                              : reconnectRequired
                                ? "bg-amber-500/5 border border-amber-500/15"
                                : "bg-red-500/5 border border-red-500/10"
                            : isActive
                              ? "bg-white/5 border border-white/10"
                              : "bg-white/[0.02] border border-white/5"
                        }`}
                        data-testid={`child-service-${service.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                              useVerification
                                ? isVerified ? "bg-emerald-500/15" : reconnectRequired ? "bg-amber-500/15" : "bg-red-500/10"
                                : isActive ? "bg-emerald-500/15" : "bg-white/5"
                            }`}>
                              <service.icon size={18} className={
                                useVerification
                                  ? isVerified ? "text-emerald-400" : reconnectRequired ? "text-amber-400" : "text-red-400"
                                  : isActive ? "text-emerald-400" : "text-slate-600"
                              } />
                            </div>
                            <div>
                              <p className={`text-sm font-medium ${
                                useVerification
                                  ? isVerified ? "text-white" : "text-slate-400"
                                  : isActive ? "text-white" : "text-slate-500"
                              }`}>
                                {service.name}
                              </p>
                              <p className="text-xs text-slate-600">{service.description}</p>
                              {service.usedBy && (
                                <p className="text-[10px] text-slate-600 mt-0.5">
                                  Used by: {service.usedBy.join(", ")}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {useVerification ? (
                              <Badge className={`text-[10px] ${
                                isVerified
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                                  : reconnectRequired
                                    ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
                                    : "bg-red-500/15 text-red-400 border-red-500/20"
                              }`} data-testid={`badge-service-${service.id}`}>
                                {isVerified ? (
                                  <><CheckCircle size={10} className="mr-1" /> Verified</>
                                ) : reconnectRequired ? (
                                  <><AlertTriangle size={10} className="mr-1" /> Reconnect Required</>
                                ) : (
                                  <><XCircle size={10} className="mr-1" /> Unverified</>
                                )}
                              </Badge>
                            ) : provider === "google" && !hasVerificationData ? (
                              <Badge className="bg-white/5 text-slate-600 border-white/5 text-[10px]" data-testid={`badge-service-${service.id}`}>
                                Not Checked
                              </Badge>
                            ) : (
                              <Badge className={`text-[10px] ${
                                isActive
                                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                                  : "bg-white/5 text-slate-600 border-white/5"
                              }`} data-testid={`badge-service-${service.id}`}>
                                {isActive ? "Active" : "Inactive"}
                              </Badge>
                            )}
                            {provider === "google" && isConnected && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                                onClick={() => verifySingleMutation.mutate(service.id)}
                                disabled={verifySingleMutation.isPending}
                                data-testid={`button-verify-${service.id}`}
                              >
                                <Activity size={12} />
                              </Button>
                            )}
                            {isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/10"
                                onClick={() => onSettingsOpen(service.id)}
                                data-testid={`button-settings-${service.id}`}
                              >
                                <Settings size={14} />
                              </Button>
                            )}
                          </div>
                        </div>
                        {useVerification && (
                          <div className="mt-2 pl-12">
                            {verification!.error && (
                              <p className="text-[10px] text-red-400" data-testid={`text-error-${service.id}`}>
                                {verification!.error}
                              </p>
                            )}
                            {verification!.lastVerified && (
                              <p className="text-[10px] text-slate-600 flex items-center gap-1" data-testid={`text-last-verified-${service.id}`}>
                                <Clock size={9} /> Last verified: {new Date(verification!.lastVerified).toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LegacyCredentialCard({
  integration,
  connected,
  isPending,
  onConnect,
  onDisconnect,
  onConfigure,
}: {
  integration: LegacyIntegration;
  connected: boolean;
  isPending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onConfigure: () => void;
}) {
  return (
    <Card
      className="bg-black/40 border-white/10 transition-all hover:border-white/20"
      data-testid={`card-integration-${integration.provider}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-11 h-11 rounded-xl ${integration.color} flex items-center justify-center`}>
            <integration.icon size={22} className={integration.iconColor} />
          </div>
          <div className="flex items-center gap-1.5">
            <Badge className="bg-slate-800/80 text-slate-500 border-slate-700/50 text-[10px]" data-testid={`badge-type-${integration.provider}`}>
              <Key size={8} className="mr-1" /> Legacy Connection
            </Badge>
            {connected ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30" data-testid={`badge-status-${integration.provider}`}>
                <Check size={12} className="mr-1" /> Connected
              </Badge>
            ) : (
              <Badge className="bg-white/5 text-slate-400 border-white/10" data-testid={`badge-status-${integration.provider}`}>
                <X size={12} /> Off
              </Badge>
            )}
          </div>
        </div>
        <h3 className="text-white font-bold text-sm mb-0.5" data-testid={`text-name-${integration.provider}`}>
          {integration.name}
        </h3>
        <p className="text-slate-500 text-xs mb-4" data-testid={`text-desc-${integration.provider}`}>
          {integration.description}
        </p>
        {connected ? (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 border border-white/10 text-slate-300 hover:bg-white/5 font-semibold text-xs h-8"
              onClick={onConfigure}
              disabled={isPending}
              data-testid={`button-configure-${integration.provider}`}
            >
              <Settings size={12} className="mr-1" /> Settings
            </Button>
            <Button
              variant="ghost"
              className="flex-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-semibold text-xs h-8"
              onClick={onDisconnect}
              disabled={isPending}
              data-testid={`button-disconnect-${integration.provider}`}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            className="w-full bg-white/5 hover:bg-white/10 text-white font-semibold text-xs h-8 border border-white/10"
            onClick={onConnect}
            disabled={isPending}
            data-testid={`button-connect-${integration.provider}`}
          >
            <Key size={12} className="mr-1" /> Connect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function LegacyConnectDialog({
  provider,
  providerName,
  existingConfig,
  onClose,
  onSave,
  isSaving,
}: {
  provider: string;
  providerName: string;
  existingConfig?: Record<string, string>;
  onClose: () => void;
  onSave: (config: Record<string, string>) => void;
  isSaving: boolean;
}) {
  const creds = LEGACY_PROVIDER_CREDENTIALS[provider];
  const [values, setValues] = useState<Record<string, string>>(
    existingConfig || creds?.fields.reduce((acc, f) => ({ ...acc, [f.key]: "" }), {}) || {}
  );

  if (!creds) return null;

  const allFilled = creds.fields
    .filter((f) => f.required !== false)
    .every((f) => (values[f.key] || "").trim().length > 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Key size={18} className="text-indigo-400" />
            Connect {providerName}
          </h2>
          {creds.helpText && (
            <p className="text-slate-400 text-sm mt-1">{creds.helpText}</p>
          )}
        </div>

        <div className="space-y-4">
          {creds.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-slate-300 text-sm font-medium">{field.label}</Label>
              <Input
                type={field.type || "text"}
                placeholder={field.placeholder}
                value={values[field.key] || ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 focus:border-indigo-500"
                data-testid={`input-credential-${field.key}`}
              />
            </div>
          ))}
        </div>

        {creds.helpUrl && (
          <a
            href={creds.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            data-testid="link-help-url"
          >
            <ExternalLink size={12} /> Where to find your credentials
          </a>
        )}

        <div className="flex gap-3 pt-2">
          <Button
            variant="ghost"
            className="flex-1 border border-white/10 text-slate-300 hover:bg-white/5"
            onClick={onClose}
            data-testid="button-cancel-connect"
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold"
            onClick={() => onSave(values)}
            disabled={!allFilled || isSaving}
            data-testid="button-save-credentials"
          >
            {isSaving ? "Saving..." : existingConfig ? "Update" : "Connect"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function GoogleSettingsModal({
  serviceId,
  subAccountId,
  onClose,
}: {
  serviceId: string;
  subAccountId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAsset, setSelectedAsset] = useState<string>("");

  const { data: assets, isLoading } = useQuery<ProviderAsset[]>({
    queryKey: ["/api/oauth/google/assets", subAccountId, serviceId],
    queryFn: async () => {
      const res = await fetch(`/api/oauth/google/assets/${subAccountId}?service=${serviceId}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/oauth/google/settings/${subAccountId}`, {
        service: serviceId,
        selectedAssetId: selectedAsset,
      });
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Your preferences have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", subAccountId] });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const settingsConfig: Record<string, { title: string; assetLabel: string; description: string }> = {
    "gmail": { title: "Gmail Settings", assetLabel: "Sending Identity", description: "Choose which email address to send from" },
    "google-calendar": { title: "Calendar Settings", assetLabel: "Calendar", description: "Select which calendar to sync" },
    "google-business": { title: "Business Profile Settings", assetLabel: "Location", description: "Choose which business location to manage" },
    "google-sheets": { title: "Sheets Settings", assetLabel: "Spreadsheet", description: "Select default spreadsheet" },
    "google-drive": { title: "Drive Settings", assetLabel: "Folder", description: "Choose default folder" },
    "youtube-analytics": { title: "YouTube Analytics", assetLabel: "Channel", description: "Select which channel to track" },
    "youtube-manage": { title: "YouTube Management", assetLabel: "Channel", description: "Choose which channel to manage" },
    "linkedin-profile": { title: "LinkedIn Profile", assetLabel: "Profile", description: "Connected LinkedIn profile" },
    "linkedin-pages": { title: "LinkedIn Pages", assetLabel: "Company Page", description: "Select company page to manage" },
    "outlook-mail": { title: "Outlook Mail", assetLabel: "Mailbox", description: "Choose mailbox for sending" },
    "outlook-calendar": { title: "Outlook Calendar", assetLabel: "Calendar", description: "Select calendar to sync" },
    "calendly-events": { title: "Calendly Events", assetLabel: "Event Type", description: "Select event type to sync" },
    "calendly-scheduling": { title: "Calendly Scheduling", assetLabel: "Scheduling Link", description: "Choose scheduling link" },
  };

  const config = settingsConfig[serviceId] || { title: "Settings", assetLabel: "Asset", description: "Configure this service" };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md" data-testid={`modal-settings-${serviceId}`}>
        <DialogHeader>
          <DialogTitle className="text-white">{config.title}</DialogTitle>
          <p className="text-sm text-slate-400">{config.description}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Label className="text-slate-300">{config.assetLabel}</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading options...
            </div>
          ) : assets && assets.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    selectedAsset === asset.id
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                  data-testid={`option-asset-${asset.id}`}
                >
                  <p className="text-sm font-medium text-white">{asset.name || asset.summary || asset.id}</p>
                  {asset.description && <p className="text-xs text-slate-500 mt-0.5">{asset.description}</p>}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No options available. Please ensure the service is properly connected.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="border border-white/10 text-slate-300" data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!selectedAsset || saveMutation.isPending}
            className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white"
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaSettingsModal({
  serviceId,
  subAccountId,
  onClose,
}: {
  serviceId: string;
  subAccountId: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAsset, setSelectedAsset] = useState<string>("");

  const { data: assets, isLoading } = useQuery<ProviderAsset[]>({
    queryKey: ["/api/oauth/meta/assets", subAccountId, serviceId],
    queryFn: async () => {
      const res = await fetch(`/api/oauth/meta/assets/${subAccountId}?service=${serviceId}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/oauth/meta/settings/${subAccountId}`, {
        service: serviceId,
        selectedAssetId: selectedAsset,
      });
    },
    onSuccess: () => {
      toast({ title: "Settings Saved", description: "Your preferences have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", subAccountId] });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const settingsConfig: Record<string, { title: string; assetLabel: string; description: string }> = {
    "facebook-pages": { title: "Page Settings", assetLabel: "Facebook Page", description: "Select which page to manage" },
    "instagram": { title: "Instagram Settings", assetLabel: "Instagram Account", description: "Select your business account" },
    "meta-ads": { title: "Meta Ads Settings", assetLabel: "Ad Account", description: "Select your ad account" },
    "meta-leads": { title: "Lead Forms Settings", assetLabel: "Lead Form", description: "Select the lead form to sync" },
  };

  const config = settingsConfig[serviceId] || { title: "Settings", assetLabel: "Asset", description: "Configure this service" };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="bg-slate-900 border-white/10 text-white max-w-md" data-testid={`modal-settings-${serviceId}`}>
        <DialogHeader>
          <DialogTitle className="text-white">{config.title}</DialogTitle>
          <p className="text-sm text-slate-400">{config.description}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Label className="text-slate-300">{config.assetLabel}</Label>
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading options...
            </div>
          ) : assets && assets.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    selectedAsset === asset.id
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                  data-testid={`option-asset-${asset.id}`}
                >
                  <p className="text-sm font-medium text-white">{asset.name || asset.id}</p>
                  {asset.description && <p className="text-xs text-slate-500 mt-0.5">{asset.description}</p>}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No options available. Please ensure the service is properly connected.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="border border-white/10 text-slate-300" data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!selectedAsset || saveMutation.isPending}
            className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white"
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationEventsSection({ subAccountId }: { subAccountId: number }) {
  const { data: events = [], isLoading } = useQuery<IntegrationEvent[]>({
    queryKey: ["/api/integrations", subAccountId, "events"],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/${subAccountId}/events`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 3_600_000,
  });

  const eventIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle size={14} className="text-emerald-400" />;
      case "error": return <XCircle size={14} className="text-red-400" />;
      default: return <Activity size={14} className="text-blue-400" />;
    }
  };

  return (
    <Card className="bg-black/40 border-white/10" data-testid="card-integration-events">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-indigo-400" />
            <h2 className="text-lg font-bold text-white" data-testid="text-events-title">Integration Events</h2>
          </div>
          <Badge className="bg-white/5 text-slate-400 border-white/10" data-testid="badge-events-count">
            {events.length} events
          </Badge>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Loading events...
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8">
            <Activity size={32} className="mx-auto text-slate-700 mb-2" />
            <p className="text-slate-500 text-sm">No recent integration events</p>
            <p className="text-slate-600 text-xs">Events will appear here as your integrations sync data</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/5 transition-colors"
                data-testid={`event-item-${event.id}`}
              >
                <div className="mt-0.5">{eventIcon(event.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">{event.message}</span>
                    <Badge className="bg-white/5 text-slate-500 border-white/5 text-[10px]">{event.provider}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{new Date(event.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GoogleIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const MetaIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="white">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/>
  </svg>
);

const LinkedInIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="#0A66C2">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const TikTokIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="white">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.84a4.83 4.83 0 0 1-1-.15z"/>
  </svg>
);

const MicrosoftIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24">
    <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
    <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
    <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
  </svg>
);

const CalendlyIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#006BFF"/>
    <path d="M15.5 8.5a3.5 3.5 0 0 0-7 0v3.5h3.5a3.5 3.5 0 0 0 3.5-3.5z" fill="white"/>
    <path d="M8.5 15.5a3.5 3.5 0 0 0 7 0V12H12a3.5 3.5 0 0 0-3.5 3.5z" fill="white"/>
  </svg>
);

const YouTubeIcon = () => (
  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="#FF0000">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

export default function IntegrationsPage() {
  const subAccountId = useActiveSubAccountId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showTutorial, startTutorial, closeTutorial } = useTutorial("apex_integrations_tutorial_completed");
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [configuringProvider, setConfiguringProvider] = useState<string | null>(null);
  const [settingsService, setSettingsService] = useState<{ serviceId: string; provider: string } | null>(null);
  const [activeTab, setActiveTab] = useState("connections");

  const { data: connections = [] } = useQuery<IntegrationConnection[]>({
    queryKey: ["/api/integrations", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/integrations/${subAccountId}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const connectMutation = useMutation({
    mutationFn: async ({ provider, config }: { provider: string; config: Record<string, string> }) => {
      await apiRequest("POST", `/api/integrations/${subAccountId}/connect`, { provider, config });
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Integration connected successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", subAccountId] });
      setConnectingProvider(null);
      setConfiguringProvider(null);
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

  const getConnection = (provider: string) =>
    connections.find((c) => c.provider === provider);

  const getConfig = (provider: string) =>
    connections.find((c) => c.provider === provider)?.config;

  const activeProvider = connectingProvider || configuringProvider;
  const activeLegacy = LEGACY_INTEGRATIONS.find((i) => i.provider === activeProvider);

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400" data-testid="text-no-account">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  const communicationIntegrations = LEGACY_INTEGRATIONS.filter((i) => i.category === "communication");
  const toolIntegrations = LEGACY_INTEGRATIONS.filter((i) => i.category === "tools");

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-integrations-title">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
              <Plug size={20} className="text-white" />
            </div>
            Integrations Hub
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-slate-400" data-testid="text-integrations-subtitle">Connect third-party services to supercharge your workflow</p>
            <button onClick={startTutorial} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5" data-testid="button-start-tutorial">
              <Info size={14} className="mr-1" /> Tutorial
            </button>
          </div>
        </div>
      </div>

      <OnboardingChecklist connections={connections} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white/5 border border-white/10 p-1">
          <TabsTrigger value="connections" className="text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white text-slate-400" data-testid="tab-connections">
            <Link2 size={14} className="mr-1.5" /> Connections
          </TabsTrigger>
          <TabsTrigger value="events" className="text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white text-slate-400" data-testid="tab-events">
            <Activity size={14} className="mr-1.5" /> Events
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-8 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="grid-oauth-connections">
            <OAuthConnectionCard
              provider="google"
              title="Google"
              description="Gmail, Calendar, Sheets, Drive, Business Profile"
              icon={<GoogleIcon />}
              gradientFrom="from-blue-500"
              gradientTo="to-green-500"
              childServices={GOOGLE_CHILD_SERVICES}
              connection={getConnection("google")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "google" })}
              onDisconnect={() => disconnectMutation.mutate("google")}
              onReconnect={() => {
                window.location.href = `/api/oauth/google/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="meta"
              title="Meta"
              description="Facebook Pages, Instagram, Ads, Lead Forms"
              icon={<MetaIcon />}
              gradientFrom="from-blue-600"
              gradientTo="to-indigo-600"
              childServices={META_CHILD_SERVICES}
              connection={getConnection("meta")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "meta" })}
              onDisconnect={() => disconnectMutation.mutate("meta")}
              onReconnect={() => {
                window.location.href = `/api/oauth/meta/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="youtube"
              title="YouTube"
              description="Video marketing, analytics, channel management"
              icon={<YouTubeIcon />}
              gradientFrom="from-red-600"
              gradientTo="to-red-400"
              childServices={GOOGLE_YOUTUBE_SERVICES}
              connection={getConnection("youtube")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "youtube" })}
              onDisconnect={() => disconnectMutation.mutate("youtube")}
              onReconnect={() => {
                window.location.href = `/api/oauth/youtube/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="linkedin"
              title="LinkedIn"
              description="Company pages, posts, lead gen forms"
              icon={<LinkedInIcon />}
              gradientFrom="from-blue-700"
              gradientTo="to-cyan-500"
              childServices={LINKEDIN_CHILD_SERVICES}
              connection={getConnection("linkedin")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "linkedin" })}
              onDisconnect={() => disconnectMutation.mutate("linkedin")}
              onReconnect={() => {
                window.location.href = `/api/oauth/linkedin/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="tiktok"
              title="TikTok for Business"
              description="Ad campaigns, audiences, reporting"
              icon={<TikTokIcon />}
              gradientFrom="from-pink-500"
              gradientTo="to-cyan-400"
              childServices={TIKTOK_CHILD_SERVICES}
              connection={getConnection("tiktok")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "tiktok" })}
              onDisconnect={() => disconnectMutation.mutate("tiktok")}
              onReconnect={() => {
                window.location.href = `/api/oauth/tiktok/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="microsoft"
              title="Microsoft 365"
              description="Outlook mail, calendar, OneDrive, Teams"
              icon={<MicrosoftIcon />}
              gradientFrom="from-blue-500"
              gradientTo="to-yellow-400"
              childServices={MICROSOFT_CHILD_SERVICES}
              connection={getConnection("microsoft")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "microsoft" })}
              onDisconnect={() => disconnectMutation.mutate("microsoft")}
              onReconnect={() => {
                window.location.href = `/api/oauth/microsoft/authorize/${subAccountId}`;
              }}
            />

            <OAuthConnectionCard
              provider="calendly"
              title="Calendly"
              description="Scheduling, booking links, event sync"
              icon={<CalendlyIcon />}
              gradientFrom="from-blue-500"
              gradientTo="to-blue-300"
              childServices={CALENDLY_CHILD_SERVICES}
              connection={getConnection("calendly")}
              subAccountId={subAccountId}
              onSettingsOpen={(serviceId) => setSettingsService({ serviceId, provider: "calendly" })}
              onDisconnect={() => disconnectMutation.mutate("calendly")}
              onReconnect={() => {
                window.location.href = `/api/oauth/calendly/authorize/${subAccountId}`;
              }}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Phone size={20} className="text-cyan-400" />
              <h2 className="text-lg font-bold text-white" data-testid="text-section-communication">Communication</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="grid-communication">
              {communicationIntegrations.map((integration, idx) => (
                <motion.div
                  key={integration.provider}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <LegacyCredentialCard
                    integration={integration}
                    connected={isConnected(integration.provider)}
                    isPending={connectMutation.isPending || disconnectMutation.isPending}
                    onConnect={() => setConnectingProvider(integration.provider)}
                    onDisconnect={() => disconnectMutation.mutate(integration.provider)}
                    onConfigure={() => setConfiguringProvider(integration.provider)}
                  />
                </motion.div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Plug size={20} className="text-indigo-400" />
              <h2 className="text-lg font-bold text-white" data-testid="text-section-tools">Tools & Services</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="grid-tools">
              {toolIntegrations.map((integration, idx) => (
                <motion.div
                  key={integration.provider}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <LegacyCredentialCard
                    integration={integration}
                    connected={isConnected(integration.provider)}
                    isPending={connectMutation.isPending || disconnectMutation.isPending}
                    onConnect={() => setConnectingProvider(integration.provider)}
                    onDisconnect={() => disconnectMutation.mutate(integration.provider)}
                    onConfigure={() => setConfiguringProvider(integration.provider)}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="events" className="mt-6">
          <IntegrationEventsSection subAccountId={subAccountId} />
        </TabsContent>
      </Tabs>

      <AnimatePresence>
        {activeProvider && activeLegacy && (
          <LegacyConnectDialog
            provider={activeProvider}
            providerName={activeLegacy.name}
            existingConfig={configuringProvider ? getConfig(activeProvider) : undefined}
            onClose={() => {
              setConnectingProvider(null);
              setConfiguringProvider(null);
            }}
            onSave={(config) => connectMutation.mutate({ provider: activeProvider, config })}
            isSaving={connectMutation.isPending}
          />
        )}
      </AnimatePresence>

      {settingsService?.provider === "google" && (
        <GoogleSettingsModal
          serviceId={settingsService.serviceId}
          subAccountId={subAccountId}
          onClose={() => setSettingsService(null)}
        />
      )}

      {settingsService?.provider === "meta" && (
        <MetaSettingsModal
          serviceId={settingsService.serviceId}
          subAccountId={subAccountId}
          onClose={() => setSettingsService(null)}
        />
      )}

      {showTutorial && <TutorialOverlay steps={INTEGRATIONS_STEPS} storageKey="apex_integrations_tutorial_completed" onClose={closeTutorial} accentColor="emerald" finishLabel="Start Connecting" />}
    </motion.div>
  );
}
