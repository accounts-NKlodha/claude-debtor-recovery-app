/**
 * TanStack Start equivalent of src/app/actions/manual-invoice.ts (M1 Batch
 * 3). Same semantics exactly: creates a draft case from one manually
 * entered invoice via the reused repository method -- preparation runs
 * immediately but the case still stops at certification/staff-validation/
 * age-gate before activation (unchanged activation logic, see
 * activation.functions.ts from Batch 2). Same staff-only authorization,
 * same server-side re-validation with manualInvoiceSchema regardless of
 * client checks.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { manualInvoiceSchema } from "@/contract/schemas";

export interface CreateManualInvoiceState {
  result: { caseId: string; status: string } | null;
  error: string | null;
}

export const createCaseFromManualInvoiceFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { organisationId: string } & Record<string, unknown>)
  .handler(async ({ data }): Promise<CreateManualInvoiceState> => {
    const { organisationId, ...fields } = data;
    if (!organisationId) {
      return { result: null, error: "Missing organisation." };
    }

    const parsed = manualInvoiceSchema.safeParse(fields);
    if (!parsed.success) {
      return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid invoice details" };
    }

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const created = await repo.createCaseFromManualInvoice(organisationId, parsed.data, actor);
      return { result: { caseId: created.case.id, status: created.case.status }, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to create the draft case" };
    }
  });
