const VISITOR_KEY = "apex_visitor_id";
const SESSION_KEY = "apex_session_id";
const SESSION_EXPIRY_KEY = "apex_session_expiry";
const STICKY_KEY = "apex_liquid_contact";
const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const QUEUE_KEY = "apex_event_queue";
const BATCH_INTERVAL_MS = 3000;
const MAX_QUEUE_SIZE = 500;
const SCROLL_DEPTHS_TRACKED = new Set<number>();

let _subAccountId: number | null = null;
let _siteId: number | null = null;
let _inited = false;
let _batchTimer: ReturnType<typeof setTimeout> | null = null;
let _localQueue: any[] = [];

function getOrCreate(key: string, factory: () => string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = factory();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return factory();
  }
}

function generateId(): string {
  return crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getVisitorId(): string {
  return getOrCreate(VISITOR_KEY, generateId);
}

function getSessionId(): string {
  try {
    const expiry = parseInt(localStorage.getItem(SESSION_EXPIRY_KEY) || "0", 10);
    if (Date.now() < expiry) {
      const sid = localStorage.getItem(SESSION_KEY);
      if (sid) {
        localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_EXPIRY_MS));
        return sid;
      }
    }
    const sid = generateId();
    localStorage.setItem(SESSION_KEY, sid);
    localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_EXPIRY_MS));
    return sid;
  } catch {
    return generateId();
  }
}

function getUtmParams(): Record<string, string> {
  const params: Record<string, string> = {};
  try {
    const search = new URLSearchParams(window.location.search);
    for (const [key, val] of [
      ["utmSource", "utm_source"],
      ["utmMedium", "utm_medium"],
      ["utmCampaign", "utm_campaign"],
      ["utmContent", "utm_content"],
      ["utmTerm", "utm_term"],
    ] as const) {
      const v = search.get(val);
      if (v) params[key] = v;
    }
  } catch {}
  return params;
}

function getDeviceInfo(): { device: string; browser: string; os: string } {
  try {
    const ua = navigator.userAgent;
    const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
    const browser =
      /Chrome/.test(ua) ? "chrome" :
      /Firefox/.test(ua) ? "firefox" :
      /Safari/.test(ua) ? "safari" :
      /Edge/.test(ua) ? "edge" : "other";
    const os =
      /Windows/.test(ua) ? "windows" :
      /Mac/.test(ua) ? "macos" :
      /Linux/.test(ua) ? "linux" :
      /Android/.test(ua) ? "android" :
      /iOS|iPhone|iPad/.test(ua) ? "ios" : "other";
    return { device, browser, os };
  } catch {
    return { device: "unknown", browser: "unknown", os: "unknown" };
  }
}

