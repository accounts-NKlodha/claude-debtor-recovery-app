import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/dashboard" }),
  useNavigate: () => navigate,
}));

const signOutFn = vi.fn();
vi.mock("@/lib/auth/tanstack-actions", () => ({ signOutFn: () => signOutFn() }));

// jsdom has no matchMedia; the theme toggle is irrelevant here.
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));

import { AppShell } from "./app-shell";

afterEach(() => vi.clearAllMocks());

function renderShell() {
  return render(
    <AppShell
      surface="internal"
      organisations={[]}
      user={{ displayName: "Priya Sharma", email: "priya@example.com", role: "staff" }}
    >
      <p>page</p>
    </AppShell>,
  );
}

async function clickSignOut() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Account menu for Priya Sharma" }));
  await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
}

describe("AppShell header search", () => {
  it("submits the query to the cases list filter", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByRole("searchbox", { name: "Search cases" }), "  Kaveri {Enter}");
    expect(navigate).toHaveBeenCalledWith({ to: "/cases", search: { q: "Kaveri" } });
  });

  it("clears the filter on an empty search", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByRole("searchbox", { name: "Search cases" }), "{Enter}");
    expect(navigate).toHaveBeenCalledWith({ to: "/cases", search: {} });
  });
});

describe("AppShell client surface", () => {
  it("has no search box and links only built client pages", () => {
    render(
      <AppShell surface="client" organisations={[]} user={{ displayName: "Client A", email: null, role: "client" }}>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/client/cases");
    for (const deferred of ["/client/upload", "/client/confirmations", "/client/statements"]) {
      expect(hrefs).not.toContain(deferred);
    }
  });
});

describe("AppShell sign-out", () => {
  it("shows a visible error and stays on the page when sign-out fails", async () => {
    signOutFn.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));
    renderShell();

    await clickSignOut();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign-out could not be completed");
    expect(alert).not.toHaveTextContent("NEXT_PUBLIC_SUPABASE_URL");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeEnabled();
  });

  it("navigates to /sign-in when sign-out succeeds, with no error shown", async () => {
    signOutFn.mockResolvedValue({ ok: true });
    renderShell();

    await clickSignOut();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/sign-in", search: { error: undefined } }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
