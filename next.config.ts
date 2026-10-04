import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['192.168.0.100'],
  // Keep OG rendering external so its .wasm files resolve at runtime
  // (bundling breaks resvg/yoga wasm loading in dev and production).
  serverExternalPackages: ['@vercel/og'],
};

export default nextConfig;
