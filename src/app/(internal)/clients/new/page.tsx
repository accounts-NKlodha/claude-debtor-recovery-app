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
      <NewClientForm />
    </div>
  );
}
