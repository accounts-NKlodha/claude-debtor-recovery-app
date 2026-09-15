import { PageHeader } from "@/components/ui/page-header";
import { PaymentsScreen, type PaymentRow, type PaymentCaseOption, type PaymentInvoiceOption } from "@/components/screens/payments-screen";
import { getRepo } from "@/server/repo";

export const metadata = { title: "Replies / Payments — Debtrecover" };

// TODO(api): scope to the signed-in staff member's org access once auth lands.
export default async function PaymentsPage() {
  const repo = getRepo();
  const [payments, organisations, cases] = await Promise.all([
    repo.listAllPayments(),
    repo.listOrganisations(),
    repo.listAllCases(),
  ]);

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

  // Case options for the Organisation -> Case selector (core-workflow
  // remediation task -- replaces the old hardcoded "case-1" fallback,
  // which silently targeted a demo-only id whenever no receipts already
  // existed to infer a case from). Every case is offered regardless of
  // status -- a payment can legitimately arrive for a case in any
  // non-terminal state, and the RPC itself is the real authority on
  // whether a given case is valid to record against.
  const caseOptions: PaymentCaseOption[] = await Promise.all(
    cases.map(async (c) => {
      const debtor = await repo.getDebtor(c.debtorId);
      return {
        id: c.id,
        organisationId: c.organisationId,
        debtorName: debtor?.name ?? "—",
        status: c.status,
      };
    }),
  );

  // Read-only invoice context per case, shown once a case is selected --
  // informational only (payment_records has no invoice_id; allocation
  // across invoices happens later, at confirmation, via the existing FIFO
  // logic in src/domain/allocation.ts -- this UI does not invent a second
  // allocation model).
  const invoicesByCase: Record<string, PaymentInvoiceOption[]> = Object.fromEntries(
    await Promise.all(
      cases.map(async (c) => {
        const invoices = await repo.listInvoicesForCase(c.id);
        return [
          c.id,
          invoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            outstandingBalance: inv.outstandingBalance,
          })),
        ] as const;
      }),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Replies & payments"
        title="Payment receipts & confirmation"
        description="Record receipts and capture client confirmation. A confirmed receipt immediately cancels pending escalation for that case."
      />
      <PaymentsScreen
        rows={rows}
        organisations={organisations.map((o) => ({ id: o.id, legalEntityName: o.legalEntityName }))}
        cases={caseOptions}
        invoicesByCase={invoicesByCase}
      />
    </div>
  );
}
