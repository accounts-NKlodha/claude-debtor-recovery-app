/**
 * Final-UAT go-live task: V1 authentication is Supabase email + password
 * (src/app/actions/auth.ts). Google OAuth was removed entirely -- the old
 * sign-in-only-via-Google page, /auth/google, and /auth/callback are gone.
 * These tests prove: successful sign-in redirects each role correctly,
 * invalid credentials and an unprovisioned identity both produce the same
 * generic outcome (no account-existence disclosure), sign-out actually
 * clears the session, and no code path still depends on Google OAuth.
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/types";

vi.mock("server-only", () => ({}));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
const fakeSupabase = { auth: { signInWithPassword, signOut } };

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(() => Promise.resolve(fakeSupabase)) }));

const getAuthContext = vi.fn<() => Promise<AuthContext | null>>();
vi.mock("@/lib/auth/session", () => ({ getAuthContext: (...args: unknown[]) => getAuthContext(...(args as [])) }));

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (...args: [string]) => redirect(...args) }));

afterEach(() => {
  vi.clearAllMocks();
});

const STAFF_ACTOR: AuthContext = {
  kind: "staff",
  userId: "staff-1",
  role: "staff",
  email: "staff@example.com",
  displayName: "Staff One",
  demo: false,
};
const ADMIN_ACTOR: AuthContext = {
  kind: "staff",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.com",
  displayName: "Admin One",
  demo: false,
};
const CLIENT_ACTOR: AuthContext = {
  kind: "client",
  userId: "client-1",
  organisationId: "org-1",
  organisationIds: ["org-1"],
  displayName: "Client One",
  demo: false,
};

function formData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

describe("signInAction", () => {
  it("staff: valid credentials redirect to /dashboard", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    getAuthContext.mockResolvedValue(STAFF_ACTOR);
    const { signInAction } = await import("./auth");

    await expect(signInAction({ error: null }, formData("staff@example.com", "correct-password"))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "staff@example.com", password: "correct-password" });
  });

  it("admin: valid credentials also redirect to /dashboard (same staff surface)", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    getAuthContext.mockResolvedValue(ADMIN_ACTOR);
    const { signInAction } = await import("./auth");

    await expect(signInAction({ error: null }, formData("admin@example.com", "correct-password"))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
  });

  it("client: valid credentials redirect to /client, never /dashboard", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    getAuthContext.mockResolvedValue(CLIENT_ACTOR);
    const { signInAction } = await import("./auth");

    await expect(signInAction({ error: null }, formData("client@example.com", "correct-password"))).rejects.toThrow(
      "NEXT_REDIRECT:/client",
    );
  });

  it("invalid credentials: generic error returned as state, no throw, no signOut, no redirect", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { signInAction } = await import("./auth");

    const result = await signInAction({ error: null }, formData("nobody@example.com", "wrong"));
    expect(result).toEqual({ error: "Invalid email or password." });
    expect(signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a nonexistent email produces the exact same generic error as a wrong password -- no account-existence disclosure", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const { signInAction } = await import("./auth");
    const unknownEmailResult = await signInAction({ error: null }, formData("unregistered@example.com", "whatever"));

    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    const wrongPasswordResult = await signInAction({ error: null }, formData("staff@example.com", "wrong-password"));

    expect(unknownEmailResult).toEqual(wrongPasswordResult);
    expect(unknownEmailResult.error).toBe("Invalid email or password.");
  });

  it("missing email or password: same generic error, no adapter call", async () => {
    const { signInAction } = await import("./auth");
    const result = await signInAction({ error: null }, formData("", ""));
    expect(result).toEqual({ error: "Invalid email or password." });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("Supabase-authenticated but unprovisioned identity (no app_users row): signed out and sent to the access-denied sign-in state, not into the app", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    getAuthContext.mockResolvedValue(null);
    const { signInAction } = await import("./auth");

    await expect(signInAction({ error: null }, formData("ghost@example.com", "correct-password"))).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?error=access",
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("signOutAction", () => {
  it("clears the session and redirects to /sign-in", async () => {
    const { signOutAction } = await import("./auth");
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("no functional dependency on Google OAuth", () => {
  it("no /auth/google or /auth/callback route exists", () => {
    const authDir = join(process.cwd(), "src", "app", "auth");
    expect(() => readdirSync(authDir)).toThrow(); // the whole src/app/auth directory was removed
  });

  it("no source file references signInWithOAuth", () => {
    const grepDir = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...grepDir(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const oauthMethodName = ["signIn", "WithOAuth"].join("");
    const offenders = grepDir(join(process.cwd(), "src"))
      .filter((f) => !f.endsWith(join("app", "actions", "auth.test.ts")))
      .filter((f) => readFileSync(f, "utf8").includes(oauthMethodName));
    expect(offenders).toEqual([]);
  });
});
