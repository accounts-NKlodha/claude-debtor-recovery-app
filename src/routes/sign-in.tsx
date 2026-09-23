/**
 * TanStack Start adapter for src/app/sign-in/page.tsx +
 * src/components/screens/sign-in-form.tsx. Same UX and same generic error
 * message; the React 19 useActionState/<form action> pattern (which relies
 * on Next Server Actions) is replaced with local state calling the
 * TanStack server function directly -- same behavior, no framework-specific
 * form-binding available here.
 */
import * as React from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInFn } from "@/lib/auth/tanstack-actions";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: SignInPage,
  head: () => ({ meta: [{ title: "Sign in — Debtrecover" }] }),
});

function SignInPage() {
  const { error: searchError } = useSearch({ from: "/sign-in" });
  const message =
    searchError === "access"
      ? "Your account has not been granted access. Contact your administrator."
      : searchError
        ? "Sign-in could not be completed. Please try again."
        : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground shadow-sm">
          D
        </span>
        <p className="text-xs font-medium text-muted-foreground">N K Lodha &amp; Co · Recovery desk</p>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold tracking-tight">Sign in to Debtrecover</h1>
        <p className="mt-1 text-center text-xs text-muted-foreground">Sign in with your email and password.</p>
        {message ? (
          <p
            className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-left text-xs text-warning"
            role="alert"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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

/** Supabase email + password sign-in. A failed sign-in always shows the
 * same generic message, regardless of the actual failure reason -- mirrors
 * src/components/screens/sign-in-form.tsx exactly. */
function SignInForm() {
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    setPending(true);
    setError(null);
    try {
      const result = await signInFn({ data: { email, password } });
      if (result.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      await navigate({ to: result.redirectTo ?? "/dashboard" });
    } catch {
      setError("Sign-in could not be completed. Please try again.");
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-4 text-left" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-password">Password</Label>
        <Input id="signin-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
