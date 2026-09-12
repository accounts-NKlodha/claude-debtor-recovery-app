"use server";

import { revalidatePath } from "next/cache";
import { getRepo } from "@/server/repo";
import { createOrganisationSchema } from "@/contract/schemas";

/**
 * Demo-only capability: creating a client organisation currently has no
 * staff/admin authentication or authorization in front of it (Phase 1 --
 * see docs/PLAN.md and the audit's P0-1 finding). It must not be reachable
 * in production until that exists. This checks NODE_ENV directly rather
 * than the data-repository profile, because a production deployment could
 * still be misconfigured to point at Supabase without auth wired in front
 * of it -- fail closed on the environment, not on which repository is active.
 */
function assertDemoCapability(capability: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${capability} is a demo-only capability until Phase 1 staff/admin authentication and ` +
        "authorization exist. Not available in production.",
    );
  }
}

/** Onboard a new client organisation. Validates server-side regardless of client-side checks. */
export async function createOrganisationAction(input: unknown) {
  assertDemoCapability("Adding a client");

  const parsed = createOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid client details");
  }
  const result = await getRepo().createOrganisation(parsed.data);
  if (result.status === "created") {
    revalidatePath("/clients");
    revalidatePath("/intake");
    revalidatePath("/today");
    revalidatePath("/dashboard");
  }
  return result;
}
