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
          <p className="text-sm font-semibold">Demo-only capability</p>
          <p className="text-xs opacity-90">
            No staff/admin authentication or authorization exists yet (Phase 1). This action is
            blocked outright in a production deployment (<code>NODE_ENV=production</code>) and must
            stay that way until Phase 1 lands.
          </p>
        </div>
      </div>
      <NewClientForm />
    </div>
  );
}
