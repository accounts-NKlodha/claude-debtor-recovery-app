// LIVE-communications UAT launcher (Stage B only). Real Supabase AND real Gmail
// SMTP + AiSensy, applied as PROCESS-LEVEL overrides -- .env.local is only read,
// never modified. Development mode (vite dev) on port 8080. Prints only
// booleans / lengths, never values. The app has no scheduler: every send is an
// operator click (verified before this was started).
//
//   LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS node scripts/uat-live-comms.mjs [email-only]
//
// DANGEROUS: real Gmail / AiSensy sends against production data. Deliberately
// NOT listed in .claude/launch.json and NOT reachable from any npm script. It
// refuses to start without the explicit per-run confirmation variable above
// (the same approval scripts/safe-run.mjs honours, defined once in safe-env.mjs).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { LIVE_CONFIRM_VALUE, LIVE_CONFIRM_VAR, liveSendsApproved } from "./safe-env.mjs";

if (!liveSendsApproved(process.env)) {
  console.error(`[live-comms] refusing to start: real external sends need ${LIVE_CONFIRM_VAR}=${LIVE_CONFIRM_VALUE} (explicit, per-run approval).`);
  process.exit(1);
}
if (!existsSync(".env.local")) {
  console.error("[live-comms] .env.local not found");
  process.exit(1);
}
process.loadEnvFile(".env.local");

// `email-only`: Gmail live, WhatsApp forced OFF and its key blanked so no
// AiSensy call is possible from this process.
const emailOnly = process.argv[2] === "email-only";
Object.assign(process.env, {
  DATA_PROFILE: "supabase",
  ADAPTER_PROFILE: "live",
  WHATSAPP_PROVIDER: emailOnly ? "disabled" : "aisensy",
});
if (emailOnly) process.env.AISENSY_API_KEY = "";
process.env.NODE_ENV = "development";

const need = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_APP_PASSWORD",
  "SMTP_FROM_ADDRESS",
  ...(emailOnly ? [] : ["AISENSY_API_KEY", "AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2"]),
];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("[live-comms] refusing to start, missing:", missing.join(", "));
  process.exit(1);
}
console.log(
  `[live-comms] LIVE email=gmail-smtp whatsapp=${emailOnly ? "DISABLED(key blanked)" : "aisensy"} data=supabase(${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.slice(0, 4)}…) ` +
    `smtpPassword=set(len ${process.env.SMTP_APP_PASSWORD.length}) aisensyKey=${process.env.AISENSY_API_KEY ? "set(len " + process.env.AISENSY_API_KEY.length + ")" : "BLANK"}`,
);

const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "dev"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
