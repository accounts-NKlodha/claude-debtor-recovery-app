/**
 * TanStack Start adapter for src/app/(client)/client/statements/page.tsx -- placeholder
 * shell only (client-facing copy). Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/statements")({
  component: () => <SlicePlaceholder title="Statements / Fees" note="Statements of recovered amounts and success-fee invoices." />,
  head: () => ({ meta: [{ title: "Statements / Fees — Debtrecover" }] }),
});
