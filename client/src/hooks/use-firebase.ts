import { useEffect, useRef } from "react";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";
import { trackPageView, requestNotificationPermission, onForegroundMessage, getFirebaseAnalytics } from "@/lib/firebase";
import { useLocation } from "wouter";

export function useFirebaseAnalytics() {
  const [location] = useLocation();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      getFirebaseAnalytics();
      trackPageView(location);
    }
  }, []);

  useEffect(() => {
    if (initialized.current) {
      trackPageView(location);
    }
  }, [location]);
}

export function useFirebaseNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        const token = await requestNotificationPermission();
        if (token) {
          await fetch("/api/auth/fcm-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ token }),
          });
        }
      } catch (err) {
        console.warn("[Firebase] Notification setup error:", err);
      }
    })();

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    onForegroundMessage((payload) => {
      toast({
        title: payload.notification?.title || "Notification",
        description: payload.notification?.body || "",
      });
    }).then((unsub) => {
      if (cancelled) {
        unsub?.();
      } else {
        unsubscribe = unsub;
      }
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [user, toast]);
}
