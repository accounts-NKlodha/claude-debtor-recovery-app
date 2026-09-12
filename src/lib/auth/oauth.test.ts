import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, safeNext } from "./oauth";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: vi.fn() }));
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { GET } from "@/app/auth/callback/route";
import { POST } from "@/app/auth/google/route";
import { getProductionDataConfig } from "@/lib/config/production";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
function configure() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://debtor.nklodha.in");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_test");
}
function mockClient() {
  const auth = { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://example.supabase.co/auth/v1/authorize" }, error: null }) };
  vi.mocked(createClient).mockResolvedValue({ auth } as unknown as Awaited<ReturnType<typeof createClient>>);
  return auth;
}
describe("OAuth boundary", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/auth/callback", "/sign-in"])("rejects unsafe destination %s", (url) => {
    expect(safeNext(url)).toBe("/dashboard");
  });
  it("retains a local case path", () => expect(safeNext("/cases/123?q=1")).toBe("/cases/123?q=1"));
  it("requires secure configured origin in production", () => {
    configure(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(() => appOrigin()).toThrow();
  });
  it("rejects a new-format secret key in the public slot", () => {
    configure(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_secret_do_not_expose");
    expect(() => getProductionDataConfig()).toThrow("service-role");
  });
  it("rejects cross-origin sign-in before calling Supabase", async () => {
    configure(); mockClient();
    const response = await POST(new Request("https://debtor.nklodha.in/auth/google", { method: "POST", headers: { origin: "https://evil.test" } }));
    expect(response.status).toBe(403); expect(createClient).not.toHaveBeenCalled();
  });
  it("starts PKCE sign-in with the configured callback", async () => {
    configure(); const auth = mockClient();
    const response = await POST(new Request("https://debtor.nklodha.in/auth/google", { method: "POST", headers: { origin: "https://debtor.nklodha.in" } }));
    expect(response.status).toBe(303);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://debtor.nklodha.in/auth/callback" } });
  });
  it("does not exchange a missing or provider-rejected code", async () => {
    configure(); mockClient();
    await GET(new Request("https://debtor.nklodha.in/auth/callback?error=denied&code=abc"));
    expect(createClient).not.toHaveBeenCalled();
  });
  it("signs out a valid Google identity without app access", async () => {
    configure(); const auth = mockClient(); vi.mocked(getAuthContext).mockResolvedValue(null);
    const response = await GET(new Request("https://debtor.nklodha.in/auth/callback?code=abc"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe("https://debtor.nklodha.in/sign-in?error=access");
  });
  it("ignores hostile host headers and external next for staff", async () => {
    configure(); mockClient();
    vi.mocked(getAuthContext).mockResolvedValue({ kind: "staff", role: "staff", userId: "a", email: null, displayName: "A", demo: false });
    const response = await GET(new Request("https://evil.test/auth/callback?code=abc&next=//evil.test", { headers: { "x-forwarded-host": "evil.test" } }));
    expect(response.headers.get("location")).toBe("https://debtor.nklodha.in/dashboard");
  });
  it("lands client accounts in the client portal", async () => {
    configure(); mockClient();
    vi.mocked(getAuthContext).mockResolvedValue({ kind: "client", userId: "c", organisationId: "o", organisationIds: ["o"], displayName: "C", demo: false });
    const response = await GET(new Request("https://debtor.nklodha.in/auth/callback?code=abc&next=/dashboard"));
    expect(response.headers.get("location")).toBe("https://debtor.nklodha.in/client");
  });
  it("does not return sensitive provider error details", async () => {
    configure(); const auth = mockClient(); auth.exchangeCodeForSession.mockRejectedValue(new Error("secret-provider-detail"));
    const response = await GET(new Request("https://debtor.nklodha.in/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBe("https://debtor.nklodha.in/sign-in?error=oauth");
  });
});
