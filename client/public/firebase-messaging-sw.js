importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyFirebaseKeyPlaceholder",
  authDomain: "apex-ma.firebaseapp.com",
  projectId: "apex-ma",
  storageBucket: "apex-ma.firebasestorage.app",
  messagingSenderId: "515378149213",
  appId: "1:515378149213:web:1e7fc4a9b8ff48ed939ab4",
  measurementId: "G-4JEVR8HBH4",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Apex Notification";
  const options = {
    body: payload.notification?.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: payload.data,
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
