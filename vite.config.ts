// @lovable.dev/vite-tanstack-config already includes TanStack devtools (dev-only),
// tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only, cloudflare
// preset by default), VITE_* env injection, the @ path alias, React/TanStack dedupe,
// error logger plugins, and sandbox detection -- do NOT add those manually.
//
// SPIKE / PORT-IN-PROGRESS: this file is additive only. It does not touch next.config.ts
// (Next.js ignores vite.config.ts entirely), so `npm run dev` / `npm run build` (Next.js)
// keep working unchanged. Use `npm run tanstack:dev` / `tanstack:build` for this stack.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
});
