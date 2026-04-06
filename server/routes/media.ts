import type { Express, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { subAccounts, systemLogs } from "@shared/schema";
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

const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR || "/tmp/uploads";

(async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (_) {}
})();

export function registerMediaRoutes(app: Express) {
  app.post("/api/media/upload", upload.array("files", 10), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user || !user.id) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const tenantAccountId = req.tenant?.subAccountId;
      const bodyAccountId = req.body.sub_account_id ? Number(req.body.sub_account_id) : null;
      const subAccountId = bodyAccountId || tenantAccountId || null;

      if (!subAccountId || isNaN(subAccountId) || subAccountId <= 0) {
        return res.status(400).json({ error: "Valid sub_account_id is required" });
      }

      const [account] = await db
        .select({ id: subAccounts.id, isProtected: subAccounts.isProtected })
        .from(subAccounts)
        .where(eq(subAccounts.id, subAccountId))
        .limit(1);

      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      if (account.isProtected) {
        await db.insert(systemLogs).values({
          severity: "warn",
          module: "media",
          message: "upload_blocked_protected",
          metadata: { subAccountId, userId: user.id },
        });
        return res.status(403).json({ error: "protected_account" });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) {
        return res.status(400).json({ error: "No files provided" });
      }

      const uploaded: { originalName: string; filename: string; size: number; mime: string }[] = [];
      for (const f of files) {
        const ext = path.extname(f.originalname) || "";
        const sanitizedExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
        const filename = `${Date.now()}-${uuidv4()}${sanitizedExt}`;
        const target = path.join(UPLOAD_DIR, filename);
        await fs.writeFile(target, f.buffer);
        uploaded.push({
          originalName: f.originalname,
          filename,
          size: f.size,
          mime: f.mimetype,
        });
      }

      await db.insert(systemLogs).values({
        severity: "info",
        module: "media",
        message: "media_uploaded",
        metadata: {
          count: uploaded.length,
          subAccountId,
          uploadedBy: user.id,
          files: uploaded.map(u => ({ name: u.originalName, size: u.size, mime: u.mime })),
        },
      });

      res.json({ ok: true, uploaded });
    } catch (err: any) {
      console.error("media upload error", err);
      if (err.message?.includes("Only image and video")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Upload failed" });
    }
  });
}
