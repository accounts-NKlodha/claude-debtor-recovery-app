"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { ImportResult } from "@/contract/types";

/**
 * Validates the uploaded CSV text (row-level errors + duplicate detection).
 * No persistence, but still staff-only -- this is part of the protected
 * intake surface and the CSV content is client financial data.
 */
export async function validateBulkImportAction(csvText: string): Promise<ImportResult> {
  await authorizeStaffMutation();
  return getRepo().validateBulkImport(csvText);
}

/**
 * Re-validates, then creates a draft case per valid row (PRD §7: never
 * partially activates). `organisationId` is which client staff is importing
 * for -- legitimate staff cross-org capability (PRD §4), gated by requiring
 * an authenticated staff/admin actor: no other actor kind can reach this
 * action at all, so it cannot be used to redirect a mutation into another
 * tenant on a client's behalf.
 */
export async function commitBulkImportAction(
  organisationId: string,
  csvText: string,
): Promise<{ result: ImportResult; casesCreated: number }> {
  const actor = await authorizeStaffMutation();
  const result = await getRepo().commitBulkImport(organisationId, csvText, actor);
  revalidatePath("/cases");
  revalidatePath("/today");
  return result;
}
