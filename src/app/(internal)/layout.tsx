import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const organisations = await getRepo().listOrganisations();
  return (
    <AppShell surface="internal" organisations={organisations}>
      {children}
    </AppShell>
  );
}
