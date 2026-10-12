"use client";

import React, { useEffect, useState } from "react";
import {
  DEMO_PERSONAS,
  type EmergencyType,
  type IssueDetailResponse,
  type Persona,
} from "@/lib/api-client";
import { DEMO_RESIDENT_ID, demoGuideProgress } from "@/lib/demo-guide";
import type { TriageExecution } from "./CockpitPanel";

// FN-08 / #63: 審査員向けデモガイド（docs/DEMO_SPEC.md のシナリオ。SC-3 地震）
// アプリの状態からステップの完了を判定し、次の操作と見どころを示す。

const ADMIN = DEMO_PERSONAS[0];
const RESIDENT = DEMO_PERSONAS.find((p) => p.userId === DEMO_RESIDENT_ID) ?? DEMO_PERSONAS[1];

type Step = {
  title: string;
  who: "管理人" | "住民301" | "どちらでも";
  persona?: Persona; // このステップで操作する画面
};

const STEPS: Step[] = [
  { title: "地震を発令する", who: "どちらでも" },
  { title: "住民301として「無事」と回答する", who: "住民301", persona: RESIDENT },
  { title: "トリアージをする", who: "どちらでも" },
  { title: "住民301として確認を引き受け、結果を報告する", who: "住民301", persona: RESIDENT },
  { title: "管理人画面で、向かうべき住戸を確認する", who: "管理人", persona: ADMIN },
];

type Props = {
  emergencyId: string | null;
  selectedEmergencyType: EmergencyType;
  issueDetail: IssueDetailResponse | null;
  activePersona: Persona;
  onSelectPersona: (persona: Persona) => void;
  triageExecution: TriageExecution;
  onRestartDemo?: () => Promise<void>;
  isLoading: boolean;
};

