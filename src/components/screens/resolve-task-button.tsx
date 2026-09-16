"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveWorkflowTaskAction, type ResolveWorkflowTaskState } from "@/app/actions/tasks";

const RESOLVE_TASK_IDLE: ResolveWorkflowTaskState = { result: null, error: null };

function MarkDoneButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" type="submit" disabled={pending}>
      <Check className="h-3.5 w-3.5" />
      {pending ? "Marking done…" : "Mark done"}
    </Button>
  );
}

export function ResolveTaskButton({ taskId, caseId }: { taskId: string; caseId?: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState<ResolveWorkflowTaskState, FormData>(
    resolveWorkflowTaskAction,
    RESOLVE_TASK_IDLE,
  );
  const lastResultRef = React.useRef<ResolveWorkflowTaskState["result"]>(null);

  React.useEffect(() => {
    if (state.result && state.result !== lastResultRef.current) {
      lastResultRef.current = state.result;
      router.refresh();
    }
  }, [state.result, router]);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="taskId" value={taskId} />
      {caseId ? <input type="hidden" name="caseId" value={caseId} /> : null}
      <MarkDoneButton />
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
