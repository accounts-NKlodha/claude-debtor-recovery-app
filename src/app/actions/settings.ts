"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeAdminMutation } from "@/lib/auth/session";

/**
 * Global automation kill switch. Requires a reason (PRD §5) -- audited.
 * Admin-only ("Admin owns the global kill switch", PRD §5) -- a plain staff
 * session is rejected here even though it would pass `authorizeStaffMutation`.
 */
export async function setAutomationStateAction(enabled: boolean, reason: string) {
  const actor = await authorizeAdminMutation();
  const result = await getRepo().setAutomationState(enabled, reason, actor);
  revalidatePath("/clients");
  revalidatePath("/audit");
  return result;
}
