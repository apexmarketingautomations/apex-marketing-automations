import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, logEvent, type Analytics } from "firebase/analytics";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, type Auth, type User } from "firebase/auth";
import { getMessaging, getToken, onMessage, isSupported as isMessagingSupported, type Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAm8RknGMokA7ayLCObnNtm5VGwzItKReg",
  authDomain: "apex-ma.firebaseapp.com",
  projectId: "apex-ma",
  storageBucket: "apex-ma.firebasestorage.app",
  messagingSenderId: "515378149213",
  appId: "1:515378149213:web:1e7fc4a9b8ff48ed939ab4",
  measurementId: "G-4JEVR8HBH4",
};

let app: FirebaseApp | null = null;
let analytics: Analytics | null = null;
let auth: Auth | null = null;
let messaging: Messaging | null = null;

function getApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAnalytics(): Analytics | null {
  if (!analytics && typeof window !== "undefined") {
    try {
      analytics = getAnalytics(getApp());
    } catch (err) {
      console.warn("[Firebase] Analytics init failed:", err);
    }
  }
  return analytics;
}

export function trackEvent(eventName: string, params?: Record<string, any>) {
  const a = getFirebaseAnalytics();
  if (a) {
    logEvent(a, eventName, params);
  }
}

export function trackPageView(pagePath: string, pageTitle?: string) {
  trackEvent("page_view", { page_path: pagePath, page_title: pageTitle || pagePath });
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getApp());
  }
  return auth;
}

const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<User> {
  const firebaseAuth = getFirebaseAuth();
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  return result.user;
}

export async function firebaseSignOut(): Promise<void> {
  const firebaseAuth = getFirebaseAuth();
  await signOut(firebaseAuth);
}

export function onFirebaseAuthStateChanged(callback: (user: User | null) => void): () => void {
  const firebaseAuth = getFirebaseAuth();
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const firebaseAuth = getFirebaseAuth();
  const user = firebaseAuth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!messaging && typeof window !== "undefined") {
    try {
      const supported = await isMessagingSupported();
      if (!supported) {
        console.warn("[Firebase] Messaging not supported in this browser");
        return null;
      }
      messaging = getMessaging(getApp());
    } catch (err) {
      console.warn("[Firebase] Messaging init failed:", err);
    }
  }
  return messaging;
}

export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[Firebase] Notification permission denied");
      return null;
    }

    const msg = await getFirebaseMessaging();
    if (!msg) return null;

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(msg, { vapidKey: vapidKey || undefined });
    console.log("[Firebase] FCM token:", token?.substring(0, 20) + "...");
    return token;
  } catch (err) {
    console.warn("[Firebase] Failed to get FCM token:", err);
    return null;
  }
}

export async function onForegroundMessage(callback: (payload: any) => void): Promise<(() => void) | null> {
  const msg = await getFirebaseMessaging();
  if (!msg) return null;
  return onMessage(msg, callback);
}
