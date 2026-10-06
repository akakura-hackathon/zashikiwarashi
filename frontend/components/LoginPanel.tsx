"use client";

// FN-02: Google ログインと、ログインユーザーのロールの確認（API-09 GET /me）。
// + Web Push / PWA スリープ通知テスト機能
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getMe, type Me } from "@/lib/api-client";
import { getFirebaseApp } from "@/lib/firebase";
import {
  requestPushPermission,
  scheduleSleepNotificationTest,
  type PushPermissionState,
} from "@/lib/push-notification";

export function LoginPanel() {
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [apiLoading, setApiLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");

  // Push notification state
  const [pushStatus, setPushStatus] = useState<PushPermissionState>("default");
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string>("");
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);

  const fetchRole = useCallback(async (current: User) => {
    setApiLoading(true);
    setMessage("");
    try {
      const data = await getMe(current);
      setMe(data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setMessage("このアカウントは未登録です。管理人にロール（admin/resident）の付与を依頼してください。");
      } else {
        setMessage(`API 接続待機中: ${String(error)}`);
      }
    } finally {
      setApiLoading(false);
    }
  }, []);

  useEffect(() => {
    const auth = getAuth(getFirebaseApp());
    const unsubscribe = onAuthStateChanged(auth, async (current) => {
      setUser(current);
      setMe(null);
      setLoading(false);
      if (current) {
        await fetchRole(current);
      }
    });
    return () => unsubscribe();
  }, [fetchRole]);

  // Check initial notification permission
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushStatus(Notification.permission as PushPermissionState);
    }
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(getAuth(getFirebaseApp()), new GoogleAuthProvider());
    } catch (err) {
      setMessage(`ログインに失敗しました: ${String(err)}`);
    }
  };

  const logout = async () => {
    await signOut(getAuth(getFirebaseApp()));
    setMe(null);
    setMessage("");
  };

  // Push notification activation
  const handleEnablePush = async () => {
    setPushMsg("通知権限をリクエスト中...");
    const res = await requestPushPermission();
    setPushStatus(res.status);
    if (res.token) {
      setFcmToken(res.token);
      setPushMsg("✅ 通知が有効化されました！");
    } else if (res.error) {
      setPushMsg(`⚠️ ${res.error}`);
    } else {
      setPushMsg("通知がブロックされているか、キャンセルされました。");
    }
  };

  // Trigger 5-second sleep test
  const handleTriggerSleepTest = async () => {
    setIsCountingDown(true);
    setCountdown(5);
    setPushMsg("【重要】すぐにiPhoneの電源ボタンを押してスリープ（画面ロック）にしてください！");

    try {
      await scheduleSleepNotificationTest(5, fcmToken || undefined);
    } catch (err) {
      setPushMsg(`エラー: ${String(err)}`);
      setIsCountingDown(false);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsCountingDown(false);
          setPushMsg("⚡ 通知が発火しました！ロック画面をご確認ください。");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    <div className="app-content">
      {/* App Brand Header */}
      <header className="app-header">
        <div className="app-badge">
          <span className="pulse-dot"></span>
          <span>Emergency Mutual Aid</span>
        </div>
        <h1 className="app-title">Zashikiwarashi</h1>
        <p className="app-subtitle">マンション内 潜在互助ネットワーク</p>
      </header>

      {loading ? (
        <div className="guardian-box">
          <img
            src="/icons/icon-192.png"
            alt="Zashikiwarashi"
            style={{ width: 64, height: 64, borderRadius: 14, margin: "0 auto 8px", display: "block" }}
          />
          <p className="guardian-sub">起動中...</p>
        </div>
      ) : !user ? (
        /* 未ログイン時の画面 */
        <div className="zashiki-card">
          <div className="guardian-box">
            <img
              src="/icons/icon-192.png"
              alt="Zashikiwarashi"
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                margin: "0 auto 12px",
                display: "block",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              }}
            />
            <div className="guardian-text">静かに佇む見守り</div>
            <p className="guardian-sub">
              平時の日常入力は不要です。緊急時のみ、住民同士の助け合いを安全に繋ぎます。
            </p>
          </div>

          <div style={{ marginTop: "12px" }}>
            <button type="button" className="btn-google" onClick={login}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.09C3.27 21.41 7.35 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.59H1.26C.46 8.18 0 9.99 0 12s.46 3.82 1.26 5.41l4.02-3.09z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.59 1.26 6.59l4.02 3.09c.95-2.83 3.6-4.93 6.72-4.93z"
                />
              </svg>
              <span>Google アカウントでログイン</span>
            </button>
          </div>
        </div>
      ) : (
        /* ログイン済み画面 */
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* 見守りステータスカード */}
          <div className="guardian-box">
            <img
              src="/icons/icon-192.png"
              alt="Zashikiwarashi"
              style={{
                width: 60,
                height: 60,
                borderRadius: 14,
                margin: "0 auto 8px",
                display: "block",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
              }}
            />
            <div className="guardian-text">静かに見守っています</div>
            <p className="guardian-sub">棟内は平常です。平時の手入力は不要です。</p>
          </div>

          {/* Web Push / スリープ通知テストカード */}
          <div className="zashiki-card" style={{ border: "1px solid rgba(249, 115, 22, 0.3)" }}>
            <div className="card-title">
              <span>🔔</span>
              <span>スリープ画面プッシュ通知テスト</span>
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--text-sub)", lineHeight: 1.45 }}>
              iPhone の画面ロック（スリープ）中でも通知がポップアップ表示されるか検証できます。
            </p>

            {pushStatus !== "granted" ? (
              <button type="button" className="btn-primary" onClick={handleEnablePush}>
                <span>🔔</span>
                <span>通知を有効にする（権限リクエスト）</span>
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.76rem", color: "var(--green-ok)" }}>
                  <span>✓</span>
                  <span>通知権限が許可されています</span>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTriggerSleepTest}
                  disabled={isCountingDown}
                  style={{ background: isCountingDown ? "#ea580c" : undefined }}
                >
                  <span>⏱️</span>
                  <span>
                    {isCountingDown
                      ? `送信待機中 (${countdown}秒) ... 電源ボタンでスリープ！`
                      : "5秒後にテスト通知を送信（スリープテスト）"}
                  </span>
                </button>
              </div>
            )}

            {pushMsg && (
              <p
                style={{
                  fontSize: "0.72rem",
                  color: isCountingDown ? "var(--amber-fire)" : "var(--text-sub)",
                  fontWeight: isCountingDown ? 700 : 400,
                  marginTop: "2px",
                }}
              >
                {pushMsg}
              </p>
            )}

            {fcmToken && (
              <details style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "4px" }}>
                <summary style={{ cursor: "pointer" }}>FCM デバイストークンを確認</summary>
                <div style={{ wordBreak: "break-all", padding: "6px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", marginTop: "4px" }}>
                  {fcmToken}
                </div>
              </details>
            )}

            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
              💡 <b>iPhoneの方へ</b>: Safariの共有ボタンから<b>「ホーム画面に追加」</b>したアイコンからアプリを開くと、スリープ画面でも確実に通知が表示されます。
            </div>
          </div>

          {/* アカウント情報カード */}
          <div className="zashiki-card">
            <div className="card-title">
              <span>👤</span>
              <span>アカウント情報</span>
            </div>

            <div className="data-grid">
              <span className="data-label">ログイン中</span>
              <span className="data-value" style={{ fontSize: "0.78rem" }}>
                {user.email}
              </span>

              <span className="data-label">ロール</span>
              <div>
                {me ? (
                  <span className={`badge-role ${me.role}`}>
                    {me.role === "admin" ? "管理人 (Admin)" : "住民 (Resident)"}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.76rem" }}>
                    {apiLoading ? "照会中..." : "未設定"}
                  </span>
                )}
              </div>

              {me && (
                <>
                  <span className="data-label">建物 ID</span>
                  <span className="data-value">{me.building_id ?? "-"}</span>

                  {me.role === "resident" && (
                    <>
                      <span className="data-label">住民 ID</span>
                      <span className="data-value">{me.resident_id}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* エラー / API未到達時のアラートカード */}
          {message && (
            <div className="alert-box" role="alert">
              <div className="alert-header">
                <span>ℹ️</span>
                <span>API ゲートウェイ接続状況</span>
              </div>
              <div className="alert-body">{message}</div>
              <p className="alert-hint">
                ※ ロール未設定やAPI接続待機中でも、上のプッシュ通知テストはお試しいただけます。
              </p>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: "6px", padding: "6px 12px", fontSize: "0.74rem" }}
                onClick={() => fetchRole(user)}
                disabled={apiLoading}
              >
                {apiLoading ? "再接続中..." : "再試行する"}
              </button>
            </div>
          )}

          {/* ログアウトボタン */}
          <div style={{ marginTop: "8px" }}>
            <button type="button" className="btn-secondary" onClick={logout}>
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
