import type { NextConfig } from "next";

/**
 * Two build targets from one codebase:
 *  - default (`next build`): server build for self-hosting at debtor.nklodha.in.
 *  - desktop (`BUILD_TARGET=desktop`): static export the Tauri shell bundles.
 *    In desktop mode the app talks to the hosted API/Supabase over HTTPS;
 *    dynamic server routes are not included in the export.
 */
const isDesktop = process.env.BUILD_TARGET === "desktop";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isDesktop
    ? { output: "export", images: { unoptimized: true }, trailingSlash: true }
    : {}),
};

export default nextConfig;
