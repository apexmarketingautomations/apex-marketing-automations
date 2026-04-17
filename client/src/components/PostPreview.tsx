import { useState } from "react";
import { Facebook, Instagram, Globe, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, ThumbsUp, ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { UploadedMediaItem } from "./MediaUpload";

export interface PostPreviewMedia {
  fileUrl: string;
  fileType: string;
  originalName?: string;
}

interface PostPreviewProps {
  caption: string;
  hashtags?: string;
  callToAction?: string;
  media: PostPreviewMedia[];
  platforms: string[];
  pageName?: string;
  pageHandle?: string;
}

const PLATFORM_TABS: Record<string, { label: string; icon: any; color: string }> = {
  facebook: { label: "Facebook", icon: Facebook, color: "text-blue-400" },
  instagram: { label: "Instagram", icon: Instagram, color: "text-pink-400" },
  x: { label: "X", icon: Globe, color: "text-white/70" },
  tiktok: { label: "TikTok", icon: Globe, color: "text-cyan-400" },
};

function MediaCarousel({ media, square }: { media: PostPreviewMedia[]; square?: boolean }) {
  const [idx, setIdx] = useState(0);
  if (media.length === 0) return null;
  const cur = media[Math.min(idx, media.length - 1)];
  const isVideo = cur.fileType === "video" || /\.(mp4|mov|webm)$/i.test(cur.fileUrl);
  return (
    <div className={`relative w-full bg-black ${square ? "aspect-square" : "max-h-[420px]"} overflow-hidden`}>
      {isVideo ? (
        <div className="relative w-full h-full">
          <video src={cur.fileUrl} className="w-full h-full object-cover" muted playsInline controls={false} />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="w-5 h-5 text-black ml-0.5" fill="currentColor" />
            </div>
          </div>
        </div>
      ) : (
        <img src={cur.fileUrl} alt="" className={`w-full h-full ${square ? "object-cover" : "object-contain"}`} />
      )}
      {media.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => (i - 1 + media.length) % media.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center"
            data-testid="preview-carousel-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIdx(i => (i + 1) % media.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center"
            data-testid="preview-carousel-next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {media.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all ${i === idx ? "bg-white" : "bg-white/40"}`}
              />
            ))}
          </div>
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-semibold">
            {idx + 1}/{media.length}
          </div>
        </>
      )}
    </div>
  );
}

