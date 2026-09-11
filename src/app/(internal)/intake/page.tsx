import { PageHeader } from "@/components/ui/page-header";
import { IntakeScreen } from "@/components/screens/intake-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Intake / OCR — Debtrecover" };

export default async function IntakePage() {
  const organisations = await getRepo().listOrganisations();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Intake & OCR"
        title="Bring invoices into the system"
        description="One at a time or by bulk CSV. An upload starts automatic preparation immediately but never activates a case — certification, staff validation and the age gate still apply."
      />
      <IntakeScreen organisations={organisations} />
    </div>
  );
}
