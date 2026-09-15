import { SignInForm } from "@/components/screens/sign-in-form";

export const metadata = { title: "Sign in — Debtrecover" };
export const dynamic = "force-dynamic";

/** V1 authentication is Supabase email + password (src/app/actions/auth.ts)
 * -- Google OAuth has been removed, not deferred behind a flag. */
export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message =
    error === "access"
      ? "Your account has not been granted access. Contact your administrator."
      : error
        ? "Sign-in could not be completed. Please try again."
        : null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold">Sign in to Debtrecover</h1>
        {message ? (
          <p className="mt-2 text-center text-sm text-muted-foreground" role="alert">
            {message}
          </p>
        ) : null}
        <div className="mt-6">
          <SignInForm />
        </div>
      </div>
    </div>
  );
}
