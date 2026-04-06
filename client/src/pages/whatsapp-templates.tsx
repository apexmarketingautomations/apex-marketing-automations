import { useState } from "react";
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
  MessageSquare, Plus, Search, Copy, Trash2, Edit3, Eye,
  FileText, CheckCircle2, Clock, AlertTriangle, X,
  Hash, Send, Sparkles, Archive
} from "lucide-react";

interface WhatsAppTemplate {
  id: number;
  subAccountId: number;
  name: string;
  category: string;
  language: string;
  headerType?: string;
  headerContent?: string;
  body: string;
  footerText?: string;
  buttons?: any;
  variables?: string[];
  status: string;
  twilioTemplateSid?: string;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Draft", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Clock },
  active: { label: "Active", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  approved: { label: "Approved", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  pending: { label: "Pending", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Clock },
  rejected: { label: "Rejected", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: AlertTriangle },
  archived: { label: "Archived", color: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: Archive },
};

const CATEGORY_OPTIONS = ["marketing", "utility", "authentication", "service"];

const STAT_CARDS = [
  { key: "total", label: "Total", icon: FileText, bg: "bg-cyan-500/15", iconColor: "text-cyan-400" },
  { key: "active", label: "Active", icon: CheckCircle2, bg: "bg-emerald-500/15", iconColor: "text-emerald-400" },
  { key: "draft", label: "Drafts", icon: Clock, bg: "bg-amber-500/15", iconColor: "text-amber-400" },
  { key: "pending", label: "Pending", icon: Send, bg: "bg-blue-500/15", iconColor: "text-blue-400" },
];

function PhonePreview({ template }: { template: Partial<WhatsAppTemplate> }) {
  const bodyWithVars = (template.body || "").replace(/\{\{(\d+)\}\}/g, (_, i) =>
    template.variables?.[parseInt(i) - 1] || `{{${i}}}`
  );
  return (
    <div className="flex justify-center">
      <div className="w-[260px] rounded-[28px] border-2 border-white/10 bg-gradient-to-b from-gray-900 to-black p-2 shadow-2xl shadow-black/50">
        <div className="rounded-[22px] bg-[#0b141a] overflow-hidden">
          <div className="bg-[#1f2c34] px-3 py-2 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-emerald-500/30 flex items-center justify-center">
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="text-[11px] font-medium text-white/90">WhatsApp Business</div>
              <div className="text-[9px] text-white/40">Template Preview</div>
            </div>
          </div>
          <div className="p-3 min-h-[200px] relative">
            <div className="absolute inset-0 opacity-5" style={{
              backgroundImage: "radial-gradient(circle at 20px 20px, white 1px, transparent 1px)",
              backgroundSize: "30px 30px"
            }} />
            {template.headerContent && (
              <div className="text-[10px] font-bold text-white/90 mb-1 relative z-10">{template.headerContent}</div>
            )}
            <div className="bg-[#005c4b] rounded-lg rounded-tl-none p-2.5 max-w-[220px] shadow-sm relative z-10">
              <p className="text-[11px] text-white/95 leading-relaxed whitespace-pre-wrap">
                {bodyWithVars || "Your message content will appear here..."}
              </p>
              {template.footerText && (
                <p className="text-[9px] text-white/50 mt-1.5">{template.footerText}</p>
              )}
              <div className="text-right mt-1">
                <span className="text-[8px] text-white/30">12:00 PM ✓✓</span>
              </div>
            </div>
            {template.buttons && Array.isArray(template.buttons) && template.buttons.length > 0 && (
              <div className="mt-1.5 space-y-1 max-w-[220px] relative z-10">
                {template.buttons.map((btn: any, i: number) => (
                  <div key={i} className="bg-[#005c4b]/60 rounded-md p-1.5 text-center">
                    <span className="text-[10px] text-cyan-300">{btn.text || btn.label || `Button ${i + 1}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateEditor({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<WhatsAppTemplate>;
  onSave: (data: any) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    category: initial?.category || "marketing",
    language: initial?.language || "en",
    headerType: initial?.headerType || "",
    headerContent: initial?.headerContent || "",
    body: initial?.body || "",
    footerText: initial?.footerText || "",
    variables: initial?.variables || [],
    status: initial?.status || "draft",
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));
  const varCount = (form.body.match(/\{\{\d+\}\}/g) || []).length;
  const charCount = form.body.length;
  const MAX_CHARS = 1024;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Template Name</label>
          <Input
            data-testid="input-template-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. welcome_message"
            className="bg-white/5 border-white/10 focus:border-[color:var(--vibe-glow,#06b6d4)]/50 text-white"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Category</label>
            <select
              data-testid="select-template-category"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
              className="w-full h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c} className="bg-gray-900">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Status</label>
            <select
              data-testid="select-template-status"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white"
            >
              {Object.entries(STATUS_MAP).map(([k, v]) => (
                <option key={k} value={k} className="bg-gray-900">{v.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Header (optional)</label>
          <Input
            data-testid="input-template-header"
            value={form.headerContent}
            onChange={(e) => set("headerContent", e.target.value)}
            placeholder="Header text or media URL"
            className="bg-white/5 border-white/10 focus:border-[color:var(--vibe-glow,#06b6d4)]/50 text-white"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Message Body</label>
            <div className="flex items-center gap-3">
              {varCount > 0 && (
                <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                  <Hash className="w-3 h-3" /> {varCount} variable{varCount > 1 ? "s" : ""}
                </span>
              )}
              <span className={`text-[10px] ${charCount > MAX_CHARS ? "text-red-400" : "text-white/30"}`}>
                {charCount}/{MAX_CHARS}
              </span>
            </div>
          </div>
          <Textarea
            data-testid="input-template-body"
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
            placeholder="Hello {{1}}, your order {{2}} is ready for pickup."
            rows={5}
            className="bg-white/5 border-white/10 focus:border-[color:var(--vibe-glow,#06b6d4)]/50 text-white resize-none"
          />
          <p className="text-[10px] text-white/30 mt-1">Use {"{{1}}"}, {"{{2}}"} etc. for dynamic variables</p>
        </div>
        <div>
          <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-1.5 block">Footer (optional)</label>
          <Input
            data-testid="input-template-footer"
            value={form.footerText}
            onChange={(e) => set("footerText", e.target.value)}
            placeholder="Reply STOP to unsubscribe"
            className="bg-white/5 border-white/10 focus:border-[color:var(--vibe-glow,#06b6d4)]/50 text-white"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <Button
            data-testid="button-save-template"
            onClick={() => onSave(form)}
            disabled={!form.name || !form.body || saving || charCount > MAX_CHARS}
            className="flex-1 text-white border-0 shadow-lg"
            style={{ background: `linear-gradient(to right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
          >
            {saving ? "Saving..." : initial?.name ? "Update Template" : "Create Template"}
          </Button>
          <Button
            data-testid="button-cancel-template"
            onClick={onCancel}
            variant="outline"
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5"
          >
            Cancel
          </Button>
        </div>
      </div>
      <div className="hidden lg:block">
        <label className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3 block">Live Preview</label>
        <PhonePreview template={form} />
      </div>
    </div>
  );
}

export default function WhatsAppTemplatesPage() {
  const subAccountId = useActiveSubAccountId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<WhatsAppTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery<WhatsAppTemplate[]>({
    queryKey: ["/api/whatsapp-templates", subAccountId],
    queryFn: async () => {
      const r = await fetch(`/api/whatsapp-templates/${subAccountId}`);
      if (!r.ok) throw new Error("Failed to load templates");
      return r.json();
    },
    enabled: !!subAccountId,
  });

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`/api/whatsapp-templates/${subAccountId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Create failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp-templates"] });
      setEditorOpen(false);
      setEditing(null);
      toast({ title: "Template created", description: "Your WhatsApp template is ready." });
    },
    onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`/api/whatsapp-templates/${subAccountId}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp-templates"] });
      setEditorOpen(false);
      setEditing(null);
      toast({ title: "Template updated" });
    },
    onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/whatsapp-templates/${subAccountId}/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: () => toast({ title: "Failed to delete template", variant: "destructive" }),
  });

  const filtered = templates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.body.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    return true;
  });

  const stats: Record<string, number> = {
    total: templates.length,
    active: templates.filter((t) => t.status === "active" || t.status === "approved").length,
    draft: templates.filter((t) => t.status === "draft").length,
    pending: templates.filter((t) => t.status === "pending").length,
  };

  const handleSave = (data: any) => {
    if (editing) {
      updateMut.mutate({ id: editing.id, data });
    } else {
      createMut.mutate(data);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}>
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <span>WhatsApp Templates</span>
          </h1>
          <p className="text-slate-200 mt-1 text-sm">Manage reusable message templates for WhatsApp Business campaigns</p>
        </div>
        <Button
          data-testid="button-create-template"
          onClick={() => { setEditing(null); setEditorOpen(true); }}
          className="text-white border-0 shadow-lg glow-box"
          style={{ background: `linear-gradient(to right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
        >
          <Plus className="w-4 h-4 mr-2" /> Create Template
        </Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STAT_CARDS.map((s, idx) => (
          <motion.div key={s.key} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + idx * 0.04 }}>
            <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all backdrop-blur-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
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
        {editorOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="glass border-white/10 overflow-hidden">
              <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(to bottom right, var(--vibe-glow, #06b6d4) 0%, transparent 100%)`, opacity: 0.3 }}>
                    <Sparkles className="w-4 h-4" style={{ color: "var(--vibe-glow, #06b6d4)" }} />
                  </div>
                  <h3 className="text-lg font-bold text-white">{editing ? "Edit Template" : "New Template"}</h3>
                </div>
                <button onClick={() => { setEditorOpen(false); setEditing(null); }} className="text-white/30 hover:text-white/60 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <CardContent className="p-6">
                <TemplateEditor
                  initial={editing || undefined}
                  onSave={handleSave}
                  onCancel={() => { setEditorOpen(false); setEditing(null); }}
                  saving={createMut.isPending || updateMut.isPending}
                />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            data-testid="input-search-templates"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
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
          {Object.entries(STATUS_MAP).map(([k, v]) => (
            <option key={k} value={k} className="bg-gray-900">{v.label}</option>
          ))}
        </select>
        <select
          data-testid="select-filter-category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white min-w-[130px]"
        >
          <option value="all" className="bg-gray-900">All Categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c} className="bg-gray-900">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </motion.div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-black/40 border-white/10">
              <CardContent className="p-5 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-5 bg-white/5 rounded w-3/4" />
                  <div className="h-5 bg-white/5 rounded w-16" />
                </div>
                <div className="h-20 bg-white/5 rounded-lg" />
                <div className="flex gap-2">
                  <div className="h-6 bg-white/5 rounded w-16" />
                  <div className="h-6 bg-white/5 rounded w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="bg-black/40 border-white/10 border-dashed">
            <CardContent className="p-12 md:p-16 text-center">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{
                background: `linear-gradient(to bottom right, color-mix(in srgb, var(--vibe-glow, #06b6d4) 15%, transparent), color-mix(in srgb, var(--vibe-accent, #4f46e5) 10%, transparent))`,
                border: `1px solid color-mix(in srgb, var(--vibe-glow, #06b6d4) 20%, transparent)`,
              }}>
                <MessageSquare className="w-9 h-9 opacity-60" style={{ color: "var(--vibe-glow, #06b6d4)" }} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                {search || statusFilter !== "all" ? "No templates match your filters" : "No templates yet"}
              </h3>
              <p className="text-sm text-slate-200 mb-8 max-w-md mx-auto leading-relaxed">
                {search || statusFilter !== "all"
                  ? "Try adjusting your search or filters to find what you're looking for."
                  : "Create your first WhatsApp message template to start engaging contacts with pre-approved, reusable messages."}
              </p>
              {!search && statusFilter === "all" && (
                <Button
                  data-testid="button-create-first-template"
                  onClick={() => { setEditing(null); setEditorOpen(true); }}
                  className="text-white border-0 shadow-lg px-8 py-3 text-base"
                  style={{ background: `linear-gradient(to right, var(--vibe-glow, #06b6d4), var(--vibe-accent, #4f46e5))` }}
                >
                  <Plus className="w-5 h-5 mr-2" /> Create Your First Template
                </Button>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const st = STATUS_MAP[t.status] || STATUS_MAP.draft;
            const StIcon = st.icon;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Card className="bg-black/40 border-white/10 hover:border-white/20 transition-all group cursor-pointer h-full" data-testid={`card-template-${t.id}`}>
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{t.name}</h3>
                        <p className="text-[11px] text-slate-200 mt-0.5">{t.category} · {t.language}</p>
                      </div>
                      <Badge className={`${st.color} border text-[10px] px-1.5 py-0 h-5 flex items-center gap-1 shrink-0 ml-2`}>
                        <StIcon className="w-2.5 h-2.5" /> {st.label}
                      </Badge>
                    </div>
                    <div className="flex-1 bg-white/[0.03] rounded-lg p-3 mb-3 border border-white/5">
                      <p className="text-xs text-white/60 line-clamp-4 leading-relaxed">{t.body}</p>
                    </div>
                    {t.variables && t.variables.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-3">
                        <Hash className="w-3 h-3" style={{ color: "var(--vibe-glow, #06b6d4)" }} />
                        <span className="text-[10px] text-white/30">{t.variables.length} variable{t.variables.length > 1 ? "s" : ""}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 pt-2 border-t border-white/5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <Button
                        data-testid={`button-edit-template-${t.id}`}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px] text-white/50 hover:text-white hover:bg-white/10"
                        onClick={() => { setEditing(t); setEditorOpen(true); }}
                      >
                        <Edit3 className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button
                        data-testid={`button-preview-template-${t.id}`}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px] text-white/50 hover:text-white hover:bg-white/10"
                        onClick={() => setPreviewTemplate(t)}
                      >
                        <Eye className="w-3 h-3 mr-1" /> Preview
                      </Button>
                      <Button
                        data-testid={`button-duplicate-template-${t.id}`}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px] text-white/50 hover:text-white hover:bg-white/10"
                        onClick={() => {
                          createMut.mutate({ name: `${t.name}_copy`, category: t.category, language: t.language, body: t.body, footerText: t.footerText, headerContent: t.headerContent, variables: t.variables, status: "draft" });
                        }}
                      >
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      <Button
                        data-testid={`button-delete-template-${t.id}`}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 ml-auto"
                        onClick={() => { if (confirm("Delete this template?")) deleteMut.mutate(t.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {previewTemplate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
            onClick={() => setPreviewTemplate(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white">{previewTemplate.name}</h3>
                <button onClick={() => setPreviewTemplate(null)} className="text-white/30 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <PhonePreview template={previewTemplate} />
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  data-testid="button-edit-from-preview"
                  size="sm"
                  variant="outline"
                  className="border-white/10 text-white/60 hover:text-white hover:bg-white/10"
                  onClick={() => { setEditing(previewTemplate); setEditorOpen(true); setPreviewTemplate(null); }}
                >
                  <Edit3 className="w-3 h-3 mr-1.5" /> Edit
                </Button>
                <Button size="sm" onClick={() => setPreviewTemplate(null)} className="bg-white/10 text-white hover:bg-white/15 border-0">
                  Close
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}