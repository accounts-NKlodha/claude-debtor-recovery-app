"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";

/** Global automation kill switch. Requires a reason (PRD §5) -- audited. */
export async function setAutomationStateAction(enabled: boolean, reason: string) {
  const result = await getRepo().setAutomationState(enabled, reason);
  revalidatePath("/clients");
  revalidatePath("/audit");
  return result;
}
