import React, { useState } from "react";

interface AppBarProps {
  variant?: "home" | "subpage";
  onBack?: () => void;
  showReadAloud?: boolean;
  onReadAloud?: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({
  variant = "home",
  onBack,
  showReadAloud = true,
  onReadAloud,
}) => {
  const [reading, setReading] = useState(false);

  const handleRead = () => {
    setReading(true);
    if (onReadAloud) {
      onReadAloud();
    } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const textToRead = document.querySelector(".app-content")?.textContent || "画面の内容を読み上げます";
      const utter = new SpeechSynthesisUtterance(textToRead.slice(0, 100));
      utter.lang = "ja-JP";
      utter.onend = () => setReading(false);
      window.speechSynthesis.speak(utter);
    } else {
      setTimeout(() => setReading(false), 2000);
    }
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 16px 6px",
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
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                backgroundColor: "var(--color-brand)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 14,
              }}
            >
              ざ
            </div>
            <span
              style={{
                fontWeight: 900,
                fontSize: 16,
                letterSpacing: "0.04em",
                color: "var(--color-ink)",
              }}
            >
              ZASHIKI
            </span>
          </div>
        )}
      </div>

      {/* Right: Read Aloud Button */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {showReadAloud && (
          <button
            onClick={handleRead}
            aria-label="画面を読み上げる"
            title="画面を読み上げる"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1px solid var(--color-line)",
              backgroundColor: reading ? "var(--color-brand-tint)" : "var(--color-surface)",
              color: reading ? "var(--color-brand)" : "var(--color-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
};
