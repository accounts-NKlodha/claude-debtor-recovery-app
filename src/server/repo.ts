/**
 * Repository factory. Pages call `getRepo()` -- never `MemoryRepository` /
 * `SupabaseRepository` directly -- so the storage swap in ADR-0001 stays a
 * one-line change here.
 *
 * PRODUCTION INVARIANT (P0-4 §2): in production this function either
 * returns a correctly configured SupabaseRepository or throws --
 * NODE_ENV=production is never, by itself, enough to select
 * MemoryRepository, and there is no fallback path from a Supabase
 * configuration/initialization failure back to memory. `DATA_PROFILE` is
 * a non-production-only escape hatch (see below); it cannot force memory
 * mode in production.
 *
 * Outside production: Supabase when both public env vars are set,
 * otherwise the in-memory demo repository. Force one explicitly with
 * DATA_PROFILE=memory|supabase (useful for a smoke test against a
 * configured project without touching env removal).
 */

import "server-only";
import type { Repository } from "./repository";
import { MemoryRepository } from "./repositories/memory";
import { SupabaseRepository } from "./repositories/supabase";
import { getProductionDataConfig, isProductionRuntime } from "@/lib/config/production";

export type RepoMode = "memory" | "supabase";

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Which mode getRepo() would select right now -- safe to log/display (no
 * secret values), used both by getRepo() itself and by anything wanting to
 * surface the active data mode (e.g. a future health-check route). */
export function resolveRepoMode(): RepoMode {
  if (isProductionRuntime()) return "supabase"; // getProductionDataConfig() enforces this or throws
  const profile = process.env.DATA_PROFILE;
  if (profile === "memory" || profile === "supabase") return profile;
  return hasSupabaseConfig() ? "supabase" : "memory";
}

let loggedMode = false;

export function getRepo(): Repository {
  if (isProductionRuntime()) {
    // Throws ProductionConfigError (fail closed) if Supabase isn't
    // correctly configured -- production never falls back to memory here,
    // and nothing downstream catches this to retry against MemoryRepository.
    const config = getProductionDataConfig();
    if (!loggedMode) {
      loggedMode = true;
      console.info(`[repo] data mode: supabase (${config.supabaseHost})`);
    }
    return new SupabaseRepository();
  }

  const mode = resolveRepoMode();
  if (!loggedMode) {
    loggedMode = true;
    console.info(`[repo] data mode: ${mode}`);
  }
  // SupabaseRepository's constructor is where next/headers `cookies()` is
  // first touched, so simply importing this module (e.g. from Vitest) is
  // safe -- only the "supabase" mode instantiates it.
  return mode === "supabase" ? new SupabaseRepository() : new MemoryRepository();
}
