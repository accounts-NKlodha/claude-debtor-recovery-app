import { isProduction } from "@/lib/auth/session";

export const metadata = { title: "Sign in — Debtrecover" };
export const dynamic = "force-dynamic";

/**
 * Structural placeholder: production traffic without a session lands here
 * (see src/middleware.ts). There is no Google OAuth wiring yet -- that
 * requires live Supabase/Google OAuth credentials that aren't available in
 * this environment (P0-1 explicit external-dependency exception). This page
 * exists so the fail-closed redirect has somewhere real to go, and so the
 * OAuth button has an obvious place to land once credentials exist.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Sign in to Debtrecover</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isProduction()
            ? "Google sign-in is not yet configured for this deployment. Contact your administrator."
            : "This environment is running in demo mode -- no sign-in is required outside production."}
        </p>
        <button
          type="button"
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
        >
          Continue with Google (coming soon)
        </button>
      </div>
    </div>
  );
}
