import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "./db";
import { crashReports, policeReportDocuments, type PoliceReportDocument } from "@shared/schema";

const POLICE_REPORT_UPLOAD_DIR = path.join(process.cwd(), "uploads", "police-reports");
const PROCESSING_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_NOT_FOUND_ATTEMPTS = 20;
const MAX_UPSTREAM_ATTEMPTS = 40;

export interface PendingPoliceReportJob {
  crashReportId: number;
  crashReportIds: number[];
  reportNumber: string;
  officialReportNumber: string;
  subAccountId: number;
  policeReportDocumentId: number;
  attemptCount: number;
  county: string | null;
  crashDate: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
}

type FailureType = "not_found" | "upstream_error" | "network_error";

function sanitizeOfficialReportNumber(value: string): string {
  return value.trim().replace(/[^A-Z0-9._-]/gi, "_");
}

function looksLikeZip(buffer: Buffer, mimeType?: string | null, originalFilename?: string | null): boolean {
  if (mimeType?.includes("zip")) return true;
  if (originalFilename?.toLowerCase().endsWith(".zip")) return true;
  return buffer.byteLength > 4 && buffer.subarray(0, 2).toString("hex") === "504b";
}

function looksLikePdf(buffer: Buffer, mimeType?: string | null, originalFilename?: string | null): boolean {
  if (mimeType?.includes("pdf")) return true;
  if (originalFilename?.toLowerCase().endsWith(".pdf")) return true;
  return buffer.byteLength > 4 && buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

function buildStoredFileName(params: {
  officialReportNumber: string;
  sha256: string;
  buffer: Buffer;
  mimeType?: string | null;
  originalFilename?: string | null;
}): string {
  const safeReportNumber = sanitizeOfficialReportNumber(params.officialReportNumber);
  const hashPrefix = params.sha256.slice(0, 16);
  const extension = looksLikeZip(params.buffer, params.mimeType, params.originalFilename)
    ? ".zip"
    : looksLikePdf(params.buffer, params.mimeType, params.originalFilename)
      ? ".pdf"
      : path.extname(params.originalFilename ?? "") || ".bin";
  return `${safeReportNumber}-${hashPrefix}${extension}`;
}

function defaultRetryMinutes(type: FailureType): number {
  if (type === "not_found") return 6 * 60;
  return 60;
}

async function ensureUploadDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function selectDocumentByKey(subAccountId: number, officialReportNumber: string): Promise<PoliceReportDocument | null> {
  const [row] = await db
    .select()
    .from(policeReportDocuments)
    .where(and(
      eq(policeReportDocuments.subAccountId, subAccountId),
      eq(policeReportDocuments.officialReportNumber, officialReportNumber),
    ))
    .limit(1);
  return row ?? null;
}

export async function linkCrashReportsToDocument(subAccountId: number, officialReportNumber: string, documentId: number): Promise<number[]> {
  const linkedRows = await db
    .select({ id: crashReports.id })
    .from(crashReports)
    .where(and(
      eq(crashReports.subAccountId, subAccountId),
      eq(crashReports.officialReportNumber, officialReportNumber),
    ));

  const linkedIds = linkedRows.map((row) => row.id);
  if (linkedIds.length === 0) return [];

  await db
    .update(crashReports)
    .set({
      policeReportDocumentId: documentId,
      updatedAt: new Date(),
    })
    .where(inArray(crashReports.id, linkedIds));

  return linkedIds;
}

export async function findStoredPoliceReportByCrashReport(report: {
  policeReportDocumentId?: number | null;
  subAccountId?: number | null;
  officialReportNumber?: string | null;
}): Promise<PoliceReportDocument | null> {
  let document: PoliceReportDocument | null = null;

  if (report.policeReportDocumentId) {
    const [row] = await db
      .select()
      .from(policeReportDocuments)
      .where(eq(policeReportDocuments.id, report.policeReportDocumentId))
      .limit(1);
    document = row ?? null;
  } else if (report.subAccountId && report.officialReportNumber) {
    document = await selectDocumentByKey(report.subAccountId, report.officialReportNumber);
  }

  if (!document?.storagePath) return null;

  try {
    await fs.access(document.storagePath);
  // allow-silent-catch: a stale local-file pointer should fall back to live fetch or retry without noisy logs
  } catch {
    return null;
  }

  if (!report.policeReportDocumentId && report.subAccountId && report.officialReportNumber) {
    await linkCrashReportsToDocument(report.subAccountId, report.officialReportNumber, document.id);
  }

  return document;
}

export async function persistPoliceReportBinary(params: {
  subAccountId: number;
  officialReportNumber: string;
  buffer: Buffer;
  mimeType?: string | null;
  originalFilename?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ document: PoliceReportDocument; linkedCrashReportIds: number[]; fileUrl: string }> {
  const officialReportNumber = params.officialReportNumber.trim();
  const sha256 = crypto.createHash("sha256").update(params.buffer).digest("hex");
  const fileName = buildStoredFileName({
    officialReportNumber,
    sha256,
    buffer: params.buffer,
    mimeType: params.mimeType,
    originalFilename: params.originalFilename,
  });

  const targetDir = path.join(POLICE_REPORT_UPLOAD_DIR, String(params.subAccountId));
  const storagePath = path.join(targetDir, fileName);
  const fileUrl = `/uploads/police-reports/${params.subAccountId}/${fileName}`;

  await ensureUploadDir(targetDir);
  await fs.writeFile(storagePath, params.buffer);

  const now = new Date();
  const [document] = await db
    .insert(policeReportDocuments)
    .values({
      subAccountId: params.subAccountId,
      officialReportNumber,
      status: "LINKED",
      source: params.source ?? "local_agent",
      storageMode: "local_uploads",
      storagePath,
      fileName,
      mimeType: params.mimeType ?? (looksLikeZip(params.buffer) ? "application/zip" : "application/pdf"),
      sha256,
      byteSize: params.buffer.byteLength,
      fetchedAt: now,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      errorLog: null,
      metadata: params.metadata ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [policeReportDocuments.subAccountId, policeReportDocuments.officialReportNumber],
      set: {
        status: "LINKED",
        source: params.source ?? "local_agent",
        storageMode: "local_uploads",
        storagePath,
        fileName,
        mimeType: params.mimeType ?? (looksLikeZip(params.buffer) ? "application/zip" : "application/pdf"),
        sha256,
        byteSize: params.buffer.byteLength,
        fetchedAt: now,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        errorLog: null,
        metadata: params.metadata ?? {},
        updatedAt: now,
      },
    })
    .returning();

  const linkedCrashReportIds = await linkCrashReportsToDocument(params.subAccountId, officialReportNumber, document.id);
  return { document, linkedCrashReportIds, fileUrl };
}

export async function claimPendingPoliceReportBatch(limit: number, locker = "local-pdf-agent"): Promise<PendingPoliceReportJob[]> {
  const rawCandidates = await db
    .select({
      id: crashReports.id,
      reportNumber: crashReports.reportNumber,
      officialReportNumber: crashReports.officialReportNumber,
      subAccountId: crashReports.subAccountId,
      data: crashReports.data,
    })
    .from(crashReports)
    .where(and(
      eq(crashReports.status, "COMPLETED"),
      isNotNull(crashReports.officialReportNumber),
      isNotNull(crashReports.subAccountId),
      isNull(crashReports.policeReportDocumentId),
    ))
    .orderBy(asc(crashReports.updatedAt))
    .limit(Math.max(limit * 20, 50));

  const grouped = new Map<string, PendingPoliceReportJob>();
  for (const row of rawCandidates) {
    if (!row.officialReportNumber || !row.subAccountId) continue;
    const key = `${row.subAccountId}:${row.officialReportNumber}`;
    const data = (row.data ?? {}) as Record<string, any>;
    const existing = grouped.get(key);
    if (existing) {
      existing.crashReportIds.push(row.id);
      continue;
    }
    grouped.set(key, {
      crashReportId: row.id,
      crashReportIds: [row.id],
      reportNumber: row.reportNumber,
      officialReportNumber: row.officialReportNumber,
      subAccountId: row.subAccountId,
      policeReportDocumentId: 0,
      attemptCount: 0,
      county: data?.county ?? null,
      crashDate: data?.crashDate ?? null,
      location: data?.location ?? null,
      lat: typeof data?.lat === "number" ? data.lat : null,
      lng: typeof data?.lng === "number" ? data.lng : null,
    });
  }

  const jobs: PendingPoliceReportJob[] = [];
  const now = Date.now();

  for (const candidate of grouped.values()) {
    if (jobs.length >= limit) break;

    const existing = await selectDocumentByKey(candidate.subAccountId, candidate.officialReportNumber);

    if (existing?.status === "LINKED" && existing.storagePath) {
      await linkCrashReportsToDocument(candidate.subAccountId, candidate.officialReportNumber, existing.id);
      continue;
    }

    if (existing?.nextAttemptAt && new Date(existing.nextAttemptAt).getTime() > now) {
      continue;
    }

    if (existing?.status === "FAILED") {
      continue;
    }

    if (existing?.lockedAt) {
      const lockAgeMs = now - new Date(existing.lockedAt).getTime();
      if (lockAgeMs < PROCESSING_LOCK_TIMEOUT_MS) {
        continue;
      }
    }

    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const updatePayload = {
      status: "PROCESSING",
      source: existing?.source ?? "local_agent",
      lastAttemptAt: new Date(now),
      nextAttemptAt: null,
      lockedAt: new Date(now),
      lockedBy: locker,
      errorLog: null,
      attemptCount,
      updatedAt: new Date(now),
    } as const;

    let document: PoliceReportDocument;
    if (existing) {
      const [row] = await db
        .update(policeReportDocuments)
        .set(updatePayload)
        .where(eq(policeReportDocuments.id, existing.id))
        .returning();
      document = row;
    } else {
      const [row] = await db
        .insert(policeReportDocuments)
        .values({
          subAccountId: candidate.subAccountId,
          officialReportNumber: candidate.officialReportNumber,
          storageMode: "local_uploads",
          source: "local_agent",
          attemptCount,
          lastAttemptAt: new Date(now),
          lockedAt: new Date(now),
          lockedBy: locker,
          status: "PROCESSING",
          updatedAt: new Date(now),
        })
        .returning();
      document = row;
    }

    jobs.push({
      ...candidate,
      policeReportDocumentId: document.id,
      attemptCount: document.attemptCount,
    });
  }

  return jobs;
}

export async function recordPoliceReportFetchFailure(params: {
  crashReportId?: number | null;
  subAccountId?: number | null;
  officialReportNumber?: string | null;
  type: FailureType;
  statusCode?: number | null;
  errorMessage?: string | null;
  retryAfterMinutes?: number | null;
  source?: string | null;
}): Promise<{ ok: boolean; action: "retry" | "failed"; documentId?: number; reason?: string }> {
  let subAccountId = params.subAccountId ?? null;
  let officialReportNumber = params.officialReportNumber?.trim() ?? null;

  if (params.crashReportId && (!subAccountId || !officialReportNumber)) {
    const [report] = await db
      .select({
        subAccountId: crashReports.subAccountId,
        officialReportNumber: crashReports.officialReportNumber,
      })
      .from(crashReports)
      .where(eq(crashReports.id, params.crashReportId))
      .limit(1);

    subAccountId = subAccountId ?? report?.subAccountId ?? null;
    officialReportNumber = officialReportNumber ?? report?.officialReportNumber ?? null;
  }

  if (!subAccountId || !officialReportNumber) {
    return { ok: false, action: "failed", reason: "missing subAccountId or officialReportNumber" };
  }

  const existing = await selectDocumentByKey(subAccountId, officialReportNumber);
  const attemptCount = existing?.attemptCount ?? 1;
  const maxAttempts = params.type === "not_found" ? MAX_NOT_FOUND_ATTEMPTS : MAX_UPSTREAM_ATTEMPTS;
  const shouldFail = attemptCount >= maxAttempts;
  const retryMinutes = params.retryAfterMinutes ?? defaultRetryMinutes(params.type);
  const now = new Date();
  const nextAttemptAt = shouldFail ? null : new Date(Date.now() + retryMinutes * 60 * 1000);
  const errorLog = [
    `[${params.type}]`,
    params.statusCode ? `HTTP ${params.statusCode}` : null,
    params.errorMessage ?? null,
  ].filter(Boolean).join(" ");

  let document: PoliceReportDocument;
  if (existing) {
    const [row] = await db
      .update(policeReportDocuments)
      .set({
        status: shouldFail ? "FAILED" : "RETRY_LATER",
        source: params.source ?? existing.source ?? "local_agent",
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        errorLog,
        updatedAt: now,
      })
      .where(eq(policeReportDocuments.id, existing.id))
      .returning();
    document = row;
  } else {
    const [row] = await db
      .insert(policeReportDocuments)
      .values({
        subAccountId,
        officialReportNumber,
        status: shouldFail ? "FAILED" : "RETRY_LATER",
        source: params.source ?? "local_agent",
        storageMode: "local_uploads",
        attemptCount,
        lastAttemptAt: now,
        nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        errorLog,
        updatedAt: now,
      })
      .returning();
    document = row;
  }

  return { ok: true, action: shouldFail ? "failed" : "retry", documentId: document.id };
}
