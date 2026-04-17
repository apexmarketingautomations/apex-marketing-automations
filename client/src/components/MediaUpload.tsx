import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, X, Film, Loader2, CheckCircle2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface UploadedMediaItem {
  originalName: string;
  filename: string;
  fileUrl: string;
  fileType: string;
  size: number;
  mime: string;
  mediaId?: number;
}

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
  status: "pending" | "uploading" | "done" | "error";
  errorMessage?: string;
}

interface MediaUploadProps {
  subAccountId?: number;
  postId?: number;
  value?: UploadedMediaItem[];
  onChange?: (items: UploadedMediaItem[]) => void;
  onUploaded?: (items: UploadedMediaItem[]) => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MediaUpload({ subAccountId, postId, value, onChange, onUploaded }: MediaUploadProps) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [uploaded, setUploadedInternal] = useState<UploadedMediaItem[]>(value || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const isControlled = value !== undefined;
  const items = isControlled ? value! : uploaded;

  const updateItems = useCallback((next: UploadedMediaItem[]) => {
    if (!isControlled) setUploadedInternal(next);
    onChange?.(next);
  }, [isControlled, onChange]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
    objectUrlsRef.current.clear();
  }, []);

  function addFiles(chosen: File[]) {
    const accepted: PendingFile[] = [];
    let firstErr: string | null = null;
    for (const f of chosen) {
      if (f.size > MAX_FILE_SIZE) {
        firstErr = firstErr || `"${f.name}" exceeds 50MB`;
        continue;
      }
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
        firstErr = firstErr || `"${f.name}" is not a supported image or video`;
        continue;
      }
      const url = URL.createObjectURL(f);
      objectUrlsRef.current.add(url);
      accepted.push({
        id: makeId(),
        file: f,
        previewUrl: url,
        isVideo: f.type.startsWith("video/"),
        status: "pending",
      });
    }
    if (accepted.length) setPending(p => [...p, ...accepted]);
    setError(firstErr);
  }

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files ? Array.from(e.target.files) : [];
    addFiles(chosen);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function removePending(id: string) {
    setPending(prev => {
      const target = prev.find(p => p.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter(p => p.id !== id);
    });
  }

  function removeUploaded(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    updateItems(next);
  }

  async function uploadAll() {
    if (!pending.length) return;
    setUploading(true);
    setError(null);
    setPending(prev => prev.map(p => ({ ...p, status: "uploading" as const })));
    try {
      const fd = new FormData();
      pending.forEach(p => fd.append("files", p.file));
      if (subAccountId) fd.append("sub_account_id", String(subAccountId));
      if (postId) fd.append("post_id", String(postId));
      const res = await fetch("/api/media/upload", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error || `Upload failed (${res.status})`;
        const stage = json?.stage ? ` [${json.stage}]` : "";
        throw new Error(`${msg}${stage}`);
      }
      const newItems: UploadedMediaItem[] = json?.uploaded || [];
      pending.forEach(p => {
        URL.revokeObjectURL(p.previewUrl);
        objectUrlsRef.current.delete(p.previewUrl);
      });
      setPending([]);
      const merged = [...items, ...newItems];
      updateItems(merged);
      onUploaded?.(newItems);
      if (json?.errors?.length) {
        setError(`${newItems.length} uploaded, ${json.errors.length} failed`);
      }
    } catch (err: any) {
      setPending(prev => prev.map(p => ({ ...p, status: "error" as const, errorMessage: err.message })));
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function clearPending() {
    pending.forEach(p => {
      URL.revokeObjectURL(p.previewUrl);
      objectUrlsRef.current.delete(p.previewUrl);
    });
    setPending([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-white/40" />
          <span className="text-xs font-medium text-white/60 uppercase tracking-wider">Media</span>
        </div>
        {items.length > 0 && (
          <span className="text-[10px] text-white/40">{items.length} attached</span>
        )}
      </div>

      <div
        data-testid="media-upload-dropzone"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-[color:var(--vibe-glow,#6366f1)]/60 bg-[color:var(--vibe-glow,#6366f1)]/5"
            : "border-white/10 hover:border-white/20 bg-white/[0.02]"
        }`}
      >
        <Upload className="w-6 h-6 mx-auto mb-2 text-white/30" />
        <p className="text-xs text-white/50">Drag & drop or click to choose</p>
        <p className="text-[10px] text-white/30 mt-1">Images and videos, up to 50MB each</p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={onSelect}
          className="hidden"
          data-testid="input-media-files"
        />
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Ready to upload</div>
          <div className="grid grid-cols-3 gap-2">
            {pending.map((p, i) => (
              <div
                key={p.id}
                data-testid={`media-pending-${i}`}
                className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-black/40 group"
              >
                {p.isVideo ? (
                  <video
                    src={p.previewUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <img src={p.previewUrl} alt={p.file.name} className="w-full h-full object-cover" />
                )}
                {p.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
                {p.status === "error" && (
                  <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-200" />
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removePending(p.id); }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white/80 hover:bg-red-500/80 hover:text-white flex items-center justify-center transition-colors"
                  data-testid={`button-remove-pending-${i}`}
                  aria-label="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center gap-1">
                    {p.isVideo && <Film className="w-2.5 h-2.5 text-cyan-300" />}
                    <span className="text-[9px] text-white/70 truncate">{p.file.name}</span>
                  </div>
                  <div className="text-[8px] text-white/40">{(p.file.size / 1024).toFixed(0)} KB</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              data-testid="button-upload-media"
              onClick={uploadAll}
              disabled={uploading || !pending.length}
              className="flex-1 text-white text-xs border-0"
              style={{ background: "linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))" }}
            >
              {uploading ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading...</>
              ) : (
                <><Upload className="w-3.5 h-3.5 mr-1.5" /> Upload {pending.length} file{pending.length > 1 ? "s" : ""}</>
              )}
            </Button>
            <Button
              data-testid="button-clear-media"
              onClick={clearPending}
              variant="outline"
              className="border-white/10 text-white/40 hover:text-white/60 text-xs"
              disabled={uploading}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Attached to post</div>
          <div className="grid grid-cols-3 gap-2">
            {items.map((item, i) => (
              <div
                key={`${item.filename}-${i}`}
                data-testid={`media-attached-${i}`}
                className="relative aspect-square rounded-lg overflow-hidden border border-emerald-500/20 bg-black/40 group"
              >
                {item.fileType === "video" ? (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-900/30 to-black">
                    <Film className="w-6 h-6 text-cyan-300/70" />
                  </div>
                ) : (
                  <img
                    src={item.fileUrl}
                    alt={item.originalName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeUploaded(i); }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white/80 hover:bg-red-500/80 hover:text-white flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                  data-testid={`button-detach-media-${i}`}
                  aria-label="Detach"
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="absolute top-1 left-1">
                  <div className="w-4 h-4 rounded-full bg-emerald-500/90 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 py-1">
                  <span className="text-[9px] text-white/70 truncate block">{item.originalName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && pending.length === 0 && (
        <div className="flex items-center gap-2 text-[11px] text-white/30 px-1">
          <ImageIcon className="w-3 h-3" />
          <span>No media attached yet</span>
        </div>
      )}

      {error && (
        <div data-testid="text-upload-error" className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
