/**
 * Repository factory. Pages call `getRepo()` -- never `MemoryRepository` /
 * `SupabaseRepository` directly -- so the storage swap in ADR-0001 stays a
 * one-line change here.
 *
 * Selection: Supabase when both public env vars are set, otherwise the
 * in-memory demo repository. Force one explicitly with
 * DATA_PROFILE=memory|supabase (useful for a smoke test against a configured
 * project without touching env removal).
 */

import type { Repository } from "./repository";
import { MemoryRepository } from "./repositories/memory";
import { SupabaseRepository } from "./repositories/supabase";

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getRepo(): Repository {
  const profile = process.env.DATA_PROFILE ?? (hasSupabaseConfig() ? "supabase" : "memory");
  // SupabaseRepository's constructor is where next/headers `cookies()` is
  // first touched, so simply importing this module (e.g. from Vitest) is
  // safe -- only the "supabase" profile instantiates it.
  return profile === "supabase" ? new SupabaseRepository() : new MemoryRepository();
}
