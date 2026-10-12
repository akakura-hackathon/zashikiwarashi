import React from "react";

interface AppBarProps {
  variant?: "home" | "subpage";
  onBack?: () => void;
  rightAction?: React.ReactNode;
  residentName?: string;
}

export const AppBar: React.FC<AppBarProps> = ({
  variant = "home",
  onBack,
  rightAction,
  residentName,
}) => {

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "34px 18px 8px",
        backgroundColor: "var(--color-surface)",
        borderBottom: "1px solid transparent",
      }}
    >
      {/* Left: Back button or Logo */}
      <div style={{ display: "flex", alignItems: "center", minWidth: 44 }}>
        {variant === "subpage" && onBack ? (
          <button
            onClick={onBack}
            aria-label="戻る"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid var(--color-line)",
              backgroundColor: "var(--color-surface)",
              color: "var(--color-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src="/icons/icon-192.png"
              alt="Zashikiwarashi"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                objectFit: "cover",
                display: "block",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
              }}
            />
            <span
              style={{
                fontWeight: 900,
                fontSize: 16,
                letterSpacing: "0.02em",
                color: "var(--color-ink)",
              }}
            >
              Zashikiwarashi
            </span>
          </div>
        )}
      </div>

      {/* Right: Optional Action or Resident Name */}
      {rightAction ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {rightAction}
        </div>
      ) : residentName ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--color-muted)",
          }}
        >
          <span>🏠</span>
          <span>{residentName}</span>
        </div>
      ) : (
        <div style={{ minWidth: 44 }} />
      )}
    </header>
  );
};
