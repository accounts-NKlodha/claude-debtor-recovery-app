/**
 * TanStack Start adapter for
 * src/components/screens/resolve-task-button.tsx -- identical UX/copy;
 * useActionState/<form action> -> local state + resolveWorkflowTaskFn,
 * next/navigation's router.refresh() -> TanStack Router's
 * router.invalidate({ sync: true }).
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveWorkflowTaskFn, type ResolveWorkflowTaskState } from "@/lib/tasks.functions";

const RESOLVE_TASK_IDLE: ResolveWorkflowTaskState = { result: null, error: null };

export function ResolveTaskButton({ taskId, caseId }: { taskId: string; caseId?: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<ResolveWorkflowTaskState>(RESOLVE_TASK_IDLE);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await resolveWorkflowTaskFn({ data: { taskId, caseId } });
      setState(result);
      if (result.result) await router.invalidate({ sync: true });
    } catch {
      setState({ result: null, error: "Failed to resolve the task" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        <Check className="h-3.5 w-3.5" />
        {pending ? "Marking done…" : "Mark done"}
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
