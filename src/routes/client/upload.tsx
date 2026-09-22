/**
 * TanStack Start adapter for src/app/(client)/client/upload/page.tsx --
 * identical placeholder content. Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/upload")({
  component: () => (
    <SlicePlaceholder title="Upload" note="Client invoice and ledger upload with certification checkbox." />
  ),
});
