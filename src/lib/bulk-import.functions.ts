/**
 * TanStack Start equivalent of src/app/actions/bulk-import.ts (M1 Batch
 * 3). Commit semantics are UNCHANGED (preserving the existing atomicity
 * model exactly, per instruction): commit re-validates server-side, then
 * creates one draft case per row already in result.preview (rows that
 * already passed validation -- duplicates and error rows are never
 * included and always skipped). This is a valid-rows-only commit, not a
 * whole-file all-or-nothing transaction -- each valid row's case is
 * created independently in a loop inside the reused, unmodified
 * repository method. Row-level validation (headers, dates, money,
 * duplicate detection) lives entirely in the pure domain function
 * validateImport (src/domain/bulk-import.ts, unmodified, zero Next.js
 * dependency) -- never throws for a malformed file or invalid row.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import type { ImportResult } from "@/contract/types";

export interface ValidateBulkImportState {
  result: ImportResult | null;
  error: string | null;
}

/**
 * Validates the uploaded CSV text (row-level errors + duplicate
 * detection). No persistence, but still staff-only -- this is part of the
 * protected intake surface and the CSV content is client financial data.
 */
export const validateBulkImportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { csvText: string })
  .handler(async ({ data }): Promise<ValidateBulkImportState> => {
    try {
      await authorizeStaffMutation(); // validation is read-only; authorization alone gates it.
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.validateBulkImport(data.csvText);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to validate the file" };
    }
  });

export interface CommitBulkImportState {
  result: { result: ImportResult; casesCreated: number } | null;
  error: string | null;
}

/**
 * Pure precondition checks, factored out for direct unit-testability (see
 * bulk-import.functions.test.ts) -- same reasoning as every prior guard
 * extraction on this branch: createServerFn's wrapper requires a Start
 * runtime context plain vitest doesn't provide.
 */
export function validateCommitPreconditions(
  organisationId: string,
  csvText: string,
): { ok: true } | { ok: false; error: string } {
  if (!organisationId) return { ok: false, error: "Missing organisation." };
  if (!csvText.trim()) return { ok: false, error: "No file loaded to commit." };
  return { ok: true };
}

export const commitBulkImportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { organisationId: string; csvText: string })
  .handler(async ({ data }): Promise<CommitBulkImportState> => {
    const { organisationId, csvText } = data;
    const preconditions = validateCommitPreconditions(organisationId, csvText);
    if (!preconditions.ok) return { result: null, error: preconditions.error };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.commitBulkImport(organisationId, csvText, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to commit the import" };
    }
  });
