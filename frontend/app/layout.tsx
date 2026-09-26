import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zashikiwarashi",
  description: "マンションの緊急時の助け合いを支える Multi-Agent サービス",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
