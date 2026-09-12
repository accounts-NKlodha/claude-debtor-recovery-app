"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeAdminMutation } from "@/lib/auth/session";
import { createOrganisationSchema } from "@/contract/schemas";

/**
 * Onboard a new client organisation. Validates server-side regardless of
 * client-side checks.
 *
 * Admin-only (P0-1/P0-2-R2 role-authorization audit): the product brief
 * (docs/product-brief/index.md) scopes "Internal staff" to "Validate
 * documents, run cases, handle replies, payments, filing assistance, DD and
 * hearings" -- entirely case-operational duties on organisations that
 * already exist. Creating a brand-new tenant/billing relationship
 * (client_code, creditor GSTIN, JITO fee tier) sits under Admin's
 * "Configuration ... Full access" instead. No document states this
 * explicitly for organisation creation specifically, so this is the
 * conservative, fail-closed reading pending an explicit product decision
 * -- see the audit report for the full reasoning. Do not relax this to
 * authorizeStaffMutation without that decision.
 */
export async function createOrganisationAction(input: unknown) {
  const actor = await authorizeAdminMutation();

  const parsed = createOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid client details");
  }
  const result = await getRepo().createOrganisation(parsed.data, actor);
  if (result.status === "created") {
    revalidatePath("/clients");
    revalidatePath("/intake");
    revalidatePath("/today");
    revalidatePath("/dashboard");
  }
  return result;
}
