"use client";

import React, { useState, useEffect, useCallback } from "react";
import { CockpitPanel } from "./CockpitPanel";
import { PhoneStage } from "./PhoneStage";
import {
  type Persona,
  type IssueDetailResponse,
  type Task,
  DEMO_PERSONAS,
  triggerEmergency,
  startTriage,
  getIssueDetail,
  setActivePersona as setGlobalActivePersona,
} from "@/lib/api-client";

export function StudioWorkspace() {
  const [activePersona, setActivePersonaState] = useState<Persona>(DEMO_PERSONAS[1]); // デフォルト: 住民I
  const [emergencyId, setEmergencyId] = useState<string | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<IssueDetailResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<{ time: string; text: string }>>([
    {
      time: new Date().toLocaleTimeString(),
      text: "座敷わらし Studio が初期化されました。平常見守りモード待機中。",
    },
  ]);

  const addLog = useCallback((text: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, text }, ...prev].slice(0, 30));
  }, []);

  const handleSelectPersona = (persona: Persona) => {
    setActivePersonaState(persona);
    setGlobalActivePersona(persona);
    addLog(`実機ペルソナを「${persona.name} (${persona.roomNumber}号室)」に切り替えました。`);
  };

  // Issue 詳細同期 (API-03)
  const refreshIssueDetail = useCallback(async () => {
    if (!issueId) return;
    try {
      const detail = await getIssueDetail(null, issueId, activePersona);
      setIssueDetail(detail);
      setTasks(detail.tasks);
    } catch (err) {
      console.error("Failed to fetch issue detail:", err);
    }
  }, [issueId, activePersona]);

  useEffect(() => {
    if (issueId) {
      refreshIssueDetail();
    }
  }, [issueId, refreshIssueDetail]);

  // 1. 地震発生・緊急モード発令 (API-01)
  const handleTriggerEmergency = async () => {
    setIsLoading(true);
    try {
      const res = await triggerEmergency(null, {
        building_id: "bld-001",
        emergency_type: "EARTHQUAKE",
        instruction: "震度5強の地震が発生しました。エレベーター全基停止。各戸の安否確認を開始します。",
      });
      setEmergencyId(res.emergency_id);
      setIssueId(res.issue_id);
      addLog(`[API-01] 震度5強 地震発生！ 緊急モード発令 (emergency_id=${res.emergency_id.slice(0, 8)}, issue_id=${res.issue_id.slice(0, 8)})`);
      addLog("全150戸へ安否確認（Cat 4）の一斉配信を開始しました。");

      // 発令直後の初期状態を取得
      const detail = await getIssueDetail(null, res.issue_id, DEMO_PERSONAS[0]);
      setIssueDetail(detail);
      setTasks(detail.tasks);
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
      const res = await startTriage(null, emergencyId, issueId);
      addLog(
        `[API-08] トリアージ完了: 未応答住戸 ${res.unresponsive_count}件, カレンダー外出除外 ${res.likely_away_count}件, 隣室確認Task作成 ${res.created_tasks_count}件`,
      );
      addLog("Policy Engine: Progressive Disclosure (未承認住戸の部屋番号をマスク) を適用。");

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

  return (
    <div className="studio-layout">
      {/* 1. 左側：シミュレーター操作卓（検証者・審査員視点） */}
      <CockpitPanel
        activePersona={activePersona}
        onSelectPersona={handleSelectPersona}
        emergencyId={emergencyId}
        issueId={issueId}
        issueDetail={issueDetail}
        onTriggerEmergency={handleTriggerEmergency}
        onStartTriage={handleStartTriage}
        onRefresh={refreshIssueDetail}
        isLoading={isLoading}
        logs={logs}
      />

      {/* 2. 中央・右側：スマートフォン実機フレーム（一般住民の体験） */}
      <PhoneStage
        activePersona={activePersona}
        emergencyId={emergencyId}
        tasks={tasks}
        onActionComplete={handleActionComplete}
        isLoading={isLoading}
      />
    </div>
  );
}
