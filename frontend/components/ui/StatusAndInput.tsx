import React from "react";

// C11: CheckRow
export const CheckRow: React.FC<{
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, sublabel, checked, onChange }) => {
  return (
    <label
      style={{
        minHeight: 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--color-line)",
        padding: "12px 0",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
          {label}
        </span>
        {sublabel && (
          <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
            {sublabel}
          </span>
        )}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 24,
          height: 24,
          accentColor: "var(--color-ink)",
          cursor: "pointer",
        }}
      />
    </label>
  );
};

// C14: StatusPill
export const StatusPill: React.FC<{
  label: string;
  variant?: "danger" | "warn" | "brand" | "neutral";
}> = ({ label, variant = "neutral" }) => {
  const getColors = () => {
    switch (variant) {
      case "danger":
        return { color: "var(--color-danger)", border: "var(--color-danger)", bg: "var(--color-danger-tint)" };
      case "warn":
        return { color: "var(--color-warn)", border: "var(--color-warn)", bg: "#FFF9E6" };
      case "brand":
        return { color: "var(--color-brand)", border: "var(--color-brand)", bg: "var(--color-brand-tint)" };
      default:
        return { color: "var(--color-muted)", border: "var(--color-line)", bg: "var(--color-surface)" };
    }
  };

  const c = getColors();

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 12px",
        borderRadius: 999,
        border: `1.5px solid ${c.border}`,
        backgroundColor: c.bg,
        color: c.color,
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
};

// C15: Tag
export const Tag: React.FC<{ label: string }> = ({ label }) => {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        border: "1px solid var(--color-line)",
        backgroundColor: "var(--color-surface)",
        color: "var(--color-muted)",
        fontSize: 12.5,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
};

// C16: CountdownPill
export const CountdownPill: React.FC<{
  label: string;
  timeRemaining: string;
  isLockScreen?: boolean;
}> = ({ label, timeRemaining, isLockScreen = false }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        borderRadius: 999,
        backgroundColor: isLockScreen ? "rgba(255, 255, 255, 0.12)" : "var(--color-canvas)",
        border: isLockScreen ? "none" : "1px solid var(--color-line)",
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: isLockScreen ? "var(--color-lock-text-3)" : "var(--color-muted)",
        }}
      >
        {label}
      </span>
      <span
        className="font-mono-num"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isLockScreen ? "var(--color-lock-timer)" : "var(--color-ink)",
        }}
      >
        {timeRemaining}
      </span>
    </div>
  );
};

// C17: ProgressBar
export const ProgressBar: React.FC<{
  title: string;
  current: number;
  total: number;
  unit?: string;
}> = ({ title, current, total, unit = "戸" }) => {
  const percentage = Math.min(Math.round((current / total) * 100), 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>
          {title}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span className="font-mono-num" style={{ fontSize: 24, fontWeight: 700, color: "var(--color-ink)" }}>
            {current}
          </span>
          <span className="font-mono-num" style={{ fontSize: 14, color: "var(--color-muted)" }}>
            / {total}{unit}
          </span>
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: 10,
          borderRadius: 5,
          backgroundColor: "var(--color-track)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percentage}%`,
            backgroundColor: "var(--color-brand-soft)",
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
};
