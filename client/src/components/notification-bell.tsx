import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, ExternalLink } from "lucide-react";
import { useAccount } from "@/hooks/use-account";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { format } from "date-fns";

interface Notification {
  id: number;
  subAccountId: number;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  link: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const { activeAccountId } = useAccount();
  const subAccountId = activeAccountId || 1;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/notifications/${subAccountId}/unread-count`);
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: notifs = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications", subAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/notifications/${subAccountId}`);
      return res.json();
    },
    enabled: open,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/notifications/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/notifications/${subAccountId}/read-all`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = countData?.count || 0;

  const typeIcons: Record<string, string> = {
    new_lead: "bg-green-500/20 text-green-400",
    new_message: "bg-cyan-500/20 text-cyan-400",
    new_review: "bg-yellow-500/20 text-yellow-400",
    incident: "bg-red-500/20 text-red-400",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-white/10 transition-colors"
        data-testid="button-notification-bell"
      >
        <Bell size={20} className="text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-pulse" data-testid="badge-unread-count">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute right-0 top-12 w-80 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="flex items-center justify-between p-3 border-b border-white/10">
              <p className="text-sm font-bold text-white">Notifications</p>
              {unreadCount > 0 && (
                <button onClick={() => markAllReadMutation.mutate()} className="text-xs text-cyan-400 hover:text-cyan-300" data-testid="button-mark-all-read">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">No notifications yet</div>
              ) : (
                notifs.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markReadMutation.mutate(n.id);
                      if (n.link) { setLocation(n.link); setOpen(false); }
                    }}
                    className={`w-full text-left p-3 border-b border-white/5 hover:bg-white/5 transition-colors ${!n.read ? "bg-cyan-500/5" : ""}`}
                    data-testid={`notification-${n.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${typeIcons[n.type] || "bg-white/10 text-white"}`}>
                        {!n.read && <div className="w-2 h-2 rounded-full bg-cyan-400" />}
                        {n.read && <Check size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${!n.read ? "text-white" : "text-slate-400"}`}>{n.title}</p>
                        {n.body && <p className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</p>}
                        <p className="text-[10px] text-slate-600 mt-1">{format(new Date(n.createdAt), "MMM d, h:mm a")}</p>
                      </div>
                      {n.link && <ExternalLink size={12} className="text-slate-600 mt-1 flex-shrink-0" />}
                    </div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
