"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";

/** Staff prepares the DD task for MSEFC filing. The DD itself stays physical/manual. */
export async function prepareDdTaskAction(caseId: string) {
  const result = await getRepo().prepareDdTask(caseId);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}

/** Records a hearing date and creates the calendar reminder. */
export async function scheduleHearingAction(caseId: string, startsAtIso: string) {
  const result = await getRepo().scheduleHearing(caseId, startsAtIso);
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/msme");
  revalidatePath("/today");
  return result;
}