export function DemoGuide({
  emergencyId,
  selectedEmergencyType,
  issueDetail,
  activePersona,
  onSelectPersona,
  triageExecution,
  onRestartDemo,
  isLoading,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [sawAdminView, setSawAdminView] = useState(false);

  const isAdmin = activePersona.role === "admin";
  const { done, current, myTask, targetRoom, reported } = demoGuideProgress({
    emergencyId,
    issueDetail,
    triageCompleted: triageExecution.status === "completed",
    sawAdminView,
  });
  const safety = issueDetail?.resident_states?.[DEMO_RESIDENT_ID];
  const triaged = done[2];

  // 管理人画面を見たらステップ5を完了にする。発令し直したら戻す
  useEffect(() => {
    setSawAdminView(false);
  }, [emergencyId]);
  useEffect(() => {
    if (reported && isAdmin) setSawAdminView(true);
  }, [reported, isAdmin]);

  const step = current >= 0 ? STEPS[current] : null;
  const needsSwitch = step?.persona && step.persona.userId !== activePersona.userId;

  return (
    <section
      aria-label="審査デモガイド"
      style={{
        border: "1.5px solid var(--color-ink)",
        borderRadius: 12,
        background: "var(--color-surface)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "var(--color-ink)" }}>
          審査デモガイド（地震・約3分）
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="font-mono-num" style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
            {current < 0 ? STEPS.length : current} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            style={linkButton}
            aria-expanded={!collapsed}
          >
            {collapsed ? "開く" : "たたむ"}
          </button>
        </span>
      </div>

      {!collapsed && (
        <>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {STEPS.map((s, i) => {
              const isCurrent = i === current;
              return (
                <li key={s.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      fontSize: "0.8rem",
                      fontWeight: isCurrent ? 800 : 500,
                      color: done[i] ? "var(--color-muted)" : "var(--color-ink)",
                    }}
                  >
                    <span className="font-mono-num" style={{ width: 16, flexShrink: 0, color: done[i] ? "var(--color-brand)" : isCurrent ? "var(--color-danger)" : "var(--color-muted)" }}>
                      {done[i] ? "✓" : isCurrent ? "▶" : i + 1}
                    </span>
                    <span>
                      {s.title}
                      <span style={{ fontSize: "0.68rem", color: "var(--color-muted)", fontWeight: 500 }}>
                        {"　"}{s.who}
                      </span>
                    </span>
                  </div>
                  {isCurrent && (
                    <div
                      style={{
                        marginLeft: 24,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "var(--color-canvas)",
                        fontSize: "0.76rem",
                        lineHeight: 1.6,
                        color: "var(--color-ink)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <StepHint
                        index={i}
                        selectedEmergencyType={selectedEmergencyType}
                        safety={safety}
                        taskStatus={myTask?.status}
                        triaged={triaged}
                        targetRoom={targetRoom}
                        targetIsPriority={issueDetail?.priority_targets.some(
                          (p) => p.room_number === targetRoom,
                        )}
                      />
                      {needsSwitch && step?.persona && (
                        <button
                          type="button"
                          onClick={() => onSelectPersona(step.persona!)}
                          style={primaryButton}
                        >
                          {step.persona.role === "admin" ? "管理人の画面に切り替える" : "住民301の画面に切り替える"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {current < 0 && (
            <p style={{ margin: 0, fontSize: "0.76rem", lineHeight: 1.6, color: "var(--color-ink)" }}>
              デモは以上です。時間があれば上の「Agentガバナンス検証」タブで、Model Armor が攻撃を遮断する様子も試せます。
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--color-line)", paddingTop: 8 }}>
            <span style={{ fontSize: "0.68rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
              ほかの方が同時に操作すると表示が混ざることがあります。おかしくなったらやり直してください。
            </span>
            {onRestartDemo && (
              <button
                type="button"
                onClick={() => void onRestartDemo()}
                disabled={isLoading}
                style={{ ...linkButton, whiteSpace: "nowrap" }}
              >
                最初からやり直す
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StepHint({
  index,
  selectedEmergencyType,
  safety,
  taskStatus,
  triaged,
  targetRoom,
  targetIsPriority,
}: {
  index: number;
  selectedEmergencyType: EmergencyType;
  safety?: string;
  taskStatus?: string;
  triaged: boolean;
  targetRoom?: string;
  targetIsPriority?: boolean;
}) {
  switch (index) {
    case 0:
      return (
        <>
          <span>
            下の「災害シミュレーション」で<b>「地震」</b>を選び、<b>「震度5強 地震発生」</b>を押します。
            {selectedEmergencyType !== "EARTHQUAKE" && "（このガイドは地震の流れです）"}
          </span>
          <Point>管理人のワンタップで、棟内50戸に安否確認が一斉に届きます。</Point>
        </>
      );
    case 1:
      return safety === "NEED_HELP" ? (
        <span>
          「被害あり」と回答したため、301号室は確認役になれません。下の「最初からやり直す」から発令し直してください。
        </span>
      ) : (
        <>
          <span>右のスマホに届いた安否確認で<b>「無事」</b>を押します。</span>
          <Point>住民は普段何も登録していません。災害時だけ、この1問に答えます。</Point>
        </>
      );
    case 2:
      return (
        <>
          <span>
            下の黒いボタン<b>「1回目のトリアージをする」</b>を押します。
          </span>
          <Point>
            AI（Building Agent）が、未応答の住戸ごとに同じ階で一番近い「無事」の住民を確認役に選びます。結果は「隣室確認の状況」に出ます。
          </Point>
        </>
      );
    case 3:
      if (!taskStatus) {
        return triaged ? (
          <span>
            今回は301号室に依頼が届きませんでした（AI が別の住民を選びました）。「隣室確認の状況」で割り当てを確認できます。「最初からやり直す」と別の割り当てになることがあります。
          </span>
        ) : null;
      }
      if (taskStatus === "OFFERED") {
        return (
          <>
            <span>右のスマホに届いた依頼で<b>「協力する」</b>を押します。</span>
            <Point>
              押す前は確認先の部屋番号が伏せられています。本人が承認した瞬間にだけ
              {targetRoom ? `「${targetRoom}号室」と` : ""}表示されます（段階的開示）。
            </Point>
          </>
        );
      }
      if (taskStatus === "APPROVED" || taskStatus === "IN_PROGRESS") {
        return (
          <>
            <span>
              インターホンを鳴らした想定で、<b>「応答がなかった」</b>を押します。
            </span>
            <Point>実際に動くのは人で、その結果が管理人に返ります。</Point>
          </>
        );
      }
      return (
        <span>
          依頼が辞退・期限切れになりました。301号室には同じ依頼が再び届かないため、「最初からやり直す」から進めてください。
        </span>
      );
    case 4:
      return (
        <>
          <span>
            管理人の画面で「隣室確認の状況」を見ます。
            {targetRoom && <>{targetRoom}号室が<b>「要対応・応答なし」</b>の先頭にあります。</>}
            {targetIsPriority && "要配慮世帯なので、最優先アラートにも出ます。"}
          </span>
          <Point>管理人は50戸すべてを回らず、ここに出た数戸だけに向かえば済みます。</Point>
        </>
      );
    default:
      return null;
  }
}

const Point: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>見どころ：{children}</span>
);

const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "var(--color-brand)",
  cursor: "pointer",
  textDecoration: "underline",
};

const primaryButton: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  borderRadius: 16,
  border: "none",
  background: "var(--color-ink)",
  color: "#FFFFFF",
  fontSize: "0.74rem",
  fontWeight: 700,
  cursor: "pointer",
};