function FacebookPreview({ caption, hashtags, callToAction, media, pageName, pageHandle }: Omit<PostPreviewProps, "platforms">) {
  const fullText = [caption, hashtags, callToAction && `\n${callToAction}`].filter(Boolean).join(hashtags ? "\n\n" : "");
  return (
    <div className="bg-[#242526] rounded-lg overflow-hidden border border-white/10 shadow-xl text-[13px]" data-testid="preview-facebook">
      <div className="px-3 pt-3 pb-2 flex items-start gap-2.5">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
          {(pageName || "P").slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold text-[13px] leading-tight truncate">{pageName || "Your Page"}</div>
          <div className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
            <span>Just now</span>
            <span>·</span>
            <Globe className="w-2.5 h-2.5" />
          </div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-white/50" />
      </div>
      {fullText && (
        <div className="px-3 pb-2 text-white/90 whitespace-pre-wrap leading-relaxed text-[14px]">
          {fullText || <span className="text-white/30 italic">Your caption will appear here…</span>}
        </div>
      )}
      {!fullText && media.length === 0 && (
        <div className="px-3 pb-2 text-white/30 italic">Your caption will appear here…</div>
      )}
      {media.length > 0 && <MediaCarousel media={media} />}
      <div className="px-3 py-2 flex items-center justify-between text-[11px] text-white/50 border-t border-white/5">
        <div className="flex items-center gap-1">
          <div className="flex -space-x-1">
            <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center border border-[#242526]">
              <ThumbsUp className="w-2 h-2 text-white" fill="currentColor" />
            </div>
            <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center border border-[#242526]">
              <Heart className="w-2 h-2 text-white" fill="currentColor" />
            </div>
          </div>
          <span className="ml-1">42</span>
        </div>
        <div>3 comments · 1 share</div>
      </div>
      <div className="grid grid-cols-3 border-t border-white/5">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageCircle, label: "Comment" },
          { icon: Send, label: "Share" },
        ].map(({ icon: Ic, label }) => (
          <div key={label} className="flex items-center justify-center gap-1.5 py-2 text-white/60 text-[12px] font-medium hover:bg-white/5">
            <Ic className="w-4 h-4" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function InstagramPreview({ caption, hashtags, media, pageName }: Omit<PostPreviewProps, "platforms" | "callToAction" | "pageHandle">) {
  const handle = (pageName || "your_page").toLowerCase().replace(/\s+/g, "_");
  return (
    <div className="bg-black rounded-lg overflow-hidden border border-white/10 shadow-xl text-[13px]" data-testid="preview-instagram">
      <div className="px-3 py-2 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
          <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-white font-bold text-[11px]">
            {(pageName || "P").slice(0, 1).toUpperCase()}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold text-[13px] leading-tight truncate">{handle}</div>
          <div className="text-[10px] text-white/50">Sponsored</div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-white/70" />
      </div>
      {media.length > 0 ? (
        <MediaCarousel media={media} square />
      ) : (
        <div className="aspect-square w-full bg-gradient-to-br from-pink-900/30 via-purple-900/30 to-blue-900/30 flex items-center justify-center">
          <div className="text-white/30 text-xs italic">Add media to see your Instagram preview</div>
        </div>
      )}
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <Heart className="w-6 h-6 text-white" />
          <MessageCircle className="w-6 h-6 text-white" />
          <Send className="w-6 h-6 text-white" />
        </div>
        <Bookmark className="w-6 h-6 text-white" />
      </div>
      <div className="px-3 pb-3 text-white text-[13px] leading-snug">
        <span className="font-semibold mr-1.5">{handle}</span>
        <span className="whitespace-pre-wrap">{caption || <span className="text-white/30 italic">Your caption…</span>}</span>
        {hashtags && <span className="text-blue-400 ml-1.5">{hashtags}</span>}
      </div>
    </div>
  );
}

function GenericPreview({ caption, hashtags, callToAction, media, platform }: Omit<PostPreviewProps, "platforms"> & { platform: string }) {
  const text = [caption, hashtags, callToAction].filter(Boolean).join("\n\n");
  return (
    <div className="bg-[#1a1a1a] rounded-lg overflow-hidden border border-white/10 shadow-xl">
      <div className="p-3 text-xs text-white/50 uppercase tracking-wider border-b border-white/5">{platform} preview</div>
      {media.length > 0 && <MediaCarousel media={media} />}
      <div className="p-3 text-white/80 text-sm whitespace-pre-wrap">{text || <span className="text-white/30 italic">Empty post</span>}</div>
    </div>
  );
}

export default function PostPreview({ caption, hashtags, callToAction, media, platforms, pageName, pageHandle }: PostPreviewProps) {
  const available = platforms.length > 0 ? platforms : ["facebook"];
  const [active, setActive] = useState<string>(available[0]);
  const current = available.includes(active) ? active : available[0];

  return (
    <div className="space-y-3" data-testid="post-preview-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/60 uppercase tracking-wider">Live Preview</span>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
          {available.map(p => {
            const cfg = PLATFORM_TABS[p] || PLATFORM_TABS.facebook;
            const Icon = cfg.icon;
            const isActive = p === current;
            return (
              <button
                key={p}
                onClick={() => setActive(p)}
                data-testid={`tab-preview-${p}`}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  isActive ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                <Icon className={`w-3 h-3 ${isActive ? cfg.color : ""}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent p-3 border border-white/5">
        {current === "facebook" && (
          <FacebookPreview caption={caption} hashtags={hashtags} callToAction={callToAction} media={media} pageName={pageName} pageHandle={pageHandle} />
        )}
        {current === "instagram" && (
          <InstagramPreview caption={caption} hashtags={hashtags} media={media} pageName={pageName} />
        )}
        {current !== "facebook" && current !== "instagram" && (
          <GenericPreview caption={caption} hashtags={hashtags} callToAction={callToAction} media={media} platform={current} />
        )}
      </div>

      <div className="text-[10px] text-white/30 leading-snug">
        Preview is an approximation. Final layout depends on each platform's renderer.
      </div>
    </div>
  );
}

export function mediaItemsFromUploaded(items: UploadedMediaItem[]): PostPreviewMedia[] {
  return items.map(i => ({ fileUrl: i.fileUrl, fileType: i.fileType, originalName: i.originalName }));
}
