import { PageHeader } from "@/components/ui/page-header";
import { IntakeScreen } from "@/components/screens/intake-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Intake / OCR — Debtrecover" };

export default async function IntakePage() {
  const organisations = await getRepo().listOrganisations();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Intake / OCR"
        description="Compose reminders and bring invoices into the system — one at a time or by bulk CSV. Uploads create draft cases; they do not activate recovery."
      />
      <IntakeScreen organisations={organisations} />
    </div>
  );
}
