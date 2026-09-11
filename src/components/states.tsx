"use client";

import { Ban, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export function AccessDenied({ detail }: { detail?: string }) {
  return (
    <EmptyState
      icon={<Ban />}
      title="You do not have access to this view"
      description={
        detail ??
        "Your role or organisation membership does not permit this screen. Ask an administrator if you believe this is wrong."
      }
    />
  );
}

export function ErrorState({ reset }: { reset?: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Something went wrong loading this view"
      description="The data could not be loaded. This is safe to retry — no workflow action was taken."
      action={reset ? <Button onClick={reset}>Retry</Button> : undefined}
    />
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
