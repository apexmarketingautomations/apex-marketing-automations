import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bell, BellRing, MessageSquare, Phone, Shield, Zap, AlertTriangle, CreditCard, Target, Clock, Save, Loader2, Smartphone, Volume2, VolumeX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";

interface NotificationPrefs {
  subAccountId: number;
  newLeadPush: boolean;
  newLeadSms: boolean;
  missedCallPush: boolean;
  missedCallSms: boolean;
  paymentFailedPush: boolean;
  paymentFailedSms: boolean;
  incidentPush: boolean;
  incidentSms: boolean;
  nudgeHighPush: boolean;
  nudgeHighSms: boolean;
  agentUrgentPush: boolean;
  agentUrgentSms: boolean;
  campaignAlertPush: boolean;
  campaignAlertSms: boolean;
  systemAlertPush: boolean;
  systemAlertSms: boolean;
  smsAlertPhone: string | null;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const EVENT_CATEGORIES = [
  {
    key: "newLead",
    label: "New Lead",
    description: "When a new lead is captured from forms, geofence, or Facebook",
    icon: Target,
    color: "text-green-400",
    bg: "bg-green-500/10",
  },
  {
    key: "paymentFailed",
    label: "Payment Failed",
    description: "When a subscription or payment fails to process",
    icon: CreditCard,
    color: "text-red-400",
    bg: "bg-red-500/10",
  },
  {
    key: "incident",
    label: "Sentinel Incident",
    description: "When Sentinel detects a crash or incident in your area",
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-500/10",
  },
  {
    key: "nudgeHigh",
    label: "High-Priority Nudge",
    description: "When the AI advisor has an important insight for you",
    icon: Zap,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    key: "agentUrgent",
    label: "Urgent Agent Task",
    description: "When the autonomous agent flags something as time-sensitive",
    icon: BellRing,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
  },
  {
    key: "campaignAlert",
    label: "Campaign Alert",
    description: "Significant campaign events (viral spike, budget exhausted, etc.)",
    icon: MessageSquare,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    key: "systemAlert",
    label: "System Alert",
    description: "Integration disconnections, automation failures, and system health issues",
    icon: Shield,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
  },
];

function usePushPermission() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const [loading, setLoading] = useState(false);

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    setLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      setPermission("denied");
    } finally {
      setLoading(false);
    }
  };

  return { permission, requestPermission, loading };
}

