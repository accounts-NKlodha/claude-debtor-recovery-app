/**
 * Default-safe local runtime: typing a normal npm command must never start live
 * Gmail or AiSensy just because .env.local holds provider credentials. Real
 * sends require LIVE_COMMS_CONFIRM=I-APPROVE-LIVE-SENDS for that run.
 *
 * The launchers are exercised for real (child processes), but SAFE_RUN_CHECK=1
 * makes them print their resolved safety state and exit, so no server starts
 * and nothing can be sent.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySafeProviderEnv, liveSendsApproved } from "../../scripts/safe-env.mjs";

const ROOT = join(__dirname, "..", "..");
const FAKE_SMTP = "fakesmtppasswordvalue";
const FAKE_AISENSY = "fake-aisensy-key-value";

const liveEnv = {
  PATH: process.env.PATH ?? "",
  ADAPTER_PROFILE: "live",
  WHATSAPP_PROVIDER: "aisensy",
  SMTP_APP_PASSWORD: FAKE_SMTP,
  AISENSY_API_KEY: FAKE_AISENSY,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "u@example.com",
  SMTP_FROM_ADDRESS: "u@example.com",
};

const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    env: { ...env, SAFE_RUN_CHECK: "1" } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 20_000,
  });

describe("applySafeProviderEnv", () => {
  it("forces mock/disabled and blanks the send secrets by default", () => {
    const out = applySafeProviderEnv(liveEnv);
    expect(out).toMatchObject({ ADAPTER_PROFILE: "mock", WHATSAPP_PROVIDER: "disabled", SMTP_APP_PASSWORD: "", AISENSY_API_KEY: "" });
    expect(liveEnv.SMTP_APP_PASSWORD).toBe(FAKE_SMTP); // input not mutated
  });

  it("only the exact confirmation value lifts it", () => {
    for (const wrong of ["true", "1", "yes", "i-approve-live-sends", "I-APPROVE-LIVE-SENDS ", ""]) {
      expect(liveSendsApproved({ LIVE_COMMS_CONFIRM: wrong }), wrong).toBe(false);
      expect(applySafeProviderEnv({ ...liveEnv, LIVE_COMMS_CONFIRM: wrong }).WHATSAPP_PROVIDER).toBe("disabled");
    }
    const approved = applySafeProviderEnv({ ...liveEnv, LIVE_COMMS_CONFIRM: "I-APPROVE-LIVE-SENDS" });
    expect(approved).toMatchObject({ ADAPTER_PROFILE: "live", WHATSAPP_PROVIDER: "aisensy" });
  });
});

describe("committed npm scripts are safe by default", () => {
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

  it.each([
    ["dev", "next dev"],
    ["start", "next start"],
    ["tanstack:dev", "vite dev"],
    ["tanstack:preview", "vite preview"],
  ])("npm run %s goes through the safe wrapper", (name, tool) => {
    expect(scripts[name]).toBe(`node scripts/safe-run.mjs ${tool}`);
  });

  it("no script boots next/vite servers unwrapped", () => {
    for (const [name, cmd] of Object.entries(scripts)) {
      if (/\bnext (dev|start)\b|\bvite (dev|preview)\b/.test(cmd)) {
        expect(cmd, `script "${name}"`).toMatch(/^node scripts\/safe-run\.mjs /);
      }
    }
  });

  it.each([
    ["dev", "next", ["dev"]],
    ["start", "next", ["start"]],
    ["tanstack:dev", "vite", ["dev"]],
  ])("npm run %s resolves to SAFE providers even with live credentials in the environment", (_name, tool, args) => {
    const r = run("safe-run.mjs", [tool, ...args], liveEnv);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/mode=SAFE adapters=mock whatsapp=disabled smtpSecret=blank aisensyKey=blank/);
    // and never prints a secret value
    expect(r.stdout + r.stderr).not.toContain(FAKE_SMTP);
    expect(r.stdout + r.stderr).not.toContain(FAKE_AISENSY);
  });

  it("the wrapper reports LIVE-APPROVED only with the exact confirmation, still without printing secrets", () => {
    const r = run("safe-run.mjs", ["vite", "dev"], { ...liveEnv, LIVE_COMMS_CONFIRM: "I-APPROVE-LIVE-SENDS" });
    expect(r.stdout).toContain("mode=LIVE-APPROVED");
    expect(r.stdout + r.stderr).not.toContain(FAKE_SMTP);
    expect(r.stdout + r.stderr).not.toContain(FAKE_AISENSY);
  });

  it("rejects unknown tools instead of running arbitrary commands", () => {
    expect(run("safe-run.mjs", ["rm", "-rf", "/"], liveEnv).status).toBe(2);
  });
});

describe("the explicit live launcher", () => {
  it.each([["(unset)", {}], ["wrong value", { LIVE_COMMS_CONFIRM: "yes" }]])("refuses to start with %s confirmation", (_l, extra) => {
    const r = run("uat-live-comms.mjs", ["email-only"], { ...liveEnv, ...(extra as Record<string, string>) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to start/);
  });
});

describe(".claude/launch.json", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, ".claude", "launch.json"), "utf8")) as {
    configurations: { name: string; runtimeExecutable: string; runtimeArgs: string[] }[];
  };

  it("every entry starts the app only through the mock-forcing launcher", () => {
    for (const c of cfg.configurations) {
      expect(c.runtimeExecutable, c.name).toBe("node");
      expect(c.runtimeArgs[0], c.name).toBe("scripts/uat-supabase-dev.mjs");
    }
    expect(cfg.configurations.map((c) => c.name)).not.toContain("prod-uat");
  });
});
