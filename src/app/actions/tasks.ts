"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { WorkflowTask } from "@/contract/types";

export interface ResolveWorkflowTaskState {
  result: WorkflowTask | null;
  error: string | null;
}

/**
 * Staff marks a workflow task done ("workflow task completion"). Idempotent
 * on retry.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing (authorization
 * hardening task, #10) -- same production-crash fix already applied
 * elsewhere in this surface.
 */
export async function resolveWorkflowTaskAction(
  _prevState: ResolveWorkflowTaskState,
  formData: FormData,
): Promise<ResolveWorkflowTaskState> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { result: null, error: "Missing task." };
  const caseId = String(formData.get("caseId") ?? "") || null;
  const reason = String(formData.get("reason") ?? "").trim() || "Marked done by staff";

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().resolveWorkflowTask(taskId, reason, actor);
    if (caseId) revalidatePath(`/cases/${caseId}`);
    revalidatePath("/today");
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to resolve the task" };
  }
}
