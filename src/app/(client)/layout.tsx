import { AppShell } from "@/components/app-shell";
import { getRepo } from "@/server/repo";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const organisations = await getRepo().listOrganisations();
  return (
    <AppShell surface="client" organisations={organisations}>
      {children}
    </AppShell>
  );
}
