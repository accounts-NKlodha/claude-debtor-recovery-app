"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { authorizeAdminMutation } from "@/lib/auth/session";

export interface AutomationSwitchState {
  enabled: boolean;
  error: string | null;
}

/**
 * Global automation kill switch. Requires a reason (PRD §5) -- audited.
 * Admin-only ("Admin owns the global kill switch", PRD §5) -- a plain staff
 * session is rejected here even though it would pass `authorizeStaffMutation`.
 *
 * Takes the `useActionState`/`<form action=...>` shape (prevState, FormData)
 * and always RETURNS its outcome rather than throwing across the client/
 * server action boundary -- final-UAT go-live task: a directly-invoked
 * "use server" function that throws (e.g. ForbiddenError for a non-admin
 * session) hits Next.js's production error-digest handling in a way that
 * crashed the client with an opaque React error instead of showing "you
 * don't have permission" -- confirmed live while UAT-testing this exact
 * control with a non-admin session. See src/app/actions/auth.ts for the
 * same fix applied to sign-in, where this was first found.
 */
export async function setAutomationStateAction(
  prevState: AutomationSwitchState,
  formData: FormData,
): Promise<AutomationSwitchState> {
  const nextEnabled = formData.get("nextEnabled") === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { enabled: prevState.enabled, error: "A reason is required before changing the global automation switch." };
  }

  let actor;
  try {
    actor = await authorizeAdminMutation();
  } catch {
    // Never disclose *why* (wrong role vs. no session) -- same principle as
    // src/app/actions/auth.ts's generic sign-in error.
    return { enabled: prevState.enabled, error: "You do not have permission to change this setting." };
  }

  const result = await getRepo().setAutomationState(nextEnabled, reason, actor);
  revalidatePath("/clients");
  revalidatePath("/audit");
  return { enabled: result.enabled, error: null };
}
