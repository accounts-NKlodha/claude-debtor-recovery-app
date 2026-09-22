import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // TanStack Start / Vite / Nitro build output (tanstack:build) -- bundled
    // third-party code (Supabase, Zod, react-router, Nitro's own runtime),
    // not this project's source; matches the /.output/ /.wrangler/ entries
    // in .gitignore.
    ".output/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
