import React, { useState } from "react";

export type RoomStatusType = "safe" | "urgent" | "unassigned" | "unresponsive" | "away";

export interface RoomItem {
  roomNo: string;
  floor: number;
  col: number; // 1 to 10
  status: RoomStatusType;
  residentName?: string;
}

interface FloorMapProps {
  rooms?: RoomItem[];
  onSelectRoom?: (room: RoomItem) => void;
}

export const FloorMap: React.FC<FloorMapProps> = ({ rooms, onSelectRoom }) => {
  const [filter, setFilter] = useState<"all" | "attention" | "unassigned">("all");

  // デフォルトで15階×10列のデータ（モック／実データ用）を構築
  const roomMap = React.useMemo(() => {
    const map = new Map<string, RoomItem>();
    if (rooms && rooms.length > 0) {
      rooms.forEach((r) => map.set(r.roomNo, r));
    } else {
      // 15階 × 10戸 = 150戸のデフォルトデータ
      for (let f = 15; f >= 1; f--) {
        for (let c = 1; c <= 10; c++) {
          const roomNo = `${f}${c < 10 ? "0" + c : c}`;
          let status: RoomStatusType = "safe";
          if (roomNo === "302") status = "urgent";
          else if (roomNo === "1107") status = "urgent";
          else if (roomNo === "815" || roomNo === "805") status = "unassigned";
          else if (f === 5 && c <= 3) status = "unresponsive";
          else if (f === 12 && c >= 8) status = "away";
          else if (f === 2 && c === 4) status = "unresponsive";

          map.set(roomNo, { roomNo, floor: f, col: c, status });
        }
      }
    }
    return map;
  }, [rooms]);

  const getCellColor = (status: RoomStatusType) => {
    switch (status) {
      case "safe":
        return "var(--color-brand-soft)";
      case "urgent":
        return "var(--color-danger)";
      case "unassigned":
        return "var(--color-warn-map)";
      case "unresponsive":
        return "var(--color-neutral-cell)";
      case "away":
        return "var(--color-neutral-cell-light)";
    }
  };

  const floors = Array.from({ length: 15 }, (_, i) => 15 - i); // 15F down to 1F

  return (
    <div
      style={{
        backgroundColor: "var(--color-canvas)",
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        border: "1px solid var(--color-line)",
      }}
    >
      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {[
          { id: "all", label: "すべて" },
          { id: "attention", label: "要確認" },
          { id: "unassigned", label: "担当なし" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id as "all" | "attention" | "unassigned")}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--color-line)",
              backgroundColor: filter === item.id ? "var(--color-ink)" : "#FFFFFF",
              color: filter === item.id ? "#FFFFFF" : "var(--color-muted)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Grid Floor Map */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {floors.map((floor) => (
          <div key={floor} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Floor Label */}
            <span
              className="font-mono-num"
              style={{
                width: 26,
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--color-muted)",
                textAlign: "right",
              }}
            >
              {floor}F
            </span>

            {/* 10 Room Cells */}
            <div style={{ display: "flex", gap: 5, flex: 1 }}>
              {Array.from({ length: 10 }, (_, c) => {
                const col = c + 1;
                const roomNo = `${floor}${col < 10 ? "0" + col : col}`;
                const r = roomMap.get(roomNo) || { roomNo, floor, col, status: "safe" as RoomStatusType };

                const isDimmed =
                  (filter === "attention" && r.status !== "urgent" && r.status !== "unassigned") ||
                  (filter === "unassigned" && r.status !== "unassigned");

                return (
                  <div
                    key={roomNo}
                    onClick={() => onSelectRoom && onSelectRoom(r)}
                    title={`${roomNo}号室 (${r.status})`}
                    style={{
                      flex: 1,
                      height: 20,
                      borderRadius: 3,
                      backgroundColor: getCellColor(r.status),
                      opacity: isDimmed ? 0.25 : 1,
                      cursor: "pointer",
                      transition: "transform 0.1s ease",
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend Chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          paddingTop: 8,
          borderTop: "1px solid var(--color-line)",
          fontSize: 11,
          color: "var(--color-muted)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "var(--color-brand-soft)" }} />
          <span>無事</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "var(--color-danger)" }} />
          <span>要確認・被害</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "var(--color-warn-map)" }} />
          <span>担当なし</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "var(--color-neutral-cell)" }} />
          <span>未応答</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "var(--color-neutral-cell-light)" }} />
          <span>外出の可能性</span>
        </div>
      </div>
    </div>
  );
};
