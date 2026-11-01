importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDJzRldHhcwoCKYewhFx0cEjs8id9gGIlI",
  authDomain: "arousal-cross-hamani.firebaseapp.com",
  projectId: "arousal-cross-hamani",
  messagingSenderId: "70626915450",
  appId: "1:70626915450:web:89b47076bcf3749ae777c3"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "צלב העוררות", {
    body: n.body || "זמן לדיווח קצר",
    icon: "icons/icon-192.png",
    dir: "rtl",
    lang: "he",
    data: { url: "./" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return clients.openWindow("./");
  }));
});
