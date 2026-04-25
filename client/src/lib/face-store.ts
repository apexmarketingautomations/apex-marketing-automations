const DB_NAME = "layla_studio";
const STORE_NAME = "face_refs";
const DB_VERSION = 1;

type StoredFace = {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

function isAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredFace(userKey: string): Promise<File | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDb();
    try {
      const stored = await new Promise<StoredFace | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(userKey);
        req.onsuccess = () => resolve(req.result as StoredFace | undefined);
        req.onerror = () => reject(req.error);
      });
      if (!stored) return null;
      return new File([stored.blob], stored.name, {
        type: stored.type,
        lastModified: stored.lastModified,
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn("face-store: getStoredFace failed", err);
    return null;
  }
}

export async function putStoredFace(userKey: string, file: File): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    try {
      const stored: StoredFace = {
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(stored, userKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn("face-store: putStoredFace failed", err);
  }
}

export async function clearStoredFace(userKey: string): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(userKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn("face-store: clearStoredFace failed", err);
  }
}
