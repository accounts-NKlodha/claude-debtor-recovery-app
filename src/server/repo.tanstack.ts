/**
 * TanStack Start equivalent of src/server/repo.ts. Same repository-selection
 * policy (production always Supabase and fails closed; DATA_PROFILE escape
 * hatch outside production) -- the only difference is which Supabase client
 * factory gets injected into SupabaseRepository (src/lib/supabase/tanstack-server.ts
 * instead of the Next.js next/headers-based one), using the constructor seam
 * added to src/server/repositories/supabase.ts for exactly this purpose.
 *
 * `getProductionDataConfig` (from @/lib/config/production, reused unmodified)
 * is imported dynamically, not statically -- that file's `import "server-only"`
 * must never be a static dependency of a module reachable from a
 * client-rendered route component (see supabase.ts's defaultNextClientFactory
 * for the identical reasoning). `isProductionRuntime()` is a one-line check
 * (`process.env.NODE_ENV === "production"`), duplicated here rather than
 * statically imported for the same reason.
 *
 * Only exists on the TanStack port branch; src/server/repo.ts (Next) is
 * untouched and still used by every existing Next.js page/action.
 */
import type { Repository } from "./repository";
import { MemoryRepository } from "./repositories/memory";
import { SupabaseRepository } from "./repositories/supabase";
import { createClient as createTanstackSupabaseClient } from "@/lib/supabase/tanstack-server";

export type RepoMode = "memory" | "supabase";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function resolveRepoMode(): RepoMode {
  if (isProductionRuntime()) return "supabase";
  const profile = process.env.DATA_PROFILE;
  if (profile === "memory" || profile === "supabase") return profile;
  return hasSupabaseConfig() ? "supabase" : "memory";
}

let loggedMode = false;

export async function getRepo(): Promise<Repository> {
  if (isProductionRuntime()) {
    const { getProductionDataConfig } = await import("@/lib/config/production");
    const config = getProductionDataConfig();
    if (!loggedMode) {
      loggedMode = true;
      console.info(`[repo:tanstack] data mode: supabase (${config.supabaseHost})`);
    }
    return new SupabaseRepository(createTanstackSupabaseClient);
  }

  const mode = resolveRepoMode();
  if (!loggedMode) {
    loggedMode = true;
    console.info(`[repo:tanstack] data mode: ${mode}`);
  }
  return mode === "supabase" ? new SupabaseRepository(createTanstackSupabaseClient) : new MemoryRepository();
}
