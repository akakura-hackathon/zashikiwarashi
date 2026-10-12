"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  type Persona,
  type SafetyConfirmation,
  type Task,
  type TaskDetailResponse,
  type IssueDetailResponse,
  type EmergencyType,
  type ReasonCode,
  confirmPresence,
  respondToTask,
  reportTask,
  getTaskDetail,
} from "@/lib/api-client";
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
} from "./ui/StatusAndInput";
import {
  Timeline,
  PrivacyNote,
} from "./ui/NavigationAndInfo";
import { LockNotification } from "./ui/LockNotification";
import { FloorMap, type RoomItem } from "./ui/FloorMap";
import { safetyRoomStatus } from "@/lib/emergency-view";
import type { PriorityAlertTarget } from "@/lib/api-client";

function formatTimeHM(isoString?: string | null): string {
  if (!isoString) {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateJa(isoString?: string | null): string {
  const d = isoString ? new Date(isoString) : new Date();
  const valid = !isNaN(d.getTime()) ? d : new Date();
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${valid.getMonth() + 1}月${valid.getDate()}日 ${days[valid.getDay()]}曜日`;
}

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

  // SC-2: 火災時の避難状況・被害項目（S2_E1）
  const [fireItems, setFireItems] = useState({
    stairsUnable: false,  // 階段を自力で降りられない（避難同行が必要）
    smokeFire: false,     // 煙が充満している・火が見える
    injury: false,        // けがをしている・動けない
    blocked: false,       // 逃げ道・ドアが遮断されている
  });

  // SC-4: 洪水・垂直避難時の状況項目（S4_L1）
  const [floodItems, setFloodItems] = useState({
    stairsUnable: false,  // 自力で上層階へ階段を上がれない（同行支援希望）
    flooded: false,       // 室内や玄関まで浸水している
    darkInjury: false,    // 停電で足元が暗く動けない・けが
    caregiver: false,     // 乳幼児・要介助者がいて移動が困難
  });

  // FN-03 / REQ-15: 自由文メッセージと代理人（Resident Agent）からの聞き返し質問
  const [damageFreeText, setDamageFreeText] = useState("");
  const [clarificationQuestion, setClarificationQuestion] = useState<string | null>(null);

  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [answeredTime, setAnsweredTime] = useState<string | null>(null);

  const issuedAtTime = formatTimeHM(issueDetail?.issue.created_at);
  const lockScreenDate = formatDateJa(issueDetail?.issue.created_at);

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
              ? "無事です。けがはなく、部屋から出られます。"
              : "被害があります。支援が必要です。"),
        },
        activePersona,
      );
      setAnsweredTime(formatTimeHM());
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

  // 管理人向け集計データ
  const summary = issueDetail?.current_states_summary ?? {};
  const adminSafeCount = summary["SAFE"] ?? 0;
  const adminNeedHelpCount = summary["NEED_HELP"] ?? 0;
  const adminOutsideCount = issueDetail?.likely_away_count ?? summary["OUTSIDE_BUILDING"] ?? 0;
  const adminRawUnknown = summary["UNKNOWN"] ?? (emergencyId ? 50 : 0);
  const adminUnknownCount = Math.max(0, adminRawUnknown - (summary["OUTSIDE_BUILDING"] ? 0 : adminOutsideCount));

  const priorityTargets: PriorityAlertTarget[] = issueDetail?.priority_targets ?? [];

  const adminRooms: RoomItem[] = Array.from({ length: 50 }, (_, i) => {
    const floor = Math.floor(i / 10) + 1;
    const col = i % 10 + 1;
    const roomNo = `${floor}${String(col).padStart(2, "0")}`;
    const safety = issueDetail?.room_states?.[roomNo];
    const isLikelyAway = issueDetail?.likely_away_rooms?.includes(roomNo);
    const status = isLikelyAway && (safety === "UNKNOWN" || !safety) ? "away" : safetyRoomStatus(safety);
    return { roomNo, floor, col, status };
  });

  // --------------------------------------------------------------------------
  // RENDER: Lock Screen Notification (R01 / R04)
  // --------------------------------------------------------------------------
  const showLockScreen = emergencyId && !isSafetyAnswered && emergencySubScreen === "lock";

  // 管理人スマホ画面
  if (activePersona.role === "admin") {
    const disasterInfo: Record<EmergencyType, { typeName: string; detail: string }> = {
      EARTHQUAKE: { typeName: "地震", detail: "震度5強" },
      POWER_OUTAGE: { typeName: "停電", detail: "EV全基停止" },
      FIRE: { typeName: "火災", detail: "警報鳴動" },
      FLOOD: { typeName: "洪水", detail: "垂直避難警戒" },
    };
    const bannerInfo = disasterInfo[emergencyType || "EARTHQUAKE"];

    return (
      <main className="device-stage">
        <div className="device-wrapper">
          <div className="device-screen">
            <div className="app-container">
              <AppBar variant="home" residentName="管理人" />

              {emergencyId && (
                <EmergencyBanner
                  disasterType={bannerInfo.typeName}
                  detail={bannerInfo.detail}
                  issuedAt={issuedAtTime}
                />
              )}

              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  padding: "16px 20px 24px",
                  overflowY: "auto",
                  gap: 16,
                }}
              >
                {/* ヘッダー部 */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 style={{ fontSize: "1.05rem", fontWeight: 800, margin: 0, color: "var(--color-ink)" }}>
                      棟内50戸の安否状況
                    </h2>
                    <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "2px 0 0" }}>
                      {emergencyId ? "全自動トリアージ & リアルタイム集計" : "平常時の棟内見守り稼働中"}
                    </p>
                  </div>
                  {emergencyId && (
                    <CountdownPill label="回答の目安 残り" timeRemaining={safetyTimeRemaining} />
                  )}
                </div>

                {/* 4枚のステータスカード */}
                <div className="status-grid">
                  <div className="status-card">
                    <span className="status-label">無事回答</span>
                    <span className="status-val ok font-mono-num">{adminSafeCount} 戸</span>
                  </div>
                  <div className="status-card">
                    <span className="status-label">未応答 (要トリアージ)</span>
                    <span className="status-val alert font-mono-num">{adminUnknownCount} 戸</span>
                  </div>
                  <div className="status-card">
                    <span className="status-label">カレンダー外出中</span>
                    <span className="status-val warn font-mono-num">{adminOutsideCount} 戸</span>
                  </div>
                  <div className="status-card">
                    <span className="status-label">要救助回答</span>
                    <span className="status-val alert font-mono-num">{adminNeedHelpCount} 戸</span>
                  </div>
                </div>

                {/* 5階×10列 (全50戸) FloorMap */}
                <div style={{ marginTop: 4 }}>
                  <FloorMap rooms={adminRooms} />
                </div>

                {/* 🚨 防災センター最優先現地確認アラート (添付画像4枚目) */}
                {priorityTargets.length > 0 && (
                  <div className="priority-alert-box">
                    <div className="priority-header">
                      <span>🚨 防災センター最優先現地確認アラート</span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "var(--color-danger-text)" }}>
                      「本人未応答 × 隣室確認も応答なし × 高齢単身要配慮」の住戸を検出しました
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                      {priorityTargets.map((target) => (
                        <div key={target.resident_id} className="priority-target-item">
                          <div>
                            <span
                              className="font-mono-num"
                              style={{ fontWeight: 800, color: "var(--color-ink)", marginRight: "6px" }}
                            >
                              {target.room_number}号室
                            </span>
                            <span style={{ color: "var(--color-danger)" }}>
                              {target.is_elderly ? "高齢単身" : "一般"}・安否未確認
                            </span>
                          </div>
                          <span
                            style={{
                              backgroundColor: "var(--color-danger)",
                              color: "#FFFFFF",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}
                          >
                            {target.priority_level}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="device-stage">
      <div className="device-wrapper">
        <div className="device-screen">
          {/* ================================================================
              PATTERN 1: Lock Screen Notification (R01)
              ================================================================ */}
          {showLockScreen ? (() => {
            const isOutage = emergencyType === "POWER_OUTAGE";
            const isFire = emergencyType === "FIRE";
            const isFlood = emergencyType === "FLOOD";
            const lockTitle = isOutage
              ? "停電が発生しました（EV全基停止）"
              : isFire
                ? "火災報知器が作動しました（全館避難）"
                : isFlood
                  ? "大雨洪水警戒情報が発令されました"
                  : "地震が発生しました（震度5強）";
            const lockMsg = isOutage
              ? "ご自宅にいらっしゃいますか？ 状況を教えてください"
              : isFire
                ? "西側非常階段から避難できますか？ 状況を教えてください"
                : isFlood
                  ? "垂直避難（上階への移動）は可能ですか？"
                  : "ご自身とお部屋は無事ですか？";
            const primaryBtn = isOutage
              ? "在宅・問題なし"
              : isFire
                ? "自力避難できる"
                : isFlood
                  ? "垂直避難できる"
                  : "無事";
            const secondaryBtn = isOutage
              ? "困っている"
              : isFire
                ? "同行が必要"
                : isFlood
                  ? "手伝いが必要"
                  : "被害あり";

            return (
              <LockNotification
                timeStr={issuedAtTime}
                dateStr={lockScreenDate}
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
                  {/* Top Bar */}
                  <AppBar
                    variant={emergencySubScreen !== "default" ? "subpage" : "home"}
                    onBack={() => setEmergencySubScreen("default")}
                    residentName={activePersona.name}
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
                    return <EmergencyBanner disasterType={bannerInfo.typeName} detail={bannerInfo.detail} issuedAt={issuedAtTime} />;
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
                      const isFire = emergencyType === "FIRE";
                      const isFlood = emergencyType === "FLOOD";
                      const pageTitle = isOutage
                        ? "停電時の困りごとを教えてください"
                        : isFire
                          ? "避難の状況を教えてください"
                          : isFlood
                            ? "垂直避難の状況を教えてください"
                            : "被害の内容を教えてください";
                      const pageSubtitle = isOutage
                        ? "エレベーター停止に伴う困りごとを管理人に届けます。命に関わるときは迷わず119番通報してください。"
                        : isFire
                          ? "西側非常階段からの避難方針のもと、同一フロアの支援可能者や管理人に届きます。命に関わるときは迷わず119番通報してください。"
                          : isFlood
                            ? "浸水リスクのある低層階から上階へ移動するため、同一動線の避難可能者や管理人に届きます。命に関わるときは迷わず119番通報してください。"
                            : "管理人に優先して情報が届きます。命に関わるときは迷わず119番通報してください。";
                      const placeholder = isOutage
                        ? "例: 14階で水が切れました / 足が悪く階段が降りられません"
                        : isFire
                          ? "例: 廊下に煙が少し漂っています / 足腰に不安があり一人で階段を降りられません"
                          : isFlood
                            ? "例: 玄関まで水が入ってきています / 足が悪く一人で上階へ階段を上がれません"
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
                            ) : isFire ? (
                              <>
                                <CheckRow
                                  label="階段を自力で降りられない（避難同行が必要）"
                                  sublabel="足腰の不安、車椅子、階段移動介助が必要など"
                                  checked={fireItems.stairsUnable}
                                  onChange={(checked) =>
                                    setFireItems({ ...fireItems, stairsUnable: checked })
                                  }
                                />
                                <CheckRow
                                  label="煙が充満している・火が見える"
                                  sublabel="廊下や室内への煙の侵入、炎の確認など"
                                  checked={fireItems.smokeFire}
                                  onChange={(checked) =>
                                    setFireItems({ ...fireItems, smokeFire: checked })
                                  }
                                />
                                <CheckRow
                                  label="けがをしている・動けない"
                                  sublabel="やけど、打撲、煙を吸い込んだなど"
                                  checked={fireItems.injury}
                                  onChange={(checked) =>
                                    setFireItems({ ...fireItems, injury: checked })
                                  }
                                />
                                <CheckRow
                                  label="逃げ道・ドアが遮断されている"
                                  sublabel="煙や熱で玄関から出られないなど"
                                  checked={fireItems.blocked}
                                  onChange={(checked) =>
                                    setFireItems({ ...fireItems, blocked: checked })
                                  }
                                />
                              </>
                            ) : isFlood ? (
                              <>
                                <CheckRow
                                  label="自力で上層階へ階段を上がれない（同行支援希望）"
                                  sublabel="足腰の不安、車椅子、荷物が多く単独移動不可など"
                                  checked={floodItems.stairsUnable}
                                  onChange={(checked) =>
                                    setFloodItems({ ...floodItems, stairsUnable: checked })
                                  }
                                />
                                <CheckRow
                                  label="室内や玄関まで浸水している"
                                  sublabel="床下・床上浸水、廊下の冠水など"
                                  checked={floodItems.flooded}
                                  onChange={(checked) =>
                                    setFloodItems({ ...floodItems, flooded: checked })
                                  }
                                />
                                <CheckRow
                                  label="停電で足元が暗く動けない・けが"
                                  sublabel="足元が見えない、転倒によるけがなど"
                                  checked={floodItems.darkInjury}
                                  onChange={(checked) =>
                                    setFloodItems({ ...floodItems, darkInjury: checked })
                                  }
                                />
                                <CheckRow
                                  label="乳幼児・要介助者がいて移動が困難"
                                  sublabel="子どもや高齢者がおり一人では連れ出せないなど"
                                  checked={floodItems.caregiver}
                                  onChange={(checked) =>
                                    setFloodItems({ ...floodItems, caregiver: checked })
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
                                  : isFire
                                    ? Object.entries(fireItems)
                                        .filter(([, v]) => v)
                                        .map(([k]) => {
                                          if (k === "stairsUnable") return "階段歩行困難・避難同行要";
                                          if (k === "smokeFire") return "煙充満・火災視認";
                                          if (k === "injury") return "けが・体調不良";
                                          if (k === "blocked") return "逃げ道・ドア遮断";
                                          return k;
                                        })
                                    : isFlood
                                      ? Object.entries(floodItems)
                                          .filter(([, v]) => v)
                                          .map(([k]) => {
                                            if (k === "stairsUnable") return "上階歩行困難・同行要";
                                            if (k === "flooded") return "室内・玄関浸水";
                                            if (k === "darkInjury") return "暗闇・足元負傷";
                                            if (k === "caregiver") return "乳幼児・要介助者同行要";
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
                                  parts.push(
                                    isOutage
                                      ? `【困りごと】${checkedLabels.join("、")}`
                                      : isFire
                                        ? `【避難状況】${checkedLabels.join("、")}`
                                        : isFlood
                                          ? `【垂直避難状況】${checkedLabels.join("、")}`
                                          : `【被害項目】${checkedLabels.join("、")}`
                                  );
                                }
                                if (damageFreeText.trim()) {
                                  parts.push(damageFreeText.trim());
                                }
                                const finalMsg =
                                  parts.join("\n") ||
                                  (isOutage
                                    ? "停電により困りごとがあります。支援が必要です。"
                                    : isFire
                                      ? "火災避難に手助け・同行が必要です。"
                                      : isFlood
                                        ? "垂直避難に手助け・同行が必要です。"
                                        : "被害があります。支援が必要です。");
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
                      const isFire = emergencyType === "FIRE";
                      const isFlood = emergencyType === "FLOOD";
                      const r02Title = isOutage
                        ? "ご自宅にいらっしゃいますか？ 状況を教えてください"
                        : isFire
                          ? "避難できますか？ 状況を教えてください"
                          : isFlood
                            ? "垂直避難できますか？ 状況を教えてください"
                            : "ご自身とお部屋は無事ですか？";
                      const r02Subtitle = isOutage
                        ? "エレベーターが全基停止しています。回答は全体の把握に使われ、部屋番号は外部に公開されません。"
                        : isFire
                          ? "6階で火災が発生し、西側非常階段からの避難指示が出ています。"
                          : isFlood
                            ? "浸水のおそれがあります。1階・2階の方は6階共用ラウンジなど上層階へ移動してください。"
                            : "回答は建物全体の把握に使われ、部屋番号は外部に公開されません。";
                      const choice1Title = isOutage
                        ? "在宅・問題なし（特別な手助けは不要）"
                        : isFire
                          ? "自力避難できる（同行支援は不要）"
                          : isFlood
                            ? "自力で垂直避難できる（同行支援は不要）"
                            : "無事（けがはなく、部屋から出られる）";
                      const choice1Desc = isOutage
                        ? "自室で待機可能で、水や階段昇降の特別な手助けは不要です。"
                        : isFire
                          ? "西側非常階段から地上へ向かって単独で避難可能です。"
                          : isFlood
                            ? "階段を使って自力で6階以上の上層階へ避難可能です。"
                            : "自身で身の安全が確保できており、特別な手助けは不要です。";
                      const choice2Title = isOutage
                        ? "困っている（水・階段・薬・体調など）"
                        : isFire
                          ? "避難に手助け・同行が必要"
                          : isFlood
                            ? "垂直避難に手助け・同行が必要"
                            : "被害あり（けが・閉じ込め・部屋の損傷など）";
                      const choice2Desc = isOutage
                        ? "飲料水の不足や階段昇降困難、熱中症リスクなど支援が必要です。"
                        : isFire
                          ? "階段の歩行に不安がある、煙が充満しているなど同行が必要です。"
                          : isFlood
                            ? "上階への階段昇降に不安がある、または浸水・体調不良等で同行が必要です。"
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
                        R10: 被害あり送信後の待機タイムライン画面（SC-2: 避難同行待機 S2_E2 / SC-4: 垂直避難待機 S4_L2）
                        -------------------------------------------------------- */}
                    {isSafetyAnswered && currentResidentSafety === "NEED_HELP" && emergencySubScreen === "default" && (() => {
                      const isFire = emergencyType === "FIRE";
                      const isFlood = emergencyType === "FLOOD";
                      const helpTitle = isFire
                        ? "避難同行の手配状況"
                        : isFlood
                          ? "垂直避難同行の手配状況"
                          : "管理人に伝わりました";
                      const helpSubtitle = isFire
                        ? (checkStatus === "in_progress"
                            ? "同行支援の方があなたのお部屋（ドア前）へ向かっています。"
                            : checkStatus === "approved"
                              ? "同じフロアの方が避難同行を承認しました（移動目安 約30秒）。"
                              : checkStatus === "triaging"
                                ? "同一フロアの自力避難可能者とマッチング中です。"
                                : "避難同行の要請を受け付けました。同一フロアの支援可能者を探しています。")
                        : isFlood
                          ? (checkStatus === "in_progress"
                              ? "同行支援の方があなたのお部屋（ドア前）へ向かっています。"
                              : checkStatus === "approved"
                                ? "上方向へ避難中の住民が同行を承認しました（移動目安 約1分）。"
                                : checkStatus === "triaging"
                                  ? "上方向へ移動中の避難可能者とマッチング中です。"
                                  : "垂直避難同行の要請を受け付けました。上方向へ移動中の住民を探しています。")
                          : (checkStatus === "in_progress"
                              ? "近隣の方による安否確認が始まりました。"
                              : checkStatus === "approved"
                                ? "近隣の方が、あなたのお宅の安否確認への協力を承認しました。"
                                : checkStatus === "triaging"
                                  ? "安否状況の確認・対応の検討中です。あなたへの対応はまだ確定していません。"
                                  : "被害状況を受け付けました。管理人による確認をお待ちください。");

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                          <PageTitle
                            title={helpTitle}
                            subtitle={helpSubtitle}
                          />
                          {isFire ? (
                            <div
                              style={{
                                backgroundColor: "#FFF8E1",
                                borderRadius: 12,
                                padding: "14px 16px",
                                border: "1px solid #FFE082",
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#B78103" }}>
                                ⚠️ 煙への注意・待機時の心得
                              </span>
                              <p style={{ fontSize: 13, color: "var(--color-ink)", marginTop: 4, lineHeight: 1.5 }}>
                                煙が充満してきた場合は無理に廊下に出ず、濡れタオル等で口と鼻を覆い、姿勢を低くして待機してください。30秒以上来ない場合や危険が迫った場合は無理をせず即座に通報・避難してください。
                              </p>
                            </div>
                          ) : isFlood ? (
                            <div
                              style={{
                                backgroundColor: "#E3F2FD",
                                borderRadius: 12,
                                padding: "14px 16px",
                                border: "1px solid #90CAF9",
                              }}
                            >
                              <span style={{ fontSize: 14, fontWeight: 700, color: "#1565C0" }}>
                                ⚠️ 垂直避難の準備・待機時の心得
                              </span>
                              <p style={{ fontSize: 13, color: "var(--color-ink)", marginTop: 4, lineHeight: 1.5 }}>
                                浸水が始まる前に、貴重品や非常持ち出し品を持って玄関付近でお待ちください。同行者が到着したら、エレベーターは使わず非常階段で6階共用ラウンジへ向かいます。
                              </p>
                            </div>
                          ) : hasConfirmedCheck && (
                            <div
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
                            </div>
                          )}

                          {/* Timeline */}
                          {(isFire || isFlood || hasConfirmedCheck) && (
                            <div style={{ marginTop: 8 }}>
                              <Timeline
                                items={isFire ? [
                                  { text: "同行要請を送信しました", status: "completed" },
                                  {
                                    text: checkStatus === "approved" || checkStatus === "in_progress"
                                      ? "同じフロアの方が避難同行を承認しました（約30秒）"
                                      : "同じフロアの避難可能者を探しています",
                                    status: checkStatus === "approved" || checkStatus === "in_progress" ? "completed" : "pending",
                                  },
                                  {
                                    text: checkStatus === "in_progress" ? "合流して西側階段へ移動中" : "合流を待機中",
                                    status: checkStatus === "in_progress" ? "in_progress" : "pending",
                                  },
                                ] : isFlood ? [
                                  { text: "垂直避難同行の要請を送信しました", status: "completed" },
                                  {
                                    text: checkStatus === "approved" || checkStatus === "in_progress"
                                      ? "上方向避難者が同行を承認しました（約1分）"
                                      : "上方向へ移動中の避難可能者を探しています",
                                    status: checkStatus === "approved" || checkStatus === "in_progress" ? "completed" : "pending",
                                  },
                                  {
                                    text: checkStatus === "in_progress" ? "合流して6階共用ラウンジへ移動中" : "合流を待機中",
                                    status: checkStatus === "in_progress" ? "in_progress" : "pending",
                                  },
                                ] : [
                                  { text: "被害状況を送信しました", status: "completed" },
                                  { text: "近隣の方が安否確認への協力を承認しました", status: "completed" },
                                  {
                                    text: checkStatus === "in_progress" ? "安否確認を実施中です" : "安否確認の開始を待っています",
                                    status: checkStatus === "in_progress" ? "in_progress" : "pending",
                                  },
                                ]}
                              />
                            </div>
                          )}
                          <PrivacyNote note={isFire ? "火の手が迫った場合は、支援を待たずに直ちに避難・119番通報してください。" : isFlood ? "浸水が急激に進む場合は、支援を待たずに直ちに上層階へ自力避難・119番通報してください。" : "命に関わるときは、対応を待たずに119番へ通報してください。"} />

                          <div style={{ marginTop: "auto", paddingTop: 20 }}>
                            <SecondaryButton onClick={() => setEmergencySubScreen("safety_answer")}>
                              状況が変わったので更新する
                            </SecondaryButton>
                          </div>
                        </div>
                      );
                    })()}

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
                              subtitle={`${answeredTime || issuedAtTime} 回答済み。ご協力ありがとうございます。`}
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
                            const isEscort = myTask.task_type === "EVACUATION_ESCORT";
                            const isVertical = myTask.task_type === "VERTICAL_EVACUATION";

                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <PageTitle
                                  title={
                                    isEscort
                                      ? "合流場所と避難ルート"
                                      : isVertical
                                        ? "合流場所と垂直避難先"
                                        : isRelay
                                          ? "物資の受取場所と運搬先"
                                          : "確認・支援先のお部屋"
                                  }
                                  subtitle={
                                    isEscort
                                      ? "無理は禁物です。煙が濃い場合や危険を感じたら直ちに自身を優先し避難してください。"
                                      : isVertical
                                        ? "無理は禁物です。浸水の深さや危険を感じたら直ちに自身を優先し上階へ避難してください。"
                                        : isRelay
                                          ? "無理は禁物です。荷物が重い場合や危険を感じたら中断してください。"
                                          : "無理は禁物です。危険を感じたら直ちに引き返してください。"
                                  }
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
                                    {isEscort
                                      ? "合流場所（西側非常階段ルート上）"
                                      : isVertical
                                        ? "合流場所（低層階・上方向避難ルート上）"
                                        : isRelay
                                          ? "物資の受取場所"
                                          : "対象住戸"}
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
                                  {isEscort && (
                                    <div
                                      style={{
                                        display: "inline-block",
                                        fontSize: 12,
                                        color: "#C62828",
                                        backgroundColor: "#FFEBEE",
                                        padding: "4px 12px",
                                        borderRadius: 8,
                                        marginTop: 8,
                                        fontWeight: 700,
                                      }}
                                    >
                                      ⚠️ 姿勢を低く保ち、エレベーターは絶対に使用しないでください
                                    </div>
                                  )}
                                  {isVertical && (
                                    <div
                                      style={{
                                        display: "inline-block",
                                        fontSize: 12,
                                        color: "#1565C0",
                                        backgroundColor: "#E3F2FD",
                                        padding: "4px 12px",
                                        borderRadius: 8,
                                        marginTop: 8,
                                        fontWeight: 700,
                                      }}
                                    >
                                      ⚠️ 浸水に注意し、エレベーターは絶対に使用せず非常階段で6階へ向かってください
                                    </div>
                                  )}
                                </div>

                                {/* Steps list */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      1
                                    </span>
                                    <span>
                                      {isEscort
                                        ? (isDisclosed ? `${targetRoom}号室ドア前へ向かいます（西側階段ルート上）` : "合流場所ドア前へ向かいます")
                                        : isVertical
                                          ? (isDisclosed ? `${targetRoom}号室ドア前へ向かいます（低層階合流場所）` : "合流場所ドア前へ向かいます")
                                          : isRelay
                                            ? (isDisclosed ? `${targetRoom}号室ドア前に置かれた物資を受け取ります（非対面）` : "受取場所ドア前へ向かいます")
                                            : (isDisclosed ? `${targetRoom}号室の前へ向かいます` : "対象住戸の前へ向かいます")}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      2
                                    </span>
                                    <span>
                                      {isEscort
                                        ? "合流して西側非常階段へ向かいます（エレベーター使用禁止・手すり側通行）"
                                        : isVertical
                                          ? "合流して非常階段から6階共用ラウンジへ向かいます（エレベーター使用禁止）"
                                          : isRelay
                                            ? "指定階（8階踊り場）の「ZASHIKI箱」へ運んで置きます"
                                            : "インターホンを1回だけ鳴らします（不在時は深追い不要）"}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                    <span style={{ width: 22, height: 22, borderRadius: "50%", backgroundColor: "var(--color-ink)", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                      3
                                    </span>
                                    <span>
                                      {isEscort
                                        ? "地上集合場所（西側駐車場）到着後、避難完了を報告してください"
                                        : isVertical
                                          ? "6階共用ラウンジへ到着後、避難完了を報告してください"
                                          : isRelay
                                            ? "置き終えたら「踊り場に置いた」ボタンを押して報告してください"
                                            : "応答の有無をアプリで報告してください"}
                                    </span>
                                  </div>
                                </div>

                                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                                  <PrimaryButton onClick={() => setEmergencySubScreen("reporting")}>
                                    {isEscort
                                      ? "合流した・地上集合場所へ向かう（報告へ）"
                                      : isVertical
                                        ? "合流した・6階ラウンジへ向かう（報告へ）"
                                        : isRelay
                                          ? "指定の踊り場に着いた・報告する"
                                          : (isDisclosed ? `${targetRoom}号室に着いた・報告する` : "現地に着いた・報告する")}
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
                            const isEscort = myTask.task_type === "EVACUATION_ESCORT";
                            const isVertical = myTask.task_type === "VERTICAL_EVACUATION";

                            return (
                              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <PageTitle
                                  title={
                                    isEscort
                                      ? "地上集合場所に到着しましたか？"
                                      : isVertical
                                        ? "6階共用ラウンジに到着しましたか？"
                                        : isRelay
                                          ? "踊り場に置けましたか？"
                                          : "応答はありましたか？"
                                  }
                                  subtitle={
                                    isEscort
                                      ? "合流および地上への退避状況を選んでください。"
                                      : isVertical
                                        ? "合流および6階共用ラウンジへの垂直避難状況を選んでください。"
                                        : isRelay
                                          ? "運搬と引き継ぎの状況を選んでください。"
                                          : "確認できた状況を選んでください。"
                                  }
                                />
                                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                                  {isEscort ? (
                                    <>
                                      <ChoiceButton
                                        title="同行して地上（西側駐車場）へ到着した"
                                        description="無事に合流し、西側非常階段経由で退避完了しました。"
                                        accentColor="brand"
                                        onClick={() => handleReportTask("TARGET_RESPONDED")}
                                        icon={
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                            <polyline points="20 6 9 17 4 12" />
                                          </svg>
                                        }
                                      />
                                      <ChoiceButton
                                        title="相手の部屋に応答がなく、先行して避難した"
                                        description="呼びかけましたが返事がなく、危険のため自身で退避しました。"
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
                                        title="煙や火災で合流できず、自身を優先して避難した"
                                        description="廊下の煙が濃いため合流を断念し、非常階段へ直接退避しました。"
                                        accentColor="danger"
                                        onClick={() => handleReportTask("UNSAFE")}
                                        icon={
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2.5">
                                            <polygon points="12 2 2 22 22 22 12 2" />
                                            <line x1="12" y1="9" x2="12" y2="13" />
                                            <line x1="12" y1="17" x2="12.01" y2="17" />
                                          </svg>
                                        }
                                      />
                                    </>
                                  ) : isVertical ? (
                                    <>
                                      <ChoiceButton
                                        title="同行して6階共用ラウンジへ到着した"
                                        description="無事に合流し、階段経由で6階共用ラウンジへ退避完了しました。"
                                        accentColor="brand"
                                        onClick={() => handleReportTask("TARGET_RESPONDED")}
                                        icon={
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2.5">
                                            <polyline points="20 6 9 17 4 12" />
                                          </svg>
                                        }
                                      />
                                      <ChoiceButton
                                        title="相手の部屋に応答がなく、先行して上階へ避難した"
                                        description="呼びかけましたが応答がなく、浸水危険のため自身で上階へ退避しました。"
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
                                        title="浸水・危険のため合流できず、自身を優先して退避した"
                                        description="1階の冠水が進んでいたため合流を断念し、単独で上層階へ退避しました。"
                                        accentColor="danger"
                                        onClick={() => handleReportTask("UNSAFE")}
                                        icon={
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2.5">
                                            <polygon points="12 2 2 22 22 22 12 2" />
                                            <line x1="12" y1="9" x2="12" y2="13" />
                                            <line x1="12" y1="17" x2="12.01" y2="17" />
                                          </svg>
                                        }
                                      />
                                    </>
                                  ) : (
                                    <>
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
                                    </>
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
                        {myTask && myTask.status === "COMPLETED" && (() => {
                          const isEscort = myTask.task_type === "EVACUATION_ESCORT";
                          const isVertical = myTask.task_type === "VERTICAL_EVACUATION";

                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                              <PageTitle
                                title={
                                  isEscort
                                    ? "避難同行ありがとうございました"
                                    : isVertical
                                      ? "垂直避難同行ありがとうございました"
                                      : "確認ありがとうございました"
                                }
                                subtitle={
                                  isEscort
                                    ? (disclosedRoom
                                        ? "地上集合場所への避難報告が管理人に送信されました。同行したお部屋を以下に表示しています。"
                                        : "地上集合場所への避難報告が管理人に送信されました。")
                                    : isVertical
                                      ? (disclosedRoom
                                          ? "6階共用ラウンジへの避難報告が管理人に送信されました。同行したお部屋を以下に表示しています。"
                                          : "6階共用ラウンジへの避難報告が管理人に送信されました。")
                                      : (disclosedRoom
                                          ? "確認結果は管理人に送信されました。確認したお部屋を以下に表示しています。"
                                          : "確認結果は管理人に送信されました。確認先の部屋番号はまだ取得できていません。")
                                }
                              />
                              {/* FN-07: Use the current task’s authorized API detail. */}
                              <div
                                style={{
                                  textAlign: "center",
                                  padding: "20px 0",
                                  backgroundColor: "var(--color-canvas)",
                                  borderRadius: 16,
                                  border: "1px solid var(--color-line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                }}
                              >
                                <span style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 700 }}>
                                  {isEscort || isVertical ? "同行支援先" : "確認先住戸"}
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

                          </div>
                        );
                      })()}
                      </>
                    )}
                  </div>
                </>
              ) : (
                /* ==============================================================
                   PATTERN 3: Normal Time (P_R1)
                   ============================================================== */
                <>
                  <AppBar variant="home" residentName={activePersona.name} />

                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      padding: "16px 24px 20px",
                      overflowY: "auto",
                    }}
                  >
                    {/* Centered content block */}
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 18,
                      }}
                    >
                      <PageTitle
                        title="平常時 何もしなくて大丈夫です"
                        subtitle="緊急時のみ、必要な確認やお願いが届きます。"
                      />

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
                    </div>

                    <div style={{ paddingTop: 16 }}>
                      <PrivacyNote note="Zashikiwarashiは119番の代わりではありません。命に関わるときは、直ちに119番へ。" />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
