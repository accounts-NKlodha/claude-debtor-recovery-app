// @lovable.dev/vite-tanstack-config already includes TanStack devtools (dev-only),
// tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only, cloudflare
// preset by default), VITE_* env injection, the @ path alias, React/TanStack dedupe,
// error logger plugins, and sandbox detection -- do NOT add those manually.
//
// SPIKE / PORT-IN-PROGRESS: this file is additive only. It does not touch next.config.ts
// (Next.js ignores vite.config.ts entirely), so `npm run dev` / `npm run build` (Next.js)
// keep working unchanged. Use `npm run tanstack:dev` / `tanstack:build` for this stack.
import path from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // The reused repository files (src/server/repositories/supabase.ts,
  // memory.ts -- shared unmodified with the Next.js app) statically import
  // "server-only" (via @/lib/config/production, @/adapters, etc). That
  // package's package.json only resolves to its harmless no-op when the
  // bundler declares the "react-server" condition (what Next.js sets for
  // its own RSC/server graph); setting that condition broadly for the SSR
  // environment was tried first and rejected -- it also changes which
  // conditional export several @tanstack/* packages resolve to and breaks
  // TanStack Start's own SSR entry point (createStartHandler). Aliasing
  // just the "server-only" package itself, SSR-only, is the surgical fix:
  // server-side code (where these modules genuinely belong) stops
  // throwing, while the top-level/client resolution is untouched, so
  // "server-only"'s actual protective purpose -- throwing if a CLIENT
  // bundle ever imports one of these modules -- is preserved.
  vite: {
    resolve: {
      alias: {
        "server-only": path.resolve(__dirname, "src/lib/noop-server-only.ts"),
      },
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
