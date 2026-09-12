/**
 * Centralized, typed production data-layer configuration validation
 * (P0-4 §8). This is the ONLY place production's Supabase configuration is
 * validated -- src/server/repo.ts calls it before ever selecting a
 * repository so that missing/malformed configuration fails closed instead
 * of silently falling back to in-memory storage.
 *
 * Never logs or throws the actual secret values -- only which named
 * variable is missing or which specific shape check failed.
 */

import "server-only";

export class ProductionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionConfigError";
  }
}

export interface ProductionDataConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Hostname only -- safe to log/display; never the key material. */
  supabaseHost: string;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Decodes a JWT's payload claims without verifying its signature -- only
 * used here to sanity-check which Supabase key role a value carries, never
 * to trust its contents for authorization. */
function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

/**
 * Validates the production Supabase configuration and returns it, or
 * throws `ProductionConfigError`. Deliberately does NOT require
 * `SUPABASE_SERVICE_ROLE_KEY` -- that credential is only needed by
 * `createAdminClient()` (src/lib/supabase/server.ts), which is not on any
 * normal staff/client request path (see the P0-4 audit report); requiring
 * it globally would make an unrelated credential a startup dependency for
 * every ordinary request.
 */
export function getProductionDataConfig(): ProductionDataConfig {
  const missing: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !url.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey || !anonKey.trim()) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    throw new ProductionConfigError(
      `Production data layer misconfigured -- missing required environment variable(s): ${missing.join(", ")}. ` +
        "Production must use a correctly configured Supabase repository and never falls back to in-memory storage.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url!);
  } catch {
    throw new ProductionConfigError(
      "Production data layer misconfigured -- NEXT_PUBLIC_SUPABASE_URL is not a valid URL.",
    );
  }
  if (parsedUrl.protocol !== "https:") {
    throw new ProductionConfigError(
      "Production data layer misconfigured -- NEXT_PUBLIC_SUPABASE_URL must be an https:// URL.",
    );
  }

  // NEXT_PUBLIC_* variables are bundled into client JS -- if the anon-key
  // slot is accidentally holding a service-role key, that credential would
  // ship to every browser. Catch that specific, high-severity misconfiguration
  // class without ever logging the key itself.
  const anonKeyRole = decodeJwtRole(anonKey!);
  if (anonKeyRole === "service_role" || anonKey!.startsWith("sb_secret_")) {
    throw new ProductionConfigError(
      "Production data layer misconfigured -- NEXT_PUBLIC_SUPABASE_ANON_KEY appears to be a " +
        "service-role key. This variable is bundled into the client and must never hold " +
        "service-role credentials.",
    );
  }

  return { supabaseUrl: url!, supabaseAnonKey: anonKey!, supabaseHost: parsedUrl.host };
}
