/**
 * TanStack Start adapter for src/app/(client)/client/cases/page.tsx --
 * identical placeholder content. Authorization is enforced by the parent
 * client layout route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SlicePlaceholder } from "@/components/ui/slice-placeholder";

export const Route = createFileRoute("/client/cases")({
  component: () => <SlicePlaceholder title="Cases" note="Client-safe case list with stage labels only." />,
});
