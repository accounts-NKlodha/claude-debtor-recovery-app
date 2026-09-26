// SAFE local launcher. EVERY external send channel is forced to its mock (or made
// unable to send) in every mode, whatever .env.local says. It can never send a
// real email or WhatsApp message. Real sends require the separate, deliberately
// local-only controlled launcher (scripts/uat-live-comms.mjs), which is NOT
// referenced by .claude/launch.json.
//
//   node scripts/uat-supabase-dev.mjs demo       -> vite dev, in-memory demo data, no Supabase (default dev launcher)
//   node scripts/uat-supabase-dev.mjs            -> vite dev against the real Supabase project, sends mocked
//   node scripts/uat-supabase-dev.mjs preview    -> Node-preset build + server (NODE_ENV=production, port 4173), sends mocked
//
// .env.local is loaded first, then the overrides below are applied, so what
// the file says about ADAPTER_PROFILE / WHATSAPP_PROVIDER / send secrets is
// irrelevant here. In production mode the email adapter is always the real
// one (src/adapters/index.ts), so the SMTP secret is blanked to make it fail
// closed rather than send. Prints only booleans / lengths, never values.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const mode = process.argv[2] === "preview" ? "preview" : process.argv[2] === "demo" ? "demo" : "dev";

if (!existsSync(".env.local")) {
  console.error("[uat] .env.local not found in the project root.");
  process.exit(1);
}
process.loadEnvFile(".env.local");

Object.assign(process.env, {
  DATA_PROFILE: mode === "demo" ? "memory" : "supabase",
  ADAPTER_PROFILE: "mock",
  WHATSAPP_PROVIDER: "disabled",
  EMAIL_PROVIDER: "",
  SMTP_APP_PASSWORD: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_REFRESH_TOKEN: "",
  AISENSY_API_KEY: "",
});
process.env.NODE_ENV = mode === "preview" ? "production" : "development";

const problems = [];
if (mode !== "demo") {
  if (!/^https:\/\//.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) problems.push("NEXT_PUBLIC_SUPABASE_URL missing or not https");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
}
if (process.env.ADAPTER_PROFILE !== "mock") problems.push("ADAPTER_PROFILE not mock");
if (process.env.WHATSAPP_PROVIDER !== "disabled") problems.push("WHATSAPP_PROVIDER not disabled");
if (process.env.SMTP_APP_PASSWORD || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_REFRESH_TOKEN || process.env.AISENSY_API_KEY) problems.push("send secrets not blanked");
if (problems.length) {
  console.error("[uat] refusing to start:", problems.join("; "));
  process.exit(1);
}

console.log(
  `[uat] mode=${mode} NODE_ENV=${process.env.NODE_ENV} data=${process.env.DATA_PROFILE} ` +
    (mode === "demo" ? "" : `supabaseHost=${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.slice(0, 4)}… `) +
    `adapters=mock whatsapp=disabled smtpSecret=blank aisensyKey=blank`,
);

const vite = ["node_modules/vite/bin/vite.js"];
let args = [...vite, "dev"];
if (mode === "preview") {
  // The default Nitro preset targets Cloudflare and can't run under Node;
  // build a Node server into the git-ignored .output for this UAT only.
  const build = spawnSync(process.execPath, [...vite, "build"], {
    stdio: "inherit",
    env: { ...process.env, NITRO_PRESET: "node-server" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
  process.env.PORT = "4173";
  args = [".output/server/index.mjs"];
}
const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
