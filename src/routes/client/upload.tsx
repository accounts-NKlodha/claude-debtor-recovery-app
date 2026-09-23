/**
 * TanStack Start adapter for src/app/(client)/client/upload/page.tsx -- placeholder
 * shell only (client-facing copy). Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/upload")({
  component: () => <SlicePlaceholder title="Upload" note="Upload invoices and ledgers for recovery." />,
  head: () => ({ meta: [{ title: "Upload — Debtrecover" }] }),
});
