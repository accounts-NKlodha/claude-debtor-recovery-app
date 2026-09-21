import "server-only";
import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Server Supabase client (Server Components, Route Handlers, Server Actions).
 * Reads/writes the session cookie via the current @supabase/ssr getAll/setAll
 * API. Bound to the signed-in user, so RLS applies.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY -- see .env.example",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component render -- safe to ignore when
          // middleware is responsible for refreshing the session cookie.
        }
      },
    },
  });
}

/**
 * Service-role client for trusted server-side jobs only (orchestration
 * workers, audit hash-chain writer). BYPASSES RLS -- never expose to the
 * browser and never construct it from a request handler acting on behalf of
 * an end user.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -- see .env.example",
    );
  }

  return createServerClient<Database>(url, serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // no-op: the admin client is sessionless
      },
    },
  });
}
