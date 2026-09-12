import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth/session";
import { appOrigin, safeNext } from "@/lib/auth/oauth";

export async function GET(request: Request) {
  let origin: string;
  try { origin = appOrigin(); }
  catch { return new Response("Sign-in is not configured. Contact your administrator.", { status: 503 }); }
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (code && !params.has("error")) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        const actor = await getAuthContext();
        if (actor) {
          const next = actor.kind === "client" ? "/client" : safeNext(params.get("next"));
          return NextResponse.redirect(origin + next, 303);
        }
        await supabase.auth.signOut({ scope: "local" });
        return NextResponse.redirect(origin + "/sign-in?error=access", 303);
      }
    } catch { /* Fail closed without exposing provider error details. */ }
  }
  return NextResponse.redirect(origin + "/sign-in?error=oauth", 303);
}
