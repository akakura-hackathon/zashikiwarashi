import { LoginPanel } from "@/components/LoginPanel";

export default function Home() {
  return (
    <div className="device-wrapper">
      <div className="device-screen">
        {/* iOS-style Status Notch */}
        <div className="device-notch-bar">
          <span>9:41</span>
          <div className="device-notch">
            <span className="notch-camera-dot"></span>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem" }}>5G</span>
            <span>100%</span>
          </div>
        </div>

        {/* App Content */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <LoginPanel />
        </main>
      </div>
    </div>
  );
}
