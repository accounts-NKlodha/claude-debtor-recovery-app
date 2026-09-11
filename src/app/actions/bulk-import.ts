"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import type { ImportResult } from "@/contract/types";

/** Validates the uploaded CSV text (row-level errors + duplicate detection). No persistence. */
export async function validateBulkImportAction(csvText: string): Promise<ImportResult> {
  return getRepo().validateBulkImport(csvText);
}

/** Re-validates, then creates a draft case per valid row (PRD §7: never partially activates). */
export async function commitBulkImportAction(
  organisationId: string,
  csvText: string,
): Promise<{ result: ImportResult; casesCreated: number }> {
  const result = await getRepo().commitBulkImport(organisationId, csvText);
  revalidatePath("/cases");
  revalidatePath("/today");
  return result;
}
