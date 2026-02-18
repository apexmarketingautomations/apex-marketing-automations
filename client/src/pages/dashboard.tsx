import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useAccount } from "@/hooks/use-account";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Users, Kanban, CalendarDays, Mail, Megaphone, Target, Instagram, DollarSign, TrendingUp, Bell, Clock } from "lucide-react";
import { Link } from "wouter";

interface DashboardMetrics {
  totalMessages: number;
  todayMessages: number;
  totalContacts: number;
  totalDeals: number;
  totalDealValue: number;
  upcomingAppointments: number;
  totalCampaigns: number;
  metaAdCampaigns: number;
  metaLeads: number;
  totalAdSpend: number;
  totalAdLeads: number;
  igConversations: number;
  unreadIgMessages: number;
  unreadNotifications: number;
  recentMessages: any[];
  recentLeads: any[];
}

const metricCards = [
  { key: "totalMessages", label: "Total Messages", icon: MessageSquare, color: "from-cyan-500 to-blue-600", link: "/", bgColor: "bg-cyan-500/20", iconColor: "text-cyan-400" },
  { key: "todayMessages", label: "Messages Today", icon: Clock, color: "from-blue-500 to-indigo-600", link: "/", bgColor: "bg-blue-500/20", iconColor: "text-blue-400" },
  { key: "totalContacts", label: "Contacts", icon: Users, color: "from-green-500 to-emerald-600", link: "/pipeline", bgColor: "bg-green-500/20", iconColor: "text-green-400" },
  { key: "totalDeals", label: "Active Deals", icon: Kanban, color: "from-purple-500 to-violet-600", link: "/pipeline", bgColor: "bg-purple-500/20", iconColor: "text-purple-400" },
  { key: "totalDealValue", label: "Deal Pipeline Value", icon: DollarSign, color: "from-emerald-500 to-teal-600", link: "/pipeline", bgColor: "bg-emerald-500/20", iconColor: "text-emerald-400", isCurrency: true },
  { key: "upcomingAppointments", label: "Upcoming Appointments", icon: CalendarDays, color: "from-amber-500 to-orange-600", link: "/calendar", bgColor: "bg-amber-500/20", iconColor: "text-amber-400" },
  { key: "totalCampaigns", label: "Email Campaigns", icon: Mail, color: "from-pink-500 to-rose-600", link: "/email-campaigns", bgColor: "bg-pink-500/20", iconColor: "text-pink-400" },
  { key: "metaAdCampaigns", label: "Meta Ad Campaigns", icon: Target, color: "from-blue-500 to-indigo-600", link: "/meta-ads", bgColor: "bg-blue-500/20", iconColor: "text-blue-400" },
  { key: "metaLeads", label: "Facebook Leads", icon: Megaphone, color: "from-green-500 to-emerald-600", link: "/meta-leads", bgColor: "bg-green-500/20", iconColor: "text-green-400" },
  { key: "totalAdSpend", label: "Ad Spend", icon: DollarSign, color: "from-red-500 to-rose-600", link: "/meta-ads", bgColor: "bg-red-500/20", iconColor: "text-red-400", isCurrency: true },
  { key: "igConversations", label: "IG Conversations", icon: Instagram, color: "from-pink-500 to-purple-600", link: "/instagram-inbox", bgColor: "bg-pink-500/20", iconColor: "text-pink-400" },
  { key: "unreadNotifications", label: "Unread Alerts", icon: Bell, color: "from-yellow-500 to-amber-600", link: "/", bgColor: "bg-yellow-500/20", iconColor: "text-yellow-400" },
];

export default function DashboardPage() {
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 1;

  const { data: metrics, isLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/${subAccountId}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white flex items-center gap-3" data-testid="text-dashboard-title">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center">
            <TrendingUp size={20} className="text-white" />
          </div>
          Command Dashboard
        </h1>
        <p className="text-slate-400 mt-1">Real-time overview of your business operations</p>
      </div>

      {isLoading ? (
        <div className="text-center py-20 text-slate-400">Loading dashboard...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {metricCards.map((card, idx) => {
            const value = metrics?.[card.key as keyof DashboardMetrics] ?? 0;
            const displayValue = card.isCurrency ? `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : Number(value).toLocaleString();
            return (
              <motion.div key={card.key} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Link href={card.link}>
                  <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all cursor-pointer group" data-testid={`card-metric-${card.key}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-lg ${card.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                          <card.icon size={20} className={card.iconColor} />
                        </div>
                      </div>
                      <p className="text-2xl font-black text-white">{displayValue}</p>
                      <p className="text-xs text-slate-400 mt-1">{card.label}</p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-black/40 border border-white/10 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <MessageSquare size={18} className="text-cyan-400" /> Recent Messages
            </h2>
            {metrics.recentMessages.length === 0 ? (
              <p className="text-slate-500 text-sm">No messages today</p>
            ) : (
              <div className="space-y-3">
                {metrics.recentMessages.map((msg: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${msg.direction === "inbound" ? "bg-cyan-500/20 text-cyan-400" : "bg-indigo-500/20 text-indigo-400"}`}>
                      {msg.direction === "inbound" ? "IN" : "OUT"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm truncate">{msg.body}</p>
                      <p className="text-slate-500 text-xs">{msg.contactPhone} · {msg.channel}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-black/40 border border-white/10 rounded-xl p-5">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Megaphone size={18} className="text-green-400" /> Recent Leads
            </h2>
            {metrics.recentLeads.length === 0 ? (
              <p className="text-slate-500 text-sm">No recent leads</p>
            ) : (
              <div className="space-y-3">
                {metrics.recentLeads.map((lead: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-xs">
                      {(lead.name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm">{lead.name}</p>
                      <p className="text-slate-500 text-xs">{lead.email || lead.phone || "No contact info"}</p>
                    </div>
                    {lead.syncedToCrm && (
                      <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">In CRM</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
