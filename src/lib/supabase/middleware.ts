import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Middleware-scoped Supabase client (distinct from src/lib/supabase/server.ts
 * -- that one uses `next/headers` cookies(), which isn't available in the
 * Edge middleware runtime; this uses the request/response cookie jars
 * middleware gets directly, per Supabase's documented SSR middleware
 * pattern). Also refreshes the session cookie so a near-expiry session
 * doesn't silently drop mid-request.
 */
export async function getMiddlewareUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });
  if (!url || !anonKey) {
    // No Supabase configured -- there is no session to resolve. Callers
    // (src/middleware.ts) still fail closed in production on `user === null`.
    return { user: null, response };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, response };
}
