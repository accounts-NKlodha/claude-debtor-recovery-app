"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeStaffMutation } from "@/lib/auth/session";
import type { ImportResult } from "@/contract/types";

/* R1 residual server-action closure: both bulk-import actions previously
 * threw on any failure (missing organisation, no session), which crashes a
 * directly-invoked "use server" function's caller with an opaque React
 * production error, same class of bug already fixed elsewhere in this app.
 * Converted to the same typed safe-action-state contract (prevState,
 * FormData) -> state, always RETURNED rather than thrown.
 *
 * Row-level validation itself (headers, dates, money, duplicate detection,
 * debtor email/mobile format) already lived in the pure domain function
 * `validateImport` (src/domain/bulk-import.ts) and already returns a
 * structured ImportResult -- never throws for a malformed file, missing
 * header, or invalid row. That is unchanged; only the action-layer
 * wrapper's own failure modes (authorization, an unrecognised
 * organisation) are converted here.
 *
 * Commit semantics are UNCHANGED and are not "fixed" here (preserving the
 * existing atomicity model per the task's explicit instruction): commit
 * re-validates server-side, then creates one draft case per row in
 * `result.preview` (rows that already passed validation -- duplicates and
 * error rows are never included and are always skipped). This is a
 * "valid-rows-only" commit, not a single all-or-nothing transaction across
 * the whole file: each valid row's case is created independently in a
 * loop inside the repository method. If that loop throws partway through
 * (an unexpected failure, not a validation rejection -- every row it
 * iterates has already passed validation), rows already created before the
 * throw remain created; this was already true before this task and is
 * preserved exactly, not newly introduced or newly rolled back.
 */

export interface ValidateBulkImportState {
  result: ImportResult | null;
  error: string | null;
}

/**
 * Validates the uploaded CSV text (row-level errors + duplicate detection).
 * No persistence, but still staff-only -- this is part of the protected
 * intake surface and the CSV content is client financial data.
 */
export async function validateBulkImportAction(
  _prevState: ValidateBulkImportState,
  formData: FormData,
): Promise<ValidateBulkImportState> {
  const csvText = String(formData.get("csvText") ?? "");

  try {
    await authorizeStaffMutation(); // validation is read-only; authorization alone gates it.
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().validateBulkImport(csvText);
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to validate the file" };
  }
}

export interface CommitBulkImportState {
  result: { result: ImportResult; casesCreated: number } | null;
  error: string | null;
}

/**
 * Re-validates, then creates a draft case per valid row (PRD §7: never
 * partially activates a single row -- see the file-level note above for
 * the full commit semantics). `organisationId` is which client staff is
 * importing for -- legitimate staff cross-org capability (PRD §4), gated
 * by requiring an authenticated staff/admin actor: no other actor kind can
 * reach this action at all, so it cannot be used to redirect a mutation
 * into another tenant on a client's behalf.
 */
export async function commitBulkImportAction(
  _prevState: CommitBulkImportState,
  formData: FormData,
): Promise<CommitBulkImportState> {
  const organisationId = String(formData.get("organisationId") ?? "");
  const csvText = String(formData.get("csvText") ?? "");
  if (!organisationId) {
    return { result: null, error: "Missing organisation." };
  }
  if (!csvText.trim()) {
    return { result: null, error: "No file loaded to commit." };
  }

  let actor;
  try {
    actor = await authorizeStaffMutation();
  } catch {
    return { result: null, error: "You do not have permission to perform this action." };
  }

  try {
    const result = await getRepo().commitBulkImport(organisationId, csvText, actor);
    revalidatePath("/cases");
    revalidatePath("/today");
    return { result, error: null };
  } catch (e: unknown) {
    return { result: null, error: e instanceof Error ? e.message : "Failed to commit the import" };
  }
}
