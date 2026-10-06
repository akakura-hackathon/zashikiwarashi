"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  type User,
} from "firebase/auth";
import { CockpitPanel, type TriageAiResult } from "./CockpitPanel";
import { PhoneStage } from "./PhoneStage";
import {
  type Persona,
  type IssueDetailResponse,
  type Task,
  type EmergencyType,
  DEMO_PERSONAS,
  triggerEmergency,
  startTriage,
  getIssueDetail,
  resetDatabase,
  setActivePersona as setGlobalActivePersona,
} from "@/lib/api-client";
import { getFirebaseApp } from "@/lib/firebase";

export function StudioWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [activePersona, setActivePersonaState] = useState<Persona>(DEMO_PERSONAS[1]); // デフォルト: 住民I
  const [selectedEmergencyType, setSelectedEmergencyType] = useState<EmergencyType>("EARTHQUAKE");
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<IssueDetailResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [triageAiResult, setTriageAiResult] = useState<TriageAiResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
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

  // Firebase Auth 初期化 & 匿名自動認証（API Gateway 通過用のトークン確保）
  useEffect(() => {
    const auth = getAuth(getFirebaseApp());
    const unsubscribe = onAuthStateChanged(auth, async (current) => {
      setUser(current);
      if (current) {
        addLog(`認証セッション確立: ${current.email || "匿名デモユーザー"}`);
      } else {
        // ユーザーが未認証の場合、匿名ログインを試みて本番 API Gateway 用のトークンを自動発行
        try {
          await signInAnonymously(auth);
        } catch {
          addLog("※ API Gateway 通過には Google ログインが必要です。");
        }
      }
    });
    return () => unsubscribe();
  }, [addLog]);

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

  // Issue 詳細同期 (API-03)
  const refreshIssueDetail = useCallback(async () => {
    if (!issueId) return;
    try {
      const detail = await getIssueDetail(user, issueId, activePersona, emergencyId);
      setIssueDetail(detail);
      setTasks(detail.tasks);
    } catch (err) {
      console.error("Failed to fetch issue detail:", err);
    }
  }, [issueId, user, activePersona, emergencyId]);

  useEffect(() => {
    if (issueId) {
      refreshIssueDetail();
    }
  }, [issueId, refreshIssueDetail]);

  // 1. 災害発生・緊急モード発令 (API-01)
  const handleTriggerEmergency = async () => {
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
      });
      setEmergencyId(res.emergency_id);
      setIssueId(res.issue_id);
      addLog(`[API-01] ${disasterLabels[selectedEmergencyType]}！ 緊急モード発令 (emergency_id=${res.emergency_id.slice(0, 8)}, issue_id=${res.issue_id.slice(0, 8)})`);
      addLog("全50戸へ安否確認（Cat 4）の一斉配信を開始しました。");

      // 発令直後の初期状態を取得
      try {
        const detail = await getIssueDetail(user, res.issue_id, DEMO_PERSONAS[0], res.emergency_id);
        setIssueDetail(detail);
        setTasks(detail.tasks);
      } catch (e) {
        console.warn("Issue detail initial fetch warning:", e);
      }
    } catch (err) {
      alert(`緊急モード発令に失敗しました: ${String(err)}`);
      addLog(`[ERROR] 発令失敗: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. トリアージ開始 (API-08)
  const handleStartTriage = async () => {
    if (!emergencyId || !issueId) return;
    setIsLoading(true);
    try {
      addLog("[API-08] 安否確認を締め切り、Building Agent によるルールベース/LLM トリアージを開始します...");
      const res = await startTriage(user, emergencyId, issueId);
      setTriageAiResult(res);
      addLog(`🤖 [Building Agent AI推論] モデル: ${res.agent_model}`);
      addLog(`💡 [AI推論判断根拠] ${res.ai_reasoning}`);
      addLog(
        `[API-08] トリアージ完了: 未応答住戸 ${res.unresponsive_count}件, カレンダー外出除外 ${res.likely_away_count}件, 隣室確認Task作成 ${res.tasks_created}件`,
      );
      addLog(`🛡️ [Policy Engine] ${res.policy_gate}`);

      // 詳細再取得
      await refreshIssueDetail();
    } catch (err) {
      alert(`トリアージ開始に失敗しました: ${String(err)}`);
      addLog(`[ERROR] トリアージ失敗: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. アクション完了コールバック
  const handleActionComplete = async (logText: string) => {
    addLog(logText);
    await refreshIssueDetail();
  };

  // 4. データベース完全初期化（不要データ全削除 & 50戸再シード）
  const handleResetDatabase = async () => {
    if (!confirm("Firestoreの古い住戸・住民データを全削除し、厳密な50戸（SC-3仕様）に再シードします。よろしいですか？")) return;
    setIsLoading(true);
    try {
      addLog("🧹 Firestore上の不要データを全削除し、50戸（101〜510）に再シード中...");
      const res = await resetDatabase(user);
      addLog(`✅ ${res.message} (住戸: ${res.units_count}戸, 住民: ${res.residents_count}名)`);
      setEmergencyId(null);
      setIssueId(null);
      setIssueDetail(null);
      setTasks([]);
      setTriageAiResult(null);
    } catch (err) {
      alert(`初期化に失敗しました: ${String(err)}`);
      addLog(`❌ [ERROR] 初期化失敗: ${String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="studio-layout">
      {/* 1. 左側：シミュレーター操作卓（検証者・審査員視点） */}
      <CockpitPanel
        activePersona={activePersona}
        onSelectPersona={handleSelectPersona}
        selectedEmergencyType={selectedEmergencyType}
        onSelectEmergencyType={setSelectedEmergencyType}
        emergencyId={emergencyId}
        issueId={issueId}
        issueDetail={issueDetail}
        onTriggerEmergency={handleTriggerEmergency}
        onStartTriage={handleStartTriage}
        onRefresh={refreshIssueDetail}
        isLoading={isLoading}
        logs={logs}
        user={user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onAddLog={addLog}
        triageAiResult={triageAiResult}
        onResetDatabase={handleResetDatabase}
      />

      {/* 2. 中央・右側：スマートフォン実機フレーム（一般住民の体験） */}
      <PhoneStage
        activePersona={activePersona}
        emergencyId={emergencyId}
        emergencyType={selectedEmergencyType}
        tasks={tasks}
        issueDetail={issueDetail}
        onActionComplete={handleActionComplete}
        isLoading={isLoading}
        user={user}
      />
    </div>
  );
}
