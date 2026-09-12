import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { NewClientForm } from "@/components/screens/new-client-form";

export const metadata = { title: "Add client — Debtrecover" };

export default function NewClientPage() {
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
