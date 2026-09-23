/**
 * TanStack Start adapter for src/app/(internal)/payments/page.tsx.
 * Identical JSX -- reuses PageHeader verbatim and the PaymentsScreen
 * adapter (only its Next Server Action / next/navigation dependencies
 * swapped, see src/components/tanstack/payments-screen.tsx). Authorization
 * is enforced by the parent _internal layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/ui/page-header";
import { PaymentsScreen } from "@/components/tanstack/payments-screen";
import { getPaymentsPageData } from "@/lib/payments-page.functions";

export const Route = createFileRoute("/_internal/payments")({
  loader: () => getPaymentsPageData(),
  component: PaymentsPage,
  head: () => ({ meta: [{ title: "Replies / Payments — Debtrecover" }] }),
});

function PaymentsPage() {
  const { rows, organisations, cases, invoicesByCase } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Replies & payments"
        title="Payment receipts & confirmation"
        description="Record receipts and capture client confirmation. A confirmed receipt immediately cancels pending escalation for that case."
      />
      <PaymentsScreen rows={rows} organisations={organisations} cases={cases} invoicesByCase={invoicesByCase} />
    </div>
  );
}
