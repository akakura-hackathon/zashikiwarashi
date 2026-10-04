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

// UI Components conforming to docs/UI_DESIGN_SPEC.md
import { AppBar } from "./ui/AppBar";
import { EmergencyBanner } from "./ui/EmergencyBanner";
import { PageTitle } from "./ui/PageTitle";
import {
  PrimaryButton,
  SecondaryButton,
  TextButton,
  ChoiceButton,
} from "./ui/Buttons";
import {
  CheckRow,
  StatusPill,
  CountdownPill,
  ProgressBar,
} from "./ui/StatusAndInput";
import {
  Timeline,
  PrivacyNote,
  TabBar,
} from "./ui/NavigationAndInfo";
import { LockNotification } from "./ui/LockNotification";

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
  isLoading: _isLoading,
  user,
}: PhoneStageProps) {
  // Navigation Tabs: home (P_R1), history (P_R2), settings (P_R3)
  const [currentTab, setCurrentTab] = useState<"home" | "history" | "settings">("home");

  // Emergency flow sub-screens for resident
  // "lock" (R01), "safety_answer" (R02), "damage_detail" (R09), "reporting" (R07)
  const [emergencySubScreen, setEmergencySubScreen] = useState<
    "lock" | "safety_answer" | "damage_detail" | "reporting" | "default"
  >("default");

  // Damage checkbox items for R09
  const [damageItems, setDamageItems] = useState({
    injury: false,
    trapped: false,
    broken: false,
    gasSmell: false,
  });

  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // Push notification state
  const [pushStatus, setPushStatus] = useState<PushPermissionState>("default");
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string>("");
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);

  // サーバー上の安否ステータス
  const currentResidentSafety = issueDetail?.resident_states?.[activePersona.userId] ?? "UNKNOWN";
  const isSafetyAnswered = currentResidentSafety === "SAFE" || currentResidentSafety === "NEED_HELP";

  // 自分の担当タスク
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
    if (currentTab === "history") {
      fetchAuditEvents();
    }
  }, [currentTab, fetchAuditEvents]);

  // Push通知の初期状態確認
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushStatus(Notification.permission as PushPermissionState);
    }
  }, []);

  // 安否回答 (API-02)
  const handleConfirmPresence = async (safetyStatus: "SAFE" | "NEED_HELP", message?: string) => {
    if (!emergencyId) return;
    try {
      await confirmPresence(
        user,
        {
          emergency_id: emergencyId,
          safety_status: safetyStatus,
          message:
            message ||
            (safetyStatus === "SAFE"
              ? "けがはなく、部屋から出られます。"
              : "被害があります。支援が必要です。"),
        },
        activePersona,
      );
      await onActionComplete(
        `[API-02] ${activePersona.name} が安否回答を送信しました (status=${safetyStatus})`,
      );
      setEmergencySubScreen("default");
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
      setEmergencySubScreen("default");
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

  // 計算値：安否集計
  const safeCount = Object.values(issueDetail?.resident_states || {}).filter(
    (s) => s === "SAFE",
  ).length;
  const needHelpCount = Object.values(issueDetail?.resident_states || {}).filter(
    (s) => s === "NEED_HELP",
  ).length;
  const totalAnswered = safeCount + needHelpCount;

  // --------------------------------------------------------------------------
  // RENDER: Lock Screen Notification (R01 / R04)
  // --------------------------------------------------------------------------
  const showLockScreen = emergencyId && !isSafetyAnswered && emergencySubScreen === "lock";

  return (
    <main className="device-stage">
      <div className="device-wrapper">
        <div className="device-screen">
          {/* iOS-style Top Status Bar */}
          <div className={`device-notch-bar ${showLockScreen ? "dark" : ""}`}>
            <span className="font-mono-num">8:04</span>
            <div className="device-notch">
              <span className="notch-camera-dot" />
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span className="font-mono-num" style={{ fontSize: "0.75rem" }}>5G</span>
              <span className="font-mono-num" style={{ fontSize: "0.75rem" }}>100%</span>
            </div>
          </div>

          {/* Active Persona indicator bar in Stage */}
          <div className="persona-switch-bar">
            <div className="persona-info">
              <span>🏠</span>
              <span className="font-mono-num" style={{ fontWeight: 700 }}>
                {activePersona.roomNumber}号室
              </span>
              <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>
                {activePersona.name}
              </span>
            </div>
            <StatusPill
              label={activePersona.role === "admin" ? "ADMIN 管理人" : "RESIDENT 住民"}
              variant={activePersona.role === "admin" ? "warn" : "brand"}
            />
          </div>

          {/* ================================================================
              PATTERN 1: Lock Screen Notification (R01)
              ================================================================ */}
          {showLockScreen ? (
            <LockNotification
              timeStr="8:03"
              dateStr="10月4日 土曜日"
              title="地震が発生しました（震度5強）"
              message="ご自身とお部屋は無事ですか？"
              timeRemaining="2:00"
              primaryButtonText="無事"
              primaryButtonVariant="brand"
              onPrimaryClick={() => handleConfirmPresence("SAFE")}
              secondaryButtonText="被害あり"
              onSecondaryClick={() => {
                setEmergencySubScreen("damage_detail");
              }}
              onNotificationClick={() => setEmergencySubScreen("safety_answer")}
            />
          ) : (
            <div className="app-container">
              {/* ==============================================================
                  PATTERN 2: Emergency Mode Active
                  ============================================================== */}
              {emergencyId ? (
                <>
                  {/* Top Bar with 119 and Read Aloud */}
                  <AppBar
                    variant={emergencySubScreen !== "default" ? "subpage" : "home"}
                    onBack={() => setEmergencySubScreen("default")}
                    showReadAloud={true}
                  />

                  {/* C3: Emergency Banner */}
                  <EmergencyBanner disasterType="地震" detail="震度5強" issuedAt="8:03" />

                  {/* Screen Content Container with auto-flex bottom action */}
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      padding: "16px 24px 20px",
                      overflowY: "auto",
                    }}
                  >
                    {/* --------------------------------------------------------
                        R09: 被害内容の入力画面
                        -------------------------------------------------------- */}
                    {emergencySubScreen === "damage_detail" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <PageTitle
                          title="被害の内容を教えてください"
                          subtitle="管理人に優先して情報が届きます。命に関わるときは迷わず119番通報してください。"
                        />
                        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                          <CheckRow
                            label="けがをしている"
                            sublabel="応急手当が必要、出血など"
                            checked={damageItems.injury}
                            onChange={(checked) =>
                              setDamageItems({ ...damageItems, injury: checked })
                            }
                          />
                          <CheckRow
                            label="部屋から出られない"
                            sublabel="ドアの変形、閉じ込め"
                            checked={damageItems.trapped}
                            onChange={(checked) =>
                              setDamageItems({ ...damageItems, trapped: checked })
                            }
                          />
                          <CheckRow
                            label="部屋の家具や設備が破損した"
                            sublabel="大型家具の転倒、ガラス散乱"
                            checked={damageItems.broken}
                            onChange={(checked) =>
                              setDamageItems({ ...damageItems, broken: checked })
                            }
                          />
                          <CheckRow
                            label="ガス・水の漏れやにおいがする"
                            sublabel="二次災害の危険あり"
                            checked={damageItems.gasSmell}
                            onChange={(checked) =>
                              setDamageItems({ ...damageItems, gasSmell: checked })
                            }
                          />
                        </div>
                        <div style={{ marginTop: "auto", paddingTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                          <PrimaryButton
                            onClick={() =>
                              handleConfirmPresence(
                                "NEED_HELP",
                                `被害あり: ${Object.entries(damageItems)
                                  .filter(([, v]) => v)
                                  .map(([k]) => k)
                                  .join(", ") || "支援希望"}`,
                              )
                            }
                          >
                            管理人に送る
                          </PrimaryButton>
                          <SecondaryButton onClick={() => setEmergencySubScreen("default")}>
                            もどる
                          </SecondaryButton>
                        </div>
                      </div>
                    )}

                    {/* --------------------------------------------------------
                        R02: 安否回答画面（2択Choiceカード）
                        -------------------------------------------------------- */}
                    {!isSafetyAnswered && emergencySubScreen !== "damage_detail" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <PageTitle
                          title="ご自身とお部屋は無事ですか？"
                          subtitle="回答は建物全体の把握に使われ、部屋番号は外部に公開されません。"
                        />
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <CountdownPill label="回答の目安 残り" timeRemaining="1:42" />
                        </div>

                        {/* C9: 2択 Choice Buttons */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <ChoiceButton
                            title="無事（けがはなく、部屋から出られる）"
                            description="自身で身の安全が確保できており、特別な手助けは不要です。"
                            accentColor="brand"
                            onClick={() => handleConfirmPresence("SAFE")}
                            icon={
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            }
                          />
                          <ChoiceButton
                            title="被害あり（けが・閉じ込め・部屋の損傷など）"
                            description="家具の転倒、けが、室内に閉じ込められているなど支援が必要です。"
                            accentColor="danger"
                            onClick={() => setEmergencySubScreen("damage_detail")}
                            icon={
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2.5">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                            }
                          />
                        </div>

                        <div style={{ marginTop: "auto", paddingTop: 16 }}>
                          <PrivacyNote note="ZASHIKIは119番の代わりではありません。命に関わるときは、直ちに119番へ。" />
                        </div>
                      </div>
                    )}

                    {/* --------------------------------------------------------
                        R10: 被害あり送信後の待機タイムライン画面
                        -------------------------------------------------------- */}
                    {isSafetyAnswered && currentResidentSafety === "NEED_HELP" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <PageTitle
                          title="管理人に伝わりました"
                          subtitle="状況が共有され、優先度の高い住戸として救護の手配を進めています。"
                        />
                        <div
                          style={{
                            backgroundColor: "var(--color-danger-tint)",
                            borderRadius: 12,
                            padding: "14px 16px",
                            border: "1px solid rgba(194, 59, 46, 0.3)",
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-danger-text)" }}>
                            助けが来るまで
                          </span>
                          <p style={{ fontSize: 13, color: "var(--color-ink)", marginTop: 4, lineHeight: 1.5 }}>
                            体力を温存し、無理に動かず安全な姿勢を保ってください。大きな音（壁や床を叩く等）で居場所を知らせることも有効です。
                          </p>
                        </div>

                        {/* C18 Timeline */}
                        <div style={{ marginTop: 8 }}>
                          <Timeline
                            items={[
                              { time: "8:04", text: "被害状況を送信しました", status: "completed" },
                              { time: "8:05", text: "管理人が確認・優先支援リストに登録", status: "completed" },
                              { time: "8:07", text: "現地確認に向かう準備をしています", status: "in_progress" },
                              { text: "管理人または救助隊が到着", status: "pending" },
                            ]}
                          />
                        </div>

                        <div style={{ marginTop: "auto", paddingTop: 20 }}>
                          <SecondaryButton onClick={() => setEmergencySubScreen("damage_detail")}>
                            状況が変わったので更新する
                          </SecondaryButton>
                        </div>
                      </div>
                    )}

                    {/* --------------------------------------------------------
                        R03〜R08: 無事回答後の各ステップ
                        -------------------------------------------------------- */}
                    {isSafetyAnswered && currentResidentSafety === "SAFE" && (
                      <>
                        {/* 1. 打診なし：R03 回答済み・待機画面 */}
                        {!myTask && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                            <PageTitle
                              title="無事を受け付けました"
                              subtitle="8:04 回答済み。ご協力ありがとうございます。"
                            />
                            {/* C17 ProgressBar */}
                            <ProgressBar
                              title="全館の安否回答状況"
                              current={totalAnswered || 96}
                              total={150}
                            />
                            <div
                              style={{
                                backgroundColor: "var(--color-canvas)",
                                borderRadius: 12,
                                padding: "16px",
                                border: "1px solid var(--color-line)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                                近くのお宅の確認をお願いすることがあります
                              </span>
                              <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5, margin: 0 }}>
                                同じ階で未だ応答がないお部屋がある場合、インターホンを1回鳴らす極小タスク（約20秒）の打診が届く場合があります。
                              </p>
                            </div>
                            <div style={{ marginTop: "auto", paddingTop: 20, textAlign: "center" }}>
                              <TextButton
                                color="var(--color-danger)"
                                onClick={() => setEmergencySubScreen("damage_detail")}
                              >
                                回答を「被害あり」に変更する
                              </TextButton>
                            </div>
                          </div>
                        )}

                        {/* 2. タスク打診中：R04 / R05 確認のお願い */}
                        {myTask && myTask.status === "OFFERED" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <PageTitle
                              title="近くのお宅の確認をお願いできますか？"
                              subtitle="インターホンを1回鳴らすだけです。約20秒。断っても理由は聞きません。"
                            />
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <CountdownPill label="返事の期限 残り" timeRemaining="0:45" />
                            </div>

                            <div
                              style={{
                                backgroundColor: "var(--color-canvas)",
                                borderRadius: 12,
                                padding: "14px 16px",
                                border: "1px solid var(--color-line)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                fontSize: 13.5,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--color-muted)" }}>やること</span>
                                <span style={{ fontWeight: 700 }}>インターホンを1回鳴らして応答を確認</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--color-muted)" }}>場所</span>
                                <span style={{ fontWeight: 700 }}>同じ3階の住戸</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "var(--color-muted)" }}>所要時間</span>
                                <span style={{ fontWeight: 700 }}>約20秒</span>
                              </div>
                            </div>

                            <PrivacyNote note="部屋番号は協力すると表示されます。あなたに頼んだ理由：同じ階で無事と回答し、いちばん近いため。" />

                            {/* Actions (Max 2 Buttons) */}
                            <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                              <PrimaryButton onClick={() => handleRespondTask("APPROVED")}>
                                協力する（約20秒）
                              </PrimaryButton>
                              <SecondaryButton onClick={() => handleRespondTask("DECLINED")}>
                                今は無理（理由は不要です）
                              </SecondaryButton>
                            </div>
                          </div>
                        )}

                        {/* 3. 承認後：R06 確認先・手順表示 */}
                        {myTask &&
                          (myTask.status === "APPROVED" || myTask.status === "IN_PROGRESS") &&
                          emergencySubScreen !== "reporting" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <PageTitle
                              title="確認先のお部屋"
                              subtitle="無理は禁物です。危険を感じたら直ちに引き返してください。"
                            />
                            {/* Big Room Number */}
                            <div
                              style={{
                                textAlign: "center",
                                padding: "20px 0",
                                backgroundColor: "var(--color-canvas)",
                                borderRadius: 16,
                                border: "1px solid var(--color-line)",
                              }}
                            >
                              <span style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 700 }}>
                                確認対象住戸
                              </span>
                              <div style={{ marginTop: 4 }}>
                                <span className="font-mono-num" style={{ fontSize: 36, fontWeight: 900, color: "var(--color-ink)" }}>
                                  {taskDetail?.target_room_number || "302"}
                                </span>
                                <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 4 }}>号室</span>
                              </div>
                            </div>

                            {/* Steps list */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                  1
                                </span>
                                <span>302号室の前へ向かいます</span>
                              </div>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                  2
                                </span>
                                <span>インターホンを1回だけ鳴らします（不在時は深追い不要）</span>
                              </div>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                  3
                                </span>
                                <span>応答の有無をアプリで報告してください</span>
                              </div>
                            </div>

                            <div style={{ marginTop: "auto", paddingTop: 16 }}>
                              <PrimaryButton onClick={() => setEmergencySubScreen("reporting")}>
                                302号室の前に着いた・報告する
                              </PrimaryButton>
                            </div>
                          </div>
                        )}

                        {/* 4. 結果報告：R07 結果の報告 */}
                        {myTask &&
                          (myTask.status === "APPROVED" || myTask.status === "IN_PROGRESS") &&
                          emergencySubScreen === "reporting" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <PageTitle
                              title="応答はありましたか？"
                              subtitle="確認できた状況を選んでください。"
                            />
                            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                              <ChoiceButton
                                title="応答があった"
                                description="声や返答があり、無事であることが確認できました。"
                                accentColor="brand"
                                onClick={() => handleReportTask("TARGET_RESPONDED")}
                                icon={
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                }
                              />
                              <ChoiceButton
                                title="応答がなかった"
                                description="インターホンへの返答がなく、室内の物音も聞こえません。"
                                accentColor="ink"
                                onClick={() => handleReportTask("TARGET_NO_RESPONSE")}
                                icon={
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink)" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="8" y1="12" x2="16" y2="12" />
                                  </svg>
                                }
                              />
                              <ChoiceButton
                                title="確認できなかった（危険・たどり着けない）"
                                description="障害物や煙、落下物などで安全に接近できませんでした。"
                                accentColor="danger"
                                onClick={() => handleReportTask("TARGET_NO_RESPONSE")}
                                icon={
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2.5">
                                    <polygon points="12 2 2 22 22 22 12 2" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                  </svg>
                                }
                              />
                            </div>
                            <div style={{ marginTop: "auto", paddingTop: 16 }}>
                              <SecondaryButton onClick={() => setEmergencySubScreen("default")}>
                                前の画面へもどる
                              </SecondaryButton>
                            </div>
                          </div>
                        )}

                        {/* 5. 完了：R08 完了・開示の終了 */}
                        {myTask && myTask.status === "COMPLETED" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <PageTitle
                              title="確認ありがとうございました"
                              subtitle="状況は管理人に送信されました。開示されていた部屋番号はマスキングされました。"
                            />
                            {/* Masked room number */}
                            <div
                              style={{
                                textAlign: "center",
                                padding: "20px 0",
                                backgroundColor: "var(--color-canvas)",
                                borderRadius: 16,
                                border: "1px solid var(--color-line)",
                              }}
                            >
                              <span style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 700 }}>
                                確認先住戸（開示終了）
                              </span>
                              <div style={{ marginTop: 4 }}>
                                <span className="font-mono-num" style={{ fontSize: 32, fontWeight: 900, color: "var(--color-muted)" }}>
                                  •••
                                </span>
                                <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 4, color: "var(--color-muted)" }}>号室</span>
                              </div>
                            </div>

                            {/* Privacy Audit Trail in Card */}
                            <div
                              style={{
                                backgroundColor: "var(--color-surface)",
                                borderRadius: 12,
                                padding: "14px 16px",
                                border: "1px solid var(--color-line)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                fontSize: 13,
                              }}
                            >
                              <span style={{ fontWeight: 700, color: "var(--color-ink)" }}>
                                このタスクで扱われた情報
                              </span>
                              <div style={{ color: "var(--color-muted)" }}>
                                • 使われた情報：同じ3階・無事の回答・在宅状況
                              </div>
                              <div style={{ color: "var(--color-muted)" }}>
                                • 開示された情報：確認先の部屋番号（8:05〜8:07のみ、現在非表示）
                              </div>
                            </div>

                            <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                              <PrimaryButton onClick={() => setCurrentTab("history")}>
                                くわしい利用記録を見る
                              </PrimaryButton>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                /* ==============================================================
                   PATTERN 3: Normal Time (P_R1〜P_R3)
                   ============================================================== */
                <>
                  <AppBar variant="home" showReadAloud={false} />

                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      padding: "16px 24px 20px",
                      overflowY: "auto",
                    }}
                  >
                    {/* Tab 1: P_R1 ホーム（平時マイページ） */}
                    {currentTab === "home" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <PageTitle
                          title="平常時 何もしなくて大丈夫です"
                          subtitle="緊急時のみ、必要な確認やお願いが届きます。"
                        />

                        {/* Status Card */}
                        <div
                          style={{
                            backgroundColor: "var(--color-canvas)",
                            borderRadius: 14,
                            padding: "16px",
                            border: "1px solid var(--color-line)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                            連携状況
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--color-muted)" }}>プッシュ通知</span>
                              <span style={{ fontWeight: 700, color: "var(--color-brand)" }}>
                                {pushStatus === "granted" ? "受信可能" : "未設定"}
                              </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--color-muted)" }}>Google カレンダー</span>
                              <span style={{ fontWeight: 700, color: "var(--color-brand)" }}>連携中</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "var(--color-muted)" }}>在宅シグナル</span>
                              <span style={{ fontWeight: 700 }}>自動検知中</span>
                            </div>
                          </div>
                        </div>

                        {/* Knowledge Card */}
                        <div
                          style={{
                            backgroundColor: "#FFFFFF",
                            borderRadius: 14,
                            padding: "16px",
                            border: "1px solid var(--color-line)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                            いま座敷わらしが知っていること
                          </span>
                          <div style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
                            • 在館推定：在宅の可能性が高い<br />
                            • 階段の支援：健脚（短時間の階段移動が可能）<br />
                            • 個人の性格・評価・ランキングは一切作成・保存しません。
                          </div>
                        </div>

                        <div style={{ marginTop: "auto", paddingTop: 16 }}>
                          <PrivacyNote note="ZASHIKIは119番の代わりではありません。命に関わるときは、直ちに119番へ。" />
                        </div>
                      </div>
                    )}

                    {/* Tab 2: P_R2 記録（監査ログ・利用履歴） */}
                    {currentTab === "history" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <PageTitle
                          title="情報の利用記録"
                          subtitle="わたしの情報を、いつ誰が使い、誰に見せたかを透明に記録しています。"
                        />
                        <div
                          style={{
                            backgroundColor: "var(--color-canvas)",
                            padding: "10px 14px",
                            borderRadius: 10,
                            fontSize: 12.5,
                            color: "var(--color-muted)",
                          }}
                        >
                          断ったお願いや不参加は評価として一切残りません。
                        </div>

                        {auditEvents.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-muted)", fontSize: 14 }}>
                            平常時のため、情報の外部利用・開示の記録はありません。
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {auditEvents.map((evt) => (
                              <div
                                key={evt.audit_id}
                                style={{
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid var(--color-line)",
                                  borderRadius: 12,
                                  padding: "12px 14px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 4,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                                    {evt.event_name}
                                  </span>
                                  <span className="font-mono-num" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                                    {evt.created_at.slice(11, 16)}
                                  </span>
                                </div>
                                <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                                  主体: {evt.actor_type} ({evt.actor_id})
                                </div>
                                {evt.description && (
                                  <div style={{ fontSize: 12.5, color: "var(--color-ink)", lineHeight: 1.5 }}>
                                    {evt.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 3: P_R3 設定 */}
                    {currentTab === "settings" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <PageTitle
                          title="設定"
                          subtitle="通知や外部サービスとの連携設定です。"
                        />

                        {/* Push Notification Setup */}
                        <div
                          style={{
                            backgroundColor: "var(--color-canvas)",
                            borderRadius: 14,
                            padding: "16px",
                            border: "1px solid var(--color-line)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                            Web Push通知（スリープ対応）
                          </span>
                          <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
                            緊急時にロック画面へ通知を灯すための設定です。
                          </p>
                          {pushStatus !== "granted" ? (
                            <PrimaryButton onClick={handleEnablePush}>
                              通知を有効にする
                            </PrimaryButton>
                          ) : (
                            <SecondaryButton
                              onClick={handleTriggerSleepTest}
                              disabled={isCountingDown}
                            >
                              {isCountingDown ? `${countdown}秒後に送信...` : "5秒後にテスト通知を送信"}
                            </SecondaryButton>
                          )}
                          {pushMsg && (
                            <span style={{ fontSize: 12.5, color: "var(--color-brand)", fontWeight: 600 }}>
                              {pushMsg}
                            </span>
                          )}
                        </div>

                        {/* Google Calendar */}
                        <div
                          style={{
                            backgroundColor: "#FFFFFF",
                            borderRadius: 14,
                            padding: "16px",
                            border: "1px solid var(--color-line)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                              Google カレンダー
                            </div>
                            <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginTop: 2 }}>
                              在宅シグナルの推定に使用
                            </div>
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-brand)" }}>
                            連携中
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* C22 TabBar */}
                  <TabBar currentTab={currentTab} onChangeTab={setCurrentTab} />
                </>
              )}
            </div>
          )}

          {/* Bottom Home Indicator Bar */}
          <div className="home-indicator-bar">
            <div className={`home-indicator ${showLockScreen ? "dark" : ""}`} />
          </div>
        </div>
      </div>
    </main>
  );
}
