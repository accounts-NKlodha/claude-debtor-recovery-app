/**
 * TanStack Start adapter for src/app/(client)/client/statements/page.tsx --
 * identical placeholder content. Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/statements")({
  component: () => (
    <SlicePlaceholder title="Statements / Fees" note="Recovered-amount statements and success-fee invoices." />
  ),
});
