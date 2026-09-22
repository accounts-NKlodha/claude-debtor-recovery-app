/**
 * TanStack Start equivalent of src/lib/supabase/server.ts -- same cookie
 * session contract as @supabase/ssr expects, backed by TanStack Start's
 * cookie primitives (getCookies/setCookie from "@tanstack/react-start/server")
 * instead of Next's `next/headers` cookies(). Only usable inside a server
 * function / server-side loader (the "server-only" module import below
 * fails the build if a client bundle ever pulls this in, same guarantee
 * the Next.js version has).
 *
 * This file exists ONLY on the TanStack port branch (port/tanstack-start)
 * and is never imported by the Next.js app -- src/lib/supabase/server.ts
 * (Next) is untouched.
 */
import { getCookies, setCookie } from "@tanstack/react-start/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "./types";

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY -- see .env.example");
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        const cookies = getCookies();
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            setCookie(name, value, options as CookieOptions);
          }
        } catch {
          // Called from a loader/render path where the response headers are
          // already flushed -- same tolerated no-op the Next.js version has
          // when middleware/beforeLoad is responsible for refreshing the
          // session cookie instead.
        }
      },
    },
  });
}
