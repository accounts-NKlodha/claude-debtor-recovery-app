import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./types";

/**
 * Browser Supabase client (Client Components). Uses the anon key and the
 * signed-in user's session; every query is subject to RLS (see
 * supabase/migrations/0002_rls.sql).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY -- see .env.example",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
