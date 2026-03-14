import { useState, useEffect, useCallback } from "react";
import {
  FlaskConical,
  Plus,
  TrendingUp,
  TrendingDown,
  Trophy,
  Loader2,
  Trash2,
  StopCircle,
  BarChart3,
  Eye,
  MousePointerClick,
  Target,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  Globe,
  MessageSquare,
  Megaphone,
  Percent,
  Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ExperimentStats {
  rateA: number;
  rateB: number;
  improvement: number;
  confidence: number;
  significant: boolean;
  winner: "A" | "B" | null;
}

interface Experiment {
  id: number;
  name: string;
  description: string | null;
  contentType: string;
  contentId: number | null;
  status: string;
  variantA: any;
  variantB: any;
  trafficSplit: number;
  metric: string;
  impressionsA: number;
  impressionsB: number;
  conversionsA: number;
  conversionsB: number;
  winnerVariant: string | null;
  confidenceLevel: number;
  autoPromote: boolean;
  minSampleSize: number;
  createdAt: string;
  completedAt: string | null;
  stats: ExperimentStats;
}

const CONTENT_TYPE_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  landing_page: { label: "Landing Page", icon: Globe, color: "text-blue-400" },
  sms_template: { label: "SMS Template", icon: MessageSquare, color: "text-green-400" },
  ad_copy: { label: "Ad Copy", icon: Megaphone, color: "text-orange-400" },
  email: { label: "Email", icon: MessageSquare, color: "text-purple-400" },
};

