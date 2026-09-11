import { ListSkeleton } from "@/components/states";

export default function InternalLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <ListSkeleton />
    </div>
  );
}
