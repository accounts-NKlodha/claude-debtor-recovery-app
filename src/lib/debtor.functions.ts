/**
 * TanStack Start equivalent of src/app/actions/debtor.ts (M1 Batch 2).
 * Staff/admin-only debtor contact correction; same validation, same
 * generic denial message (never discloses wrong-role vs no-session).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { debtorContactSchema } from "@/contract/schemas";

export interface UpdateDebtorContactState {
  debtor: { email: string | null; mobile: string | null } | null;
  error: string | null;
}

export const updateDebtorContactFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { debtorId: string; caseId?: string; reason?: string; email: unknown; mobile: unknown })
  .handler(async ({ data }): Promise<UpdateDebtorContactState> => {
    const debtorId = data.debtorId;
    const caseId = data.caseId ?? "";
    const reason = (data.reason ?? "").trim() || "Staff-corrected debtor contact details";

    const parsed = debtorContactSchema.safeParse({ email: data.email, mobile: data.mobile });
    if (!parsed.success) {
      return { debtor: null, error: parsed.error.issues[0]?.message ?? "Invalid contact details" };
    }

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { debtor: null, error: "You do not have permission to change this debtor's contact details." };
    }

    try {
      const repo = await getRepo();
      const debtor = await repo.updateDebtorContact(debtorId, parsed.data, reason, actor);
      void caseId;
      return { debtor: { email: debtor.email, mobile: debtor.mobile }, error: null };
    } catch (e: unknown) {
      return { debtor: null, error: e instanceof Error ? e.message : "Failed to update contact details" };
    }
  });