function getStickyContact(): { email?: string; phone?: string; firstName?: string } | null {
  try {
    const raw = localStorage.getItem(STICKY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function buildBaseEvent(eventType: string, payload?: Record<string, any>) {
  const contact = getStickyContact();
  const { device, browser, os } = getDeviceInfo();
  return {
    eventType,
    sessionId: getSessionId(),
    visitorId: getVisitorId(),
    page: window.location.href.slice(0, 1024),
    referrer: document.referrer.slice(0, 1024) || undefined,
    device,
    browser,
    os,
    ...getUtmParams(),
    ...(contact?.email ? { contactEmail: contact.email } : {}),
    ...(contact?.phone ? { contactPhone: contact.phone } : {}),
    payload: payload || {},
    clientTimestamp: new Date().toISOString(),
  };
}

function enqueueEvent(event: any) {
  _localQueue.push(event);
  if (_localQueue.length > MAX_QUEUE_SIZE) {
    _localQueue = _localQueue.slice(-MAX_QUEUE_SIZE);
  }
  scheduleBatch();
}

function scheduleBatch() {
  if (_batchTimer) return;
  _batchTimer = setTimeout(flushQueue, BATCH_INTERVAL_MS);
}

async function flushQueue() {
  _batchTimer = null;
  if (_localQueue.length === 0 || !_subAccountId) return;

  const batch = _localQueue.splice(0, 50);
  const payload = {
    subAccountId: _subAccountId,
    siteId: _siteId,
    events: batch,
  };

  try {
    await fetch("/api/track/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (err) {
    _localQueue.unshift(...batch);
    console.warn("[apex-tracker] Flush failed, events re-queued:", (err as Error).message);
  }

  if (_localQueue.length > 0) scheduleBatch();
}

export function track(eventType: string, payload?: Record<string, any>) {
  if (!_inited) return;
  enqueueEvent(buildBaseEvent(eventType, payload));
}

function initScrollTracking() {
  const depths = [25, 50, 75, 90];
  const onScroll = () => {
    const scrolled = window.scrollY + window.innerHeight;
    const total = document.documentElement.scrollHeight;
    if (total <= 0) return;
    const pct = Math.round((scrolled / total) * 100);
    for (const depth of depths) {
      if (pct >= depth && !SCROLL_DEPTHS_TRACKED.has(depth)) {
        SCROLL_DEPTHS_TRACKED.add(depth);
        track("scroll_depth", { depth_pct: depth });
      }
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initClickTracking() {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const el = target?.closest("a, button, [data-apex-cta]");
    if (!el) return;
    const isCta = el.hasAttribute("data-apex-cta") || el.matches("[data-testid*='cta'], [class*='cta']");
    const eventType = isCta ? "cta_click" : "click";
    track(eventType, {
      element: el.tagName.toLowerCase(),
      text: (el.textContent || "").slice(0, 100),
      href: (el as HTMLAnchorElement).href || undefined,
      testId: el.getAttribute("data-testid") || undefined,
    });
  });
}

function initFormTracking() {
  const startedForms = new WeakSet<HTMLFormElement>();
  const filledForms = new WeakSet<HTMLFormElement>();

  document.addEventListener("focusin", (e) => {
    const form = (e.target as HTMLElement)?.closest("form");
    if (form && !startedForms.has(form as HTMLFormElement)) {
      startedForms.add(form as HTMLFormElement);
      track("form_start", { formId: (form as HTMLFormElement).id || undefined, action: (form as HTMLFormElement).action || undefined });
    }
  });

  document.addEventListener("input", (e) => {
    const form = (e.target as HTMLElement)?.closest("form");
    if (form && startedForms.has(form as HTMLFormElement) && !filledForms.has(form as HTMLFormElement)) {
      filledForms.add(form as HTMLFormElement);
      track("form_fill", { formId: (form as HTMLFormElement).id || undefined });
    }
  });

  document.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    if (form) {
      track("form_submit", { formId: form.id || undefined, action: form.action || undefined });
    }
  });

  document.addEventListener("focusout", (e) => {
    const form = (e.target as HTMLElement)?.closest("form");
    if (form && startedForms.has(form as HTMLFormElement)) {
      setTimeout(() => {
        if (!document.activeElement?.closest("form") || document.activeElement?.closest("form") !== form) {
          track("form_abandon", { formId: (form as HTMLFormElement).id || undefined });
        }
      }, 200);
    }
  });
}

export function identifyVisitor(data: { email?: string; phone?: string; firstName?: string }) {
  try {
    localStorage.setItem(STICKY_KEY, JSON.stringify(data));
  } catch {}
  track("identity_resolved", { ...data });
}

export function initApexTracker(config: { subAccountId: number; siteId?: number }) {
  if (_inited) return;
  _subAccountId = config.subAccountId;
  _siteId = config.siteId ?? null;
  _inited = true;

  track("page_view", {
    title: document.title,
    path: window.location.pathname,
  });

  initScrollTracking();
  initClickTracking();
  initFormTracking();

  window.addEventListener("beforeunload", () => {
    flushQueue();
  });

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushQueue();
    }
  });

  console.log(`[apex-tracker] Initialized for account ${_subAccountId}`);
}

export function getApexTrackerId() {
  return {
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
  };
}

declare global {
  interface Window {
    apexTrack?: typeof track;
    apexIdentify?: typeof identifyVisitor;
    apexInit?: typeof initApexTracker;
  }
}

if (typeof window !== "undefined") {
  window.apexTrack = track;
  window.apexIdentify = identifyVisitor;
  window.apexInit = initApexTracker;
}
