import { redirect } from "next/navigation";
import { getAuthContext, isProduction } from "@/lib/auth/session";

/**
 * Role-aware landing redirect (authorization hardening task) -- previously
 * unconditionally redirected to /dashboard, which meant a client's very
 * first hop after "/" bounced through the staff surface (harmless once
 * (internal)/layout.tsx's own role gate redirects them onward to /client,
 * but an unnecessary double-redirect the root route can avoid entirely).
 */
export default async function Home() {
  const actor = await getAuthContext();
  if (!actor) {
    redirect(isProduction() ? "/sign-in" : "/dashboard"); // unchanged demo behavior outside production
  }
  redirect(actor.kind === "client" ? "/client" : "/dashboard");
}
