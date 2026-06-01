import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  // Transpile the local workspace package so Next.js bundles its TypeScript
  // source directly so no pre-build step is required during development.
  transpilePackages: ["live2d-react"],
};

export default nextConfig;
