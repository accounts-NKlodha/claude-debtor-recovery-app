import type { NextConfig } from "next";

/**
 * Two build targets from one codebase:
 *  - default (`next build`): server build for self-hosting at debtor.nklodha.in.
 *  - desktop (`BUILD_TARGET=desktop`): static export the Tauri shell bundles.
 *    In desktop mode the app talks to the hosted API/Supabase over HTTPS;
 *    dynamic server routes are not included in the export.
 */
const isDesktop = process.env.BUILD_TARGET === "desktop";

/**
 * Audit P2-4: responses disclosed `X-Powered-By: Next.js` and lacked CSP,
 * frame protection, MIME-sniff protection, referrer policy, and permissions
 * policy. HSTS is a production HTTPS-edge concern, not set here. Not
 * available in `output: "export"` (desktop) builds -- Next.js ignores
 * `headers()` for static export, so the Tauri shell relies on its own CSP
 * (src-tauri/tauri.conf.json) instead.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isDesktop
    ? { output: "export", images: { unoptimized: true }, trailingSlash: true }
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