function ConfidenceBadge({ confidence, significant }: { confidence: number; significant: boolean }) {
  const color = significant
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : confidence >= 80
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
      : "bg-neutral-500/20 text-neutral-400 border-neutral-500/30";

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`} data-testid="badge-confidence">
      {confidence}% confidence
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    draft: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] || styles.draft}`} data-testid="badge-status">
      {status === "running" && <Activity size={10} className="inline mr-1 animate-pulse" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function VariantBar({ label, impressions, conversions, rate, isWinner, color }: {
  label: string; impressions: number; conversions: number; rate: number; isWinner: boolean; color: string;
}) {
  const maxRate = 100;
  const barWidth = Math.max(2, (rate / maxRate) * 100);

  return (
    <div className={`p-4 rounded-xl border ${isWinner ? "border-green-500/40 bg-green-500/5" : "border-white/10 bg-white/5"}`} data-testid={`variant-bar-${label}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${color}`}>Variant {label}</span>
          {isWinner && (
            <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Trophy size={10} /> Winner
            </span>
          )}
        </div>
        <span className="text-lg font-bold text-white">{rate.toFixed(2)}%</span>
      </div>
      <div className="h-3 bg-white/5 rounded-full overflow-hidden mb-3">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${barWidth}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${isWinner ? "bg-green-500" : color === "text-cyan-400" ? "bg-cyan-500" : "bg-indigo-500"}`}
        />
      </div>
      <div className="flex gap-4 text-xs text-neutral-400">
        <span className="flex items-center gap-1"><Eye size={12} /> {impressions.toLocaleString()} impressions</span>
        <span className="flex items-center gap-1"><MousePointerClick size={12} /> {conversions.toLocaleString()} conversions</span>
      </div>
    </div>
  );
}

function ExperimentCard({ experiment, onDelete, onStop, onRefresh }: {
  experiment: Experiment; onDelete: (id: number) => void; onStop: (id: number) => void; onRefresh: () => void;
}) {
  const { stats } = experiment;
  const contentMeta = CONTENT_TYPE_LABELS[experiment.contentType] || { label: experiment.contentType, icon: Target, color: "text-neutral-400" };
  const ContentIcon = contentMeta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-neutral-900 border border-white/10 rounded-2xl p-6 space-y-4"
      data-testid={`card-experiment-${experiment.id}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ContentIcon size={16} className={contentMeta.color} />
            <span className="text-xs text-neutral-500 uppercase tracking-wider">{contentMeta.label}</span>
          </div>
          <h3 className="text-lg font-bold text-white" data-testid={`text-experiment-name-${experiment.id}`}>{experiment.name}</h3>
          {experiment.description && <p className="text-sm text-neutral-400 mt-1">{experiment.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={experiment.status} />
          <ConfidenceBadge confidence={stats.confidence} significant={stats.significant} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VariantBar
          label="A"
          impressions={experiment.impressionsA}
          conversions={experiment.conversionsA}
          rate={stats.rateA}
          isWinner={experiment.winnerVariant === "A"}
          color="text-cyan-400"
        />
        <VariantBar
          label="B"
          impressions={experiment.impressionsB}
          conversions={experiment.conversionsB}
          rate={stats.rateB}
          isWinner={experiment.winnerVariant === "B"}
          color="text-indigo-400"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Percent size={12} /> {experiment.trafficSplit}/{100 - experiment.trafficSplit} split
          </span>
          <span className="flex items-center gap-1">
            <Target size={12} /> {experiment.metric.replace(/_/g, " ")}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={12} /> {new Date(experiment.createdAt).toLocaleDateString()}
          </span>
          {stats.improvement !== 0 && (
            <span className={`flex items-center gap-1 ${stats.improvement > 0 ? "text-green-400" : "text-red-400"}`}>
              {stats.improvement > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {stats.improvement > 0 ? "+" : ""}{stats.improvement.toFixed(1)}% B vs A
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {experiment.status === "running" && (
            <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5 text-xs" onClick={() => onStop(experiment.id)} data-testid={`button-stop-${experiment.id}`}>
              <StopCircle size={12} className="mr-1" /> Stop
            </Button>
          )}
          <Button variant="outline" size="sm" className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs" onClick={() => onDelete(experiment.id)} data-testid={`button-delete-${experiment.id}`}>
            <Trash2 size={12} className="mr-1" /> Delete
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function CreateExperimentModal({ onClose, onCreated, defaultContentType, defaultContentId, defaultName }: { onClose: () => void; onCreated: () => void; defaultContentType?: string; defaultContentId?: string; defaultName?: string }) {
  const [name, setName] = useState(defaultName ? `A/B Test: ${defaultName}` : "");
  const [description, setDescription] = useState("");
  const [contentType, setContentType] = useState(defaultContentType || "landing_page");
  const [contentId, setContentId] = useState(defaultContentId || "");
  const [trafficSplit, setTrafficSplit] = useState(50);
  const [metric, setMetric] = useState("conversion_rate");
  const [minSampleSize, setMinSampleSize] = useState(100);
  const [variantALabel, setVariantALabel] = useState("Original");
  const [variantBLabel, setVariantBLabel] = useState("Variant B");
  const [variantADesc, setVariantADesc] = useState("");
  const [variantBDesc, setVariantBDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/ab-experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          contentType,
          contentId: contentId ? parseInt(contentId) : null,
          variantA: { label: variantALabel, description: variantADesc },
          variantB: { label: variantBLabel, description: variantBDesc },
          trafficSplit,
          metric,
          minSampleSize,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Experiment Created", description: `"${name}" is now running.` });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        className="bg-neutral-900 border border-white/10 rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="modal-create-experiment"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FlaskConical size={20} className="text-cyan-400" /> New A/B Test
          </h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" data-testid="button-close-modal">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-400 block mb-1">Test Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Homepage Hero CTA Test" className="bg-white/5 border-white/10" data-testid="input-experiment-name" />
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What are you testing?" className="bg-white/5 border-white/10" data-testid="input-experiment-desc" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Content Type</label>
              <select value={contentType} onChange={e => setContentType(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white" data-testid="select-content-type">
                <option value="landing_page">Landing Page</option>
                <option value="sms_template">SMS Template</option>
                <option value="ad_copy">Ad Copy</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Content ID (optional)</label>
              <Input value={contentId} onChange={e => setContentId(e.target.value)} placeholder="e.g., 5" className="bg-white/5 border-white/10" data-testid="input-content-id" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Traffic Split (% to A)</label>
              <Input type="number" min={10} max={90} value={trafficSplit} onChange={e => setTrafficSplit(parseInt(e.target.value) || 50)} className="bg-white/5 border-white/10" data-testid="input-traffic-split" />
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">Min Sample Size</label>
              <Input type="number" min={20} value={minSampleSize} onChange={e => setMinSampleSize(parseInt(e.target.value) || 100)} className="bg-white/5 border-white/10" data-testid="input-min-sample" />
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-400 block mb-1">Success Metric</label>
            <select value={metric} onChange={e => setMetric(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white" data-testid="select-metric">
              <option value="conversion_rate">Conversion Rate</option>
              <option value="click_through_rate">Click-Through Rate</option>
              <option value="engagement_rate">Engagement Rate</option>
              <option value="reply_rate">Reply Rate</option>
            </select>
          </div>

          <div className="border-t border-white/10 pt-3">
            <p className="text-xs text-neutral-400 mb-2 uppercase tracking-wider">Variant A (Control)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={variantALabel} onChange={e => setVariantALabel(e.target.value)} placeholder="Label" className="bg-white/5 border-white/10" data-testid="input-variant-a-label" />
              <Input value={variantADesc} onChange={e => setVariantADesc(e.target.value)} placeholder="Description" className="bg-white/5 border-white/10" data-testid="input-variant-a-desc" />
            </div>
          </div>
          <div>
            <p className="text-xs text-neutral-400 mb-2 uppercase tracking-wider">Variant B (Challenger)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input value={variantBLabel} onChange={e => setVariantBLabel(e.target.value)} placeholder="Label" className="bg-white/5 border-white/10" data-testid="input-variant-b-label" />
              <Input value={variantBDesc} onChange={e => setVariantBDesc(e.target.value)} placeholder="Description" className="bg-white/5 border-white/10" data-testid="input-variant-b-desc" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="border-white/10" data-testid="button-cancel-create">Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-create-experiment">
            {creating ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
            Create Test
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function useQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    contentType: params.get("contentType") || undefined,
    contentId: params.get("contentId") || undefined,
    name: params.get("name") || undefined,
  };
}

export default function ABTestingDashboard() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | "running" | "completed">("all");
  const { toast } = useToast();
  const queryParams = useQueryParams();
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    if (queryParams.contentType && !autoOpened) {
      setAutoOpened(true);
      setShowCreate(true);
    }
  }, [queryParams.contentType, autoOpened]);

  const fetchExperiments = useCallback(async () => {
    try {
      const res = await fetch("/api/ab-experiments");
      if (res.ok) {
        const data = await res.json();
        setExperiments(data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
    const interval = setInterval(fetchExperiments, 15000);
    return () => clearInterval(interval);
  }, [fetchExperiments]);

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/ab-experiments/${id}`, { method: "DELETE" });
      toast({ title: "Experiment Deleted" });
      fetchExperiments();
    } catch {
      toast({ title: "Delete Failed", variant: "destructive" });
    }
  };

  const handleStop = async (id: number) => {
    try {
      await fetch(`/api/ab-experiments/${id}/stop`, { method: "POST" });
      toast({ title: "Experiment Stopped" });
      fetchExperiments();
    } catch {
      toast({ title: "Stop Failed", variant: "destructive" });
    }
  };

  const filtered = experiments.filter(e => {
    if (filter === "running") return e.status === "running";
    if (filter === "completed") return e.status === "completed";
    return true;
  });

  const runningCount = experiments.filter(e => e.status === "running").length;
  const completedCount = experiments.filter(e => e.status === "completed").length;
  const totalImpressions = experiments.reduce((s, e) => s + (e.impressionsA || 0) + (e.impressionsB || 0), 0);
  const totalConversions = experiments.reduce((s, e) => s + (e.conversionsA || 0) + (e.conversionsB || 0), 0);

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <FlaskConical className="text-cyan-400" size={28} />
              A/B Testing
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              Create experiments, split traffic, and automatically promote winners.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-new-experiment">
            <Plus size={16} className="mr-2" /> New Test
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-neutral-900 border border-white/10 rounded-xl p-4 text-center">
            <Activity size={20} className="mx-auto mb-2 text-cyan-400" />
            <p className="text-xl font-bold" data-testid="stat-running">{runningCount}</p>
            <p className="text-xs text-neutral-400">Running</p>
          </div>
          <div className="bg-neutral-900 border border-white/10 rounded-xl p-4 text-center">
            <CheckCircle2 size={20} className="mx-auto mb-2 text-green-400" />
            <p className="text-xl font-bold" data-testid="stat-completed">{completedCount}</p>
            <p className="text-xs text-neutral-400">Completed</p>
          </div>
          <div className="bg-neutral-900 border border-white/10 rounded-xl p-4 text-center">
            <Eye size={20} className="mx-auto mb-2 text-indigo-400" />
            <p className="text-xl font-bold" data-testid="stat-impressions">{totalImpressions.toLocaleString()}</p>
            <p className="text-xs text-neutral-400">Total Impressions</p>
          </div>
          <div className="bg-neutral-900 border border-white/10 rounded-xl p-4 text-center">
            <MousePointerClick size={20} className="mx-auto mb-2 text-orange-400" />
            <p className="text-xl font-bold" data-testid="stat-conversions">{totalConversions.toLocaleString()}</p>
            <p className="text-xs text-neutral-400">Total Conversions</p>
          </div>
        </div>

        <div className="flex gap-2">
          {(["all", "running", "completed"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === f
                  ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                  : "bg-white/5 text-neutral-400 border-white/10 hover:bg-white/10"
              }`}
              data-testid={`filter-${f}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} {f === "all" ? `(${experiments.length})` : f === "running" ? `(${runningCount})` : `(${completedCount})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
            <FlaskConical size={48} className="mx-auto mb-4 text-neutral-600" />
            <h3 className="text-lg font-bold text-neutral-400 mb-2">No experiments yet</h3>
            <p className="text-sm text-neutral-500 mb-6">
              Create your first A/B test to start optimizing your content.
            </p>
            <Button onClick={() => setShowCreate(true)} className="bg-cyan-600 hover:bg-cyan-700" data-testid="button-create-first">
              <Plus size={16} className="mr-2" /> Create First Test
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(exp => (
              <ExperimentCard
                key={exp.id}
                experiment={exp}
                onDelete={handleDelete}
                onStop={handleStop}
                onRefresh={fetchExperiments}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateExperimentModal
            onClose={() => setShowCreate(false)}
            onCreated={fetchExperiments}
            defaultContentType={queryParams.contentType}
            defaultContentId={queryParams.contentId}
            defaultName={queryParams.name}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
