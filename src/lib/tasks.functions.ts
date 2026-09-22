/**
 * TanStack Start equivalent of src/app/actions/tasks.ts (M1 Batch 2).
 * Staff marks a workflow task done; idempotent on retry (enforced by the
 * reused repository method).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import type { WorkflowTask } from "@/contract/types";

export interface ResolveWorkflowTaskState {
  result: WorkflowTask | null;
  error: string | null;
}

export const resolveWorkflowTaskFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { taskId: string; caseId?: string | null; reason?: string })
  .handler(async ({ data }): Promise<ResolveWorkflowTaskState> => {
    if (!data.taskId) return { result: null, error: "Missing task." };
    const reason = (data.reason ?? "").trim() || "Marked done by staff";

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.resolveWorkflowTask(data.taskId, reason, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to resolve the task" };
    }
  });
