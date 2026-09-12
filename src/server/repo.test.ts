/**
 * P0-4 §2/§9: the production data-mode invariant --
 * production either uses a correctly configured SupabaseRepository or
 * refuses (throws); it can never select MemoryRepository, whether by
 * missing configuration, an explicit DATA_PROFILE override, or any other
 * path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// SupabaseRepository's constructor calls createClient() (real impl touches
// next/headers cookies(), unavailable outside a request in Vitest) -- these
// tests only assert *which class* getRepo() instantiates, never call a
// repository method, so a resolved stub is enough to avoid an unhandled
// promise rejection from the untouched clientPromise.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}) }));

const REAL_URL = "https://abcdefghijklmno.supabase.co";
function fakeJwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ role })}.sig`;
}
const REAL_ANON_KEY = fakeJwt("anon");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadModule() {
  return import("./repo");
}

describe("getRepo(): production data-mode invariant", () => {
  it("throws (fails closed) in production with no Supabase configuration -- does not fall back to memory", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getRepo } = await loadModule();
    expect(() => getRepo()).toThrow(/Production data layer misconfigured/);
  });

  it("an explicit DATA_PROFILE=memory override is ignored in production -- still fails closed rather than returning MemoryRepository", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATA_PROFILE", "memory");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getRepo } = await loadModule();
    expect(() => getRepo()).toThrow(/Production data layer misconfigured/);
  });

  it("returns a SupabaseRepository instance in production when correctly configured -- never MemoryRepository", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getRepo } = await loadModule();
    const { SupabaseRepository } = await import("./repositories/supabase");
    const { MemoryRepository } = await import("./repositories/memory");
    const repo = getRepo();
    expect(repo).toBeInstanceOf(SupabaseRepository);
    expect(repo).not.toBeInstanceOf(MemoryRepository);
  });

  it("even with DATA_PROFILE=memory set, production still returns SupabaseRepository once correctly configured (production ignores the override entirely, not just when it would fail)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATA_PROFILE", "memory");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getRepo } = await loadModule();
    const { SupabaseRepository } = await import("./repositories/supabase");
    expect(getRepo()).toBeInstanceOf(SupabaseRepository);
  });

  it("outside production, no Supabase config resolves to MemoryRepository (intentional demo behaviour, unchanged)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATA_PROFILE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { getRepo } = await loadModule();
    const { MemoryRepository } = await import("./repositories/memory");
    expect(getRepo()).toBeInstanceOf(MemoryRepository);
  });

  it("outside production, DATA_PROFILE=supabase forces SupabaseRepository even without full config (existing smoke-test escape hatch, unchanged)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATA_PROFILE", "supabase");
    const { getRepo } = await loadModule();
    const { SupabaseRepository } = await import("./repositories/supabase");
    expect(getRepo()).toBeInstanceOf(SupabaseRepository);
  });
});

describe("resolveRepoMode(): pure, side-effect-free mode resolution", () => {
  it("is always \"supabase\" in production, regardless of DATA_PROFILE", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATA_PROFILE", "memory");
    const { resolveRepoMode } = await loadModule();
    expect(resolveRepoMode()).toBe("supabase");
  });

  it("outside production, prefers an explicit DATA_PROFILE over auto-detection", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATA_PROFILE", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { resolveRepoMode } = await loadModule();
    expect(resolveRepoMode()).toBe("supabase");
  });

  it("outside production with no override, auto-detects from Supabase env presence", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATA_PROFILE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { resolveRepoMode } = await loadModule();
    expect(resolveRepoMode()).toBe("supabase");
  });
});

describe("getRepo(): does not leak secrets when it fails closed", () => {
  it("the thrown error in production never contains the (even if partially set) anon key value", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-valid-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", REAL_ANON_KEY);
    const { getRepo } = await loadModule();
    try {
      getRepo();
      throw new Error("expected to throw");
    } catch (e) {
      expect((e as Error).message).not.toContain(REAL_ANON_KEY);
    }
  });
});
