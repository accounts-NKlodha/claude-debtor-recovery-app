"use server";

import { getRepo } from "@/server/repo";
import type { ImportResult } from "@/contract/types";

/**
 * Server action behind the intake bulk-import dropzone. Routes through the
 * repository seam like everything else; on the in-memory profile this
 * returns the demo `ImportResult` (src/lib/mock-data.ts stubBulkImport), on
 * the Supabase profile it currently throws with a TODO pointer to
 * src/domain/bulk-import.ts validateImport() -- the real parser is already
 * written and unit-tested, it just isn't reachable from an uploaded file yet.
 */
export async function runBulkImport(fileName: string): Promise<ImportResult> {
  return getRepo().bulkImport(fileName);
}
