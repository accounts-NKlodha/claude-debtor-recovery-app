/**
 * Which data layer a request will use. Pure environment logic, shared by the
 * repository factory (repo.tanstack.ts) and the session layer (which must not
 * offer the non-production demo-actor fallback when real Supabase data is in
 * play). No imports on purpose: importing it must never pull in a repository.
 */
export type RepoMode = "memory" | "supabase";

export function isProductionRuntime(): boolean {
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
