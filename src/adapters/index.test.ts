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
    vi.resetModules();
    const { getAdapters } = await import("./index");
    expect(getAdapters().email.name).toBe("gmail-smtp");
  });
});
