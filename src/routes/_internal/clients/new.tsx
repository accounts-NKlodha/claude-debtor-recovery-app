/**
 * TanStack Start adapter for src/app/(internal)/clients/new/page.tsx.
 * Identical JSX/copy -- reuses PageHeader verbatim and the NewClientForm
 * adapter (its Next Server Action / next/navigation dependencies swapped,
 * see src/components/tanstack/new-client-form.tsx). Page-level admin check
 * preserved via beforeLoad (mirrors the Next.js page's inline redirect);
 * createOrganisationFn independently re-enforces admin-only.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { NewClientForm } from "@/components/tanstack/new-client-form";
import { getNewClientPageAccess } from "@/lib/clients.functions";

export const Route = createFileRoute("/_internal/clients/new")({
  beforeLoad: async () => {
    const { isAdmin } = await getNewClientPageAccess();
    if (!isAdmin) throw redirect({ to: "/clients" });
  },
  component: NewClientPage,
  head: () => ({ meta: [{ title: "Add client — Debtrecover" }] }),
});

function NewClientPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Clients & policy"
        title="Add a new client"
        description="Onboards the client organisation record so cases, invoices and debtors can be scoped to it."
      />
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-warning">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">Admin-only</p>
          <p className="text-xs opacity-90">
            Onboarding a new client requires an authenticated admin session in production;
            an ordinary staff session is rejected. Outside production this runs under the
            demo staff/admin fallback.
          </p>
        </div>
      </div>
      <NewClientForm />
    </div>
  );
}
