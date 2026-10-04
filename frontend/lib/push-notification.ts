// Web Push / FCM Push notification helper
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { getFirebaseApp } from "./firebase";

export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

export async function checkPushSupport(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) {
    return false;
  }
  return await isSupported();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const app = getFirebaseApp();
    const config = app.options;
    const query = new URLSearchParams({
      apiKey: config.apiKey ?? "",
      projectId: config.projectId ?? "",
      messagingSenderId: config.messagingSenderId ?? "",
      appId: config.appId ?? "",
    }).toString();

    const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${query}`, {
      scope: "/",
    });
    console.log("[Push] Service Worker registered:", registration.scope);
    return registration;
  } catch (error) {
    console.error("[Push] Service Worker registration failed:", error);
    return null;
  }
}

export async function requestPushPermission(vapidKey?: string): Promise<{
  token: string | null;
  status: PushPermissionState;
  error?: string;
}> {
  const supported = await checkPushSupport();
  if (!supported) {
    return { token: null, status: "unsupported", error: "このブラウザはWeb Pushに対応していません（iOSの場合はホーム画面に追加してください）" };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { token: null, status: permission };
    }

    const swReg = await registerServiceWorker();
    if (!swReg) {
      return { token: null, status: "denied", error: "Service Workerの登録に失敗しました" };
    }

    const app = getFirebaseApp();
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      serviceWorkerRegistration: swReg,
      vapidKey: vapidKey || process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    });

    console.log("[Push] FCM Device Token obtained:", token);
    return { token, status: "granted" };
  } catch (err) {
    console.error("[Push] Token acquisition error:", err);
    return { token: null, status: "denied", error: String(err) };
  }
}

// 5秒後にテスト通知をトリガーする（ローカル通知またはバックエンド呼び出し）
export async function scheduleSleepNotificationTest(
  delaySeconds: number = 5,
  token?: string
): Promise<void> {
  if (typeof window === "undefined" || Notification.permission !== "granted") {
    throw new Error("通知権限が許可されていません");
  }

  // 1. バックエンドに token があれば FCM 経由で送る（本物のAPNsプッシュ）
  if (token && process.env.NEXT_PUBLIC_API_BASE_URL) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/push/test-sleep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, delay_seconds: delaySeconds }),
      });
      return;
    } catch (e) {
      console.warn("[Push] Backend push failed, falling back to Service Worker delay", e);
    }
  }

  // 2. フォールバック: Service Worker から遅延通知（ローカルポップアップ）
  const reg = await navigator.serviceWorker.ready;
  setTimeout(() => {
    reg.showNotification("⚡ 停電が発生しました", {
      body: "少し手を貸せますか？ 4分ほど階段でお水を運ぶお願いです。",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "zashiki-sleep-test",
      requireInteraction: true,
      vibrate: [200, 100, 200],
    } as NotificationOptions);
  }, delaySeconds * 1000);
}
