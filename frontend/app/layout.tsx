import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "akakura-ai-web-template",
  description: "AI agent web app template",
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
