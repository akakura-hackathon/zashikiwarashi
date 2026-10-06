import React, { useState, useRef, useEffect } from "react";

// C5: Primary Button
export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}> = ({ children, onClick, disabled, type = "button", ariaLabel }) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        height: 56,
        borderRadius: 28,
        backgroundColor: disabled ? "var(--color-track)" : "var(--color-ink)",
        color: disabled ? "var(--color-muted)" : "#FFFFFF",
        border: "none",
        fontSize: 17,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 0.15s ease",
      }}
    >
      {children}
    </button>
  );
};

// C6: Primary Danger Button
export const DangerButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}> = ({ children, onClick, disabled, ariaLabel }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        height: 56,
        borderRadius: 28,
        backgroundColor: disabled ? "var(--color-track)" : "var(--color-danger)",
        color: "#FFFFFF",
        border: "none",
        fontSize: 17,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 0.15s ease",
      }}
    >
      {children}
    </button>
  );
};

// C7: Secondary Button
export const SecondaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}> = ({ children, onClick, disabled, ariaLabel }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        width: "100%",
        height: 50,
        borderRadius: 25,
        backgroundColor: "transparent",
        color: "var(--color-ink)",
        border: "1.5px solid var(--color-ink)",
        fontSize: 15,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background-color 0.15s ease",
      }}
    >
      {children}
    </button>
  );
};

// C8: Text Button
export const TextButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  color?: string;
}> = ({ children, onClick, color = "var(--color-ink)" }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 44,
        background: "none",
        border: "none",
        color,
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        padding: "0 12px",
        textDecoration: "underline",
        textUnderlineOffset: 4,
      }}
    >
      {children}
    </button>
  );
};

// C9: Choice Card Button (大選択肢)
export const ChoiceButton: React.FC<{
  title: string;
  description: string;
  icon?: React.ReactNode;
  accentColor?: "brand" | "danger" | "ink";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ title, description, icon, accentColor = "ink", selected, disabled, onClick }) => {
  const getBorderColor = () => {
    if (selected) {
      if (accentColor === "danger") return "var(--color-danger)";
      if (accentColor === "brand") return "var(--color-brand)";
      return "var(--color-ink)";
    }
    return "var(--color-line)";
  };

  const getBgColor = () => {
    if (selected) {
      if (accentColor === "danger") return "var(--color-danger-tint)";
      if (accentColor === "brand") return "var(--color-brand-tint)";
      return "var(--color-canvas)";
    }
    return "var(--color-surface)";
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        minHeight: 88,
        padding: "16px 20px",
        borderRadius: 16,
        border: `1.5px solid ${getBorderColor()}`,
        backgroundColor: getBgColor(),
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        textAlign: "left",
        transition: "all 0.15s ease",
      }}
    >
      {icon && (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            backgroundColor: selected ? "#FFFFFF" : "var(--color-canvas)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
          {title}
        </span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-muted)" }}>
          {description}
        </span>
      </div>
    </button>
  );
};

// C10: Long Press Button (重大操作用：長押し2秒)
export const LongPressButton: React.FC<{
  label: string;
  onComplete: () => void;
  durationMs?: number;
  variant?: "danger" | "brand" | "ink";
  noteText?: string;
}> = ({
  label,
  onComplete,
  durationMs = 2000,
  variant = "danger",
  noteText = "誤操作を防ぐため、長押しして確定します",
}) => {
  const [pressing, setPressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startRef = useRef<number>(0);

  const bgBase = variant === "danger" ? "var(--color-danger)" : variant === "brand" ? "var(--color-brand)" : "var(--color-ink)";

  const startPress = () => {
    setPressing(true);
    startRef.current = Date.now();
    const interval = 30;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const ratio = Math.min(elapsed / durationMs, 1);
      setProgress(ratio * 100);

      if (ratio >= 1) {
        if (timerRef.current) clearInterval(timerRef.current);
        setPressing(false);
        setProgress(0);
        onComplete();
      }
    }, interval);
  };

  const cancelPress = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
    setProgress(0);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      <button
        type="button"
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        style={{
          width: "100%",
          height: 56,
          borderRadius: 28,
          backgroundColor: bgBase,
          color: "#FFFFFF",
          border: "none",
          fontSize: 17,
          fontWeight: 700,
          position: "relative",
          overflow: "hidden",
          cursor: "pointer",
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Progress fill bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            backgroundColor: "rgba(255, 255, 255, 0.35)",
            transition: "width 0.05s linear",
          }}
        />
        <span style={{ position: "relative", zIndex: 1 }}>
          {pressing ? `そのまま長押し (${Math.ceil(((100 - progress) / 100) * (durationMs / 1000))}秒)` : label}
        </span>
      </button>
      {noteText && (
        <span style={{ fontSize: 12.5, color: "var(--color-muted)", textAlign: "center" }}>
          {noteText}
        </span>
      )}
    </div>
  );
};
