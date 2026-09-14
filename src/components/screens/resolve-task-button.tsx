"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveWorkflowTaskAction } from "@/app/actions/tasks";

export function ResolveTaskButton({ taskId, caseId }: { taskId: string; caseId?: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resolve = () => {
    setPending(true);
    setError(null);
    resolveWorkflowTaskAction(taskId, "Marked done by staff", caseId)
      .then(() => router.refresh())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to resolve task"))
      .finally(() => setPending(false));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={resolve} disabled={pending}>
        <Check className="h-3.5 w-3.5" />
        {pending ? "Marking done…" : "Mark done"}
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
