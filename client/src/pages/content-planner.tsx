import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useActiveSubAccountId } from "@/components/account-required";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Plus, Search, LayoutGrid, Calendar, FileText, Clock,
  CheckCircle2, Send, Eye, AlertTriangle, X, Edit3, Trash2,
  Image, Instagram, Facebook, Hash, Sparkles, ChevronLeft, ChevronRight,
  Globe, ArrowRight, Zap
} from "lucide-react";

interface ContentPost {
  id: number;
  subAccountId: number;
  title?: string;
  caption?: string;
  hashtags?: string;
  callToAction?: string;
  firstComment?: string;
  contentType?: string;
  status: string;
  approvalStatus?: string;
  scheduledAt?: string;
  publishedAt?: string;
  createdAt: string;
  platforms?: { platform: string; socialAccountId?: number; platformStatus?: string }[];
  media?: { id: number; fileUrl: string; fileType: string }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string; accent: string }> = {
  draft: { label: "Draft", color: "text-gray-400", icon: FileText, bg: "bg-gray-500/15", accent: "#9ca3af" },
  scheduled: { label: "Scheduled", color: "text-blue-400", icon: Clock, bg: "bg-blue-500/15", accent: "#60a5fa" },
  published: { label: "Published", color: "text-emerald-400", icon: CheckCircle2, bg: "bg-emerald-500/15", accent: "#34d399" },
  failed: { label: "Failed", color: "text-red-400", icon: AlertTriangle, bg: "bg-red-500/15", accent: "#f87171" },
};

const PLATFORM_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  instagram: { icon: Instagram, color: "text-pink-400", label: "Instagram" },
  facebook: { icon: Facebook, color: "text-blue-400", label: "Facebook" },
  x: { icon: Globe, color: "text-white/60", label: "X" },
  tiktok: { icon: Globe, color: "text-cyan-400", label: "TikTok" },
};

const STAT_CARDS = [
  { key: "scheduled", label: "Scheduled", icon: Clock, bg: "bg-blue-500/15", iconColor: "text-blue-400" },
  { key: "draft", label: "Drafts", icon: FileText, bg: "bg-gray-500/15", iconColor: "text-gray-400" },
  { key: "pendingApproval", label: "Pending Approval", icon: Eye, bg: "bg-amber-500/15", iconColor: "text-amber-400" },
  { key: "published", label: "Published", icon: CheckCircle2, bg: "bg-emerald-500/15", iconColor: "text-emerald-400" },
];

