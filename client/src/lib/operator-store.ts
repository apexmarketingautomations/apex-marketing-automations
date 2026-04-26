function isAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function makeKey(scope: string, userKey: string): string {
  return `layla_studio:${scope}:${userKey}`;
}

export function getOperatorString(scope: string, userKey: string): string | null {
  if (!isAvailable()) return null;
  try {
    return localStorage.getItem(makeKey(scope, userKey));
  } catch (err) {
    console.warn("operator-store: read failed", err);
    return null;
  }
}

export function setOperatorString(scope: string, userKey: string, value: string): void {
  if (!isAvailable()) return;
  try {
    localStorage.setItem(makeKey(scope, userKey), value);
  } catch (err) {
    console.warn("operator-store: write failed", err);
  }
}

export function removeOperatorString(scope: string, userKey: string): void {
  if (!isAvailable()) return;
  try {
    localStorage.removeItem(makeKey(scope, userKey));
  } catch (err) {
    console.warn("operator-store: remove failed", err);
  }
}
