// @ts-nocheck
import type { OperatorMemory } from "./types";

const memoryStore = new Map<string, OperatorMemory>();
const MAX_ENTRIES = 2000;

function makeKey(subAccountId: number, key: string): string {
  return `${subAccountId}:${key}`;
}

export function setMemory(subAccountId: number, key: string, value: any, ttlMs?: number): void {
  const storeKey = makeKey(subAccountId, key);
  memoryStore.set(storeKey, {
    subAccountId,
    key,
    value,
    updatedAt: new Date().toISOString(),
    expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
  });
  cleanExpired();
}

export function getMemory(subAccountId: number, key: string): any | null {
  const storeKey = makeKey(subAccountId, key);
  const entry = memoryStore.get(storeKey);
  if (!entry) return null;
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    memoryStore.delete(storeKey);
    return null;
  }
  return entry.value;
}

export function deleteMemory(subAccountId: number, key: string): boolean {
  return memoryStore.delete(makeKey(subAccountId, key));
}

export function listMemory(subAccountId: number): OperatorMemory[] {
  cleanExpired();
  return [...memoryStore.values()].filter(m => m.subAccountId === subAccountId);
}

export function getSessionContext(subAccountId: number): Record<string, any> {
  const entries = listMemory(subAccountId);
  const context: Record<string, any> = {};
  for (const entry of entries) {
    context[entry.key] = entry.value;
  }
  return context;
}

export function recordOperatorAction(subAccountId: number, action: string, details: any): void {
  const historyKey = "operator_action_history";
  const history = getMemory(subAccountId, historyKey) || [];
  history.push({
    action,
    details,
    timestamp: new Date().toISOString(),
  });
  if (history.length > 100) history.splice(0, history.length - 100);
  setMemory(subAccountId, historyKey, history);
}

function cleanExpired(): void {
  const now = new Date();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt && new Date(entry.expiresAt) < now) {
      memoryStore.delete(key);
    }
  }
  if (memoryStore.size > MAX_ENTRIES) {
    const sorted = [...memoryStore.entries()].sort((a, b) =>
      new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime()
    );
    const toRemove = sorted.slice(0, sorted.length - MAX_ENTRIES);
    for (const [key] of toRemove) memoryStore.delete(key);
  }
}
