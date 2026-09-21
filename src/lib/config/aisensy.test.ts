import { afterEach, describe, expect, it } from "vitest";
import { AiSensyConfigError, getAiSensyConfig, getCampaignName, isWhatsAppCampaignConfigured } from "./aisensy";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

const CAMPAIGN_VARS = WHATSAPP_MESSAGE_KINDS.map((k) => WHATSAPP_TEMPLATES[k].campaignEnvVar);
const ENV_KEYS = ["AISENSY_API_KEY", "AISENSY_SEND_TIMEOUT_MS", ...CAMPAIGN_VARS];
const original: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) original[k] = process.env[k];

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
}

afterEach(() => setEnv(original));

describe("getAiSensyConfig (credentials + timeout)", () => {
  it("returns the API key and the default timeout", () => {
    setEnv({ AISENSY_API_KEY: "not-a-real-api-key" });
    expect(getAiSensyConfig()).toEqual({ apiKey: "not-a-real-api-key", sendTimeoutMs: 15_000 });
  });

  it("accepts a custom AISENSY_SEND_TIMEOUT_MS and rejects a non-positive-integer one", () => {
    setEnv({ AISENSY_API_KEY: "k", AISENSY_SEND_TIMEOUT_MS: "30000" });
    expect(getAiSensyConfig().sendTimeoutMs).toBe(30_000);
    setEnv({ AISENSY_API_KEY: "k", AISENSY_SEND_TIMEOUT_MS: "-5" });
    expect(() => getAiSensyConfig()).toThrow(/AISENSY_SEND_TIMEOUT_MS/);
    setEnv({ AISENSY_API_KEY: "k", AISENSY_SEND_TIMEOUT_MS: "nope" });
    expect(() => getAiSensyConfig()).toThrow(/AISENSY_SEND_TIMEOUT_MS/);
  });

  it("fails closed without an API key, and never echoes a value", () => {
    setEnv({});
    expect(() => getAiSensyConfig()).toThrow(AiSensyConfigError);
    expect(() => getAiSensyConfig()).toThrow(/AISENSY_API_KEY/);
  });
});

describe("per-message campaign configuration", () => {
  it("uses one distinct environment variable per approved message", () => {
    expect(new Set(CAMPAIGN_VARS).size).toBe(5);
    expect(WHATSAPP_TEMPLATES.initial_reminder.campaignEnvVar).toBe("AISENSY_CAMPAIGN_PAYMENT_REMINDER_INITIAL_V2");
  });

  it.each(WHATSAPP_MESSAGE_KINDS)("%s: returns the configured campaign name and fails closed (naming its variable) when unset", (kind) => {
    const envVar = WHATSAPP_TEMPLATES[kind].campaignEnvVar;
    setEnv({ [envVar]: "  Some Campaign Name  " });
    expect(getCampaignName(kind)).toBe("Some Campaign Name");
    expect(isWhatsAppCampaignConfigured(kind)).toBe(true);

    setEnv({});
    expect(isWhatsAppCampaignConfigured(kind)).toBe(false);
    expect(() => getCampaignName(kind)).toThrow(AiSensyConfigError);
    expect(() => getCampaignName(kind)).toThrow(new RegExp(envVar));
    setEnv({ [envVar]: "   " });
    expect(isWhatsAppCampaignConfigured(kind)).toBe(false);
  });

  it("an unconfigured campaign affects only its own message", () => {
    setEnv({ [WHATSAPP_TEMPLATES.initial_reminder.campaignEnvVar]: "Initial" });
    expect(isWhatsAppCampaignConfigured("initial_reminder")).toBe(true);
    expect(isWhatsAppCampaignConfigured("followup_reminder")).toBe(false);
    expect(isWhatsAppCampaignConfigured("payment_closed")).toBe(false);
  });
});
