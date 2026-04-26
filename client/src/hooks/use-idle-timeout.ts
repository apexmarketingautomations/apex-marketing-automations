import { useState, useEffect, useCallback, useRef } from "react";

const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const WARNING_BEFORE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

export function useIdleTimeout(isAuthenticated: boolean) {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showWarning) {
      setShowWarning(false);
      if (warningTimerRef.current) {
        clearInterval(warningTimerRef.current);
        warningTimerRef.current = null;
      }
    }
  }, [showWarning]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/apex-logout", { method: "POST", credentials: "include" });
    } catch {}
    window.location.href = "/login?reason=idle";
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handler = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handler));
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;

      if (idleMs >= IDLE_TIMEOUT_MS) {
        handleLogout();
        return;
      }

      const remaining = IDLE_TIMEOUT_MS - idleMs;
      if (remaining <= WARNING_BEFORE_MS && !showWarning) {
        setShowWarning(true);
        setRemainingSeconds(Math.ceil(remaining / 1000));

        warningTimerRef.current = setInterval(() => {
          const nowIdle = Date.now() - lastActivityRef.current;
          const nowRemaining = IDLE_TIMEOUT_MS - nowIdle;
          if (nowRemaining <= 0) {
            handleLogout();
          } else {
            setRemainingSeconds(Math.ceil(nowRemaining / 1000));
          }
        }, 1000);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (warningTimerRef.current) clearInterval(warningTimerRef.current);
    };
  }, [isAuthenticated, showWarning, handleLogout]);

  return {
    showWarning,
    remainingSeconds,
    dismissWarning: resetActivity,
  };
}