function PostComposer({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ContentPost;
  onSave: (data: any) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    caption: initial?.caption || "",
    hashtags: initial?.hashtags || "",
    callToAction: initial?.callToAction || "",
    firstComment: initial?.firstComment || "",
    contentType: initial?.contentType || "post",
    scheduledAt: initial?.scheduledAt && !isNaN(new Date(initial.scheduledAt).getTime()) ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : "",
    platforms: initial?.platforms?.map((p) => p.platform) || [],
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const togglePlatform = (p: string) => {
    set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);
  };
  const captionLen = form.caption.length;

  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Post Title</label>
        <Input
          data-testid="input-post-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Campaign title or internal label"
          className="bg-white/5 border-white/10 text-white focus:border-[color:var(--vibe-glow,#6366f1)]/50"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Caption</label>
          <span className="text-[10px] text-white/30">{captionLen} characters</span>
        </div>
        <Textarea
          data-testid="input-post-caption"
          value={form.caption}
          onChange={(e) => set("caption", e.target.value)}
          placeholder="Write your post content..."
          rows={4}
          className="bg-white/5 border-white/10 text-white resize-none focus:border-[color:var(--vibe-glow,#6366f1)]/50"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Hashtags</label>
          <Input
            data-testid="input-post-hashtags"
            value={form.hashtags}
            onChange={(e) => set("hashtags", e.target.value)}
            placeholder="#marketing #growth"
            className="bg-white/5 border-white/10 text-white"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Content Type</label>
          <select
            data-testid="select-post-type"
            value={form.contentType}
            onChange={(e) => set("contentType", e.target.value)}
            className="w-full h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white"
          >
            <option value="post" className="bg-gray-900">Post</option>
            <option value="reel" className="bg-gray-900">Reel</option>
            <option value="story" className="bg-gray-900">Story</option>
            <option value="carousel" className="bg-gray-900">Carousel</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Schedule</label>
        <Input
          data-testid="input-post-schedule"
          type="datetime-local"
          value={form.scheduledAt}
          onChange={(e) => set("scheduledAt", e.target.value)}
          className="bg-white/5 border-white/10 text-white"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2 block">Platforms</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PLATFORM_ICONS).map(([key, { icon: PIcon, color, label }]) => (
            <button
              key={key}
              data-testid={`button-platform-${key}`}
              onClick={() => togglePlatform(key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all border ${
                form.platforms.includes(key)
                  ? "bg-white/10 border-white/20 text-white shadow-sm"
                  : "bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60 hover:border-white/10"
              }`}
            >
              <PIcon className={`w-3.5 h-3.5 ${form.platforms.includes(key) ? color : ""}`} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Call to Action</label>
        <Input
          data-testid="input-post-cta"
          value={form.callToAction}
          onChange={(e) => set("callToAction", e.target.value)}
          placeholder="Link in bio, Shop now, etc."
          className="bg-white/5 border-white/10 text-white"
        />
      </div>
      <div className="flex gap-3 pt-3 border-t border-white/5">
        <Button
          data-testid="button-save-post"
          onClick={() => onSave({
            ...form,
            scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
            platforms: form.platforms.map((p) => ({ platform: p })),
          })}
          disabled={!form.caption || saving}
          className="flex-1 text-white border-0 shadow-lg"
          style={{ background: `linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))` }}
        >
          {saving ? "Saving..." : initial ? "Update Post" : "Create Post"}
        </Button>
        <Button onClick={onCancel} variant="outline" className="border-white/10 text-white/60 hover:text-white hover:bg-white/5">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CalendarView({ posts, onEdit }: { posts: ContentPost[]; onEdit: (p: ContentPost) => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: { date: number; posts: ContentPost[] }[] = [];
    for (let i = 0; i < firstDay; i++) days.push({ date: 0, posts: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayPosts = posts.filter((p) => {
        const pDate = p.scheduledAt || p.createdAt;
        return pDate && pDate.startsWith(dateStr);
      });
      days.push({ date: d, posts: dayPosts });
    }
    return days;
  }, [currentMonth, posts]);

  const monthLabel = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date();
  const isToday = (d: number) =>
    d === today.getDate() && currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <button
          data-testid="button-prev-month"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-bold text-white">{monthLabel}</h3>
        <button
          data-testid="button-next-month"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-white/5 rounded-xl overflow-hidden border border-white/5">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-black/60 p-2.5 text-center text-[10px] font-bold text-white/30 uppercase tracking-wider">{d}</div>
        ))}
        {calendarDays.map((day, i) => (
          <div
            key={i}
            className={`bg-black/40 min-h-[90px] md:min-h-[100px] p-1.5 transition-colors hover:bg-white/[0.03] ${day.date === 0 ? "opacity-20" : ""} ${
              isToday(day.date) ? "ring-1 ring-inset ring-[color:var(--vibe-glow,#6366f1)]/40 bg-white/[0.02]" : ""
            }`}
          >
            {day.date > 0 && (
              <>
                <div className={`text-[11px] font-bold mb-1.5 ${isToday(day.date) ? "text-white" : "text-white/30"}`} style={isToday(day.date) ? { color: "var(--vibe-glow, #6366f1)" } : undefined}>{day.date}</div>
                {day.posts.slice(0, 2).map((p) => {
                  const st = STATUS_CONFIG[p.status] || STATUS_CONFIG.draft;
                  return (
                    <button
                      key={p.id}
                      onClick={() => onEdit(p)}
                      className="w-full text-left text-[9px] px-1.5 py-0.5 rounded-md mb-0.5 truncate transition-all hover:brightness-125 border border-transparent hover:border-white/10"
                      style={{ background: `${st.accent}15`, color: st.accent }}
                    >
                      {p.title || p.caption?.slice(0, 20) || "Untitled"}
                    </button>
                  );
                })}
                {day.posts.length > 2 && (
                  <div className="text-[9px] text-white/20 text-center mt-0.5">+{day.posts.length - 2} more</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PostDetailPanel({ post, onEdit, onClose, onDelete }: { post: ContentPost; onEdit: () => void; onClose: () => void; onDelete: () => void }) {
  const st = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft;
  const StIcon = st.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed right-0 top-0 bottom-0 w-full max-w-md glass border-l border-white/10 z-50 overflow-y-auto"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <Badge className="text-[10px] px-2 py-0.5 h-5 border" style={{ background: `${st.accent}20`, color: st.accent, borderColor: `${st.accent}30` }}>
            <StIcon className="w-3 h-3 mr-1" /> {st.label}
          </Badge>
          <button data-testid="button-close-detail" onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <h2 className="text-xl font-bold text-white" data-testid="text-post-detail-title">{post.title || "Untitled Post"}</h2>
        {post.caption && (
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{post.caption}</p>
          </div>
        )}
        {post.hashtags && (
          <div className="flex items-center gap-1.5 text-xs">
            <Hash className="w-3.5 h-3.5" style={{ color: "var(--vibe-glow, #6366f1)" }} />
            <span className="text-white/40">{post.hashtags}</span>
          </div>
        )}
        {post.platforms && post.platforms.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">Platforms</span>
            <div className="flex gap-2 mt-2">
              {post.platforms.map((p) => {
                const pi = PLATFORM_ICONS[p.platform];
                if (!pi) return null;
                const PIc = pi.icon;
                return (
                  <div key={p.platform} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5">
                    <PIc className={`w-3.5 h-3.5 ${pi.color}`} />
                    <span className="text-[11px] text-white/60">{pi.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {post.scheduledAt && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Clock className="w-3.5 h-3.5" />
            <span>Scheduled: {new Date(post.scheduledAt).toLocaleString()}</span>
          </div>
        )}
        {post.approvalStatus && post.approvalStatus !== "none" && post.approvalStatus !== "not_required" && (
          <Badge className={`text-[10px] px-2 py-0.5 h-5 ${
            post.approvalStatus === "approved" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" :
            post.approvalStatus === "rejected" ? "bg-red-500/20 text-red-400 border-red-500/20" :
            "bg-amber-500/20 text-amber-400 border-amber-500/20"
          }`}>
            {post.approvalStatus}
          </Badge>
        )}
        {post.media && post.media.length > 0 && (
          <div>
            <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">Media</span>
            <div className="flex gap-2 mt-2 flex-wrap">
              {post.media.map((m) => (
                <div key={m.id} className="w-16 h-16 rounded-lg bg-white/5 border border-white/10 overflow-hidden">
                  {m.fileType?.startsWith("image") ? (
                    <img src={m.fileUrl} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Image className="w-5 h-5 text-white/20" /></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-3 border-t border-white/5">
          <Button data-testid="button-edit-from-detail" onClick={onEdit} className="flex-1 text-white border-0" style={{ background: `linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))` }}>
            <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit Post
          </Button>
          <Button data-testid="button-delete-from-detail" onClick={onDelete} variant="outline" className="border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-300">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export default function ContentPlannerPage() {
  const subAccountId = useActiveSubAccountId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"board" | "calendar">("board");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<ContentPost | null>(null);
  const [detailPost, setDetailPost] = useState<ContentPost | null>(null);

  const { data: posts = [], isLoading } = useQuery<ContentPost[]>({
    queryKey: ["/api/content-planner/posts", subAccountId],
    queryFn: async () => {
      const r = await fetch("/api/content-planner/posts", {
        headers: { "x-sub-account-id": String(subAccountId) },
      });
      if (!r.ok) throw new Error("Failed to load posts");
      return r.json();
    },
    enabled: !!subAccountId,
  });

  const { data: approvals = [] } = useQuery<any[]>({
    queryKey: ["/api/content-planner/approvals", subAccountId],
    queryFn: async () => {
      const r = await fetch("/api/content-planner/approvals", {
        headers: { "x-sub-account-id": String(subAccountId) },
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!subAccountId,
  });

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/content-planner/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sub-account-id": String(subAccountId) },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Create failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-planner/posts"] });
      setComposerOpen(false);
      setEditing(null);
      toast({ title: "Post created" });
    },
    onError: () => toast({ title: "Failed to create post", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`/api/content-planner/posts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-sub-account-id": String(subAccountId) },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-planner/posts"] });
      setComposerOpen(false);
      setEditing(null);
      toast({ title: "Post updated" });
    },
    onError: () => toast({ title: "Failed to update post", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/content-planner/posts/${id}`, {
        method: "DELETE",
        headers: { "x-sub-account-id": String(subAccountId) },
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content-planner/posts"] });
      setDetailPost(null);
      toast({ title: "Post deleted" });
    },
    onError: () => toast({ title: "Failed to delete post", variant: "destructive" }),
  });

  const filtered = posts.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(p.title || "").toLowerCase().includes(q) && !(p.caption || "").toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  const stats: Record<string, number> = {
    scheduled: posts.filter((p) => p.status === "scheduled").length,
    draft: posts.filter((p) => p.status === "draft").length,
    published: posts.filter((p) => p.status === "published").length,
    pendingApproval: approvals.filter((a: any) => !a.decision).length,
  };

  const grouped = {
    draft: filtered.filter((p) => p.status === "draft"),
    scheduled: filtered.filter((p) => p.status === "scheduled"),
    published: filtered.filter((p) => p.status === "published"),
    failed: filtered.filter((p) => p.status === "failed"),
  };

  const handleSave = (data: any) => {
    if (editing) {
      updateMut.mutate({ id: editing.id, data });
    } else {
      createMut.mutate(data);
    }
  };

  const openEdit = (p: ContentPost) => {
    setEditing(p);
    setComposerOpen(true);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))` }}>
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            Content Planner
          </h1>
          <p className="text-slate-200 mt-1 text-sm">Plan, organize, and schedule your brand content across all platforms</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 rounded-xl p-0.5 border border-white/5">
            <button
              data-testid="button-view-board"
              onClick={() => setView("board")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                view === "board" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/60"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
            <button
              data-testid="button-view-calendar"
              onClick={() => setView("calendar")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                view === "calendar" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/60"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
          <Button
            data-testid="button-create-post"
            onClick={() => { setEditing(null); setComposerOpen(true); }}
            className="text-white border-0 shadow-lg glow-box"
            style={{ background: `linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))` }}
          >
            <Plus className="w-4 h-4 mr-2" /> Create Post
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAT_CARDS.map((s, idx) => (
          <motion.div key={s.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + idx * 0.04 }}>
            <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all backdrop-blur-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                  <s.icon className={`w-4.5 h-4.5 ${s.iconColor}`} />
                </div>
                <div>
                  <p className="text-2xl font-black text-white">{stats[s.key] ?? 0}</p>
                  <p className="text-xs text-slate-200 mt-0.5">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <AnimatePresence>
        {composerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }} className="glass border border-white/10 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 glass border-b border-white/5 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #6366f1) 0%, transparent 100%)`, opacity: 0.4 }}>
                    <Sparkles className="w-4 h-4" style={{ color: "var(--vibe-glow, #6366f1)" }} />
                  </div>
                  <h3 className="text-lg font-bold text-white">{editing ? "Edit Post" : "New Post"}</h3>
                </div>
                <button onClick={() => { setComposerOpen(false); setEditing(null); }} className="text-white/30 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <PostComposer
                  initial={editing || undefined}
                  onSave={handleSave}
                  onCancel={() => { setComposerOpen(false); setEditing(null); }}
                  saving={createMut.isPending || updateMut.isPending}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailPost && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-40" onClick={() => setDetailPost(null)} />
            <PostDetailPanel
              post={detailPost}
              onEdit={() => { openEdit(detailPost); setDetailPost(null); }}
              onClose={() => setDetailPost(null)}
              onDelete={() => { if (confirm("Delete this post?")) deleteMut.mutate(detailPost.id); }}
            />
          </>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            data-testid="input-search-posts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts..."
            className="pl-9 bg-white/5 border-white/10 text-white"
          />
        </div>
        <select
          data-testid="select-filter-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white min-w-[130px]"
        >
          <option value="all" className="bg-gray-900">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k} className="bg-gray-900">{v.label}</option>
          ))}
        </select>
      </motion.div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-3">
              <div className="h-5 bg-white/5 rounded w-24 animate-pulse" />
              {[1, 2].map((j) => (
                <Card key={j} className="bg-black/40 border-white/10 animate-pulse">
                  <CardContent className="p-4 space-y-2">
                    <div className="h-4 bg-white/5 rounded w-3/4" />
                    <div className="h-12 bg-white/5 rounded" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-black/40 border-white/10 border-dashed">
            <CardContent className="p-12 md:p-16 text-center">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{
                background: `linear-gradient(to bottom right, color-mix(in srgb, var(--vibe-glow, #6366f1) 15%, transparent), color-mix(in srgb, var(--vibe-accent, #818cf8) 10%, transparent))`,
                border: `1px solid color-mix(in srgb, var(--vibe-glow, #6366f1) 20%, transparent)`,
              }}>
                <CalendarDays className="w-9 h-9 opacity-60" style={{ color: "var(--vibe-glow, #6366f1)" }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Your content workspace is ready</h3>
              <p className="text-sm text-slate-200 mb-8 max-w-md mx-auto leading-relaxed">
                Start planning your social content. Create posts, schedule them, and manage approvals all from one place.
              </p>
              <Button
                data-testid="button-create-first-post"
                onClick={() => { setEditing(null); setComposerOpen(true); }}
                className="text-white border-0 shadow-lg px-8 py-3 text-base"
                style={{ background: `linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))` }}
              >
                <Plus className="w-5 h-5 mr-2" /> Create Your First Post
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : view === "calendar" ? (
        <Card className="bg-black/40 border-white/10 backdrop-blur-sm">
          <CardContent className="p-4 md:p-6">
            <CalendarView posts={filtered} onEdit={(p) => setDetailPost(p)} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(grouped).map(([status, items]) => {
            const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
            const CfgIcon = cfg.icon;
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: cfg.accent }} />
                  <span className="text-sm font-bold text-white/70">{cfg.label}</span>
                  <span className="text-xs text-white/20 ml-auto bg-white/5 px-2 py-0.5 rounded-full">{items.length}</span>
                </div>
                <div className="space-y-3 min-h-[200px]">
                  {items.map((post, pi) => (
                    <motion.div key={post.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.03 }}>
                      <Card
                        className="bg-black/40 border-white/10 hover:border-white/20 transition-all cursor-pointer group"
                        onClick={() => setDetailPost(post)}
                        data-testid={`card-post-${post.id}`}
                      >
                        <CardContent className="p-4 space-y-2.5">
                          <div className="flex items-start justify-between">
                            <h4 className="text-sm font-bold text-white/90 line-clamp-1">{post.title || "Untitled"}</h4>
                            <button
                              data-testid={`button-delete-post-${post.id}`}
                              onClick={(e) => { e.stopPropagation(); if (confirm("Delete?")) deleteMut.mutate(post.id); }}
                              className="md:opacity-0 md:group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all p-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {post.caption && (
                            <p className="text-xs text-white/40 line-clamp-2 leading-relaxed">{post.caption}</p>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            {post.platforms?.map((p) => {
                              const pi = PLATFORM_ICONS[p.platform];
                              if (!pi) return null;
                              const PIc = pi.icon;
                              return <PIc key={p.platform} className={`w-3.5 h-3.5 ${pi.color}`} />;
                            })}
                            {post.scheduledAt && (
                              <span className="text-[10px] text-white/25 ml-auto">
                                {new Date(post.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          {post.media && post.media.length > 0 && (
                            <div className="flex items-center gap-1 text-white/20">
                              <Image className="w-3 h-3" />
                              <span className="text-[10px]">{post.media.length} media</span>
                            </div>
                          )}
                          {post.approvalStatus && post.approvalStatus !== "none" && post.approvalStatus !== "not_required" && (
                            <Badge className={`text-[9px] px-1.5 py-0 h-4 ${
                              post.approvalStatus === "approved" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" :
                              post.approvalStatus === "rejected" ? "bg-red-500/20 text-red-400 border-red-500/20" :
                              "bg-amber-500/20 text-amber-400 border-amber-500/20"
                            }`}>
                              {post.approvalStatus}
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                  {items.length === 0 && (
                    <div className="border border-dashed border-white/5 rounded-xl p-6 text-center">
                      <p className="text-[11px] text-white/15">No {cfg.label.toLowerCase()} posts</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}