"use client";

import React from "react";
import {
  type IssueDetailResponse,
  type Persona,
  DEMO_PERSONAS,
  type PriorityAlertTarget,
  type EmergencyType,
  testGuardrail,
} from "@/lib/api-client";

import type { User } from "firebase/auth";
import { FloorMap } from "./ui/FloorMap";

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
};

export function CockpitPanel({
  activePersona,
  onSelectPersona,
  selectedEmergencyType,
  onSelectEmergencyType,
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
  onAddLog,
}: CockpitPanelProps) {
  const summary = issueDetail?.current_states_summary ?? {};
  const safeCount = summary["SAFE"] ?? 0;
  const unknownCount = summary["UNKNOWN"] ?? (emergencyId ? 50 : 0);
  const needHelpCount = summary["NEED_HELP"] ?? 0;
  const outsideCount = summary["OUTSIDE_BUILDING"] ?? 0;

  const priorityTargets: PriorityAlertTarget[] = issueDetail?.priority_targets ?? [];

  return (
    <aside className="cockpit-sidebar">
      {/* 1. Header */}
      <div className="cockpit-header">
        <span className="cockpit-badge">ZASHIKI STUDIO COCKPIT</span>
        <h1 className="cockpit-title">座敷わらし検証卓</h1>
        <p className="cockpit-desc">
          一般住民のスマホ画面（右）と、建物全体Multi-Agent（トリアージ・Policy Engine）の動作をリアルタイム検証します。
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
      </div>

      {/* 2. 災害シミュレーション制御 */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>⚡ 災害シミュレーション</span>
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
              {selectedEmergencyType === "POWER_OUTAGE" && "⚡ 落雷・全館停電発生・発令 (API-01)"}
              {selectedEmergencyType === "EARTHQUAKE" && "🚨 震度5強 地震発生・発令 (API-01)"}
              {selectedEmergencyType === "FIRE" && "🔥 火災警報鳴動・発令 (API-01)"}
              {selectedEmergencyType === "FLOOD" && "🌊 浸水警戒・洪水発令 (API-01)"}
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={onStartTriage}
                disabled={isLoading}
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
                🎯 トリアージ開始 (API-08)
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
        </div>
      </div>

      {/* 2.5 Agent ガバナンス・ガードレール検証 (FN-10 / Step 7) */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>🛡️ Agent ガバナンス検証 (FN-10)</span>
          <span style={{ fontSize: "0.7rem", color: "var(--color-brand)", fontWeight: 700 }}>G1〜G6 統制</span>
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--color-muted)", marginBottom: "6px" }}>
          Model Armor（G2）と IAP CEL（G4）による決定論的防御を実機検証します。
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <button
            style={{
              padding: "7px 10px",
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
            🛡️ G2: プロンプトインジェクション遮断テスト
          </button>
          <button
            style={{
              padding: "7px 10px",
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
            🛡️ G4: IAP 権限外ツール呼出物理拒否テスト
          </button>
          <button
            style={{
              padding: "7px 10px",
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
            🛡️ G2/G3: Outbound SDP 部屋番号漏洩遮断テスト
          </button>
        </div>
      </div>

      {/* 3. 操作ペルソナ切り替え */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>👤 実機ペルソナ切り替え</span>
          <span className="font-mono-num" style={{ fontSize: "0.72rem", color: "var(--color-brand)", fontWeight: 700 }}>
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
                  backgroundColor: isSelected ? "var(--color-brand-tint)" : "#FFFFFF",
                  border: isSelected ? "1.5px solid var(--color-brand)" : "1px solid var(--cockpit-border)",
                  color: "var(--color-ink)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.76rem",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, color: isSelected ? "var(--color-brand)" : "var(--color-ink)" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--color-muted)" }}>
                    {p.desc}
                  </div>
                </div>
                {isSelected && <span style={{ color: "var(--color-brand)", fontWeight: 700 }}>✔</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. 棟内50戸の安否集約 & C24 FloorMap */}
      <div className="cockpit-section">
        <div className="section-title">
          <span>🏢 棟内50戸の安否集約 (API-03)</span>
          {emergencyId && (
            <span className="font-mono-num" style={{ fontSize: "0.68rem", color: "var(--color-muted)" }}>
              Emg: {emergencyId.slice(0, 6)} / Issue: {issueId ? issueId.slice(0, 6) : "-"}
            </span>
          )}
        </div>
        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">無事回答</span>
            <span className="status-val ok font-mono-num">{safeCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">未応答 (要トリアージ)</span>
            <span className="status-val alert font-mono-num">{unknownCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">カレンダー外出中</span>
            <span className="status-val warn font-mono-num">{outsideCount} 戸</span>
          </div>
          <div className="status-card">
            <span className="status-label">要救助回答</span>
            <span className="status-val alert font-mono-num">{needHelpCount} 戸</span>
          </div>
        </div>

        {/* 15階×10列 FloorMap (C24) */}
        <div style={{ marginTop: 8 }}>
          <FloorMap />
        </div>
      </div>

      {/* 5. 管理人優先アラート (Priority Target) */}
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
                  <span className="font-mono-num" style={{ fontWeight: 800, color: "var(--color-ink)", marginRight: "6px" }}>
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

      {/* 6. Multi-Agent 通信 & Policy Engine 監査ログ */}
      <div className="cockpit-section" style={{ flex: 1, minHeight: "180px" }}>
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
