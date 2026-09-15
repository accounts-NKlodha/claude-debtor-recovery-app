"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type SignInState } from "@/app/actions/auth";

const INITIAL_STATE: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

/** Supabase email + password sign-in (V1 authentication -- Google OAuth has
 * been removed, see src/app/actions/auth.ts). A failed sign-in always shows
 * the same generic message, regardless of whether the email is registered,
 * the password was wrong, or anything else went wrong server-side. */
export function SignInForm() {
  const [state, formAction] = useActionState(signInAction, INITIAL_STATE);

  return (
    <form className="flex flex-col gap-4 text-left" action={formAction}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-password">Password</Label>
        <Input id="signin-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
