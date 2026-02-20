import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Users, Kanban, DollarSign, CalendarDays, Building2, ShieldAlert, Clock } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { format } from "date-fns";

interface PortalData {
  businessName: string;
  totalMessages: number;
  totalContacts: number;
  activeDeals: number;
  dealValue: number;
  upcomingAppointments: number;
  recentMessages: Array<{
    id: number;
    body: string;
    direction: string;
    channel: string;
    contactPhone: string;
    createdAt: string;
  }>;
  appointments: Array<{
    id: number;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
}

const metricCards = [
  { key: "totalMessages", label: "Total Messages", icon: MessageSquare, bgColor: "bg-blue-500/15", iconColor: "text-blue-400" },
  { key: "totalContacts", label: "Contacts", icon: Users, bgColor: "bg-emerald-500/15", iconColor: "text-emerald-400" },
  { key: "activeDeals", label: "Active Deals", icon: Kanban, bgColor: "bg-violet-500/15", iconColor: "text-violet-400" },
  { key: "dealValue", label: "Deal Value", icon: DollarSign, bgColor: "bg-amber-500/15", iconColor: "text-amber-400", isCurrency: true },
  { key: "upcomingAppointments", label: "Upcoming Appointments", icon: CalendarDays, bgColor: "bg-rose-500/15", iconColor: "text-rose-400" },
];

export default function ClientPortalPage() {
  const [match, params] = useRoute("/portal/:token");
  const token = params?.token;

  const { data, isLoading, isError, error } = useQuery<PortalData>({
    queryKey: ["/api/portal", token],
    queryFn: async () => {
      const res = await fetch(`/api/portal/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Invalid or expired portal link" }));
        throw new Error(err.message || "Invalid or expired portal link");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto">
            <ShieldAlert size={32} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-portal-error-title">Invalid Portal Link</h1>
          <p className="text-slate-400" data-testid="text-portal-error-message">This portal link is missing a valid access token. Please check the link and try again.</p>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center" data-testid="status-portal-loading">
        <Spinner className="size-10 text-blue-400" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto">
            <ShieldAlert size={32} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white" data-testid="text-portal-expired-title">Portal Unavailable</h1>
          <p className="text-slate-400" data-testid="text-portal-expired-message">
            {(error as Error)?.message || "This portal link is invalid or has expired. Please contact your service provider for a new link."}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 md:py-12 space-y-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Building2 size={22} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white" data-testid="text-portal-business-name">{data.businessName}</h1>
              <p className="text-sm text-slate-500">Your business overview</p>
            </div>
          </div>
          <Badge variant="secondary" className="bg-blue-500/15 text-blue-300 border-blue-500/20 px-3 py-1 text-xs font-semibold" data-testid="badge-client-portal">
            Client Portal
          </Badge>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {metricCards.map((card, idx) => {
            const value = data[card.key as keyof PortalData] as number;
            const displayValue = card.isCurrency
              ? `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
              : Number(value).toLocaleString();
            return (
              <motion.div key={card.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.06 }}>
                <Card className="bg-slate-900/60 border-slate-700/40 hover:border-slate-600/50 transition-colors" data-testid={`card-portal-metric-${card.key}`}>
                  <CardContent className="p-4">
                    <div className={`w-9 h-9 rounded-lg ${card.bgColor} flex items-center justify-center mb-3`}>
                      <card.icon size={18} className={card.iconColor} />
                    </div>
                    <p className="text-xl font-bold text-white">{displayValue}</p>
                    <p className="text-xs text-slate-400 mt-1">{card.label}</p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="bg-slate-900/60 border-slate-700/40" data-testid="card-portal-recent-messages">
              <CardContent className="p-5">
                <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <MessageSquare size={16} className="text-blue-400" />
                  Recent Messages
                </h2>
                {data.recentMessages.length === 0 ? (
                  <p className="text-slate-500 text-sm" data-testid="text-no-messages">No recent messages</p>
                ) : (
                  <div className="space-y-2">
                    {data.recentMessages.slice(0, 10).map((msg, i) => (
                      <div key={msg.id || i} className="flex items-start gap-3 rounded-lg bg-slate-800/50 p-3" data-testid={`row-message-${msg.id || i}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${msg.direction === "inbound" ? "bg-blue-500/20 text-blue-300" : "bg-slate-600/30 text-slate-400"}`}>
                          {msg.direction === "inbound" ? "IN" : "OUT"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200 truncate">{msg.body}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">{msg.contactPhone}</span>
                            <span className="text-xs text-slate-600">·</span>
                            <span className="text-xs text-slate-500">{msg.channel}</span>
                            {msg.createdAt && (
                              <>
                                <span className="text-xs text-slate-600">·</span>
                                <span className="text-xs text-slate-500">{format(new Date(msg.createdAt), "MMM d, h:mm a")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="bg-slate-900/60 border-slate-700/40" data-testid="card-portal-appointments">
              <CardContent className="p-5">
                <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                  <CalendarDays size={16} className="text-rose-400" />
                  Upcoming Appointments
                </h2>
                {data.appointments.length === 0 ? (
                  <p className="text-slate-500 text-sm" data-testid="text-no-appointments">No upcoming appointments</p>
                ) : (
                  <div className="space-y-2">
                    {data.appointments.map((apt, i) => (
                      <div key={apt.id || i} className="rounded-lg bg-slate-800/50 p-3" data-testid={`row-appointment-${apt.id || i}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-slate-200 truncate">{apt.title}</p>
                          {apt.status && (
                            <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 shrink-0">
                              {apt.status}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Clock size={12} className="text-slate-500" />
                          <span className="text-xs text-slate-500">
                            {apt.startTime && format(new Date(apt.startTime), "MMM d, yyyy · h:mm a")}
                            {apt.endTime && ` – ${format(new Date(apt.endTime), "h:mm a")}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="text-center pt-4 pb-8">
          <p className="text-xs text-slate-600">Powered by Apex Marketing Automations</p>
        </div>
      </div>
    </div>
  );
}
