"use client";

import React from "react";
import {
  type IssueDetailResponse,
  type Persona,
  DEMO_PERSONAS,
  type PriorityAlertTarget,
} from "@/lib/api-client";

import type { User } from "firebase/auth";

type CockpitPanelProps = {
  activePersona: Persona;
  onSelectPersona: (persona: Persona) => void;
  emergencyId: string | null;
  issueId: string | null;
  issueDetail: IssueDetailResponse | null;
  onTriggerEmergency: () => Promise<void>;
  onStartTriage: () => Promise<void>;
  onRefresh: () => Promise<void>;
  isLoading: boolean;
  logs: Array<{ time: string; text: string }>;
  user: User | null;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
};

export function CockpitPanel({
  activePersona,
  onSelectPersona,
  emergencyId,
  issueId,
  issueDetail,
  onTriggerEmergency,
  onStartTriage,
  onRefresh,
  isLoading,
  logs,
  user,
  onLogin,
  onLogout,
}: CockpitPanelProps) {
  const summary = issueDetail?.current_states_summary ?? {};
  const safeCount = summary["SAFE"] ?? 0;
  const unknownCount = summary["UNKNOWN"] ?? (emergencyId ? 149 : 0);
  const needHelpCount = summary["NEED_HELP"] ?? 0;
  const outsideCount = summary["OUTSIDE_BUILDING"] ?? 0;

  const priorityTargets: PriorityAlertTarget[] = issueDetail?.priority_targets ?? [];

  return (
    <aside className="cockpit-sidebar">
      {/* 1. Header */}
      <div className="cockpit-header">
        <span className="cockpit-badge">STUDIO COCKPIT ARCHITECTURE</span>
        <h1 className="cockpit-title">座敷わらし検証卓</h1>
        <p className="cockpit-desc">
          一般住民のスマホ体験と、建物全体Multi-Agent（トリアージ・Policy Engine）の動作をリアルタイム検証します。
        </p>

        {/* Auth status & Login */}
        <div style={{
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid var(--cockpit-border)",
          borderRadius: "8px",
          padding: "8px 10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "6px"
        }}>
          {user ? (
            <>
              <div style={{ fontSize: "0.72rem", color: "var(--green-ok)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>●</span>
                <span style={{ fontWeight: 600, color: "#ffffff" }}>{user.email || "認証済"}</span>
              </div>
              <button
                onClick={onLogout}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--cockpit-text-muted)",
                  fontSize: "0.68rem",
                  cursor: "pointer",
                  textDecoration: "underline"
                }}
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.72rem", color: "#f87171" }}>
                ※ 本番API実行にはログインが必要です
              </div>
              <button
                onClick={onLogin}
                style={{
                  background: "var(--amber-fire)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Google ログイン
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. 災害シミュレーション制御 */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>⚡ 災害シミュレーション</span>
          <span style={{ fontSize: "0.7rem", color: emergencyId ? "#ef4444" : "#22c55e" }}>
            {emergencyId ? "● 発令中" : "○ 平常時"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {!emergencyId ? (
            <button
              className="btn-danger"
              onClick={onTriggerEmergency}
              disabled={isLoading}
            >
              🚨 震度5強 地震発生・緊急モード発令 (API-01)
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn-primary"
                style={{ flex: 2 }}
                onClick={onStartTriage}
                disabled={isLoading}
              >
                🎯 トリアージ開始 (API-08)
              </button>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={onRefresh}
                disabled={isLoading}
              >
                🔄 再同期
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. 操作ペルソナ切り替え */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>👤 実機ペルソナ切り替え</span>
          <span style={{ fontSize: "0.7rem", color: "var(--amber-fire)" }}>
            選択中: {activePersona.roomNumber}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {DEMO_PERSONAS.map((p) => {
            const isSelected = p.userId === activePersona.userId;
            return (
              <button
                key={p.userId}
                onClick={() => onSelectPersona(p)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: isSelected ? "rgba(249, 115, 22, 0.15)" : "rgba(255, 255, 255, 0.03)",
                  border: isSelected ? "1px solid var(--amber-fire)" : "1px solid var(--cockpit-border)",
                  color: isSelected ? "#ffffff" : "var(--cockpit-text-body)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.76rem",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: isSelected ? "var(--amber-fire)" : "#ffffff" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--cockpit-text-muted)" }}>
                    {p.desc}
                  </div>
                </div>
                {isSelected && <span style={{ color: "var(--amber-fire)" }}>✔</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. 棟内150戸の安否集約 (API-03) */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>🏢 棟内150戸の安否集約 (API-03)</span>
          {emergencyId && (
            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
              Emg: {emergencyId.slice(0, 6)} / Issue: {issueId ? issueId.slice(0, 6) : "-"}
            </span>
          )}
        </div>
        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">無事回答</span>
            <span className="status-val ok">{safeCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">未応答 (要トリアージ)</span>
            <span className="status-val alert">{unknownCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">カレンダー外出中</span>
            <span className="status-val warn">{outsideCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">要救助回答</span>
            <span className="status-val alert">{needHelpCount} 戸</span>
          </div>
        </div>
      </div>

      {/* 5. 管理人優先アラート (Priority Target) */}
      {priorityTargets.length > 0 && (
        <div className="priority-alert-box">
          <div className="priority-header">
            <span>🚨 防災センター最優先現地確認アラート</span>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#fca5a5" }}>
            「本人未応答 × 隣室確認も応答なし × 高齢単身要配慮」の住戸を検出しました
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            {priorityTargets.map((target) => (
              <div key={target.resident_id} className="priority-target-item">
                <div>
                  <span style={{ fontWeight: 800, color: "#ffffff", marginRight: "6px" }}>
                    {target.room_number}号室
                  </span>
                  <span style={{ color: "#f87171" }}>
                    {target.is_elderly ? "高齢単身" : "一般"}・安否未確認
                  </span>
                </div>
                <span
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    fontSize: "0.65rem",
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

      {/* 6. Multi-Agent 通信 & Policy Engine 監査ログ */}
      <div className="cockpit-section" style={{ flex: 1, minHeight: "180px" }}>
        <div className="section-title">
          <span>📡 Multi-Agent 通信 & Policy Engine 判定ログ</span>
        </div>
        <div className="cockpit-log">
          {logs.length === 0 ? (
            <div style={{ color: "var(--cockpit-text-muted)" }}>
              災害トリガーまたはAPI呼び出しによりログが出力されます...
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="log-entry">
                <span className="log-time">[{log.time}]</span>
                <span>{log.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
