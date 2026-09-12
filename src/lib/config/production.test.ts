/**
 * P0-4 §9: production configuration validation must fail closed and never
 * leak secret values in its error messages.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const REAL_URL = "https://abcdefghijklmno.supabase.co";
// A syntactically-valid (unsigned, made-up) JWT-shaped anon key: header.payload.signature
function fakeJwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ role })}.sig`;
}
const REAL_ANON_KEY = fakeJwt("anon");
const SERVICE_ROLE_KEY = fakeJwt("service_role");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadModule() {
  return import("./production");
}

describe("getProductionDataConfig: fails closed on missing/malformed configuration", () => {
  it("throws when both env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getProductionDataConfig, ProductionConfigError } = await loadModule();
    expect(() => getProductionDataConfig()).toThrow(ProductionConfigError);
  });

  it("throws naming the specific missing variable, without leaking the other value", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getProductionDataConfig } = await loadModule();
    try {
      getProductionDataConfig();
      throw new Error("expected to throw");
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(message).not.toContain(REAL_ANON_KEY);
    }
  });

  it("throws on a non-https URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://insecure.example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getProductionDataConfig, ProductionConfigError } = await loadModule();
    expect(() => getProductionDataConfig()).toThrow(ProductionConfigError);
  });

  it("throws on a malformed URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getProductionDataConfig, ProductionConfigError } = await loadModule();
    expect(() => getProductionDataConfig()).toThrow(ProductionConfigError);
  });

  it("throws when the anon-key slot actually holds a service-role key, and never quotes the key itself", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", SERVICE_ROLE_KEY);
    const { getProductionDataConfig, ProductionConfigError } = await loadModule();
    try {
      getProductionDataConfig();
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ProductionConfigError);
      expect((e as Error).message).not.toContain(SERVICE_ROLE_KEY);
    }
  });

  it("returns the validated config (host only, not the key) for a correct configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getProductionDataConfig } = await loadModule();
    const config = getProductionDataConfig();
    expect(config.supabaseHost).toBe("abcdefghijklmno.supabase.co");
    expect(config.supabaseUrl).toBe(REAL_URL);
  });
});
