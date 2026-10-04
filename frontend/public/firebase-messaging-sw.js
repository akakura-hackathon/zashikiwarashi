// Scripts for firebase messaging service worker
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

// Initialize Firebase in Service Worker
// Note: Config is injected from URL params or default placeholder
const urlParams = new URLSearchParams(location.search);
const firebaseConfig = {
  apiKey: urlParams.get("apiKey") || "",
  projectId: urlParams.get("projectId") || "",
  messagingSenderId: urlParams.get("messagingSenderId") || "",
  appId: urlParams.get("appId") || "",
};

if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log("[firebase-messaging-sw.js] Received background message: ", payload);
    const notificationTitle = payload.notification?.title || "⚡ Zashikiwarashi 緊急通知";
    const notificationOptions = {
      body: payload.notification?.body || "緊急のお知らせがあります。タップして確認してください。",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.data?.tag || "zashiki-emergency",
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: payload.data || {},
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

// Notification click event
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});
