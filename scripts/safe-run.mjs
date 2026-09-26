// Runs an app command (next / vite) with default-safe providers.
//
//   node scripts/safe-run.mjs <next|vite> [args...]
//
// Used by the committed npm scripts (dev, start, tanstack:dev, tanstack:preview)
// so typing them can never start live Gmail or AiSensy just because .env.local
// holds provider credentials. See scripts/safe-env.mjs for the one explicit
// approval (LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS) that lifts this for a run.
//
// SAFE_RUN_CHECK=1 prints the resolved safety state and exits without starting
// anything (used by the tests and for quick verification). Prints only
// booleans/labels, never a secret value.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { applySafeProviderEnv, describeProviderSafety } from "./safe-env.mjs";

const BINS = {
  next: "node_modules/next/dist/bin/next",
  vite: "node_modules/vite/bin/vite.js",
};

const [tool, ...args] = process.argv.slice(2);
if (!tool || !(tool in BINS)) {
  console.error(`[safe-run] usage: node scripts/safe-run.mjs <${Object.keys(BINS).join("|")}> [args...]`);
  process.exit(2);
}

// .env.local is loaded first; the safe overrides are applied on top (process env
// wins over dotenv files in both Next and Vite).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const env = applySafeProviderEnv(process.env);
const safety = describeProviderSafety(env);

console.log(
  `[safe-run] ${tool} ${args.join(" ")} | mode=${safety.mode} adapters=${safety.adapterProfile} ` +
    `whatsapp=${safety.whatsappProvider} smtpSecret=${safety.smtpSecret} aisensyKey=${safety.aisensyKey}`,
);

if (process.env.SAFE_RUN_CHECK === "1") process.exit(0);

const child = spawn(process.execPath, [BINS[tool], ...args], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
