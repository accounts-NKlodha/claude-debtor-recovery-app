import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Many action tests begin with a cold dynamic import() of a large
    // module graph while ~45 jsdom files run in parallel; the 5s default
    // timed out intermittently under load (a timed-out test's still-running
    // promise then also leaked mock call counts into the next test).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/**/*.{test,spec}.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/lib/**", "src/adapters/**"],
    },
  },
});
