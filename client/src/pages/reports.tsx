import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Download, FileText, Users, Handshake, MessageSquare, TrendingUp } from "lucide-react";

export default function ReportsPage() {
  const subAccountId = useActiveSubAccountId();

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
    queryKey: ["/api/analytics", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/${subAccountId}`);
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
    enabled: !!subAccountId,
  });

  const downloadCSV = (type: string) => {
    const url = `/api/reports/export/${subAccountId}?type=${type}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-export.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const exportCards = [
    { type: "contacts", label: "Contacts Export", icon: Users, description: "Download all contacts as CSV", color: "text-cyan-400", borderColor: "border-cyan-500/20", bgColor: "from-cyan-500/20 to-cyan-500/5" },
    { type: "deals", label: "Deals Export", icon: Handshake, description: "Download all deals as CSV", color: "text-indigo-400", borderColor: "border-indigo-500/20", bgColor: "from-indigo-500/20 to-indigo-500/5" },
    { type: "messages", label: "Messages Export", icon: MessageSquare, description: "Download all messages as CSV", color: "text-purple-400", borderColor: "border-purple-500/20", bgColor: "from-purple-500/20 to-purple-500/5" },
  ];

  const stats = [
    { label: "Total Contacts", value: data?.totalContacts ?? 0, icon: Users, color: "text-cyan-400", borderColor: "border-cyan-500/20", bgColor: "from-cyan-500/20 to-cyan-500/5" },
    { label: "Total Deals", value: data?.totalDeals ?? 0, icon: Handshake, color: "text-indigo-400", borderColor: "border-indigo-500/20", bgColor: "from-indigo-500/20 to-indigo-500/5" },
    { label: "Total Messages", value: data?.totalMessages ?? 0, icon: MessageSquare, color: "text-purple-400", borderColor: "border-purple-500/20", bgColor: "from-purple-500/20 to-purple-500/5" },
    { label: "Total Appointments", value: data?.totalAppointments ?? 0, icon: TrendingUp, color: "text-emerald-400", borderColor: "border-emerald-500/20", bgColor: "from-emerald-500/20 to-emerald-500/5" },
  ];

  if (!subAccountId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-slate-400">Select a sub-account from the sidebar to continue.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-4">
            <FileText size={12} /> REPORTS & EXPORT
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" data-testid="text-reports-title">
            Reports & <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">Export</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Download your data and view report summaries</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2" data-testid="text-export-section-title">
            <Download size={18} className="text-cyan-400" /> Export Data
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {exportCards.map((card, i) => (
              <motion.div key={card.type} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }}>
                <Card className={`bg-gradient-to-b ${card.bgColor} border ${card.borderColor} hover:border-white/20 transition-colors`} data-testid={`card-export-${card.type}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-white/5 ${card.color}`}>
                        <card.icon size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-white" data-testid={`text-export-label-${card.type}`}>{card.label}</h3>
                    </div>
                    <p className="text-xs text-slate-400 mb-4" data-testid={`text-export-desc-${card.type}`}>{card.description}</p>
                    <Button
                      onClick={() => downloadCSV(card.type)}
                      className="w-full bg-white/10 hover:bg-white/20 border border-white/10 text-white text-sm"
                      data-testid={`button-download-${card.type}`}
                    >
                      <Download size={14} className="mr-2" /> Download CSV
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mb-8">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2" data-testid="text-summary-section-title">
            <TrendingUp size={18} className="text-indigo-400" /> Report Summary
          </h2>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin text-indigo-400">
                <FileText size={32} />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {stats.map((stat, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.1 }}>
                    <Card className={`bg-gradient-to-b ${stat.bgColor} border ${stat.borderColor}`} data-testid={`card-stat-${i}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <stat.icon size={16} className={stat.color} />
                          <span className="text-xs text-slate-400 font-medium">{stat.label}</span>
                        </div>
                        <div className="text-2xl font-black text-white" data-testid={`text-stat-value-${i}`}>
                          {stat.value.toLocaleString()}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
                  <Card className="bg-white/5 border-white/10" data-testid="card-messages-by-channel">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold text-slate-300 flex items-center gap-2">
                        <MessageSquare size={14} className="text-cyan-400" /> Messages by Channel
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.messagesByChannel && data.messagesByChannel.length > 0 ? (
                        <div className="space-y-2">
                          {data.messagesByChannel.map((item, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`row-channel-${i}`}>
                              <span className="text-sm text-white font-medium" data-testid={`text-channel-name-${i}`}>{item.channel}</span>
                              <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30" data-testid={`badge-channel-count-${i}`}>
                                {item.count.toLocaleString()}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-500 text-sm text-center py-6" data-testid="text-no-channel-data">No channel data available</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0 }}>
                  <Card className="bg-white/5 border-white/10" data-testid="card-deals-by-stage">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold text-slate-300 flex items-center gap-2">
                        <Handshake size={14} className="text-indigo-400" /> Deals by Stage
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {data?.dealsByStage && data.dealsByStage.length > 0 ? (
                        <div className="space-y-2">
                          {data.dealsByStage.map((item, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5" data-testid={`row-stage-${i}`}>
                              <span className="text-sm text-white font-medium" data-testid={`text-stage-name-${i}`}>{item.stage}</span>
                              <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30" data-testid={`badge-stage-count-${i}`}>
                                {item.count.toLocaleString()}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-500 text-sm text-center py-6" data-testid="text-no-stage-data">No stage data available</p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
