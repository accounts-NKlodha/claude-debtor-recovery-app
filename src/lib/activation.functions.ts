/**
 * TanStack Start equivalent of src/app/actions/activation.ts (M1 Batch 2).
 * Same gates exactly: client certification, staff validation (both
 * staff-recorded with a mandatory reason); the 60-day age gate is derived,
 * never recordable. Fail-closed authorization and audit behavior are both
 * enforced by the reused repository method (recordActivationGate),
 * unmodified.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";

export interface RecordActivationGateState {
  result: { status: string; activated: boolean; missing: string[] } | null;
  error: string | null;
}

/**
 * Pure input validation, factored out for direct unit-testability (see
 * activation.functions.test.ts).
 */
export function validateActivationGateInput(
  caseId: string,
  gate: string,
  reason: string,
): { ok: true; gate: "client_certification" | "staff_validation"; reason: string } | { ok: false; error: string } {
  if (!caseId) return { ok: false, error: "Missing case." };
  const trimmedGate = gate.trim();
  if (trimmedGate !== "client_certification" && trimmedGate !== "staff_validation") {
    return { ok: false, error: "Unknown activation gate." };
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A reason is required (who certified / validated, and how)." };
  return { ok: true, gate: trimmedGate, reason: trimmedReason };
}

export const recordActivationGateFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; gate: string; reason: string })
  .handler(async ({ data }): Promise<RecordActivationGateState> => {
    const validated = validateActivationGateInput(data.caseId, data.gate, data.reason);
    if (!validated.ok) return { result: null, error: validated.error };
    const { caseId, gate, reason: trimmedReason } = { caseId: data.caseId, ...validated };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const out = await repo.recordActivationGate(caseId, gate, trimmedReason, actor);
      return { result: { status: out.case.status, activated: out.activated, missing: out.gates.missing }, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to record the activation gate" };
    }
  });
