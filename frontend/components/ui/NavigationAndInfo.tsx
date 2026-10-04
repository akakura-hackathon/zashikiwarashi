import React from "react";

// C18: Timeline
export interface TimelineItem {
  time?: string;
  text: string;
  status: "completed" | "in_progress" | "pending";
}

export const Timeline: React.FC<{ items: TimelineItem[] }> = ({ items }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", paddingLeft: 8 }}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const getDotBg = () => {
          if (item.status === "completed") return "var(--color-ink)";
          if (item.status === "in_progress") return "var(--color-warn)";
          return "var(--color-pending)";
        };

        return (
          <div key={idx} style={{ display: "flex", alignItems: "flex-start", minHeight: 44, position: "relative" }}>
            {/* Vertical Line */}
            {!isLast && (
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 14,
                  bottom: -6,
                  width: 2,
                  backgroundColor: "var(--color-line)",
                }}
              />
            )}
            {/* Dot */}
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: getDotBg(),
                flexShrink: 0,
                marginTop: 4,
                zIndex: 1,
              }}
            />
            {/* Time + Text */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginLeft: 16 }}>
              {item.time && (
                <span
                  className="font-mono-num"
                  style={{
                    width: 38,
                    fontSize: 13,
                    color: "var(--color-muted)",
                    flexShrink: 0,
                  }}
                >
                  {item.time}
                </span>
              )}
              <span
                style={{
                  fontSize: 15,
                  fontWeight: item.status === "pending" ? 500 : 700,
                  color: item.status === "pending" ? "var(--color-muted)" : "var(--color-ink)",
                }}
              >
                {item.text}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// C20: PrivacyNote
export const PrivacyNote: React.FC<{ note: string }> = ({ note }) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        color: "var(--color-muted)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span>{note}</span>
    </div>
  );
};

// C22: TabBar
export const TabBar: React.FC<{
  currentTab: "home" | "history" | "settings";
  onChangeTab: (tab: "home" | "history" | "settings") => void;
}> = ({ currentTab, onChangeTab }) => {
  const tabs: Array<{ id: "home" | "history" | "settings"; label: string; icon: React.ReactNode }> = [
    {
      id: "home",
      label: "ホーム",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      id: "history",
      label: "記録",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      id: "settings",
      label: "設定",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      style={{
        height: 78,
        paddingBottom: 14,
        display: "flex",
        borderTop: "1px solid var(--color-line)",
        backgroundColor: "var(--color-surface)",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeTab(tab.id)}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              border: "none",
              backgroundColor: "transparent",
              cursor: "pointer",
              position: "relative",
              color: isActive ? "var(--color-brand)" : "var(--color-muted)",
              transition: "color 0.15s ease",
            }}
          >
            {/* Active Top Bar Indicator */}
            {isActive && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 12,
                  right: 12,
                  height: 3,
                  backgroundColor: "var(--color-brand)",
                  borderRadius: "0 0 2px 2px",
                }}
              />
            )}
            {tab.icon}
            <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
