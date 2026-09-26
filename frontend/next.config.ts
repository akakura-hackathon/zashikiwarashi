import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Firebase Hosting に静的ファイルとして置く（docs/ARCHITECTURE.md §6.2）。ビルド結果は out/
  output: "export",
  // Pin the workspace root to this directory so Next.js doesn't misdetect it
  // from an unrelated lockfile elsewhere on the machine.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
