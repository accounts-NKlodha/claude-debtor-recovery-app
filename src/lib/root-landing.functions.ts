/**
 * TanStack Start equivalent of src/app/page.tsx's role-aware landing
 * redirect (M1 Batch 1). Supersedes the M0 boot-test placeholder that
 * previously lived at src/routes/index.tsx (accepted as PASS and no longer
 * needed once real routes exist to prove the toolchain against).
 */
import { createServerFn } from "@tanstack/react-start";
import { getAuthContext, isProduction } from "@/lib/auth/tanstack-session";

/** Pure, directly unit-testable (see root-landing.guard.test.ts). */
export function decideLandingRedirect(
  actor: Awaited<ReturnType<typeof getAuthContext>>,
  isProd: boolean,
): "/dashboard" | "/client" | "/sign-in" {
  if (!actor) return isProd ? "/sign-in" : "/dashboard";
  return actor.kind === "client" ? "/client" : "/dashboard";
}

export const getLandingRedirect = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await getAuthContext();
  return { to: decideLandingRedirect(actor, isProduction()) };
});
