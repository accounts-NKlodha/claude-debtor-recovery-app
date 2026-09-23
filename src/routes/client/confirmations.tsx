/**
 * TanStack Start adapter for src/app/(client)/client/confirmations/page.tsx -- placeholder
 * shell only (client-facing copy). Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/confirmations")({
  component: () => <SlicePlaceholder title="Confirmations" note="Payments and settlements waiting for your confirmation." />,
  head: () => ({ meta: [{ title: "Confirmations — Debtrecover" }] }),
});
