import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the local workspace package so Next.js bundles its TypeScript
  // source directly — no pre-build step required during development.
  transpilePackages: ["live2d-react"],
};

export default nextConfig;
