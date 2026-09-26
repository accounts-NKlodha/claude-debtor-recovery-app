import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getAdapters / isLiveWhatsAppConfigured -- WhatsApp production safety switch", () => {
  it("defaults to the mock WhatsApp adapter when WHATSAPP_PROVIDER is unset, even in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "");
    vi.resetModules();
    const { getAdapters, isLiveWhatsAppConfigured } = await import("./index");
    expect(isLiveWhatsAppConfigured()).toBe(false);
    expect(getAdapters().whatsapp.name).toBe("mock-whatsapp");
  });

  it("stays mocked when WHATSAPP_PROVIDER is set to anything other than 'aisensy'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "disabled");
    vi.resetModules();
    const { getAdapters, isLiveWhatsAppConfigured } = await import("./index");
    expect(isLiveWhatsAppConfigured()).toBe(false);
    expect(getAdapters().whatsapp.name).toBe("mock-whatsapp");
  });

  it("uses the real AiSensy adapter only when WHATSAPP_PROVIDER=aisensy is explicitly set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "aisensy");
    vi.resetModules();
    const { getAdapters, isLiveWhatsAppConfigured } = await import("./index");
    expect(isLiveWhatsAppConfigured()).toBe(true);
    expect(getAdapters().whatsapp.name).toBe("aisensy");
  });

  it("WHATSAPP_PROVIDER=aisensy works identically outside production too (not an environment-mode switch)", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "aisensy");
    vi.resetModules();
    const { getAdapters, isLiveWhatsAppConfigured } = await import("./index");
    expect(isLiveWhatsAppConfigured()).toBe(true);
    expect(getAdapters().whatsapp.name).toBe("aisensy");
  });

  it("email's own production switch is unaffected by WHATSAPP_PROVIDER (independent gates)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHATSAPP_PROVIDER", "disabled");
    vi.stubEnv("EMAIL_PROVIDER", "gmail-smtp");
    vi.resetModules();
    const { getAdapters } = await import("./index");
    expect(getAdapters().email.name).toBe("gmail-smtp");
  });
});

describe("EMAIL_PROVIDER -- explicit real-email provider selection", () => {
  const load = async (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return (await import("./index")).getAdapters().email;
  };
  const sendOnce = (a: { send: (i: never) => Promise<{ outcome: string; errorCode: string | null }> }) =>
    a.send({ idempotencyKey: "k", caseId: "c", channel: "email", to: "d@example.com", body: "b" } as never);

  it("production + EMAIL_PROVIDER=gmail-api uses the Gmail API adapter", async () => {
    expect((await load({ NODE_ENV: "production", EMAIL_PROVIDER: "gmail-api" })).name).toBe("gmail-api");
  });

  it("production + EMAIL_PROVIDER=gmail-smtp uses SMTP (self-hosted Node)", async () => {
    expect((await load({ NODE_ENV: "production", EMAIL_PROVIDER: "gmail-smtp" })).name).toBe("gmail-smtp");
  });

  it("production with EMAIL_PROVIDER unset FAILS CLOSED: no SMTP guess from credentials, no mock", async () => {
    const a = await load({ NODE_ENV: "production", EMAIL_PROVIDER: "", SMTP_APP_PASSWORD: "abcdefghijklmnop", SMTP_USER: "u@example.com" });
    expect(a.name).toBe("email-misconfigured");
    expect(await sendOnce(a as never)).toMatchObject({ outcome: "permanent_failure", errorCode: "EMAIL_PROVIDER_NOT_SET" });
  });

  it("an unknown provider value fails closed", async () => {
    const a = await load({ NODE_ENV: "production", EMAIL_PROVIDER: "sendgrid" });
    expect(await sendOnce(a as never)).toMatchObject({ outcome: "permanent_failure", errorCode: "EMAIL_PROVIDER_UNKNOWN" });
  });

  it("SMTP is refused on a Cloudflare Worker even if selected", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    try {
      const a = await load({ NODE_ENV: "production", EMAIL_PROVIDER: "gmail-smtp" });
      expect(await sendOnce(a as never)).toMatchObject({ outcome: "permanent_failure", errorCode: "EMAIL_SMTP_NOT_SUPPORTED_ON_WORKERS" });
      // ...while the Gmail API adapter is still allowed there
      expect((await load({ NODE_ENV: "production", EMAIL_PROVIDER: "gmail-api" })).name).toBe("gmail-api");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("outside production, real email needs ADAPTER_PROFILE=live too: default is the mock whatever EMAIL_PROVIDER says", async () => {
    expect((await load({ NODE_ENV: "development", EMAIL_PROVIDER: "gmail-api" })).name).toBe("mock-gmail");
    expect((await load({ NODE_ENV: "development", EMAIL_PROVIDER: "gmail-api", ADAPTER_PROFILE: "live" })).name).toBe("gmail-api");
  });
});
