"use client";

import React, { useEffect, useState } from "react";
import type { TaskBoardItem } from "@/lib/api-client";
import { taskCountdown } from "@/lib/emergency-view";

// C27: TaskBoard（隣室確認の状況。FN-08、#61、DESIGN §6.3 D）
// Building Agent が誰にどの住戸の確認を頼み、今どうなっているかを管理人に見せる。

type Tone = "danger" | "warn" | "info" | "brand" | "muted";

const STATE_LABEL: Record<string, { label: string; tone: Tone }> = {
  NO_RESPONSE: { label: "応答なし", tone: "danger" },
  EXHAUSTED: { label: "担当決まらず", tone: "danger" },
  UNASSIGNED: { label: "担当なし", tone: "warn" },
  RETRY_PENDING: { label: "再打診待ち", tone: "warn" },
  IN_PROGRESS: { label: "確認中", tone: "brand" },
  APPROVED: { label: "承認済み", tone: "brand" },
  OFFERED: { label: "打診中", tone: "info" },
  RESPONDED: { label: "応答あり", tone: "muted" },
};

const TONE_STYLE: Record<Tone, { color: string; background: string }> = {
  danger: { color: "var(--color-danger-text)", background: "var(--color-danger-tint)" },
  warn: { color: "var(--color-warn)", background: "#FBF1DC" },
  info: { color: "var(--color-info-text)", background: "var(--color-info-tint)" },
  brand: { color: "var(--color-brand)", background: "var(--color-brand-tint)" },
  muted: { color: "var(--color-muted)", background: "var(--color-canvas)" },
};

const GROUPS: { key: TaskBoardItem["group"]; title: string }[] = [
  { key: "ACTION", title: "要対応" },
  { key: "ACTIVE", title: "進行中" },
  { key: "DONE", title: "完了" },
];

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className="font-mono-num"
    style={{
      ...TONE_STYLE[tone],
      fontSize: "0.66rem",
      fontWeight: 700,
      padding: "2px 7px",
      borderRadius: 4,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

const Row: React.FC<{ item: TaskBoardItem; now: number }> = ({ item, now }) => {
  const meta = STATE_LABEL[item.state] ?? { label: item.state, tone: "muted" as Tone };
  const label =
    item.state === "OFFERED" && item.expires_at
      ? `${meta.label} ${taskCountdown(item.expires_at, undefined, now)}`
      : meta.label;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 0",
        borderBottom: "1px solid var(--color-line)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: "0.82rem", color: "var(--color-ink)" }}>
          <span className="font-mono-num" style={{ fontWeight: 800 }}>
            {item.target_room_number}号室
          </span>
          {item.helper_room_number && (
            <span style={{ color: "var(--color-muted)" }}>
              {" ← "}
              <span className="font-mono-num">{item.helper_room_number}</span>号室が確認
            </span>
          )}
        </span>
        {item.reason && (
          <span style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>{item.reason}</span>
        )}
      </div>
      <Pill tone={meta.tone}>{label}</Pill>
    </div>
  );
};

// 担当なしはトリアージ直後に数十戸になりうるので、階ごとに部屋番号をまとめる
const UnassignedRow: React.FC<{ items: TaskBoardItem[] }> = ({ items }) => {
  const byFloor = new Map<number, string[]>();
  for (const i of items) {
    byFloor.set(i.target_floor, [...(byFloor.get(i.target_floor) ?? []), i.target_room_number]);
  }
  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid var(--color-line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--color-ink)" }}>
          担当なし <span className="font-mono-num">{items.length}</span>戸
        </span>
        <Pill tone="warn">担当なし</Pill>
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--color-muted)", marginTop: 2 }}>
        同じ階に頼める「無事」の住民がいません
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
        {[...byFloor.entries()]
          .sort(([a], [b]) => a - b)
          .map(([floor, rooms]) => (
            <span key={floor} className="font-mono-num" style={{ fontSize: "0.72rem", color: "var(--color-ink)" }}>
              {floor}F: {rooms.join("・")}
            </span>
          ))}
      </div>
    </div>
  );
};

export const TaskBoard: React.FC<{ items: TaskBoardItem[] }> = ({ items }) => {
  const now = useNow(items.some((i) => i.state === "OFFERED"));
  if (items.length === 0) return null;

  return (
    <section
      aria-label="隣室確認の状況"
      style={{
        border: "1px solid var(--color-line)",
        borderRadius: 10,
        background: "var(--color-surface)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "var(--color-ink)" }}>
        隣室確認の状況
      </div>
      {GROUPS.map(({ key, title }) => {
        const groupItems = items.filter((i) => i.group === key);
        if (groupItems.length === 0) return null;
        const unassigned = groupItems.filter((i) => i.state === "UNASSIGNED");
        const rows = groupItems.filter((i) => i.state !== "UNASSIGNED");
        return (
          <div key={key}>
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: key === "ACTION" ? "var(--color-danger)" : "var(--color-muted)",
                letterSpacing: "0.04em",
              }}
            >
              {title} <span className="font-mono-num">{groupItems.length}</span>
            </div>
            {rows.map((item) => (
              <Row key={item.target_resident_id} item={item} now={now} />
            ))}
            {unassigned.length > 0 && <UnassignedRow items={unassigned} />}
          </div>
        );
      })}
    </section>
  );
};
