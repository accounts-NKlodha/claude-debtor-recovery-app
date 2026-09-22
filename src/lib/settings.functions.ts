/**
 * TanStack Start equivalent of src/app/actions/settings.ts (M1 Batch 1).
 * Same semantics exactly: admin-only global automation kill switch,
 * requires a reason, audited. Never throws across the RPC boundary -- always
 * returns its outcome (same convention established by tanstack-actions.ts's
 * signInFn, for the same reason: a thrown error crosses the client/server
 * boundary as an opaque failure instead of a clean, typed result).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeAdminMutation } from "@/lib/auth/tanstack-session";

export interface AutomationSwitchState {
  enabled: boolean;
  error: string | null;
}

export const setAutomationStateFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { nextEnabled: boolean; reason: string; currentEnabled: boolean })
  .handler(async ({ data }): Promise<AutomationSwitchState> => {
    const reason = data.reason.trim();
    if (!reason) {
      return { enabled: data.currentEnabled, error: "A reason is required before changing the global automation switch." };
    }

    let actor;
    try {
      actor = await authorizeAdminMutation();
    } catch {
      return { enabled: data.currentEnabled, error: "You do not have permission to change this setting." };
    }

    const repo = await getRepo();
    const result = await repo.setAutomationState(data.nextEnabled, reason, actor);
    return { enabled: result.enabled, error: null };
  });
