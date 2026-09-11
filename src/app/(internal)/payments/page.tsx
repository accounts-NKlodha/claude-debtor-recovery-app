import { PageHeader } from "@/components/ui/page-header";
import { PaymentsScreen, type PaymentRow } from "@/components/screens/payments-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Replies / Payments — Debtrecover" };

// TODO(api): scope to the signed-in staff member's org access once auth lands.
export default async function PaymentsPage() {
  const repo = getRepo();
  const payments = await repo.listAllPayments();
  const rows: PaymentRow[] = await Promise.all(
    payments.map(async (p) => {
      const kase = await repo.getCase(p.caseId);
      const [debtor, org] = await Promise.all([
        kase ? repo.getDebtor(kase.debtorId) : Promise.resolve(undefined),
        repo.getOrg(p.organisationId),
      ]);
      return {
        ...p,
        debtorName: debtor?.name ?? "—",
        clientName: org?.legalEntityName ?? "—",
      };
    }),
  );

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
