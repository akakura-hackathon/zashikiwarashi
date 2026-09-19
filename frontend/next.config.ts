import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory so Next.js doesn't misdetect it
  // from an unrelated lockfile elsewhere on the machine.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
