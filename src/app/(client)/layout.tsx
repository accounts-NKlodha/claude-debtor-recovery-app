import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";

/** Audit P0-3: force dynamic, uncached rendering -- see (internal)/layout.tsx. */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const organisations = await getRepo().listOrganisations();
  return (
    <AppShell surface="client" organisations={organisations}>
      {children}
    </AppShell>
  );
}
