/**
 * TanStack Start adapter for
 * src/app/(client)/client/confirmations/page.tsx -- identical placeholder
 * content. Authorization is enforced by the parent client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/confirmations")({
  component: () => (
    <SlicePlaceholder
      title="Confirmations"
      note="Outstanding payment and settlement confirmations for the client to action."
    />
  ),
});
