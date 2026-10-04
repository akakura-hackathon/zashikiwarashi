import React from "react";

interface PageTitleProps {
  title: string;
  subtitle?: string;
}

export const PageTitle: React.FC<PageTitleProps> = ({ title, subtitle }) => {
  return (
    <div style={{ padding: "8px 24px 0", display: "flex", flexDirection: "column", gap: 6 }}>
      <h1
        style={{
          fontSize: 26,
          fontWeight: 900,
          lineHeight: 1.35,
          letterSpacing: "0.01em",
          color: "var(--color-ink)",
          margin: 0,
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p
          style={{
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.65,
            color: "var(--color-muted)",
            margin: 0,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
};
