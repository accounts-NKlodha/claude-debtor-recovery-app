import { NextResponse, type NextRequest } from "next/server";
import { getMiddlewareUser } from "@/lib/supabase/middleware";

/**
 * Route-protection Proxy (Next.js 16 renamed Middleware -> Proxy; see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * Implements P0-1 requirements 1, 6, 7.
 *
 * Production: every internal/client route requires a verified Supabase user
 * (`auth.getUser()`, revalidated -- not a trusted cookie). No session ->
 * redirect to /sign-in. This is a coarse "is anyone authenticated" gate;
 * the actual staff/admin/client + tenant authorization decision is made
 * server-side per-request by src/lib/auth/session.ts and src/lib/auth/context.ts,
 * which this middleware cannot and does not replace.
 *
 * Non-production: unchanged -- requests pass through so the existing
 * demo/mock-data experience keeps working without live Google OAuth
 * credentials (P0-1 requirement 8).
 */
export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/sign-in" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname === "/favicon.ico";
  if (isPublic) {
    return NextResponse.next();
  }

  const { user, response } = await getMiddlewareUser(request);
  if (!user) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * All paths except static assets and Next internals. Kept broad and
     * deny-by-default (fail closed) rather than an explicit allowlist of
     * "protected" routes -- new routes are protected by default.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
