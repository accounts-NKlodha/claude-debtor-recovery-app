"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeAdminMutation } from "@/lib/auth/session";
import { createOrganisationSchema } from "@/contract/schemas";
import type { CreateOrganisationResult } from "@/server/repository";

export interface CreateOrganisationState {
  result: CreateOrganisationResult | null;
  error: string | null;
}

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
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing (authorization
 * hardening task, #15) -- a plain staff session that somehow reaches this
 * action (the page itself already redirects a non-admin away, see
 * src/app/(internal)/clients/new/page.tsx) gets a clean, controlled
 * "you do not have permission" result instead of an opaque crash, and a
 * validation/business-rule rejection (duplicate client code, duplicate
 * GSTIN) never leaves the form in a broken state. The name-collision
 * two-step warning (`confirmDuplicateName` + `duplicateOverrideReason`) is
 * unchanged -- it is carried in the returned `result` exactly as before.
 */
export async function createOrganisationAction(
  _prevState: CreateOrganisationState,
  formData: FormData,
): Promise<CreateOrganisationState> {
  const parsed = createOrganisationSchema.safeParse({
    clientCode: formData.get("clientCode"),
    legalEntityName: formData.get("legalEntityName"),
    creditorGstin: formData.get("creditorGstin"),
    udyamNumber: formData.get("udyamNumber"),
    jitoMember: formData.get("jitoMember") === "true",
    confirmDuplicateName: formData.get("confirmDuplicateName") === "true",
    duplicateOverrideReason: formData.get("duplicateOverrideReason"),
  });
  if (!parsed.success) {
    return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid client details" };
  }

  let actor;
  try {
    actor = await authorizeAdminMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().createOrganisation(parsed.data, actor);
    if (result.status === "created") {
      revalidatePath("/clients");
      revalidatePath("/intake");
      revalidatePath("/today");
      revalidatePath("/dashboard");
    }
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to add the client" };
  }
}
