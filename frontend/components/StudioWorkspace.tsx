"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { CockpitPanel, type TriageAiResult, type TriageExecution } from "./CockpitPanel";
import { PhoneStage } from "./PhoneStage";
import {
  type Persona,
  type SafetyConfirmation,
  type IssueDetailResponse,
  type Task,
  type EmergencyType,
  DEMO_PERSONAS,
  triggerEmergency,
  simulateEmergencyStep,
  startTriage,
  getIssueDetail,
  getActiveEmergency,
  setActivePersona as setGlobalActivePersona,
} from "@/lib/api-client";
import { applySafetyConfirmation } from "@/lib/emergency-view";
import { getFirebaseApp } from "@/lib/firebase";

export function StudioWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [activePersona, setActivePersonaState] = useState<Persona>(DEMO_PERSONAS[1]); // デフォルト: 住民I
  const [selectedEmergencyType, setSelectedEmergencyType] = useState<EmergencyType>("EARTHQUAKE");
  const [randomSeed, setRandomSeed] = useState<boolean>(false);
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<IssueDetailResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [triageAiResult, setTriageAiResult] = useState<TriageAiResult | null>(null);
  const [triageExecution, setTriageExecution] = useState<TriageExecution>({ count: 0, status: "idle" });
  const triageInFlight = useRef(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSimulatingStep, setIsSimulatingStep] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string }>>([
    {
      time: new Date().toLocaleTimeString(),
      text: "Zashikiwarashi Studio が初期化されました。平常見守りモード待機中。",
    },
  ]);

  const addLog = useCallback((text: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, text }, ...prev].slice(0, 30));
  }, []);

  // FN-02: Both consoles require an explicit, non-anonymous login.
  useEffect(() => {
    const auth = getAuth(getFirebaseApp());
    return onAuthStateChanged(auth, (current) => {
      setUser(current && !current.isAnonymous ? current : null);
      if (current && !current.isAnonymous) {
        addLog(`認証セッション確立: ${current.email || current.uid}`);
      } else {
        setIssueDetail(null);
        setTasks([]);
      }
    });
  }, [addLog]);

  // FN-01: ログイン後または画面リロード時にアクティブな緊急事態・Issueを自動復元
  useEffect(() => {
    if (!user || emergencyId || issueId) return;
    let cancelled = false;
    const restoreActiveEmergency = async () => {
      try {
        const active = await getActiveEmergency(user);
        if (cancelled) return;
        if (active.is_active && active.emergency_id && active.issue_id) {
          setEmergencyId(active.emergency_id);
          setIssueId(active.issue_id);
          if (active.emergency_type) {
            setSelectedEmergencyType(active.emergency_type);
          }
          addLog(
            `アクティブな災害セッション (${active.emergency_type ?? "緊急事態"}) を自動復元しました。`
          );
        }
      } catch (err) {
        console.error("Failed to restore active emergency:", err);
      }
    };
    void restoreActiveEmergency();
    return () => {
      cancelled = true;
    };
  }, [user, emergencyId, issueId, addLog]);

  const handleLogin = async () => {
    try {
      const auth = getAuth(getFirebaseApp());
      await signInWithPopup(auth, new GoogleAuthProvider());
      addLog("Google ログインに成功しました。");
    } catch (err) {
      alert(`Google ログインに失敗しました: ${String(err)}`);
      addLog(`[ERROR] ログイン失敗: ${String(err)}`);
    }
  };

  const handleLogout = async () => {
    try {
      const auth = getAuth(getFirebaseApp());
      await signOut(auth);
      setUser(null);
      addLog("ログアウトしました。");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const handleSelectPersona = (persona: Persona) => {
    setActivePersonaState(persona);
    setGlobalActivePersona(persona);
    addLog(`実機ペルソナを「${persona.name} (${persona.roomNumber}号室)」に切り替えました。`);
  };

  const refreshVersion = useRef({ version: 0 });
  const currentScope = useRef({ issueId, emergencyId, uid: user?.uid });
  currentScope.current = { issueId, emergencyId, uid: user?.uid };

  // Issue 詳細同期 (API-03)
  const refreshIssueDetail = useCallback(async () => {
    if (!issueId || !user || currentScope.current.issueId !== issueId || currentScope.current.uid !== user.uid) return;
    const version = ++refreshVersion.current.version;
    try {
      const detail = await getIssueDetail(user, issueId, DEMO_PERSONAS[0], emergencyId);
      if (version !== refreshVersion.current.version || currentScope.current.issueId !== issueId || currentScope.current.uid !== user.uid) return;
      setIssueDetail(detail);
      setTasks(detail.tasks);
    } catch (err) {
      console.error("Failed to fetch issue detail:", err);
    }
  }, [issueId, user, emergencyId]);

  useEffect(() => {
    if (!issueId || !user) return;
    const refreshState = refreshVersion.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // FN-08: A slow API must finish before scheduling the next poll.
    const poll = async () => {
      await refreshIssueDetail();
      if (!stopped) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      refreshState.version++;
    };
  }, [issueId, user, refreshIssueDetail]);

  // 1. 災害発生・緊急モード発令 (API-01)
  const handleTriggerEmergency = async () => {
    if (triageInFlight.current) return;
    if (!user) {
      // ユーザーが未ログインの場合、Google ログインを要求
      const doLogin = confirm("本番 API Gateway を通過するため Google ログインが必要です。ログインしますか？");
      if (doLogin) {
        await handleLogin();
      }
      return;
    }

    const defaultInstructions: Record<EmergencyType, string> = {
      EARTHQUAKE: "震度5強の地震が発生しました。エレベーター全基停止。各戸の安否確認を開始します。",
      POWER_OUTAGE: "落雷による全館停電が発生しました。エレベーター全基停止。各戸の安否と支援ニーズを確認します。",
      FIRE: "棟内火災警報が鳴動しました。非常階段での初期避難・安全確認を開始します。",
      FLOOD: "外水氾濫による浸水警戒が発令されました。上層階への垂直避難・安否確認を開始します。",
    };

    const disasterLabels: Record<EmergencyType, string> = {
      EARTHQUAKE: "震度5強 地震発生",
      POWER_OUTAGE: "落雷 全館停電発生",
      FIRE: "棟内火災警報鳴動",
      FLOOD: "外水氾濫 浸水警戒",
    };

    setIsLoading(true);
    setTriageAiResult(null);
    try {
      const res = await triggerEmergency(user, {
        building_id: "bld-01",
        emergency_type: selectedEmergencyType,
        instruction: defaultInstructions[selectedEmergencyType],
        random_seed: randomSeed,
      });
      setTriageExecution({ count: 0, status: "idle" });
      setEmergencyId(res.emergency_id);
      setIssueId(res.issue_id);
      addLog(`[API-01] ${disasterLabels[selectedEmergencyType]}！ 緊急モード発令 (emergency_id=${res.emergency_id.slice(0, 8)}, issue_id=${res.issue_id.slice(0, 8)})`);
      addLog(`全50戸へ安否確認（Cat 4）の一斉配信を開始しました（${randomSeed ? "🎲 ランダム変動シミュレーション" : "🎯 固定再現シミュレーション"}）。`);

      // FN-08: The issue effect owns synchronization; discard the previous emergency view.
      refreshVersion.current.version++;
      setIssueDetail(null);
      setTasks([]);

    } catch (err) {
      alert(`緊急モード発令に失敗しました: ${String(err)}`);
      addLog(`[ERROR] 発令失敗: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 1.5 時間経過シミュレーション（自律回答進行 Issue #50）
  const handleSimulateStep = async () => {
    if (!user || !emergencyId || isLoading || isSimulatingStep) return;
    setIsSimulatingStep(true);
    try {
      addLog("⏱ [時間経過シミュレーション] 未回答住戸からの安否回答を受信中...");
      const res = await simulateEmergencyStep(user, emergencyId);
      addLog(
        `⏱ [自律回答進行] ${res.message} (無事=${res.safe_count}, 要支援=${res.need_help_count}, 未回答=${res.unknown_count})`,
      );
      await refreshIssueDetail();
    } catch (err) {
      alert(`時間経過シミュレーションに失敗しました: ${String(err)}`);
      addLog(`[ERROR] 時間経過シミュレーション失敗: ${String(err)}`);
    } finally {
      setIsSimulatingStep(false);
    }
  };

  // 2. トリアージ開始 (API-08)
  const handleStartTriage = async () => {
    if (!user || !emergencyId || !issueId || isLoading || triageInFlight.current) return;
    // FN-08: Lock synchronously so two clicks cannot create two requests.
    triageInFlight.current = true;
    const runNumber = triageExecution.count + 1;
    setTriageExecution({ count: runNumber, status: "running" });
    setTriageAiResult(null);
    setIsLoading(true);
    try {
      addLog(`[API-08] ${runNumber}回目のトリアージを開始します。Building Agent が処理中です...`);
      const res = await startTriage(user, emergencyId, issueId);
      setTriageAiResult(res);
      addLog(`🤖 [Building Agent AI推論] モデル: ${res.agent_model}`);
      addLog(`💡 [AI推論判断根拠] ${res.ai_reasoning}`);
      addLog(
        `[API-08] ${runNumber}回目のトリアージ完了: 未応答住戸 ${res.unresponsive_count}件, カレンダー外出除外 ${res.likely_away_count}件, 隣室確認Task作成 ${res.tasks_created}件`,
      );
      addLog(`🛡️ [Policy Engine] ${res.policy_gate}`);

      // 詳細再取得
      await refreshIssueDetail();
      setTriageExecution({ count: runNumber, status: "completed" });
    } catch (err) {
      setTriageExecution({ count: runNumber, status: "failed" });
      alert(`トリアージ開始に失敗しました: ${String(err)}`);
      addLog(`[ERROR] ${runNumber}回目のトリアージ失敗: ${String(err)}`);
    } finally {
      triageInFlight.current = false;
      setIsLoading(false);
    }
  };

  // 3. アクション完了コールバック
  const handleActionComplete = async (logText: string, answer?: SafetyConfirmation) => {
    addLog(logText);
    if (answer && (answer.emergency_id !== currentScope.current.emergencyId || user?.uid !== currentScope.current.uid)) return;
    if (answer) {
      // FN-08: Invalidate pre-answer reads and retain the acknowledged state on refresh failure.
      refreshVersion.current.version++;
      const persona = DEMO_PERSONAS.find((p) => p.userId === answer.resident_id);
      if (persona) setIssueDetail((current) => applySafetyConfirmation(current, answer, persona.roomNumber));
    }
    await refreshIssueDetail();
  };

  return (
    <div className="studio-layout">
      {/* 1. 左側：シミュレーター操作卓（検証者・審査員視点） */}
      <CockpitPanel
        activePersona={activePersona}
        onSelectPersona={handleSelectPersona}
        selectedEmergencyType={selectedEmergencyType}
        onSelectEmergencyType={setSelectedEmergencyType}
        randomSeed={randomSeed}
        onToggleRandomSeed={setRandomSeed}
        emergencyId={emergencyId}
        issueId={issueId}
        issueDetail={issueDetail}
        onTriggerEmergency={handleTriggerEmergency}
        onSimulateStep={handleSimulateStep}
        isSimulatingStep={isSimulatingStep}
        onStartTriage={handleStartTriage}
        onRefresh={refreshIssueDetail}
        isLoading={isLoading}
        logs={logs}
        user={user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onAddLog={addLog}
        triageAiResult={triageAiResult}
        triageExecution={triageExecution}
      />

      {/* 2. 中央・右側：スマートフォン実機フレーム（一般住民の体験） */}
      {user ? <PhoneStage
        key={`${user.uid}:${activePersona.userId}:${emergencyId ?? "normal"}`}
        activePersona={activePersona}
        emergencyId={emergencyId}
        emergencyType={selectedEmergencyType}
        tasks={tasks}
        issueDetail={issueDetail}
        onActionComplete={handleActionComplete}
        isLoading={isLoading}
        user={user}
      /> : (
        <main className="device-stage">
          <div className="zashiki-card">
            <h2>住民ログイン</h2>
            <p>安否回答・協力依頼の確認にはログインが必要です。</p>
            <button type="button" className="btn-google" onClick={handleLogin}>Google アカウントでログイン</button>
          </div>
        </main>
      )}
    </div>
  );
}
