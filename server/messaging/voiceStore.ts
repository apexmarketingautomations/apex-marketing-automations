import { mkdir, writeFile, stat, readdir, unlink, access } from "fs/promises";
import { join, resolve, basename } from "path";
import { randomUUID } from "crypto";
import { constants as fsConstants } from "fs";

const VOICE_DIR = resolve(process.cwd(), "data", "voice");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;    // 1 hour
const ID_PATTERN = /^[a-f0-9-]{8,64}$/i;

let initialized = false;
let initPromise: Promise<void> | null = null;

export interface PersistedVoice {
  id: string;
  url: string;
  filePath: string;
  bytes: number;
  createdAtIso: string;
}

async function ensureInit(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await mkdir(VOICE_DIR, { recursive: true });
      initialized = true;
      console.log(`[VOICE-STORE] Ready dir=${VOICE_DIR} maxAge=${Math.round(MAX_AGE_MS / 86400000)}d`);
      cleanupOldVoiceFiles().catch(e =>
        console.warn(`[VOICE-STORE] Startup sweep failed: ${e?.message || e}`)
      );
      setInterval(() => {
        cleanupOldVoiceFiles().catch(e =>
          console.warn(`[VOICE-STORE] Periodic sweep failed: ${e?.message || e}`)
        );
      }, SWEEP_INTERVAL_MS).unref();
    } catch (e: any) {
      console.error(`[VOICE-STORE] Init failed: ${e?.message || e}`);
      initialized = true; // mark anyway so we don't loop
    }
  })();
  return initPromise;
}

export async function persistVoiceFile(
  buffer: Buffer,
  meta: { textUsed?: string; subAccountId?: number | null; channel?: string | null } = {}
): Promise<PersistedVoice | null> {
  try {
    await ensureInit();
    if (!buffer || buffer.length === 0) return null;
    const id = randomUUID();
    const filePath = join(VOICE_DIR, `${id}.mp3`);
    await writeFile(filePath, buffer);
    const url = `/voice/${id}.mp3`;
    const persisted: PersistedVoice = {
      id,
      url,
      filePath,
      bytes: buffer.length,
      createdAtIso: new Date().toISOString(),
    };
    console.log(`[VOICE-STORE] Persisted id=${id} bytes=${buffer.length} subAccount=${meta.subAccountId ?? "n/a"} channel=${meta.channel ?? "n/a"}`);
    return persisted;
  } catch (e: any) {
    console.warn(`[VOICE-STORE] Persist failed (non-blocking): ${e?.message || e}`);
    return null;
  }
}

export async function resolveVoiceFilePath(rawId: string): Promise<string | null> {
  await ensureInit();
  const id = (rawId || "").replace(/\.mp3$/i, "");
  if (!ID_PATTERN.test(id)) return null;
  const filePath = join(VOICE_DIR, `${id}.mp3`);
  // Defense-in-depth path containment check
  if (!filePath.startsWith(VOICE_DIR + "/") && filePath !== join(VOICE_DIR, basename(filePath))) {
    return null;
  }
  try {
    await access(filePath, fsConstants.R_OK);
    return filePath;
  } catch {
    return null;
  }
}

export async function cleanupOldVoiceFiles(maxAgeMs: number = MAX_AGE_MS): Promise<{ scanned: number; deleted: number }> {
  await ensureInit();
  let scanned = 0;
  let deleted = 0;
  try {
    const entries = await readdir(VOICE_DIR);
    const cutoff = Date.now() - maxAgeMs;
    for (const name of entries) {
      if (!name.endsWith(".mp3")) continue;
      scanned++;
      const fp = join(VOICE_DIR, name);
      try {
        const st = await stat(fp);
        if (st.mtimeMs < cutoff) {
          await unlink(fp);
          deleted++;
        }
      } catch {}
    }
    if (scanned > 0) {
      console.log(`[VOICE-STORE][SWEEP] scanned=${scanned} deleted=${deleted} maxAgeDays=${Math.round(maxAgeMs / 86400000)}`);
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      console.warn(`[VOICE-STORE][SWEEP] error: ${e?.message || e}`);
    }
  }
  return { scanned, deleted };
}

export function getVoiceStoreInfo() {
  return { dir: VOICE_DIR, maxAgeMs: MAX_AGE_MS, sweepIntervalMs: SWEEP_INTERVAL_MS };
}
