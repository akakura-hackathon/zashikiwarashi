import React from "react";
import { CountdownPill } from "./StatusAndInput";

interface LockNotificationProps {
  timeStr?: string;
  dateStr?: string;
  sender?: string;
  title: string;
  message: string;
  timeRemaining?: string;
  primaryButtonText: string;
  primaryButtonVariant?: "brand" | "danger" | "ink";
  onPrimaryClick: () => void;
  secondaryButtonText?: string;
  onSecondaryClick?: () => void;
  onNotificationClick?: () => void;
}

export const LockNotification: React.FC<LockNotificationProps> = ({
  timeStr = "8:03",
  dateStr = "10月4日 土曜日",
  sender = "ZASHIKI",
  title,
  message,
  timeRemaining,
  primaryButtonText,
  primaryButtonVariant = "brand",
  onPrimaryClick,
  secondaryButtonText,
  onSecondaryClick,
  onNotificationClick,
}) => {
  const getPrimaryBg = () => {
    if (primaryButtonVariant === "danger") return "var(--color-danger)";
    if (primaryButtonVariant === "brand") return "var(--color-brand)";
    return "var(--color-ink)";
  };

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: "var(--color-lock-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "24px 20px 20px",
        color: "#FFFFFF",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* Top: Date and Big Lock Clock */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 24 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: "var(--color-lock-text-2)" }}>
          {dateStr}
        </span>
        <span
          className="font-mono-num"
          style={{
            fontSize: 82,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "#FFFFFF",
            marginTop: 4,
          }}
        >
          {timeStr}
        </span>
      </div>

      {/* Middle: Notification Card (Glassy Card) */}
      <div
        style={{
          width: "100%",
          backgroundColor: "var(--color-lock-card)",
          backdropFilter: "blur(20px)",
          borderRadius: 22,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        {/* Header inside Notification */}
        <div
          onClick={onNotificationClick}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: onNotificationClick ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img
              src="/icons/icon-192.png"
              alt="座敷わらし"
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                objectFit: "cover",
                display: "block",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-lock-text-3)" }}>
              {sender}
            </span>
          </div>
          {timeRemaining && (
            <CountdownPill label="残り" timeRemaining={timeRemaining} isLockScreen={true} />
          )}
        </div>

        {/* Content text */}
        <div
          onClick={onNotificationClick}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            cursor: onNotificationClick ? "pointer" : "default",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF" }}>
            {title}
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-lock-text-2)" }}>
            {message}
          </span>
        </div>

        {/* Action Buttons (Max 2 buttons) */}
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          {secondaryButtonText && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onSecondaryClick) onSecondaryClick();
              }}
              style={{
                flex: 1,
                height: 50,
                borderRadius: 25,
                backgroundColor: "var(--color-lock-secondary)",
                color: "#FFFFFF",
                border: "none",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {secondaryButtonText}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryClick();
            }}
            style={{
              flex: 1,
              height: 50,
              borderRadius: 25,
              backgroundColor: getPrimaryBg(),
              color: "#FFFFFF",
              border: "none",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {primaryButtonText}
          </button>
        </div>
      </div>

      {/* Bottom hint text */}
      <div style={{ textAlign: "center", paddingBottom: 10 }}>
        <span style={{ fontSize: 13, color: "var(--color-lock-text-4)" }}>
          ロックを解除せずに回答できます
        </span>
      </div>
    </div>
  );
};
