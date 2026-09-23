import { Clock } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

/** Visual shell for client-portal screens that are not built yet. */
export function SlicePlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={note} />
      <EmptyState
        icon={<Clock />}
        title="Not available yet"
        description="This part of the client portal is still being prepared. Your recovery team can share this information with you directly in the meantime."
      />
    </div>
  );
}
