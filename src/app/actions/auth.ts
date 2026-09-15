"use server";

/**
 * V1 authentication is Supabase email + password (final-UAT go-live task).
 * Google OAuth was never wired up for a real environment (no Google Cloud
 * client, no Supabase provider config -- see docs/DEPLOYMENT.md) and has
 * been removed from V1 entirely; this is the one and only sign-in path.
 *
 * Uses the same server-bound Supabase client (`src/lib/supabase/server.ts`)
 * every other mutation in this app uses -- `signInWithPassword`/`signOut`
 * write the session cookie through that client's `setAll` handler, so the
 * resulting session is verified the same way everywhere else
 * (`auth.getUser()` in `src/lib/auth/session.ts`), regardless of how it was
 * established. No second authentication architecture is introduced.
 *
 * `signInAction` takes the `useActionState`/`<form action=...>` shape
 * (prevState, FormData) -- not a plain function call -- because Next.js's
 * production build applies its own error-digest redaction to values thrown
 * out of a directly-invoked "use server" function; returning the error as
 * ordinary state (never throwing across the client/server action boundary)
 * is the framework's documented, production-robust pattern and avoids that
 * redaction path entirely, along with everything it can drag in.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";

/** Never discloses whether a specific email is registered, whether the
 * password was wrong, or any provider-internal detail -- one fixed message
 * for every failure mode (wrong password, unknown email, rate limit,
 * network/provider error, or a Supabase-authenticated identity with no
 * matching `app_users` row). */
const GENERIC_AUTH_ERROR = "Invalid email or password.";

export interface SignInState {
  error: string | null;
}

export async function signInAction(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: GENERIC_AUTH_ERROR };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: GENERIC_AUTH_ERROR };
  }

  // Supabase authenticated the credentials, but this app also requires a
  // provisioned app_users row (+ org membership for a client) -- mirrors
  // the exact "unprovisioned identity" handling the old OAuth callback used
  // (src/app/auth/callback/route.ts, now removed): sign the raw Supabase
  // session back out rather than ever exposing it to the rest of the app.
  const actor = await getAuthContext();
  if (!actor) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/sign-in?error=access");
  }

  redirect(actor.kind === "client" ? "/client" : "/dashboard");
}

export async function signOutAction(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
