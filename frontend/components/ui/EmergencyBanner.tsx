import React from "react";

interface EmergencyBannerProps {
  disasterType?: string;
  detail?: string;
  issuedAt?: string;
}

export const EmergencyBanner: React.FC<EmergencyBannerProps> = ({
  disasterType = "地震",
  detail = "震度5強",
  issuedAt = "8:03",
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 24px",
        marginTop: 6,
        borderBottom: "1px solid var(--color-line)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: "var(--color-danger)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
          緊急モード · {disasterType}（{detail}）
        </span>
      </div>
      <span
        className="font-mono-num"
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-muted)",
        }}
      >
        {issuedAt} 発令
      </span>
    </div>
  );
};
