"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";

/** Staff marks a workflow task done ("workflow task completion"). Idempotent on retry. */
export async function resolveWorkflowTaskAction(taskId: string, reason: string, caseId?: string | null) {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().resolveWorkflowTask(taskId, reason, actor);
  if (caseId) revalidatePath(`/cases/${caseId}`);
  revalidatePath("/today");
  return result;
}
