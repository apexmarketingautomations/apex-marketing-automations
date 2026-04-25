import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subAccounts, systemLogs, contentMedia } from "@shared/schema";
import { eq } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"));
    }
  },
});

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

(async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) { console.warn("[MEDIA] caught:", err instanceof Error ? err.message : err); }
})();

export function registerMediaRoutes(app: Express) {
  app.post("/api/media/upload", (req: Request, res: Response, next: Function) => {
    upload.array("files", 10)(req, res, (err: any) => {
      if (err) {
        if (err.message?.includes("Only image and video")) {
          return res.status(400).json({ message: err.message });
        }
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ message: "File exceeds 50MB size limit" });
        }
        return res.status(400).json({ message: err.message || "Upload error" });
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    try {
      console.log(JSON.stringify({
        stage: "upload_received",
        fileCount: (req.files as Express.Multer.File[] | undefined)?.length ?? 0,
        bodyKeys: Object.keys(req.body || {}),
        hasTenant: !!req.tenant?.subAccountId,
        hasUser: !!(req as any).user?.id,
        timestamp: new Date().toISOString(),
      }));

      const user = (req as any).user;
      const adminSecret = process.env.STANDALONE_ADMIN_SECRET;
      const headerSecret = req.headers["x-admin-secret"] as string | undefined;
      const isAdminBypass = !!(adminSecret && headerSecret && headerSecret.trim() === adminSecret.trim());

      if (!isAdminBypass && (!user || !user.id)) {
        console.log(JSON.stringify({ stage: "upload_rejected", reason: "not_authenticated" }));
        return res.status(401).json({ success: false, stage: "auth", error: "Not authenticated" });
      }

      const effectiveUserId = user?.id || "admin";

      const tenantAccountId = req.tenant?.subAccountId;
      const bodyAccountId = req.body.sub_account_id ? Number(req.body.sub_account_id) : null;
      const subAccountId = bodyAccountId || tenantAccountId || null;

      if (!subAccountId || isNaN(subAccountId) || subAccountId <= 0) {
        console.log(JSON.stringify({ stage: "upload_rejected", reason: "missing_sub_account_id", bodyAccountId, tenantAccountId }));
        return res.status(400).json({ success: false, stage: "validation", error: "Valid sub_account_id is required" });
      }

      const [account] = await db
        .select({ id: subAccounts.id, isProtected: subAccounts.isProtected })
        .from(subAccounts)
        .where(eq(subAccounts.id, subAccountId))
        .limit(1);

      if (!account) {
        console.log(JSON.stringify({ stage: "upload_rejected", reason: "account_not_found", subAccountId }));
        return res.status(404).json({ success: false, stage: "validation", error: "Account not found" });
      }

      if (account.isProtected) {
        await db.insert(systemLogs).values({
          severity: "warn",
          module: "media",
          message: "upload_blocked_protected",
          metadata: { subAccountId, userId: user.id },
        });
        console.log(JSON.stringify({ stage: "upload_rejected", reason: "protected_account", subAccountId }));
        return res.status(403).json({ success: false, stage: "validation", error: "protected_account" });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) {
        console.log(JSON.stringify({ stage: "upload_rejected", reason: "no_files" }));
        return res.status(400).json({ success: false, stage: "validation", error: "No files provided" });
      }

      console.log(JSON.stringify({
        stage: "upload_processing",
        fileCount: files.length,
        files: files.map(f => ({ name: f.originalname, size: f.size, mime: f.mimetype })),
        subAccountId,
      }));

      const postId = req.body.post_id ? parseInt(req.body.post_id) : null;

      const uploaded: { originalName: string; filename: string; fileUrl: string; fileType: string; size: number; mime: string; mediaId?: number }[] = [];
      const errors: { file: string; error: string }[] = [];

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const ext = path.extname(f.originalname) || "";
          const sanitizedExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
          const filename = `${Date.now()}-${uuidv4()}${sanitizedExt}`;
          const target = path.join(UPLOAD_DIR, filename);
          await fs.writeFile(target, f.buffer);

          const fileUrl = `/uploads/${filename}`;
          const fileType = f.mimetype.startsWith("video/") ? "video" : "image";

          let mediaId: number | undefined;
          try {
            const [mediaRecord] = await db
              .insert(contentMedia)
              .values({
                subAccountId,
                postId,
                fileUrl,
                fileKey: filename,
                fileType,
                fileSize: f.size,
                sortOrder: i,
                altText: f.originalname,
              })
              .returning({ id: contentMedia.id });
            mediaId = mediaRecord?.id;
          } catch (dbErr: any) {
            console.error(JSON.stringify({
              stage: "db_write_failed",
              file: f.originalname,
              error: dbErr.message,
            }));
          }

          uploaded.push({
            originalName: f.originalname,
            filename,
            fileUrl,
            fileType,
            size: f.size,
            mime: f.mimetype,
            mediaId,
          });

          console.log(JSON.stringify({
            stage: "file_saved",
            file: f.originalname,
            filename,
            fileUrl,
            size: f.size,
            mediaId,
          }));
        } catch (fileErr: any) {
          console.error(JSON.stringify({
            stage: "file_write_failed",
            file: f.originalname,
            error: fileErr.message,
          }));
          errors.push({ file: f.originalname, error: fileErr.message });
        }
      }

      await db.insert(systemLogs).values({
        severity: "info",
        module: "media",
        message: "media_uploaded",
        metadata: {
          count: uploaded.length,
          errors: errors.length,
          subAccountId,
          uploadedBy: effectiveUserId,
          files: uploaded.map(u => ({ name: u.originalName, size: u.size, mime: u.mime, mediaId: u.mediaId })),
        },
      });

      console.log(JSON.stringify({
        stage: "upload_complete",
        success: true,
        uploaded: uploaded.length,
        errors: errors.length,
        subAccountId,
      }));

      res.json({
        success: true,
        uploaded,
        errors: errors.length > 0 ? errors : undefined,
        rowsProcessed: uploaded.length,
      });
    } catch (err: any) {
      console.error(JSON.stringify({
        stage: "upload_fatal_error",
        error: err.message,
        stack: err.stack?.substring(0, 500),
      }));
      if (err.message?.includes("Only image and video")) {
        return res.status(400).json({ success: false, stage: "validation", error: err.message });
      }
      res.status(500).json({ success: false, stage: "server", error: "Upload failed — please try again" });
    }
  });
}
