import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export function SlicePlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <EmptyState
        title="Not built in this UI slice"
        description={`${note} TODO(api): design and wire this screen.`}
      />
    </div>
  );
}
