import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/hooks/use-account";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import { motion } from "framer-motion";
import { Users, Handshake, MessageSquare, CalendarCheck, BarChart3, Loader2 } from "lucide-react";

const CYAN = "#06b6d4";
const INDIGO = "#6366f1";
const PIE_COLORS = ["#06b6d4", "#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#10b981"];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-black/80 border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl backdrop-blur-sm">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-white font-semibold">
          {entry.name}: {typeof entry.value === "number" && entry.name?.toLowerCase().includes("revenue")
            ? `$${entry.value.toLocaleString()}`
            : entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const { activeAccountId } = useAccount();

  const { data, isLoading } = useQuery<{
    messagesByDay: { date: string; count: number }[];
    messagesByChannel: { channel: string; count: number }[];
    dealsByStage: { stage: string; count: number }[];
    revenueByMonth: { month: string; revenue: number }[];
    totalContacts: number;
    totalDeals: number;
    totalMessages: number;
    totalAppointments: number;
  }>({
    queryKey: ["/api/analytics", activeAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/${activeAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
    enabled: !!activeAccountId,
  });

  const stats = [
    {
      label: "Total Contacts",
      value: data?.totalContacts ?? 0,
      icon: Users,
      gradient: "from-cyan-500/20 to-cyan-500/5",
      iconColor: "text-cyan-400",
      borderColor: "border-cyan-500/20",
    },
    {
      label: "Total Deals",
      value: data?.totalDeals ?? 0,
      icon: Handshake,
      gradient: "from-indigo-500/20 to-indigo-500/5",
      iconColor: "text-indigo-400",
      borderColor: "border-indigo-500/20",
    },
    {
      label: "Total Messages",
      value: data?.totalMessages ?? 0,
      icon: MessageSquare,
      gradient: "from-purple-500/20 to-purple-500/5",
      iconColor: "text-purple-400",
      borderColor: "border-purple-500/20",
    },
    {
      label: "Total Appointments",
      value: data?.totalAppointments ?? 0,
      icon: CalendarCheck,
      gradient: "from-emerald-500/20 to-emerald-500/5",
      iconColor: "text-emerald-400",
      borderColor: "border-emerald-500/20",
    },
  ];

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <BarChart3 size={12} /> ANALYTICS
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-analytics-title">
            Analytics{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Dashboard
            </span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Track performance metrics and trends across your account</p>
        </motion.div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        ) : !activeAccountId ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-slate-400 text-sm">Select a sub-account to view analytics</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-testid="stats-row">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card
                    className={`bg-gradient-to-br ${stat.gradient} bg-black/40 border ${stat.borderColor} border-white/10 overflow-hidden`}
                    data-testid={`stat-card-${i}`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                          {stat.label}
                        </span>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 ${stat.iconColor}`}>
                          <stat.icon size={16} />
                        </div>
                      </div>
                      <div className="text-3xl font-black text-white" data-testid={`stat-value-${i}`}>
                        {stat.value.toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <motion.div
                className="lg:col-span-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="bg-black/40 border-white/10" data-testid="chart-messages-by-day">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold text-slate-300">Messages — Last 30 Days</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data?.messagesByDay || []}>
                          <defs>
                            <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={CYAN} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={CYAN} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="date"
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Area
                            type="monotone"
                            dataKey="count"
                            name="Messages"
                            stroke={CYAN}
                            strokeWidth={2}
                            fill="url(#msgGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <Card className="bg-black/40 border-white/10" data-testid="chart-messages-by-channel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold text-slate-300">Messages by Channel</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-[280px] flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data?.messagesByChannel || []}
                            dataKey="count"
                            nameKey="channel"
                            cx="50%"
                            cy="50%"
                            outerRadius={90}
                            innerRadius={50}
                            paddingAngle={3}
                            strokeWidth={0}
                          >
                            {(data?.messagesByChannel || []).map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-3 justify-center mt-2">
                      {(data?.messagesByChannel || []).map((entry, i) => (
                        <div key={entry.channel} className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          {entry.channel}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Card className="bg-black/40 border-white/10" data-testid="chart-deals-by-stage">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold text-slate-300">Deals by Stage</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data?.dealsByStage || []}>
                          <defs>
                            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={INDIGO} stopOpacity={0.8} />
                              <stop offset="100%" stopColor={INDIGO} stopOpacity={0.3} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="stage"
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar
                            dataKey="count"
                            name="Deals"
                            fill="url(#barGradient)"
                            radius={[6, 6, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <Card className="bg-black/40 border-white/10" data-testid="chart-revenue-by-month">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold text-slate-300">Revenue by Month</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-[280px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data?.revenueByMonth || []}>
                          <defs>
                            <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={CYAN} />
                              <stop offset="100%" stopColor={INDIGO} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="month"
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                            tickLine={false}
                            tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Line
                            type="monotone"
                            dataKey="revenue"
                            name="Revenue"
                            stroke="url(#lineGradient)"
                            strokeWidth={2.5}
                            dot={{ fill: INDIGO, strokeWidth: 0, r: 4 }}
                            activeDot={{ fill: CYAN, strokeWidth: 0, r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
