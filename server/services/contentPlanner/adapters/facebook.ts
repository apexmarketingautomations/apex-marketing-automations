import type { PlatformAdapter, PublishInput, PublishResult } from "./types";
import { db } from "../../../db";
import { contentMedia } from "@shared/schema";
import { inArray } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function mediaFileToAbsPath(fileUrl: string, fileKey: string | null): string {
  if (fileKey) return path.join(UPLOAD_DIR, fileKey);
  const basename = path.basename(fileUrl);
  return path.join(UPLOAD_DIR, basename);
}

async function uploadUnpublishedPhoto(
  pageId: string,
  accessToken: string,
  filePath: string,
  mime: string,
): Promise<{ ok: true; mediaFbid: string } | { ok: false; error: string }> {
  try {
    const buf = await fs.readFile(filePath);
    const blob = new Blob([buf], { type: mime || "image/jpeg" });
    const form = new FormData();
    form.append("source", blob, path.basename(filePath));
    form.append("published", "false");
    form.append("access_token", accessToken);
    const r = await fetch(`${GRAPH_API_BASE}/${pageId}/photos`, { method: "POST", body: form });
    const data = await r.json() as any;
    if (!r.ok || data.error) {
      return { ok: false, error: data.error?.message || `Upload failed (${r.status})` };
    }
    return { ok: true, mediaFbid: data.id };
  } catch (err: any) {
    return { ok: false, error: `Photo upload error: ${err.message}` };
  }
}

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",

  validate(input: PublishInput) {
    if (!input.body && (!input.mediaIds || input.mediaIds.length === 0)) {
      return { valid: false, error: "Facebook requires text content or at least one media item" };
    }
    if (input.body && input.body.length > 63206) {
      return { valid: false, error: "Facebook post must be 63206 characters or fewer" };
    }
    if (!input.credentials) {
      return { valid: false, error: "Facebook credentials not configured for this account" };
    }
    if (!input.credentials.accessToken) {
      return { valid: false, error: "Facebook access token is missing" };
    }
    if (!input.credentials.pageId) {
      return { valid: false, error: "Facebook Page ID is missing" };
    }
    return { valid: true };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const { credentials } = input;
    if (!credentials || !credentials.accessToken || !credentials.pageId) {
      return {
        success: false,
        platform: "facebook",
        externalPostId: null,
        errorMessage: "Missing Facebook credentials (accessToken or pageId)",
      };
    }

    try {
      console.log(`[CP-FACEBOOK] Publishing post ${input.postId} to Page ${credentials.pageId} (subAccount ${input.subAccountId})`);

      const hasMedia = !!(input.mediaIds && input.mediaIds.length > 0);
      let attachedMediaFbids: string[] = [];
      let videoMedia: { filePath: string; mime: string } | null = null;

      if (hasMedia) {
        const rows = await db.select().from(contentMedia)
          .where(inArray(contentMedia.id, input.mediaIds!));

        for (const m of rows) {
          const filePath = mediaFileToAbsPath(m.fileUrl, m.fileKey || null);
          try {
            await fs.access(filePath);
          } catch (err) {
            console.warn("[FACEBOOK] caught:", err instanceof Error ? err.message : err);
            return {
              success: false,
              platform: "facebook",
              externalPostId: null,
              errorMessage: `Media file missing on disk: ${path.basename(filePath)}`,
            };
          }
          const mime = m.fileType === "video" ? "video/mp4" : "image/jpeg";
          if (m.fileType === "video") {
            videoMedia = { filePath, mime };
          } else {
            const up = await uploadUnpublishedPhoto(credentials.pageId, credentials.accessToken, filePath, mime);
            if (!up.ok) {
              return {
                success: false,
                platform: "facebook",
                externalPostId: null,
                errorMessage: `Photo upload failed: ${up.error}`,
              };
            }
            attachedMediaFbids.push(up.mediaFbid);
          }
        }
      }

      if (videoMedia) {
        const buf = await fs.readFile(videoMedia.filePath);
        const blob = new Blob([buf], { type: videoMedia.mime });
        const form = new FormData();
        form.append("source", blob, path.basename(videoMedia.filePath));
        if (input.body) form.append("description", input.body);
        form.append("access_token", credentials.accessToken);
        const r = await fetch(`${GRAPH_API_BASE}/${credentials.pageId}/videos`, { method: "POST", body: form });
        const data = await r.json() as any;
        if (!r.ok || data.error) {
          return {
            success: false,
            platform: "facebook",
            externalPostId: null,
            errorMessage: data.error?.message || `Facebook video upload error (${r.status})`,
          };
        }
        const externalId = data.post_id || data.id || null;
        console.log(`[CP-FACEBOOK] Published video post ${input.postId} -> ${externalId}`);
        return { success: true, platform: "facebook", externalPostId: externalId, errorMessage: null };
      }

      const url = `${GRAPH_API_BASE}/${credentials.pageId}/feed`;
      const params: Record<string, any> = { access_token: credentials.accessToken };
      if (input.body) params.message = input.body;
      if (attachedMediaFbids.length > 0) {
        params.attached_media = attachedMediaFbids.map(id => ({ media_fbid: id }));
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await response.json() as any;

      if (!response.ok || data.error) {
        const errMsg = data.error?.message || `Facebook API error (${response.status})`;
        console.error(`[CP-FACEBOOK] API error for post ${input.postId}:`, errMsg);
        return { success: false, platform: "facebook", externalPostId: null, errorMessage: errMsg };
      }

      console.log(`[CP-FACEBOOK] Published post ${input.postId} -> ${data.id} (${attachedMediaFbids.length} photos)`);
      return { success: true, platform: "facebook", externalPostId: data.id || null, errorMessage: null };
    } catch (err: any) {
      console.error(`[CP-FACEBOOK] Network error for post ${input.postId}:`, err.message);
      return {
        success: false,
        platform: "facebook",
        externalPostId: null,
        errorMessage: `Facebook publish failed: ${err.message}`,
      };
    }
  },
};
