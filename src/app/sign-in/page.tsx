import { appOrigin } from "@/lib/auth/oauth";
import { getProductionDataConfig } from "@/lib/config/production";

export const metadata = { title: "Sign in — Debtrecover" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let configured = false;
  try { appOrigin(); getProductionDataConfig(); configured = true; } catch { /* Render setup guidance. */ }
  const message = !configured ? "Sign-in is not configured. Contact your administrator."
    : error === "access" ? "Your account has not been granted access. Contact your administrator."
    : error ? "Sign-in could not be completed. Please try again."
    : "Use the Google account approved by your administrator.";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Sign in to Debtrecover</h1>
        <p className="mt-2 text-sm text-muted-foreground" role={error ? "alert" : undefined}>{message}</p>
        <form action="/auth/google" method="post">
          <button type="submit" disabled={!configured}
            className="mt-6 w-full rounded-md border border-border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}
