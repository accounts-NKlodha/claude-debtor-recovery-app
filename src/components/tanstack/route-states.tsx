import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";

/** Router-wide error boundary. Never shows the raw error (it may carry
 * server detail); retry just re-runs the loaders -- no mutation is replayed. */
export function RouteErrorState({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="py-10">
      <ErrorState
        reset={() => {
          reset();
          void router.invalidate();
        }}
      />
    </div>
  );
}

export function RouteNotFound() {
  return (
    <div className="py-10">
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="This case or page doesn't exist, or it may have been moved. Check the link, or go back to the dashboard."
        action={
          <Link
            to="/dashboard"
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}

/** Shown only when a loader takes longer than the router's pending delay. */
export function RoutePending() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 border-b border-border pb-5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
