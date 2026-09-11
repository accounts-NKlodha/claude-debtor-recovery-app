"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { createOrganisationSchema } from "@/contract/schemas";

/** Onboard a new client organisation. Validates server-side regardless of client-side checks. */
export async function createOrganisationAction(input: unknown) {
  const parsed = createOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid client details");
  }
  const result = await getRepo().createOrganisation(parsed.data);
  revalidatePath("/clients");
  revalidatePath("/intake");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return result;
}
