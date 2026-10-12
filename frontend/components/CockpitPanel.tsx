"use client";

import React from "react";
import {
  type IssueDetailResponse,
  type Persona,
  DEMO_PERSONAS,
  type EmergencyType,
  testGuardrail,
} from "@/lib/api-client";

import type { User } from "firebase/auth";
import { TaskBoard } from "./ui/TaskBoard";

export type TriageExecution = {
  count: number;
  status: "idle" | "running" | "completed" | "failed";
};

export type TriageAiResult = {
  tasks_created: number;
  unresponsive_count: number;
  likely_away_count: number;
  assigned_residents: string[];
  ai_reasoning: string;
  agent_model: string;
  policy_gate: string;
};

type CockpitPanelProps = {
  activePersona: Persona;
  onSelectPersona: (persona: Persona) => void;
  selectedEmergencyType: EmergencyType;
  onSelectEmergencyType: (type: EmergencyType) => void;
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
  onAddLog?: (text: string) => void;
  triageAiResult?: TriageAiResult | null;
  triageExecution: TriageExecution;
};

export function CockpitPanel({
  activePersona,
  onSelectPersona,
  selectedEmergencyType,
  onSelectEmergencyType,
  emergencyId,
  issueId: _issueId,
  issueDetail,
  onTriggerEmergency,
  onStartTriage,
  onRefresh,
  isLoading,
  logs,
  user,
  onLogin,
  onLogout,
  onAddLog,
  triageAiResult,
  triageExecution,
}: CockpitPanelProps) {
  const [activeTab, setActiveTab] = React.useState<"disaster" | "governance">("disaster");

  return (
    <aside className="cockpit-sidebar">
      {/* 1. Header */}
      <div className="cockpit-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <img
            src="/icons/icon-192.png"
            alt="Zashikiwarashi"
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              objectFit: "cover",
              flexShrink: 0,
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
            }}
          />
          <h1 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "var(--color-ink)" }}>
            Zashikiwarashi検証画面
          </h1>
        </div>
        <p className="cockpit-desc" style={{ margin: "0 0 6px 0" }}>
          ハッカソン用のデモとして、Zashikiwarashiの機能の検証をするための画面です。
        </p>

        {/* Auth status & Login */}
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--cockpit-border)",
            borderRadius: "8px",
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "6px",
          }}
        >
          {user ? (
            <>
              <div style={{ fontSize: "0.74rem", color: "var(--color-brand)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>●</span>
                <span style={{ fontWeight: 700, color: "var(--color-ink)" }}>{user.email || "認証済"}</span>
              </div>
              <button
                onClick={onLogout}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-muted)",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.72rem", color: "var(--color-danger)" }}>
                ※ 本番API実行にはログインが必要です
              </div>
              <button
                onClick={onLogin}
                style={{
                  backgroundColor: "var(--color-ink)",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Google ログイン
              </button>
            </>
          )}
        </div>

        {/* タブ切り替え: 災害時検証 / Agentガバナンス検証 */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            backgroundColor: "#F1F3F5",
            padding: "3px",
            borderRadius: "10px",
            marginTop: "10px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("disaster")}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: activeTab === "disaster" ? "#FFFFFF" : "transparent",
              color: activeTab === "disaster" ? "var(--color-ink)" : "var(--color-muted)",
              fontWeight: activeTab === "disaster" ? 700 : 500,
              fontSize: "0.78rem",
              cursor: "pointer",
              boxShadow: activeTab === "disaster" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <span>災害時検証</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("governance")}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: activeTab === "governance" ? "#FFFFFF" : "transparent",
              color: activeTab === "governance" ? "var(--color-ink)" : "var(--color-muted)",
              fontWeight: activeTab === "governance" ? 700 : 500,
              fontSize: "0.78rem",
              cursor: "pointer",
              boxShadow: activeTab === "governance" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <span>Agentガバナンス検証</span>
          </button>
        </div>
      </div>

      {/* タブ1: 災害時検証 */}
      {activeTab === "disaster" && (
        <>
          {/* 2. 災害シミュレーション制御 */}
          <div className="cockpit-section">
        <div className="section-title">
          <span>災害シミュレーション</span>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: emergencyId ? "var(--color-danger)" : "var(--color-brand)" }}>
            {emergencyId ? "● 発令中" : "○ 平常時"}
          </span>
        </div>

        {/* 災害種別 選択タブ */}
        {!emergencyId && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px", marginBottom: "8px" }}>
            {[
              { type: "EARTHQUAKE" as const, label: "🚨 地震" },
              { type: "POWER_OUTAGE" as const, label: "⚡ 停電" },
              { type: "FIRE" as const, label: "🔥 火災" },
              { type: "FLOOD" as const, label: "🌊 洪水" },
            ].map((d) => (
              <button
                key={d.type}
                type="button"
                onClick={() => onSelectEmergencyType(d.type)}
                style={{
                  padding: "6px 2px",
                  borderRadius: "6px",
                  border: selectedEmergencyType === d.type ? "1.5px solid var(--color-ink)" : "1px solid var(--cockpit-border)",
                  backgroundColor: selectedEmergencyType === d.type ? "var(--color-ink)" : "#FFFFFF",
                  color: selectedEmergencyType === d.type ? "#FFFFFF" : "var(--color-ink)",
                  fontSize: "0.72rem",
                  fontWeight: selectedEmergencyType === d.type ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {!emergencyId ? (
            <button
              onClick={onTriggerEmergency}
              disabled={isLoading}
              style={{
                width: "100%",
                height: 44,
                borderRadius: 22,
                backgroundColor: "var(--color-danger)",
                color: "#FFFFFF",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {selectedEmergencyType === "POWER_OUTAGE" && "落雷 全館停電発生"}
              {selectedEmergencyType === "EARTHQUAKE" && "震度5強 地震発生"}
              {selectedEmergencyType === "FIRE" && "火災発生 警報鳴動"}
              {selectedEmergencyType === "FLOOD" && "洪水発生 浸水警戒"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={onStartTriage}
                aria-busy={triageExecution.status === "running"}
                disabled={isLoading || triageExecution.status === "running"}
                style={{
                  flex: 2,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: "var(--color-ink)",
                  color: "#FFFFFF",
                  border: "none",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {triageExecution.status === "running"
                  ? `${triageExecution.count}回目のトリアージ進行中…`
                  : triageExecution.count > 0
                    ? `${triageExecution.count + 1}回目のトリアージをする`
                    : "トリアージ開始"}
              </button>
              <button
                onClick={onRefresh}
                disabled={isLoading}
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: "#FFFFFF",
                  color: "var(--color-ink)",
                  border: "1.5px solid var(--color-ink)",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                🔄 再同期
              </button>
            </div>
          )}

          {/* Building Agent (AI) 推論結果カード */}
          {emergencyId && triageExecution.status !== "idle" && (
            <p role="status" aria-live="polite" style={{ fontSize: "0.82rem", margin: "8px 0" }}>
              {triageExecution.status === "running"
                ? `${triageExecution.count}回目のトリアージ進行中です。完了までお待ちください。`
                : triageExecution.status === "completed"
                  ? `${triageExecution.count}回目のトリアージが完了しました。`
                  : `${triageExecution.count}回目のトリアージに失敗しました。再実行できます。`}
            </p>
          )}

          {triageAiResult && (
            <div
              style={{
                marginTop: "10px",
                padding: "10px 12px",
                borderRadius: "10px",
                backgroundColor: "rgba(37, 99, 235, 0.06)",
                border: "1.5px solid var(--color-brand)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "var(--color-brand)" }}>
                  🤖 Building Agent AI推論結果
                </span>
                <span
                  style={{
                    fontSize: "0.62rem",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    backgroundColor: "var(--color-brand)",
                    color: "#FFFFFF",
                    fontWeight: 600,
                  }}
                >
                  {triageAiResult.agent_model}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "6px",
                  fontSize: "0.7rem",
                  textAlign: "center",
                  marginTop: "2px",
                }}
              >
                <div style={{ backgroundColor: "#FFFFFF", padding: "4px 2px", borderRadius: "6px", border: "1px solid var(--cockpit-border)" }}>
                  <div style={{ color: "var(--color-muted)", fontSize: "0.6rem" }}>未応答対象</div>
                  <div style={{ fontWeight: 700, color: "var(--color-danger)" }}>{triageAiResult.unresponsive_count} 戸</div>
                </div>
                <div style={{ backgroundColor: "#FFFFFF", padding: "4px 2px", borderRadius: "6px", border: "1px solid var(--cockpit-border)" }}>
                  <div style={{ color: "var(--color-muted)", fontSize: "0.6rem" }}>カレンダー不在除外</div>
                  <div style={{ fontWeight: 700, color: "var(--color-warn)" }}>{triageAiResult.likely_away_count} 戸</div>
                </div>
                <div style={{ backgroundColor: "#FFFFFF", padding: "4px 2px", borderRadius: "6px", border: "1px solid var(--cockpit-border)" }}>
                  <div style={{ color: "var(--color-muted)", fontSize: "0.6rem" }}>打診Task生成</div>
                  <div style={{ fontWeight: 700, color: "var(--color-brand)" }}>{triageAiResult.tasks_created} 件</div>
                </div>
              </div>
              {/* FN-08 / #61: 推論文より、誰にどの住戸を頼んだかを先に見せる */}
              <TaskBoard items={issueDetail?.task_board ?? []} />
              <details style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>
                <summary style={{ cursor: "pointer" }}>AIの判断理由を見る</summary>
                <div style={{ marginTop: 4, color: "var(--color-ink)", lineHeight: 1.45 }}>
                  {triageAiResult.ai_reasoning}
                </div>
              </details>
              <div style={{ fontSize: "0.65rem", color: "var(--color-muted)", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                <span>🔒</span>
                <span>{triageAiResult.policy_gate}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. 操作ペルソナ切り替え */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>利用ペルソナの切り替え</span>
          <span style={{ fontSize: "0.72rem", color: "var(--color-brand)", fontWeight: 700 }}>
            選択中: {activePersona.name}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {DEMO_PERSONAS.filter((p) => p.userId === "admin-001" || p.userId === "resident-i").map((p) => {
            const isSelected = p.userId === activePersona.userId;
            return (
              <button
                key={p.userId}
                onClick={() => onSelectPersona(p)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  backgroundColor: isSelected ? "var(--color-brand-tint)" : "#FFFFFF",
                  border: isSelected ? "1.5px solid var(--color-brand)" : "1px solid var(--cockpit-border)",
                  color: "var(--color-ink)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.82rem",
                }}
              >
                <div style={{ fontWeight: 700, color: isSelected ? "var(--color-brand)" : "var(--color-ink)" }}>
                  {p.name}
                </div>
                {isSelected && <span style={{ color: "var(--color-brand)", fontWeight: 700 }}>✔</span>}
              </button>
            );
          })}
        </div>
      </div>

    </>
  )}

  {/* タブ2: Agentガバナンス検証 */}
  {activeTab === "governance" && (
    <div className="cockpit-section">
      <div className="section-title">
        <span>攻撃リクエスト</span>
      </div>
      <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginBottom: "6px" }}>
        攻撃リクエストに対して、Model ArmorなどのAgent ガバナンス機能を検証します。
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <button
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--cockpit-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--color-ink)",
            fontSize: "0.74rem",
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
          onClick={async () => {
            if (onAddLog) onAddLog("🛡️ [G2 Model Armor] 敵対的プロンプトインジェクション攻撃を送信中...");
            try {
              const res = await testGuardrail(user, "PROMPT_INJECTION");
              if (onAddLog) onAddLog(`✅ [${res.guardrail_layer}] ${res.message} (コード: ${res.violation_code})`);
            } catch (e) {
              if (onAddLog) onAddLog(`❌ [ERROR] ${String(e)}`);
            }
          }}
        >
          プロンプトインジェクション遮断テスト
        </button>
        <button
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--cockpit-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--color-ink)",
            fontSize: "0.74rem",
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
          onClick={async () => {
            if (onAddLog) onAddLog("🛡️ [G4 IAP CEL] Resident Agent による権限外ツール（部屋番号開示）呼び出しを試行中...");
            try {
              const res = await testGuardrail(user, "IAP_FORBIDDEN_TOOL");
              if (onAddLog) onAddLog(`✅ [${res.guardrail_layer}] ${res.message} (コード: ${res.violation_code})`);
            } catch (e) {
              if (onAddLog) onAddLog(`❌ [ERROR] ${String(e)}`);
            }
          }}
        >
          IAP 権限外ツール呼出物理拒否テスト
        </button>
        <button
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid var(--cockpit-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--color-ink)",
            fontSize: "0.74rem",
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
          onClick={async () => {
            if (onAddLog) onAddLog("🛡️ [G2 SDP Filter] 外向き通信（Egress）への生部屋番号漏洩をシミュレーション中...");
            try {
              const res = await testGuardrail(user, "SDP_ROOM_LEAK");
              if (onAddLog) onAddLog(`✅ [${res.guardrail_layer}] ${res.message} (コード: ${res.violation_code})`);
            } catch (e) {
              if (onAddLog) onAddLog(`❌ [ERROR] ${String(e)}`);
            }
          }}
        >
          Outbound SDP 部屋番号漏洩遮断テスト
        </button>
      </div>
    </div>
  )}

  {/* 6. Multi-Agent 通信 & Policy Engine 監査ログ */}
  <div className="cockpit-section" style={{ flex: 1, minHeight: "380px" }}>
        <div className="section-title">
          <span>📡 Multi-Agent 通信 & Policy Engine 判定ログ</span>
        </div>
        <div className="cockpit-log">
          {logs.length === 0 ? (
            <div style={{ color: "var(--color-muted)" }}>
              災害トリガーまたはAPI呼び出しによりログが出力されます...
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="log-entry">
                <span className="log-time font-mono-num">[{log.time}]</span>
                <span>{log.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
