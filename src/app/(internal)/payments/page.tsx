import { PageHeader } from "@/components/ui/page-header";
import { PaymentsScreen, type PaymentRow } from "@/components/screens/payments-screen";
import { PAYMENTS, getCase, getDebtor, getOrg } from "@/lib/mock-data";

export const metadata = { title: "Replies / Payments — Debtrecover" };

// TODO(api): replace mock with server fetch.
export default function PaymentsPage() {
  const rows: PaymentRow[] = PAYMENTS.map((p) => {
    const k = getCase(p.caseId);
    return {
      ...p,
      debtorName: k ? (getDebtor(k.debtorId)?.name ?? "—") : "—",
      clientName: getOrg(p.organisationId)?.legalEntityName ?? "—",
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment receipts & confirmation"
        description="Record receipts and capture client confirmation. A confirmed receipt immediately cancels pending escalation for that case."
      />
      <PaymentsScreen rows={rows} />
    </div>
  );
}
