import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/auth/oauth";
import { getProductionDataConfig } from "@/lib/config/production";

export async function POST(request: Request) {
  let origin: string;
  try { origin = appOrigin(); getProductionDataConfig(); }
  catch { return new Response("Sign-in is not configured. Contact your administrator.", { status: 503 }); }
  if (request.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google", options: { redirectTo: origin + "/auth/callback" },
    });
    if (!error && data.url) return NextResponse.redirect(data.url, 303);
  } catch { /* Do not disclose provider errors or credentials. */ }
  return NextResponse.redirect(origin + "/sign-in?error=oauth", 303);
}
