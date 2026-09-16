/**
 * Authorization + server-action hardening task, #1-#9/#23: proves the
 * SHARED (internal) layout itself -- not any individual page -- is the
 * authorization boundary. A client actor, or (in production) no session at
 * all, must be redirected before any internal data is ever fetched; a real
 * staff/admin session must render with its actual identity, never the
 * historical hardcoded "Priya Sharma". Because every page under
 * src/app/(internal)/ shares this one layout, a new page added later
 * inherits this check automatically without its own authorization code --
 * this test is what makes that guarantee verifiable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirectMock(path) }));

const getAuthContext = vi.fn();
const isProduction = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getAuthContext: (...args: unknown[]) => getAuthContext(...args),
  isProduction: (...args: unknown[]) => isProduction(...args),
}));

const fakeRepo = {
  listOrganisations: vi.fn().mockResolvedValue([]),
  listAllCases: vi.fn().mockResolvedValue([]),
  listAllCommunications: vi.fn().mockResolvedValue([]),
  listAllPayments: vi.fn().mockResolvedValue([]),
  openTasks: vi.fn().mockResolvedValue([]),
};
vi.mock("@/server/repo", () => ({ getRepo: () => fakeRepo }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("(internal)/layout.tsx: server-side staff/admin authorization boundary", () => {
  it("redirects a client actor to /client before any internal data is fetched", async () => {
    getAuthContext.mockResolvedValue({
      kind: "client",
      userId: "u1",
      organisationId: "org-a",
      organisationIds: ["org-a"],
      displayName: "Client A",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: InternalLayout } = await import("./layout");

    await expect(InternalLayout({ children: null })).rejects.toThrow("REDIRECT:/client");
    expect(redirectMock).toHaveBeenCalledWith("/client");
    expect(fakeRepo.listAllCases).not.toHaveBeenCalled();
    expect(fakeRepo.listOrganisations).not.toHaveBeenCalled();
  });

  it("redirects an unauthenticated request to /sign-in in production, before fetching data", async () => {
    getAuthContext.mockResolvedValue(null);
    isProduction.mockReturnValue(true);
    const { default: InternalLayout } = await import("./layout");

    await expect(InternalLayout({ children: null })).rejects.toThrow("REDIRECT:/sign-in");
    expect(fakeRepo.listAllCases).not.toHaveBeenCalled();
  });

  it("does not redirect an unauthenticated request outside production (existing demo fallback, unchanged)", async () => {
    getAuthContext.mockResolvedValue(null);
    isProduction.mockReturnValue(false);
    const { default: InternalLayout } = await import("./layout");

    const element = (await InternalLayout({ children: "kids" })) as unknown as {
      props: { user: { displayName: string; email: string | null; role: string }; children: unknown };
    };
    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.props.user.displayName).toBe("Staff (demo)");
  });

  it("renders the shell for a real staff/admin session with their real identity, never a hardcoded name", async () => {
    getAuthContext.mockResolvedValue({
      kind: "staff",
      userId: "u2",
      role: "admin",
      email: "admin@nklodha.in",
      displayName: "Real Admin",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: InternalLayout } = await import("./layout");

    const element = (await InternalLayout({ children: "kids" })) as unknown as {
      props: { user: { displayName: string; email: string | null; role: string }; children: unknown };
    };
    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.props.user).toEqual({ displayName: "Real Admin", email: "admin@nklodha.in", role: "admin" });
    expect(element.props.user.displayName).not.toBe("Priya Sharma");
    expect(element.props.children).toBe("kids");
  });

  it("never redirects a legitimate staff session, in production or otherwise", async () => {
    getAuthContext.mockResolvedValue({
      kind: "staff",
      userId: "u3",
      role: "staff",
      email: "staff@nklodha.in",
      displayName: "Real Staff",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: InternalLayout } = await import("./layout");

    await InternalLayout({ children: "kids" });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
