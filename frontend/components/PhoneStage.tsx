"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  type Persona,
  type Task,
  type TaskDetailResponse,
  type IssueDetailResponse,
  type AuditEvent,
  confirmPresence,
  respondToTask,
  reportTask,
  getTaskDetail,
  getMyAuditEvents,
} from "@/lib/api-client";
import {
  requestPushPermission,
  scheduleSleepNotificationTest,
  type PushPermissionState,
} from "@/lib/push-notification";

import type { User } from "firebase/auth";

type PhoneStageProps = {
  activePersona: Persona;
  emergencyId: string | null;
  tasks: Task[];
  issueDetail: IssueDetailResponse | null;
  onActionComplete: (logText: string) => Promise<void>;
  isLoading: boolean;
  user: User | null;
};

export function PhoneStage({
  activePersona,
  emergencyId,
  tasks,
  issueDetail,
  onActionComplete,
  isLoading,
  user,
}: PhoneStageProps) {
  const [activeTab, setActiveTab] = useState<"scenario" | "audit" | "push">("scenario");
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // サーバー上の安否ステータスと直接同期（ペルソナ切り替え時に正しく反映）
  const currentResidentSafety = issueDetail?.resident_states?.[activePersona.userId] ?? "UNKNOWN";
  const isSafetyAnswered = currentResidentSafety === "SAFE" || currentResidentSafety === "NEED_HELP";

  // Push notification state
  const [pushStatus, setPushStatus] = useState<PushPermissionState>("default");
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string>("");
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);

  // 自分の担当タスクを探す
  const myTask = tasks.find((t) => t.assigned_resident_id === activePersona.userId);

  // タスク詳細取得（Progressive Disclosure の開示状態確認）
  const fetchTaskDetail = useCallback(async () => {
    if (!myTask) {
      setTaskDetail(null);
      return;
    }
    try {
      const detail = await getTaskDetail(user, myTask.task_id, activePersona);
      setTaskDetail(detail);
    } catch (err) {
      console.error("Failed to fetch task detail:", err);
    }
  }, [myTask, user, activePersona]);

  useEffect(() => {
    fetchTaskDetail();
  }, [fetchTaskDetail]);

  // 監査イベント取得
  const fetchAuditEvents = useCallback(async () => {
    try {
      const res = await getMyAuditEvents(user, activePersona);
      setAuditEvents(res.audit_events);
    } catch (err) {
      console.error("Failed to fetch audit events:", err);
    }
  }, [user, activePersona]);

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAuditEvents();
    }
  }, [activeTab, fetchAuditEvents]);

  // Push通知の初期状態確認
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushStatus(Notification.permission as PushPermissionState);
    }
  }, []);

  // 安否回答 (API-02)
  const handleConfirmPresence = async (safetyStatus: "SAFE" | "NEED_HELP") => {
    if (!emergencyId) return;
    try {
      await confirmPresence(
        user,
        {
          emergency_id: emergencyId,
          safety_status: safetyStatus,
          message: safetyStatus === "SAFE" ? "室内転倒なし、動けます。" : "家具が転倒し足が挟まれました。",
        },
        activePersona,
      );
      await onActionComplete(
        `[API-02] ${activePersona.name} が安否回答を送信しました (status=${safetyStatus})`,
      );
    } catch (err) {
      alert(`安否回答に失敗しました: ${String(err)}`);
    }
  };

  // タスク打診回答 (API-04)
  const handleRespondTask = async (response: "APPROVED" | "DECLINED") => {
    if (!myTask) return;
    try {
      await respondToTask(user, myTask.task_id, response, undefined, activePersona);
      await onActionComplete(
        `[API-04] ${activePersona.name} がタスク打診に回答しました (response=${response})`,
      );
      await fetchTaskDetail();
    } catch (err) {
      alert(`打診回答に失敗しました: ${String(err)}`);
    }
  };

  // タスク結果報告 (API-05)
  const handleReportTask = async (reasonCode: "TARGET_RESPONDED" | "TARGET_NO_RESPONSE") => {
    if (!myTask) return;
    try {
      await reportTask(user, myTask.task_id, "COMPLETED", reasonCode, activePersona);
      await onActionComplete(
        `[API-05] ${activePersona.name} が現地確認結果を完了報告しました (reason=${reasonCode})`,
      );
      await fetchTaskDetail();
    } catch (err) {
      alert(`完了報告に失敗しました: ${String(err)}`);
    }
  };

  // Push通知有効化
  const handleEnablePush = async () => {
    setPushMsg("通知権限をリクエスト中...");
    const res = await requestPushPermission();
    setPushStatus(res.status);
    if (res.token) {
      setFcmToken(res.token);
      setPushMsg("✅ Web Pushが有効化されました！");
    } else if (res.error) {
      setPushMsg(`⚠️ ${res.error}`);
    }
  };

  // スリープ通知テスト
  const handleTriggerSleepTest = async () => {
    if (!fcmToken) return;
    setIsCountingDown(true);
    setCountdown(5);
    setPushMsg("画面をロックしてください...");
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsCountingDown(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      await scheduleSleepNotificationTest(5, fcmToken);
      setPushMsg("✅ 5秒後に通知を送信しました。ロック画面をご確認ください。");
    } catch (err) {
      setPushMsg(`エラー: ${String(err)}`);
      setIsCountingDown(false);
    }
  };

  return (
    <main className="device-stage">
      <div className="device-wrapper">
        <div className="device-screen">
          {/* iOS-style Status Notch */}
          <div className="device-notch-bar">
            <span>9:41</span>
            <div className="device-notch">
              <span className="notch-camera-dot"></span>
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "0.72rem" }}>5G</span>
              <span>100%</span>
            </div>
          </div>

          {/* App Header */}
          <div className="app-header">
            <div className="persona-switch-bar">
              <div className="persona-info">
                <span>🏠</span>
                <span>{activePersona.roomNumber}号室</span>
                <span style={{ color: "var(--text-sub)", fontWeight: 500 }}>
                  {activePersona.name}
                </span>
              </div>
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: activePersona.role === "admin" ? "rgba(249, 115, 22, 0.2)" : "rgba(34, 197, 94, 0.2)",
                  color: activePersona.role === "admin" ? "var(--amber-fire)" : "var(--green-ok)",
                  fontWeight: 700,
                }}
              >
                {activePersona.role === "admin" ? "ADMIN" : "RESIDENT"}
              </span>
            </div>
          </div>

          {/* App Scrollable Content */}
          <div className="app-content">
            {activeTab === "scenario" && (
              <>
                {/* 1. 平常時（災害未発令） */}
                {!emergencyId && (
                  <div className="zashiki-card">
                    <div className="card-title">
                      <span>🛡️ 平常見守りモード</span>
                      <span style={{ color: "var(--green-ok)", fontSize: "0.75rem" }}>● 正常稼働</span>
                    </div>
                    <div style={{ textAlign: "center", padding: "20px 0" }}>
                      <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>🏮</div>
                      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#ffffff" }}>
                        座敷わらしが見守っています
                      </div>
                      <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: "6px" }}>
                        平時の手入力は不要です。緊急事態発生時のみ、必要な情報と極小タスクをお届けします。
                      </div>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "10px" }}>
                      💡 左側シミュレーター操作卓の「⚡ 震度5強 地震発生」を押すと、有事シナリオを開始できます。
                    </div>
                  </div>
                )}

                {/* 2. 災害発令中 & 安否未回答 */}
                {emergencyId && !isSafetyAnswered && (
                  <div className="zashiki-card highlight">
                    <div className="card-title">
                      <span>🚨 緊急安否確認 (API-02)</span>
                      <span style={{ color: "var(--amber-fire)", fontSize: "0.72rem" }}>1タップ回答</span>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#ffffff", fontWeight: 700 }}>
                      震度5強の地震が発生しました。<br />
                      ご自身とお部屋はご無事ですか？
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                      無事な住民の方へ、最寄りの隣室確認タスク（約20秒）の打診をお願いする場合があります。
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
                      <button
                        className="btn-primary"
                        onClick={() => handleConfirmPresence("SAFE")}
                        disabled={isLoading}
                      >
                        ✅ 自身・室内ともに無事です
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => handleConfirmPresence("NEED_HELP")}
                        disabled={isLoading}
                      >
                        ⚠️ 室内負傷・閉じ込め等で救助が必要
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. 安否回答済み & タスク打診なし */}
                {emergencyId && isSafetyAnswered && !myTask && (
                  <div className="zashiki-card">
                    <div className="card-title">
                      <span>✅ 安否回答を受理しました</span>
                      <span style={{ color: "var(--green-ok)", fontSize: "0.75rem" }}>回答済</span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-sub)" }}>
                      ご回答ありがとうございました。<br />
                      現在、棟内全体の安否を集約しトリアージを行っています。
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "10px" }}>
                      💡 左側操作卓の「🎯 トリアージ開始」を実行すると、近隣の未応答住戸に対する隣室確認タスクが打診されます。
                    </div>
                  </div>
                )}

                {/* 4. タスク打診中 (OFFERED) - Progressive Disclosure */}
                {myTask && myTask.status === "OFFERED" && (
                  <div className="zashiki-card highlight">
                    <div className="card-title">
                      <span>🤝 極小タスクの打診 (API-04)</span>
                      <span style={{ color: "var(--amber-fire)", fontSize: "0.72rem" }}>約20秒</span>
                    </div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#ffffff" }}>
                      隣の部屋のインターホンを1回確認できますか？
                    </div>
                    <div style={{ fontSize: "0.76rem", color: "var(--text-sub)", lineHeight: 1.45 }}>
                      ご自身の安全確保後、同じ階の近隣住戸の応答有無のみご確認をお願いします。室内に入る必要はありません。
                    </div>

                    {/* Progressive Disclosure: 未承認時は部屋番号マスク */}
                    <div className="disclosure-box">
                      <div className="room-badge-locked">
                        <span>🔒 確認対象: 3階の近隣住戸</span>
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        ※ プライバシー保護のため、引き受け承認後にのみ具体的な部屋番号が開示されます。
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      <button
                        className="btn-primary"
                        style={{ flex: 2 }}
                        onClick={() => handleRespondTask("APPROVED")}
                        disabled={isLoading}
                      >
                        手伝える（約20秒）
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ flex: 1 }}
                        onClick={() => handleRespondTask("DECLINED")}
                        disabled={isLoading}
                      >
                        今は無理
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. タスク承認済み (APPROVED / IN_PROGRESS) - 部屋番号開示 & 結果報告 */}
                {myTask && (myTask.status === "APPROVED" || myTask.status === "IN_PROGRESS") && (
                  <div className="zashiki-card highlight">
                    <div className="card-title">
                      <span>🚪 現地確認の実行 & 完了報告 (API-05)</span>
                      <span style={{ color: "var(--green-ok)", fontSize: "0.72rem" }}>進行中</span>
                    </div>

                    {/* Progressive Disclosure: 承認後に部屋番号が開示 */}
                    <div className="disclosure-box unlocked">
                      <div className="room-badge-unlocked">
                        <span>🔓 確認対象: {taskDetail?.target_room_number ?? "302"} 号室</span>
                      </div>
                      <div style={{ fontSize: "0.74rem", color: "#86efac" }}>
                        ✔ 承認により部屋番号が開示されました（監査ログに記録済み）
                      </div>
                    </div>

                    <div style={{ fontSize: "0.78rem", color: "var(--text-sub)", lineHeight: 1.45 }}>
                      <strong>手順:</strong> 廊下に出て、<strong>{taskDetail?.target_room_number ?? "302"}号室</strong>のインターホンを1回鳴らし、応答があるか確認してください。
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
                      <button
                        className="btn-danger"
                        onClick={() => handleReportTask("TARGET_NO_RESPONSE")}
                        disabled={isLoading}
                      >
                        🚨 応答なし（声・返事なし）
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => handleReportTask("TARGET_RESPONDED")}
                        disabled={isLoading}
                      >
                        ✅ 応答あり（無事を確認）
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. タスク完了 (COMPLETED) */}
                {myTask && myTask.status === "COMPLETED" && (
                  <div className="zashiki-card">
                    <div className="card-title">
                      <span>🎉 確認完了</span>
                      <span style={{ color: "var(--green-ok)", fontSize: "0.75rem" }}>完了</span>
                    </div>
                    <div style={{ textAlign: "center", padding: "16px 0" }}>
                      <div style={{ fontSize: "2rem", marginBottom: "6px" }}>🙏</div>
                      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#ffffff" }}>
                        ご協力ありがとうございました
                      </div>
                      <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: "4px" }}>
                        確認結果は防災センターへ即座に共有され、優先救助トリアージに反映されました。
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* タブ2: 監査ログ (API-07) */}
            {activeTab === "audit" && (
              <div className="zashiki-card">
                <div className="card-title">
                  <span>📜 個人監査ログ閲覧 (API-07)</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>改ざん不能</span>
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                  あなたの個人データ（部屋番号等）が開示された記録です。人物プロファイリングや評価スコア化は行われません。
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
                  {auditEvents.length === 0 ? (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
                      監査イベントはまだありません
                    </div>
                  ) : (
                    auditEvents.map((e) => (
                      <div
                        key={e.audit_id}
                        style={{
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid var(--phone-card-border)",
                          borderRadius: "10px",
                          padding: "10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: "var(--amber-fire)", fontSize: "0.75rem" }}>
                            {e.event_name}
                          </span>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                            {new Date(e.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.74rem", color: "#ffffff" }}>
                          {e.description}
                        </div>
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                          実行者: {e.actor_type} ({e.actor_id})
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* タブ3: Push通知設定 */}
            {activeTab === "push" && (
              <div className="zashiki-card">
                <div className="card-title">
                  <span>🔔 Web Push・スリープ通知テスト</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--amber-fire)" }}>iOS 16.4+ / PWA</span>
                </div>
                <div style={{ fontSize: "0.74rem", color: "var(--text-sub)", lineHeight: 1.45 }}>
                  災害時のロック画面通知（FCM HTTP v1 / APNs 連携）を検証できます。
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
                  {pushStatus !== "granted" ? (
                    <button className="btn-primary" onClick={handleEnablePush}>
                      📢 通知を許可する (VAPID)
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      onClick={handleTriggerSleepTest}
                      disabled={isCountingDown || !fcmToken}
                    >
                      {isCountingDown ? `⏳ ${countdown}秒後に送信... 画面をロックしてください` : "⚡ 5秒後スリープ画面通知テスト"}
                    </button>
                  )}

                  {pushMsg && (
                    <div style={{ fontSize: "0.72rem", color: "#cbd5e1", background: "rgba(0,0,0,0.3)", padding: "8px", borderRadius: "8px" }}>
                      {pushMsg}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Tabs */}
          <nav className="app-tabs">
            <button
              className={`tab-btn ${activeTab === "scenario" ? "active" : ""}`}
              onClick={() => setActiveTab("scenario")}
            >
              <span>🛡️</span>
              <span>災害対応</span>
            </button>
            <button
              className={`tab-btn ${activeTab === "audit" ? "active" : ""}`}
              onClick={() => setActiveTab("audit")}
            >
              <span>📜</span>
              <span>監査ログ</span>
            </button>
            <button
              className={`tab-btn ${activeTab === "push" ? "active" : ""}`}
              onClick={() => setActiveTab("push")}
            >
              <span>🔔</span>
              <span>Push通知</span>
            </button>
          </nav>
        </div>
      </div>
    </main>
  );
}
