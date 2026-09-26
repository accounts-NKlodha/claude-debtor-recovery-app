/**
 * TanStack Start server functions for sign-in/sign-out -- equivalent to
 * src/app/actions/auth.ts (Next.js Server Actions), preserving the exact
 * same semantics: Supabase email+password only, one generic error message
 * for every failure mode, the same "authenticated with Supabase but not a
 * provisioned app_users row" handling, and the same role-based redirect
 * target. Only exists on the TanStack port branch.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@/lib/supabase/tanstack-server";
import { clearRequestAuthCache, getAuthContext } from "@/lib/auth/tanstack-session";

/** Never discloses whether a specific email is registered, whether the
 * password was wrong, or any provider-internal detail -- mirrors
 * src/app/actions/auth.ts's GENERIC_AUTH_ERROR exactly. */
const GENERIC_AUTH_ERROR = "Invalid email or password.";

export interface SignInResult {
  error: string | null;
  redirectTo: "/dashboard" | "/client" | null;
}

export const signInFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { email: string; password: string })
  .handler(async ({ data }): Promise<SignInResult> => {
    const { email, password } = data;
    if (!email || !password) return { error: GENERIC_AUTH_ERROR, redirectTo: null };

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: GENERIC_AUTH_ERROR, redirectTo: null };

    // Supabase authenticated the credentials, but this app also requires a
    // provisioned app_users row -- same handling as signInAction: sign the
    // raw Supabase session back out rather than exposing it to the rest of
    // the app. Must reuse this same `supabase` client instance (see
    // getAuthContext's doc comment in tanstack-session.ts) -- a freshly
    // created client would re-parse the incoming request's cookies and
    // never see the session that was just established above.
    clearRequestAuthCache();
    const actor = await getAuthContext(supabase);
    if (!actor) {
      await supabase.auth.signOut({ scope: "local" });
      return { error: "Your account has not been granted access. Contact your administrator.", redirectTo: null };
    }

    return { error: null, redirectTo: actor.kind === "client" ? "/client" : "/dashboard" };
  });

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  clearRequestAuthCache();
  return { ok: true };
});
