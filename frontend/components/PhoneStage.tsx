"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  type Persona,
  type SafetyConfirmation,
  type Task,
  type TaskDetailResponse,
  type IssueDetailResponse,
  type AuditEvent,
  type EmergencyType,
  type ReasonCode,
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

import { useSafetyCountdown } from "@/lib/use-safety-countdown";
import { useTaskCountdown } from "@/lib/use-task-countdown";
import { incomingCheckStatus } from "@/lib/emergency-view";

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
  emergencyType?: EmergencyType;
  tasks: Task[];
  issueDetail: IssueDetailResponse | null;
  onActionComplete: (logText: string, answer?: SafetyConfirmation) => Promise<void>;
  isLoading: boolean;
  user: User | null;
};

export function PhoneStage({
  activePersona,
  emergencyId,
  emergencyType = "EARTHQUAKE",
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

  // Damage checkbox items for R09 (Earthquake default)
  const [damageItems, setDamageItems] = useState({
    injury: false,
    trapped: false,
    broken: false,
    gasSmell: false,
  });

  // SC-1: 停電時の困りごと項目（S1_A2）
  const [outageItems, setOutageItems] = useState({
    waterFood: false,     // 飲み水・食料が足りない
    stairsUnable: false,  // 階段を自力で昇降できない
    medicalPower: false,  // 薬が足りない・医療機器が使えない
    heatCold: false,      // 暑さ・寒さで体調が不安
  });

  // FN-03 / REQ-15: 自由文メッセージと代理人（Resident Agent）からの聞き返し質問
  const [damageFreeText, setDamageFreeText] = useState("");
  const [clarificationQuestion, setClarificationQuestion] = useState<string | null>(null);

  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // Push notification state
  const [pushStatus, setPushStatus] = useState<PushPermissionState>("default");
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [pushMsg, setPushMsg] = useState<string>("");
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(5);

  const safetyTimeRemaining = useSafetyCountdown(
    emergencyId && issueDetail?.issue.emergency_id === emergencyId
      ? issueDetail.issue.created_at : undefined,
  );

  // サーバー上の安否ステータス
  const currentResidentSafety = issueDetail?.resident_states?.[activePersona.userId] ?? "UNKNOWN";
  const isSafetyAnswered = currentResidentSafety === "SAFE" || currentResidentSafety === "NEED_HELP";

  // FN-08: Show only confirmed incoming checks for this resident and emergency.
  const checkStatus = incomingCheckStatus(issueDetail, activePersona.userId, emergencyId);
  const hasConfirmedCheck = checkStatus === "approved" || checkStatus === "in_progress";

  // 自分の担当タスク
  const myTask = tasks.find((t) => t.resident_id === activePersona.userId);

  // FN-06: 打診の返事期限カウントダウン
  const taskTimeRemaining = useTaskCountdown(
    myTask?.expires_at ?? taskDetail?.latest_event?.expires_at,
    myTask?.created_at,
  );

  // FN-07: Never display details left over from another task or resident.
  const disclosedRoom = taskDetail?.task.task_id === myTask?.task_id &&
    taskDetail?.task.resident_id === activePersona.userId && taskDetail?.is_disclosed
    ? taskDetail.target_room_number : null;

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

  const sendingSafety = useRef(false);
  const [isSendingSafety, setIsSendingSafety] = useState(false);

  // FN-08: Serialize safety answers until the saved state has been reflected.
  // 安否回答 (API-02)
  const handleConfirmPresence = async (safetyStatus: "SAFE" | "NEED_HELP", message?: string) => {
    if (!emergencyId || sendingSafety.current) return;
    sendingSafety.current = true;
    setIsSendingSafety(true);
    try {
      const answer = await confirmPresence(
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
        answer,
      );
      if (answer.needs_clarification && answer.clarification_question) {
        setClarificationQuestion(answer.clarification_question);
        setEmergencySubScreen("damage_detail");
      } else {
        setClarificationQuestion(null);
        setEmergencySubScreen("default");
      }
    } catch (err) {
      alert(`安否回答に失敗しました: ${String(err)}`);
    } finally {
      sendingSafety.current = false;
      setIsSendingSafety(false);
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
  const handleReportTask = async (reasonCode: ReasonCode) => {
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

  // FN-02: The admin persona has no resident safety answer or resident task.
  if (activePersona.role === "admin") {
    return (
      <main className="device-stage">
        <section className="zashiki-card">
          <h2>防災センター（管理人）</h2>
          <p>発令・トリアージ・住戸別の状況確認は管理人コンソールで操作してください。</p>
          <p>安否回答済み：{totalAnswered} / 50戸</p>
        </section>
      </main>
    );
  }

  return (
    <main className="device-stage">
      <div className="device-wrapper">
        <div className="device-screen">
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
          </div>

          {/* ================================================================
              PATTERN 1: Lock Screen Notification (R01)
              ================================================================ */}
          {showLockScreen ? (() => {
            const isOutage = emergencyType === "POWER_OUTAGE";
            const lockTitle = isOutage
              ? "停電が発生しました（EV全基停止）"
              : emergencyType === "FIRE"
                ? "火災報知器が作動しました"
                : emergencyType === "FLOOD"
                  ? "大雨洪水警戒情報が発令されました"
                  : "地震が発生しました（震度5強）";
            const lockMsg = isOutage
              ? "ご自宅にいらっしゃいますか？ 状況を教えてください"
              : "ご自身とお部屋は無事ですか？";
            const primaryBtn = isOutage ? "在宅・問題なし" : "無事";
            const secondaryBtn = isOutage ? "困っている" : "被害あり";

            return (
              <LockNotification
                timeStr="8:03"
                dateStr="10月4日 土曜日"
                title={lockTitle}
                message={lockMsg}
                timeRemaining={safetyTimeRemaining}
                primaryButtonText={primaryBtn}
                primaryButtonVariant="brand"
                onPrimaryClick={() => handleConfirmPresence("SAFE")}
                secondaryButtonText={secondaryBtn}
                onSecondaryClick={() => {
                  setEmergencySubScreen("damage_detail");
                }}
                onNotificationClick={() => setEmergencySubScreen("safety_answer")}
              />
            );
          })() : (
            <div className="app-container">
              {/* ==============================================================
                  PATTERN 2: Emergency Mode Active
                  ============================================================== */}
              {emergencyId ? (
                <>
                  {/* Top Bar with Read Aloud */}
                  <AppBar
                    variant={emergencySubScreen !== "default" ? "subpage" : "home"}
                    onBack={() => setEmergencySubScreen("default")}
                    showReadAloud={true}
                  />

                  {/* C3: Emergency Banner */}
                  {(() => {
                    const disasterInfo: Record<EmergencyType, { typeName: string; detail: string }> = {
                      EARTHQUAKE: { typeName: "地震", detail: "震度5強" },
                      POWER_OUTAGE: { typeName: "停電", detail: "EV全基停止" },
                      FIRE: { typeName: "火災", detail: "警報鳴動" },
                      FLOOD: { typeName: "洪水", detail: "垂直避難警戒" },
                    };
                    const bannerInfo = disasterInfo[emergencyType || "EARTHQUAKE"];
                    return <EmergencyBanner disasterType={bannerInfo.typeName} detail={bannerInfo.detail} issuedAt="8:03" />;
                  })()}

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
                        R09: 被害内容の入力画面（SC-1: 停電時は困りごと選択 S1_A2）
                        -------------------------------------------------------- */}
                    {emergencySubScreen === "damage_detail" && (() => {
                      const isOutage = emergencyType === "POWER_OUTAGE";
                      const pageTitle = isOutage ? "停電時の困りごとを教えてください" : "被害の内容を教えてください";
                      const pageSubtitle = isOutage
                        ? "エレベーター停止に伴う困りごとを管理人に届けます。命に関わるときは迷わず119番通報してください。"
                        : "管理人に優先して情報が届きます。命に関わるときは迷わず119番通報してください。";
                      const placeholder = isOutage
                        ? "例: 14階で水が切れました / 足が悪く階段が降りられません"
                        : "例: 棚が倒れて足を挟まれ動けません / 飲料水が必要です";

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                          <PageTitle
                            title={pageTitle}
                            subtitle={pageSubtitle}
                          />
                          {/* FN-03 / REQ-15: Resident Agent からの聞き返しバナー */}
                          {clarificationQuestion && (
                            <div
                              style={{
                                backgroundColor: "#FFF8E1",
                                border: "1px solid #FFE082",
                                borderRadius: 10,
                                padding: "10px 14px",
                                fontSize: 13,
                                color: "#6D4C41",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>💬 代理人（Resident Agent）より確認</span>
                              </div>
                              <div>{clarificationQuestion}</div>
                            </div>
                          )}

                          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                            {isOutage ? (
                              <>
                                <CheckRow
                                  label="飲み水・食料が足りない"
                                  sublabel="備蓄切れ、自力調達困難など"
                                  checked={outageItems.waterFood}
                                  onChange={(checked) =>
                                    setOutageItems({ ...outageItems, waterFood: checked })
                                  }
                                />
                                <CheckRow
                                  label="階段を自力で昇降できない"
                                  sublabel="エレベーター停止による移動困難、高齢・車椅子など"
                                  checked={outageItems.stairsUnable}
                                  onChange={(checked) =>
                                    setOutageItems({ ...outageItems, stairsUnable: checked })
                                  }
                                />
                                <CheckRow
                                  label="薬が足りない・医療機器が使えない"
                                  sublabel="常備薬不足、電源途絶による機器停止など"
                                  checked={outageItems.medicalPower}
                                  onChange={(checked) =>
                                    setOutageItems({ ...outageItems, medicalPower: checked })
                                  }
                                />
                                <CheckRow
                                  label="暑さ・寒さで体調が不安"
                                  sublabel="空調停止による熱中症リスクなど"
                                  checked={outageItems.heatCold}
                                  onChange={(checked) =>
                                    setOutageItems({ ...outageItems, heatCold: checked })
                                  }
                                />
                              </>
                            ) : (
                              <>
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
                              </>
                            )}
                          </div>

                          {/* FN-03 / REQ-15: 自由記述入力エリア */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
                              詳しい状況・必要なこと（自由記述）
                            </label>
                            <textarea
                              value={damageFreeText}
                              onChange={(e) => setDamageFreeText(e.target.value)}
                              placeholder={placeholder}
                              rows={3}
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: "1px solid var(--color-line)",
                                fontSize: 13,
                                resize: "vertical",
                                boxSizing: "border-box",
                                fontFamily: "inherit",
                              }}
                            />
                          </div>

                          <div style={{ marginTop: "auto", paddingTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                            <PrimaryButton
                              disabled={isSendingSafety}
                              onClick={() => {
                                const checkedLabels = isOutage
                                  ? Object.entries(outageItems)
                                      .filter(([, v]) => v)
                                      .map(([k]) => {
                                        if (k === "waterFood") return "飲み水・食料不足";
                                        if (k === "stairsUnable") return "階段歩行困難";
                                        if (k === "medicalPower") return "薬・医療機器停止";
                                        if (k === "heatCold") return "暑さ・熱中症リスク";
                                        return k;
                                      })
                                  : Object.entries(damageItems)
                                      .filter(([, v]) => v)
                                      .map(([k]) => {
                                        if (k === "injury") return "けがをしている";
                                        if (k === "trapped") return "部屋から出られない";
                                        if (k === "broken") return "家具・設備の破損";
                                        if (k === "gasSmell") return "ガス・水漏れのにおい";
                                        return k;
                                      });
                                const parts = [];
                                if (checkedLabels.length > 0) {
                                  parts.push(isOutage ? `【困りごと】${checkedLabels.join("、")}` : `【被害項目】${checkedLabels.join("、")}`);
                                }
                                if (damageFreeText.trim()) {
                                  parts.push(damageFreeText.trim());
                                }
                                const finalMsg = parts.join("\n") || (isOutage ? "停電により困りごとがあります。支援が必要です。" : "被害があります。支援が必要です。");
                                handleConfirmPresence("NEED_HELP", finalMsg);
                              }}
                            >
                              {isSendingSafety ? "送信中…" : "管理人に送る"}
                            </PrimaryButton>
                            <SecondaryButton onClick={() => setEmergencySubScreen("default")}>
                              もどる
                            </SecondaryButton>
                          </div>
                        </div>
                      );
                    })()}

                    {/* --------------------------------------------------------
                        R02: 安否回答画面（2択Choiceカード）
                        -------------------------------------------------------- */}
                    {(!isSafetyAnswered || emergencySubScreen === "safety_answer") && emergencySubScreen !== "damage_detail" && (() => {
                      const isOutage = emergencyType === "POWER_OUTAGE";
                      const r02Title = isOutage ? "ご自宅にいらっしゃいますか？ 状況を教えてください" : "ご自身とお部屋は無事ですか？";
                      const r02Subtitle = isOutage
                        ? "エレベーターが全基停止しています。回答は全体の把握に使われ、部屋番号は外部に公開されません。"
                        : "回答は建物全体の把握に使われ、部屋番号は外部に公開されません。";
                      const choice1Title = isOutage ? "在宅・問題なし（特別な手助けは不要）" : "無事（けがはなく、部屋から出られる）";
                      const choice1Desc = isOutage
                        ? "自室で待機可能で、水や階段昇降の特別な手助けは不要です。"
                        : "自身で身の安全が確保できており、特別な手助けは不要です。";
                      const choice2Title = isOutage ? "困っている（水・階段・薬・体調など）" : "被害あり（けが・閉じ込め・部屋の損傷など）";
                      const choice2Desc = isOutage
                        ? "飲料水の不足や階段昇降困難、熱中症リスクなど支援が必要です。"
                        : "家具の転倒、けが、室内に閉じ込められているなど支援が必要です。";

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                          <PageTitle
                            title={r02Title}
                            subtitle={r02Subtitle}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <CountdownPill label="回答の目安 残り" timeRemaining={safetyTimeRemaining} />
                          </div>

                          {/* C9: 2択 Choice Buttons */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <ChoiceButton
                              disabled={isSendingSafety}
                              title={choice1Title}
                              description={choice1Desc}
                              accentColor="brand"
                              onClick={() => handleConfirmPresence("SAFE")}
                              icon={
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              }
                            />
                            <ChoiceButton
                              disabled={isSendingSafety}
                              title={choice2Title}
                              description={choice2Desc}
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
                            <PrivacyNote note="Zashikiwarashiは119番の代わりではありません。命に関わるときは、直ちに119番へ。" />
                          </div>
                        </div>
                      );
                    })()}

                    {/* --------------------------------------------------------
                        R10: 被害あり送信後の待機タイムライン画面
                        -------------------------------------------------------- */}
                    {isSafetyAnswered && currentResidentSafety === "NEED_HELP" && emergencySubScreen === "default" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        <PageTitle
                          title="管理人に伝わりました"
                          subtitle={checkStatus === "in_progress"
                            ? "近隣の方による安否確認が始まりました。"
                            : checkStatus === "approved"
                              ? "近隣の方が、あなたのお宅の安否確認への協力を承認しました。"
                              : checkStatus === "triaging"
                                ? "安否状況の確認・対応の検討中です。あなたへの対応はまだ確定していません。"
                                : "被害状況を受け付けました。管理人による確認をお待ちください。"}

                        />
                        {hasConfirmedCheck && <div
                          style={{
                            backgroundColor: "var(--color-danger-tint)",
                            borderRadius: 12,
                            padding: "14px 16px",
                            border: "1px solid rgba(194, 59, 46, 0.3)",
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-danger-text)" }}>
                            近隣の方による確認まで
                          </span>
                          <p style={{ fontSize: 13, color: "var(--color-ink)", marginTop: 4, lineHeight: 1.5 }}>
                            体力を温存し、無理に動かず安全な姿勢を保ってください。大きな音（壁や床を叩く等）で居場所を知らせることも有効です。
                          </p>
                        </div>}

                        {/* FN-08: Actual accepted/started checks only; no invented arrival time. */}
                        {hasConfirmedCheck && <div style={{ marginTop: 8 }}>
                          <Timeline
                            items={[
                              { text: "被害状況を送信しました", status: "completed" },
                              { text: "近隣の方が安否確認への協力を承認しました", status: "completed" },
                              { text: checkStatus === "in_progress" ? "安否確認を実施中です" : "安否確認の開始を待っています", status: checkStatus === "in_progress" ? "in_progress" : "pending" },
                            ]}
                          />
                        </div>}
                        <PrivacyNote note="命に関わるときは、対応を待たずに119番へ通報してください。" />

                        <div style={{ marginTop: "auto", paddingTop: 20 }}>
                          <SecondaryButton onClick={() => setEmergencySubScreen("safety_answer")}>
                            状況が変わったので更新する
                          </SecondaryButton>
                        </div>
                      </div>
                    )}

                    {/* --------------------------------------------------------
                        R03〜R08: 無事回答後の各ステップ
                        -------------------------------------------------------- */}
                    {isSafetyAnswered && currentResidentSafety === "SAFE" && emergencySubScreen !== "damage_detail" && emergencySubScreen !== "safety_answer" && (
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
                              current={totalAnswered}
                              total={50}
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

                        {/* 2. タスク打診中：R04 / R05 確認・協力のお願い */}
                        {myTask && myTask.status === "OFFERED" && (() => {
                          const taskTitle = myTask.title || "近くのお宅の確認をお願いできますか？";
                          const taskDesc = myTask.description || "インターホンを1回鳴らすだけです。断っても理由は聞きません。";
                          const estSeconds = myTask.estimated_seconds ?? 20;
                          const estText = estSeconds >= 60 ? `約${Math.round(estSeconds / 60)}分` : `約${estSeconds}秒`;
                          const reasonNote = myTask.task_type === "SUPPLY_RELAY"
                            ? "部屋番号は協力すると表示されます。あなたに頼んだ理由：在宅かつ直近拘束がなく、階段移動が可能なため。"
                            : myTask.task_type === "EVACUATION_ESCORT"
                              ? "部屋番号は協力すると表示されます。あなたに頼んだ理由：同一階・同一避難動線上で自力避難が可能なため。"
                              : myTask.task_type === "VERTICAL_EVACUATION"
                                ? "部屋番号は協力すると表示されます。あなたに頼んだ理由：上方向への避難動線上に位置しているため。"
                                : "部屋番号は協力すると表示されます。あなたに頼んだ理由：同じ階で無事と回答し、いちばん近いため。";

                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                              <PageTitle
                                title={taskTitle}
                                subtitle={`${taskDesc} 所要${estText}。断っても理由は聞きません。`}
                              />
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <CountdownPill label="返事の期限 残り" timeRemaining={taskTimeRemaining} />
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
                                  <span style={{ fontWeight: 700 }}>{taskTitle}</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "var(--color-muted)" }}>場所</span>
                                  <span style={{ fontWeight: 700 }}>
                                    {activePersona.roomNumber ? `近隣（${activePersona.roomNumber[0]}階エリア）` : "近隣住戸・共用部"}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "var(--color-muted)" }}>所要時間</span>
                                  <span style={{ fontWeight: 700 }}>{estText}</span>
                                </div>
                              </div>

                              <PrivacyNote note={reasonNote} />

                              {/* Actions (Max 2 Buttons) */}
                              <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                                <PrimaryButton onClick={() => handleRespondTask("APPROVED")}>
                                  協力する（{estText}）
                                </PrimaryButton>
                                <SecondaryButton onClick={() => handleRespondTask("DECLINED")}>
                                  今は無理（理由は不要です）
                                </SecondaryButton>
                              </div>
                            </div>
                          );
                        })()}

                        {/* 3. 承認後：R06 確認先・手順表示 */}
                        {myTask &&
                          (myTask.status === "APPROVED" || myTask.status === "IN_PROGRESS") &&
                          emergencySubScreen !== "reporting" && (() => {
                            const isDisclosed = !!disclosedRoom;
                            const targetRoom = disclosedRoom || "•••";
                            const isRelay = myTask.task_type === "SUPPLY_RELAY";

                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <PageTitle
                                  title={isRelay ? "物資の受取場所と運搬先" : "確認・支援先のお部屋"}
                                  subtitle={isRelay ? "無理は禁物です。荷物が重い場合や危険を感じたら中断してください。" : "無理は禁物です。危険を感じたら直ちに引き返してください。"}
                                />
                                {/* Big Room Number / Location */}
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
                                    {isRelay ? "物資の受取場所" : "対象住戸"}
                                  </span>
                                  <div style={{ marginTop: 4 }}>
                                    <span
                                      className="font-mono-num"
                                      style={{
                                        fontSize: 36,
                                        fontWeight: 900,
                                        color: isDisclosed ? "var(--color-ink)" : "var(--color-muted)",
                                      }}
                                    >
                                      {targetRoom}
                                    </span>
                                    <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 4 }}>号室ドア前</span>
                                  </div>
                                </div>

                                {/* Steps list */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      1
                                    </span>
                                    <span>
                                      {isRelay
                                        ? (isDisclosed ? `${targetRoom}号室ドア前に置かれた物資を受け取ります（非対面）` : "受取場所ドア前へ向かいます")
                                        : (isDisclosed ? `${targetRoom}号室の前へ向かいます` : "対象住戸の前へ向かいます")}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      2
                                    </span>
                                    <span>
                                      {isRelay
                                        ? "指定階（8階踊り場）の「ZASHIKI箱」へ運んで置きます"
                                        : myTask.task_type === "EVACUATION_ESCORT"
                                          ? "合流して西側非常階段まで同行避難します"
                                          : myTask.task_type === "VERTICAL_EVACUATION"
                                            ? "合流して上層階へ垂直避難します"
                                            : "インターホンを1回だけ鳴らします（不在時は深追い不要）"}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      3
                                    </span>
                                    <span>
                                      {isRelay
                                        ? "置き終えたら「踊り場に置いた」ボタンを押して報告してください"
                                        : myTask.task_type === "EVACUATION_ESCORT" || myTask.task_type === "VERTICAL_EVACUATION"
                                          ? "同行・避難完了をアプリで報告してください"
                                          : "応答の有無をアプリで報告してください"}
                                    </span>
                                  </div>
                                </div>

                                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                                  <PrimaryButton onClick={() => setEmergencySubScreen("reporting")}>
                                    {isRelay ? "指定の踊り場に着いた・報告する" : (isDisclosed ? `${targetRoom}号室に着いた・報告する` : "現地に着いた・報告する")}
                                  </PrimaryButton>
                                </div>
                              </div>
                            );
                          })()}

                        {/* 4. 結果報告：R07 結果の報告 */}
                        {myTask &&
                          (myTask.status === "APPROVED" || myTask.status === "IN_PROGRESS") &&
                          emergencySubScreen === "reporting" && (() => {
                            const isRelay = myTask.task_type === "SUPPLY_RELAY";

                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <PageTitle
                                  title={isRelay ? "踊り場に置けましたか？" : "応答はありましたか？"}
                                  subtitle={isRelay ? "運搬と引き継ぎの状況を選んでください。" : "確認できた状況を選んでください。"}
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                                  <ChoiceButton
                                    title={isRelay ? "指定の踊り場に置いた" : "応答があった"}
                                    description={isRelay ? "無事に指定踊り場のZASHIKI箱に物資を置きました。" : "声や返答があり、無事であることが確認できました。"}
                                    accentColor="brand"
                                    onClick={() => handleReportTask("TARGET_RESPONDED")}
                                    icon={
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    }
                                  />
                                  <ChoiceButton
                                    title={isRelay ? "置けなかった（危険・途中で断念）" : "応答がなかった"}
                                    description={isRelay ? "荷物が重い、体調不良、階段が危険などのため運搬を完了できませんでした。" : "インターホンへの返答がなく、室内の物音も聞こえません。"}
                                    accentColor={isRelay ? "danger" : "ink"}
                                    onClick={() => handleReportTask(isRelay ? "UNSAFE" : "TARGET_NO_RESPONSE")}
                                    icon={
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isRelay ? "var(--color-danger)" : "var(--color-ink)"} strokeWidth="2.5">
                                        {isRelay ? (
                                          <line x1="18" y1="6" x2="6" y2="18" />
                                        ) : (
                                          <>
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="8" y1="12" x2="16" y2="12" />
                                          </>
                                        )}
                                      </svg>
                                    }
                                  />
                                  {!isRelay && (
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
                                  )}
                                </div>
                                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                                  <SecondaryButton onClick={() => setEmergencySubScreen("default")}>
                                    前の画面へもどる
                                  </SecondaryButton>
                                </div>
                              </div>
                            );
                          })()}

                        {/* FN-07 / FN-08: R08 retains the authorized destination for its assignee. */}
                        {myTask && myTask.status === "COMPLETED" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <PageTitle
                              title="確認ありがとうございました"
                              subtitle={disclosedRoom
                                ? "確認結果は管理人に送信されました。確認したお部屋を以下に表示しています。"
                                : "確認結果は管理人に送信されました。確認先の部屋番号はまだ取得できていません。"}
                            />
                            {/* FN-07: Use the current task’s authorized API detail. */}
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
                                確認先住戸
                              </span>
                              <div style={{ marginTop: 4 }}>
                                <span className="font-mono-num" style={{ fontSize: 32, fontWeight: 900, color: "var(--color-muted)" }}>
                                  {disclosedRoom || "•••"}
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
                                • 使われた情報：同じ階・無事の回答・在宅状況
                              </div>
                              <div style={{ color: "var(--color-muted)" }}>
                                {disclosedRoom
                                  ? "• 確認先の部屋番号は、確認を担当したあなたに表示しています"
                                  : "• 確認先の部屋番号は、開示が許可された場合だけ表示します"}
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
                            いま Zashikiwarashi が知っていること
                          </span>
                          <div style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6 }}>
                            • 在館推定：在宅の可能性が高い<br />
                            • 階段の支援：健脚（短時間の階段移動が可能）<br />
                            • 個人の性格・評価・ランキングは一切作成・保存しません。
                          </div>
                        </div>

                        <div style={{ marginTop: "auto", paddingTop: 16 }}>
                          <PrivacyNote note="Zashikiwarashiは119番の代わりではありません。命に関わるときは、直ちに119番へ。" />
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
                            {auditEvents.map((evt) => {
                              const eventId = evt.audit_event_id || evt.audit_id || "";
                              const rawTime = evt.occurred_at || evt.created_at || "";
                              const timeStr = rawTime.length >= 16 ? rawTime.slice(11, 16) : rawTime;

                              const formatAction = (actionName: string) => {
                                switch (actionName) {
                                  case "DISCLOSE_ROOM_NUMBER_ON_APPROVAL":
                                    return "協力承認に伴う部屋番号の限定開示";
                                  case "APPROVE_TASK":
                                    return "協力依頼の承認";
                                  case "DECLINE_TASK":
                                    return "協力依頼の辞退（理由不要）";
                                  case "EVALUATE_TASK":
                                    return "Agentによるタスク実行可否の評価";
                                  case "REPORT_SAFETY":
                                    return "安否・在館の一次回答";
                                  default:
                                    return actionName || "情報の取り扱い記録";
                                }
                              };

                              const formatActor = (actorType: string, actorId: string) => {
                                switch (actorType) {
                                  case "RESIDENT":
                                    return `本人（${actorId}）`;
                                  case "RESIDENT_AGENT":
                                    return `Resident Agent（${actorId}）`;
                                  case "BUILDING_AGENT":
                                    return "Building Agent（全体調整）";
                                  case "ADMIN":
                                    return "管理人";
                                  case "SYSTEM":
                                    return "システム（Policy Engine）";
                                  default:
                                    return `${actorType || "システム"} (${actorId || "自律制御"})`;
                                }
                              };

                              return (
                                <div
                                  key={eventId}
                                  style={{
                                    backgroundColor: "#FFFFFF",
                                    border: "1px solid var(--color-line)",
                                    borderRadius: 12,
                                    padding: "14px 16px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
                                      {formatAction(evt.action || evt.event_name || "")}
                                    </span>
                                    <span className="font-mono-num" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                                      {timeStr}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                                    操作主体: {formatActor(evt.actor_type, evt.actor_id)}
                                  </div>

                                  {/* data_used（使われた情報） */}
                                  {evt.data_used && evt.data_used.length > 0 && (
                                    <div style={{ fontSize: 12, color: "var(--color-ink)", display: "flex", flexDirection: "column", gap: 3 }}>
                                      <span style={{ fontWeight: 700, color: "var(--color-muted)", fontSize: 11 }}>使われた情報:</span>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {evt.data_used.map((d, i) => (
                                          <span key={i} style={{ backgroundColor: "var(--color-canvas)", padding: "2px 8px", borderRadius: 4, fontSize: 11.5 }}>
                                            {d === "resident_approval" ? "本人の協力承認" : d === "task_id" ? "タスク識別子" : d}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* data_disclosed（開示された情報） */}
                                  {evt.data_disclosed && evt.data_disclosed.length > 0 && (
                                    <div style={{ fontSize: 12, color: "var(--color-brand)", display: "flex", flexDirection: "column", gap: 3 }}>
                                      <span style={{ fontWeight: 700, color: "var(--color-muted)", fontSize: 11 }}>開示された情報:</span>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {evt.data_disclosed.map((d, i) => (
                                          <span key={i} style={{ backgroundColor: "var(--color-brand-tint)", color: "var(--color-brand)", padding: "2px 8px", borderRadius: 4, fontSize: 11.5, fontWeight: 700 }}>
                                            {d.startsWith("unit_room_number:") ? `${d.replace("unit_room_number:", "")}号室` : d}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {evt.description && (
                                    <div style={{ fontSize: 12.5, color: "var(--color-ink)", lineHeight: 1.5 }}>
                                      {evt.description}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
        </div>
      </div>
    </main>
  );
}