export default function NotificationPreferencesPage() {
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 1;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { permission, requestPermission, loading: permLoading } = usePushPermission();

  const { data: prefs, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ["/api/notification-preferences", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/notification-preferences/${subAccountId}`);
      return res.json();
    },
  });

  const { data: pushConfig } = useQuery<{ publicKey: string }>({
    queryKey: ["/api/push-config"],
    queryFn: async () => {
      const res = await fetch("/api/push-config");
      return res.json();
    },
  });

  const [localPrefs, setLocalPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => {
    if (prefs) setLocalPrefs({ ...prefs });
  }, [prefs]);

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<NotificationPrefs>) => {
      return apiRequest("PUT", `/api/notification-preferences/${subAccountId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({ title: "Preferences saved" });
    },
    onError: () => {
      toast({ title: "Failed to save preferences", variant: "destructive" });
    },
  });

  const subscribePushMutation = useMutation({
    mutationFn: async () => {
      if (!pushConfig?.publicKey) throw new Error("Push not configured");

      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey),
      });

      const json = subscription.toJSON();
      await apiRequest("POST", "/api/push-subscriptions", {
        subAccountId,
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      });
    },
    onSuccess: () => {
      toast({ title: "Browser push notifications enabled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to enable push", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (key: string, value: boolean) => {
    if (!localPrefs) return;
    setLocalPrefs({ ...localPrefs, [key]: value });
  };

  const handleSave = () => {
    if (!localPrefs) return;
    saveMutation.mutate(localPrefs);
  };

  const handleEnablePush = async () => {
    if (permission !== "granted") {
      await requestPermission();
    }
    if (Notification.permission === "granted") {
      subscribePushMutation.mutate();
    }
  };

  if (isLoading || !localPrefs) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6" data-testid="notification-preferences-page">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-1"
      >
        <h1 className="text-2xl font-bold text-white flex items-center gap-3" data-testid="text-page-title">
          <Bell className="w-6 h-6 text-violet-400" />
          Notification Preferences
        </h1>
        <p className="text-sm text-slate-400">
          Control how and when you receive alerts for important events.
        </p>
      </motion.div>

      <Card className="bg-neutral-900/50 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" />
            Browser Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {permission === "unsupported" && (
            <p className="text-sm text-slate-500">Your browser does not support push notifications.</p>
          )}
          {permission === "denied" && (
            <p className="text-sm text-red-400">Push notifications are blocked. Please enable them in your browser settings.</p>
          )}
          {permission === "default" && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">Enable push notifications</p>
                <p className="text-xs text-slate-500">Get real-time alerts even when you're not on the dashboard</p>
              </div>
              <Button
                size="sm"
                onClick={handleEnablePush}
                disabled={permLoading || subscribePushMutation.isPending}
                className="bg-violet-600 hover:bg-violet-500"
                data-testid="button-enable-push"
              >
                {permLoading || subscribePushMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Enable"}
              </Button>
            </div>
          )}
          {permission === "granted" && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <Volume2 className="w-4 h-4" />
              Push notifications are enabled
              {!pushConfig?.publicKey && (
                <span className="text-xs text-amber-400 ml-2">(VAPID keys not configured on server)</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-neutral-900/50 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Phone className="w-4 h-4 text-cyan-400" />
            SMS Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Alert Phone Number</label>
            <Input
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={localPrefs.smsAlertPhone || ""}
              onChange={(e) => setLocalPrefs({ ...localPrefs, smsAlertPhone: e.target.value || null })}
              className="bg-black/30 border-white/10 text-white max-w-xs"
              data-testid="input-sms-phone"
            />
            <p className="text-[11px] text-slate-600 mt-1">SMS alerts will be sent to this number. Leave blank to use your account owner phone.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-neutral-900/50 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-violet-400" />
            Alert Channels by Event Type
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 items-center px-1">
            <div />
            <span className="text-[10px] font-bold uppercase text-slate-500 text-center">Push</span>
            <span className="text-[10px] font-bold uppercase text-slate-500 text-center">SMS</span>
          </div>

          {EVENT_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const pushKey = `${cat.key}Push` as keyof NotificationPrefs;
            const smsKey = `${cat.key}Sms` as keyof NotificationPrefs;

            return (
              <motion.div
                key={cat.key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/10 transition-colors"
                data-testid={`pref-row-${cat.key}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg ${cat.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${cat.color}`} />
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">{cat.label}</p>
                    <p className="text-[11px] text-slate-500">{cat.description}</p>
                  </div>
                </div>
                <Switch
                  checked={localPrefs[pushKey] as boolean}
                  onCheckedChange={(v) => handleToggle(pushKey, v)}
                  data-testid={`switch-${cat.key}-push`}
                />
                <Switch
                  checked={localPrefs[smsKey] as boolean}
                  onCheckedChange={(v) => handleToggle(smsKey, v)}
                  data-testid={`switch-${cat.key}-sms`}
                />
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="bg-neutral-900/50 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Quiet Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Enable quiet hours</p>
              <p className="text-xs text-slate-500">Suppress non-urgent alerts during off hours</p>
            </div>
            <Switch
              checked={localPrefs.quietHoursEnabled}
              onCheckedChange={(v) => handleToggle("quietHoursEnabled", v)}
              data-testid="switch-quiet-hours"
            />
          </div>
          {localPrefs.quietHoursEnabled && (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Start</label>
                <Input
                  type="time"
                  value={localPrefs.quietHoursStart}
                  onChange={(e) => setLocalPrefs({ ...localPrefs, quietHoursStart: e.target.value })}
                  className="bg-black/30 border-white/10 text-white w-32"
                  data-testid="input-quiet-start"
                />
              </div>
              <div className="pt-5 text-slate-500">to</div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">End</label>
                <Input
                  type="time"
                  value={localPrefs.quietHoursEnd}
                  onChange={(e) => setLocalPrefs({ ...localPrefs, quietHoursEnd: e.target.value })}
                  className="bg-black/30 border-white/10 text-white w-32"
                  data-testid="input-quiet-end"
                />
              </div>
            </div>
          )}
          <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
            <VolumeX className="w-3 h-3" />
            Urgent alerts (payment failures, incidents, agent urgent) will always come through regardless of quiet hours.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="bg-violet-600 hover:bg-violet-500 px-6"
          data-testid="button-save-preferences"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Preferences
        </Button>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
