import { useState, useRef } from "react";
import { Upload, X, FileImage, Film, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UploadedItem {
  originalName: string;
  filename: string;
  fileUrl: string;
  fileType: string;
  size: number;
  mime: string;
  mediaId?: number;
}

interface MediaUploadProps {
  subAccountId?: number;
  postId?: number;
  onUploaded?: (items: UploadedItem[]) => void;
}

export default function MediaUpload({ subAccountId, postId, onUploaded }: MediaUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recentUploads, setRecentUploads] = useState<UploadedItem[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files ? Array.from(e.target.files) : [];
    const valid = chosen.filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        setError(`"${f.name}" exceeds 50MB limit`);
        return false;
      }
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
        setError(`"${f.name}" is not a supported image or video file`);
        return false;
      }
      return true;
    });
    if (valid.length) {
      setFiles(prev => [...prev, ...valid]);
      setError(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      f => (f.type.startsWith("image/") || f.type.startsWith("video/")) && f.size <= MAX_FILE_SIZE
    );
    if (dropped.length) {
      setFiles(prev => [...prev, ...dropped]);
      setError(null);
    }
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      if (subAccountId) fd.append("sub_account_id", String(subAccountId));
      if (postId) fd.append("post_id", String(postId));
      const res = await fetch("/api/media/upload", { method: "POST", body: fd, credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json?.error || `Upload failed (${res.status})`;
        const stage = json?.stage ? ` [${json.stage}]` : "";
        throw new Error(`${msg}${stage}`);
      }
      const items: UploadedItem[] = json?.uploaded || [];
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      setRecentUploads(prev => [...items, ...prev].slice(0, 10));
      if (onUploaded) onUploaded(items);

      if (json?.errors?.length) {
        setError(`${items.length} uploaded, ${json.errors.length} failed`);
      }
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-white/40" />
          <span className="text-xs font-medium text-white/60 uppercase tracking-wider">Media Upload</span>
        </div>
      </div>

      <div
        data-testid="media-upload-dropzone"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-[color:var(--vibe-glow,#6366f1)]/60 bg-[color:var(--vibe-glow,#6366f1)]/5"
            : "border-white/10 hover:border-white/20 bg-white/[0.02]"
        }`}
      >
        <Upload className="w-6 h-6 mx-auto mb-2 text-white/20" />
        <p className="text-xs text-white/40">Drag & drop or click to choose</p>
        <p className="text-[10px] text-white/20 mt-1">Images and videos, up to 50MB each</p>
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

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {files.map((f, i) => (
              <div
                key={i}
                data-testid={`media-file-preview-${i}`}
                className="relative flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/10"
              >
                {f.type.startsWith("video/") ? (
                  <Film className="w-4 h-4 text-cyan-400 shrink-0" />
                ) : (
                  <FileImage className="w-4 h-4 text-pink-400 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white/70 truncate">{f.name}</div>
                  <div className="text-[10px] text-white/30">{(f.size / 1024).toFixed(0)} KB</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="text-white/20 hover:text-white/60 transition-colors"
                  data-testid={`button-remove-file-${i}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              data-testid="button-upload-media"
              onClick={upload}
              disabled={uploading || !files.length}
              className="flex-1 text-white text-xs border-0"
              style={{ background: "linear-gradient(to right, var(--vibe-glow, #6366f1), var(--vibe-accent, #818cf8))" }}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Upload {files.length} file{files.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
            <Button
              data-testid="button-clear-media"
              onClick={() => { setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}
              variant="outline"
              className="border-white/10 text-white/40 hover:text-white/60 text-xs"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {recentUploads.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] text-white/30 uppercase tracking-wider">Recently Uploaded</span>
          <div className="grid grid-cols-4 gap-1.5">
            {recentUploads.map((item, i) => (
              <div
                key={item.filename}
                data-testid={`recent-upload-${i}`}
                className="relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/5"
              >
                {item.fileType === "video" ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-5 h-5 text-cyan-400/60" />
                  </div>
                ) : (
                  <img
                    src={item.fileUrl}
                    alt={item.originalName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 inline mr-0.5" />
                  <span className="text-[8px] text-white/60 truncate">{item.originalName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div data-testid="text-upload-error" className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
          {error}
        </div>
      )}
    </div>
  );
}
