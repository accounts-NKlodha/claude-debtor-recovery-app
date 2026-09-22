/**
 * TanStack Start adapter for src/app/(client)/layout.tsx -- the server-side
 * Client-only authorization boundary for the whole client-portal surface
 * (M1 Batch 1). Every route nested under this layout (src/routes/client/*)
 * inherits this check automatically, same as the Next.js route group.
 * "client" is a real URL segment here (unlike _internal, which is pathless
 * because "internal" must never appear in the URL) -- this file is the
 * layout for /client and everything under it.
 *
 * Guard semantics preserved exactly (logic lives in
 * src/lib/auth/tanstack-client-shell.functions.ts): a staff/admin actor is
 * always redirected to /dashboard (no approved impersonation feature
 * exists); a missing session is redirected to /sign-in ONLY in production.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/tanstack/app-shell";
import { getClientShellData } from "@/lib/auth/tanstack-client-shell.functions";

export const Route = createFileRoute("/client")({
  beforeLoad: async () => {
    const result = await getClientShellData();
    if (result.kind === "redirect") {
      throw redirect({ to: result.to });
    }
    return { shell: result };
  },
  component: ClientLayout,
});

function ClientLayout() {
  const { shell } = Route.useRouteContext();
  return (
    <AppShell surface="client" organisations={shell.organisations} user={shell.user}>
      <Outlet />
    </AppShell>
  );
}
