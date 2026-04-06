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
  GripVertical, Filter, Globe, MessageCircle, MoreVertical
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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  draft: { label: "Draft", color: "text-gray-400", icon: FileText, bg: "bg-gray-500/15" },
  scheduled: { label: "Scheduled", color: "text-blue-400", icon: Clock, bg: "bg-blue-500/15" },
  published: { label: "Published", color: "text-emerald-400", icon: CheckCircle2, bg: "bg-emerald-500/15" },
  failed: { label: "Failed", color: "text-red-400", icon: AlertTriangle, bg: "bg-red-500/15" },
};

const PLATFORM_ICONS: Record<string, { icon: any; color: string }> = {
  instagram: { icon: Instagram, color: "text-pink-400" },
  facebook: { icon: Facebook, color: "text-blue-400" },
  x: { icon: Globe, color: "text-white/60" },
  tiktok: { icon: Globe, color: "text-cyan-400" },
};

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
    scheduledAt: initial?.scheduledAt ? new Date(initial.scheduledAt).toISOString().slice(0, 16) : "",
    platforms: initial?.platforms?.map((p) => p.platform) || [],
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const togglePlatform = (p: string) => {
    set("platforms", form.platforms.includes(p) ? form.platforms.filter((x) => x !== p) : [...form.platforms, p]);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Post Title</label>
        <Input
          data-testid="input-post-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Campaign title or internal label"
          className="bg-white/5 border-white/10 text-white focus:border-violet-500/50"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Caption</label>
        <Textarea
          data-testid="input-post-caption"
          value={form.caption}
          onChange={(e) => set("caption", e.target.value)}
          placeholder="Write your post content..."
          rows={4}
          className="bg-white/5 border-white/10 text-white resize-none focus:border-violet-500/50"
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
            className="bg-white/5 border-white/10 text-white focus:border-violet-500/50"
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
          className="bg-white/5 border-white/10 text-white focus:border-violet-500/50"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2 block">Platforms</label>
        <div className="flex gap-2">
          {Object.entries(PLATFORM_ICONS).map(([key, { icon: PIcon, color }]) => (
            <button
              key={key}
              data-testid={`button-platform-${key}`}
              onClick={() => togglePlatform(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                form.platforms.includes(key)
                  ? "bg-white/10 border-white/20 text-white"
                  : "bg-white/3 border-white/5 text-white/30 hover:text-white/60"
              }`}
            >
              <PIcon className={`w-3.5 h-3.5 ${form.platforms.includes(key) ? color : ""}`} />
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Call to Action (optional)</label>
        <Input
          data-testid="input-post-cta"
          value={form.callToAction}
          onChange={(e) => set("callToAction", e.target.value)}
          placeholder="Link in bio, Shop now, etc."
          className="bg-white/5 border-white/10 text-white focus:border-violet-500/50"
        />
      </div>
      <div className="flex gap-3 pt-2">
        <Button
          data-testid="button-save-post"
          onClick={() => onSave({
            ...form,
            scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
            platforms: form.platforms.map((p) => ({ platform: p })),
          })}
          disabled={!form.caption || saving}
          className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-0"
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
      <div className="flex items-center justify-between mb-4">
        <button
          data-testid="button-prev-month"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
          className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-semibold text-white">{monthLabel}</h3>
        <button
          data-testid="button-next-month"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
          className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-white/5 rounded-xl overflow-hidden">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-black/60 p-2 text-center text-[10px] font-medium text-white/30 uppercase">{d}</div>
        ))}
        {calendarDays.map((day, i) => (
          <div
            key={i}
            className={`bg-black/40 min-h-[80px] p-1.5 ${day.date === 0 ? "opacity-30" : ""} ${
              isToday(day.date) ? "ring-1 ring-inset ring-cyan-500/40" : ""
            }`}
          >
            {day.date > 0 && (
              <>
                <div className={`text-[11px] font-medium mb-1 ${isToday(day.date) ? "text-cyan-400" : "text-white/40"}`}>{day.date}</div>
                {day.posts.slice(0, 2).map((p) => {
                  const st = STATUS_CONFIG[p.status] || STATUS_CONFIG.draft;
                  return (
                    <button
                      key={p.id}
                      onClick={() => onEdit(p)}
                      className={`w-full text-left text-[9px] px-1 py-0.5 rounded mb-0.5 truncate ${st.bg} ${st.color} hover:brightness-125 transition-all`}
                    >
                      {p.title || p.caption?.slice(0, 20) || "Untitled"}
                    </button>
                  );
                })}
                {day.posts.length > 2 && (
                  <div className="text-[9px] text-white/30 text-center">+{day.posts.length - 2} more</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
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
      toast({ title: "Post deleted" });
    },
  });

  const filtered = posts.filter((p) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(p.title || "").toLowerCase().includes(q) && !(p.caption || "").toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  const stats = {
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
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            Content Planner
          </h1>
          <p className="text-white/40 mt-1 text-sm">Plan, organize, and schedule your brand content across all platforms</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
            <button
              data-testid="button-view-board"
              onClick={() => setView("board")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                view === "board" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
            <button
              data-testid="button-view-calendar"
              onClick={() => setView("calendar")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                view === "calendar" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
          <Button
            data-testid="button-create-post"
            onClick={() => { setEditing(null); setComposerOpen(true); }}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-0 shadow-lg shadow-violet-500/20"
          >
            <Plus className="w-4 h-4 mr-2" /> Create Post
          </Button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Scheduled", value: stats.scheduled, icon: Clock, color: "blue" },
          { label: "Drafts", value: stats.draft, icon: FileText, color: "gray" },
          { label: "Awaiting Approval", value: stats.pendingApproval, icon: Eye, color: "amber" },
          { label: "Published", value: stats.published, icon: CheckCircle2, color: "emerald" },
        ].map((s) => (
          <Card key={s.label} className="bg-black/40 border-white/5 backdrop-blur-sm hover:border-white/10 transition-all">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg bg-${s.color}-500/15 flex items-center justify-center`}>
                <s.icon className={`w-4 h-4 text-${s.color}-400`} />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{s.value}</div>
                <div className="text-[11px] text-white/40">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <AnimatePresence>
        {composerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-gray-900/95 border border-white/10 rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 bg-gray-900/95 border-b border-white/5 px-6 py-4 flex items-center justify-between z-10 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{editing ? "Edit Post" : "New Post"}</h3>
                </div>
                <button onClick={() => { setComposerOpen(false); setEditing(null); }} className="text-white/30 hover:text-white">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-black/30 border-white/5 animate-pulse">
              <CardContent className="p-5 space-y-3">
                <div className="h-4 bg-white/5 rounded w-1/3" />
                <div className="h-20 bg-white/5 rounded" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Card className="bg-black/30 border-white/5 border-dashed">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center mx-auto mb-4">
                <CalendarDays className="w-8 h-8 text-violet-400/50" />
              </div>
              <h3 className="text-lg font-semibold text-white/80 mb-2">Your content workspace is ready</h3>
              <p className="text-sm text-white/40 mb-6 max-w-md mx-auto">
                Start planning your social content. Create posts, schedule them, and manage approvals all from one place.
              </p>
              <Button
                data-testid="button-create-first-post"
                onClick={() => { setEditing(null); setComposerOpen(true); }}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-0"
              >
                <Plus className="w-4 h-4 mr-2" /> Create Your First Post
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : view === "calendar" ? (
        <Card className="bg-black/30 border-white/5">
          <CardContent className="p-4">
            <CalendarView posts={filtered} onEdit={openEdit} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(grouped).map(([status, items]) => {
            const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
            const CfgIcon = cfg.icon;
            return (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3 px-1">
                  <CfgIcon className={`w-4 h-4 ${cfg.color}`} />
                  <span className="text-sm font-medium text-white/60">{cfg.label}</span>
                  <span className="text-xs text-white/20 ml-auto">{items.length}</span>
                </div>
                <div className="space-y-3 min-h-[200px]">
                  {items.map((post) => (
                    <motion.div key={post.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                      <Card
                        className="bg-black/40 border-white/5 hover:border-white/15 transition-all cursor-pointer group"
                        onClick={() => openEdit(post)}
                        data-testid={`card-post-${post.id}`}
                      >
                        <CardContent className="p-4 space-y-2.5">
                          <div className="flex items-start justify-between">
                            <h4 className="text-sm font-medium text-white/90 line-clamp-1">{post.title || "Untitled"}</h4>
                            <button
                              data-testid={`button-delete-post-${post.id}`}
                              onClick={(e) => { e.stopPropagation(); deleteMut.mutate(post.id); }}
                              className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all p-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {post.caption && (
                            <p className="text-xs text-white/40 line-clamp-2">{post.caption}</p>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            {post.platforms?.map((p) => {
                              const pi = PLATFORM_ICONS[p.platform];
                              if (!pi) return null;
                              const PIc = pi.icon;
                              return <PIc key={p.platform} className={`w-3.5 h-3.5 ${pi.color}`} />;
                            })}
                            {post.scheduledAt && (
                              <span className="text-[10px] text-white/30 ml-auto">
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
                          {post.approvalStatus && post.approvalStatus !== "none" && (
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
                    <div className="border border-dashed border-white/5 rounded-lg p-6 text-center">
                      <p className="text-[11px] text-white/20">No {cfg.label.toLowerCase()} posts</p>
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