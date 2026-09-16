/**
 * Authorization + server-action hardening task, #1-#9/#23: proves the
 * SHARED (client) layout itself is the authorization boundary for the
 * client portal, mirroring (internal)/layout.test.tsx. A staff/admin
 * session must never silently consume the client portal (no approved
 * impersonation feature exists), and a real client session must only ever
 * be handed its own organisation(s) -- never every tenant in the system.
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
  listOrganisations: vi.fn().mockResolvedValue([{ id: "org-a" }, { id: "org-b" }, { id: "org-c" }]),
  getOrg: vi.fn(async (id: string) => ({ id })),
};
vi.mock("@/server/repo", () => ({ getRepo: () => fakeRepo }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("(client)/layout.tsx: server-side client-only authorization boundary", () => {
  it("redirects a staff actor to /dashboard before any client data is fetched -- no silent impersonation", async () => {
    getAuthContext.mockResolvedValue({
      kind: "staff",
      userId: "u1",
      role: "staff",
      email: "staff@nklodha.in",
      displayName: "Real Staff",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: ClientLayout } = await import("./layout");

    await expect(ClientLayout({ children: null })).rejects.toThrow("REDIRECT:/dashboard");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    expect(fakeRepo.getOrg).not.toHaveBeenCalled();
    expect(fakeRepo.listOrganisations).not.toHaveBeenCalled();
  });

  it("redirects an admin actor to /dashboard the same way as staff", async () => {
    getAuthContext.mockResolvedValue({
      kind: "staff",
      userId: "u2",
      role: "admin",
      email: "admin@nklodha.in",
      displayName: "Real Admin",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: ClientLayout } = await import("./layout");

    await expect(ClientLayout({ children: null })).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects an unauthenticated request to /sign-in in production, before fetching data", async () => {
    getAuthContext.mockResolvedValue(null);
    isProduction.mockReturnValue(true);
    const { default: ClientLayout } = await import("./layout");

    await expect(ClientLayout({ children: null })).rejects.toThrow("REDIRECT:/sign-in");
    expect(fakeRepo.getOrg).not.toHaveBeenCalled();
  });

  it("scopes a real client session to only their own organisation(s), never every tenant", async () => {
    getAuthContext.mockResolvedValue({
      kind: "client",
      userId: "u3",
      organisationId: "org-a",
      organisationIds: ["org-a"],
      displayName: "Real Client",
      demo: false,
    });
    isProduction.mockReturnValue(true);
    const { default: ClientLayout } = await import("./layout");

    const element = (await ClientLayout({ children: "kids" })) as unknown as {
      props: { organisations: { id: string }[]; user: { displayName: string; email: string | null; role: string } };
    };
    expect(redirectMock).not.toHaveBeenCalled();
    expect(fakeRepo.listOrganisations).not.toHaveBeenCalled();
    expect(fakeRepo.getOrg).toHaveBeenCalledWith("org-a");
    expect(element.props.organisations).toEqual([{ id: "org-a" }]);
    expect(element.props.user.displayName).toBe("Real Client");
  });

  it("does not redirect an unauthenticated request outside production (existing demo fallback, unchanged) and falls back to the full org list", async () => {
    getAuthContext.mockResolvedValue(null);
    isProduction.mockReturnValue(false);
    const { default: ClientLayout } = await import("./layout");

    const element = (await ClientLayout({ children: "kids" })) as unknown as {
      props: { organisations: { id: string }[]; user: { displayName: string } };
    };
    expect(redirectMock).not.toHaveBeenCalled();
    expect(element.props.organisations.length).toBe(3);
    expect(element.props.user.displayName).toBe("Client (demo)");
  });
});
