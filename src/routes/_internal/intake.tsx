/**
 * TanStack Start adapter for src/app/(internal)/intake/page.tsx. Identical
 * JSX -- reuses PageHeader verbatim and the IntakeScreen adapter (only its
 * Next Server Action / manual-invoice/bulk-import dependencies swapped,
 * see src/components/tanstack/intake-screen.tsx). Authorization is
 * enforced by the parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { IntakeScreen } from "@/components/tanstack/intake-screen";
import { getIntakeData } from "@/lib/intake.functions";

export const Route = createFileRoute("/_internal/intake")({
  loader: () => getIntakeData(),
  component: IntakePage,
  head: () => ({ meta: [{ title: "Intake / OCR — Debtrecover" }] }),
});

function IntakePage() {
  const { organisations } = Route.useLoaderData();
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
