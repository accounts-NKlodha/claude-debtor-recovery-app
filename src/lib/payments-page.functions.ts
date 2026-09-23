/**
 * TanStack Start equivalent of src/app/(internal)/payments/page.tsx's data
 * assembly (M1 Batch 4, read-only). Identical repository calls and
 * shaping -- every case is offered in the Organisation -> Case selector
 * regardless of status (the RPC itself is the real authority on whether a
 * case is valid to record against); invoice info per case is read-only
 * reference (allocation happens at confirmation, oldest-first, via the
 * existing FIFO logic in src/domain/allocation.ts -- unchanged).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import type { Organisation } from "@/contract/types";

export interface PaymentCaseOption {
  id: string;
  organisationId: string;
  debtorName: string;
  status: string;
}

export interface PaymentInvoiceOption {
  id: string;
  invoiceNumber: string;
  outstandingBalance: number;
}

export const getPaymentsPageData = createServerFn({ method: "GET" }).handler(async () => {
  const repo = await getRepo();
  const [payments, organisations, cases] = await Promise.all([
    repo.listAllPayments(),
    repo.listOrganisations(),
    repo.listAllCases(),
  ]);

  const rows = await Promise.all(
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

  const invoicesByCaseEntries = await Promise.all(
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
  );
  const invoicesByCase: Record<string, PaymentInvoiceOption[]> = Object.fromEntries(invoicesByCaseEntries);

  return {
    rows,
    organisations: organisations.map((o: Organisation) => ({ id: o.id, legalEntityName: o.legalEntityName })),
    cases: caseOptions,
    invoicesByCase,
  };
});
