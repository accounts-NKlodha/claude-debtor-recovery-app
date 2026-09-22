/**
 * TanStack Start adapter for src/app/(internal)/layout.tsx -- the
 * server-side staff/admin authorization boundary for the whole internal
 * surface. Every route nested under this pathless layout route
 * (src/routes/_internal/*) inherits this check automatically, same as the
 * Next.js route group.
 *
 * Guard semantics preserved exactly (logic lives in
 * src/lib/auth/tanstack-shell.functions.ts):
 *   - a definitive client actor is always redirected to /client;
 *   - a missing session is redirected to /sign-in ONLY in production
 *     (outside production, the existing demo-fallback in requireStaffContext
 *     keeps the demo experience working, unchanged).
 * This does not replace RLS, which remains the real tenant-isolation
 * boundary for data.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/tanstack/app-shell";
import { getInternalShellData } from "@/lib/auth/tanstack-shell.functions";

export const Route = createFileRoute("/_internal")({
  beforeLoad: async () => {
    const result = await getInternalShellData();
    if (result.kind === "redirect") {
      throw redirect({ to: result.to });
    }
    return { shell: result };
  },
  component: InternalLayout,
});

function InternalLayout() {
  const { shell } = Route.useRouteContext();
  return (
    <AppShell surface="internal" organisations={shell.organisations} counts={shell.counts} user={shell.user}>
      <Outlet />
    </AppShell>
  );
}
