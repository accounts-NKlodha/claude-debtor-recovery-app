/**
 * The canonical, server-derived authenticated actor (P0-1 requirement 4).
 *
 * This is the ONLY source of identity/role/tenant scope every server action
 * and repository call may trust. It is never constructed from anything the
 * browser sent (form fields, query params, localStorage, unauthenticated
 * cookies) -- see src/lib/auth/session.ts, which is the sole place this type
 * is produced from a real request.
 */
export type AuthContext =
  | {
      kind: "staff";
      userId: string;
      role: "staff" | "admin";
      email: string | null;
      displayName: string;
      /** true only outside production, when no real session exists (P0-1 requirement 8). */
      demo: boolean;
    }
  | {
      kind: "client";
      userId: string;
      /** The organisation this session is scoped to right now. Selecting a
       * different membership requires a new server-side selection + session
       * rotation (P0-1 requirement 4) -- it is never a client-editable value. */
      organisationId: string;
      /** Every organisation this identity may act for (PRD §4 multi-org clients). */
      organisationIds: string[];
      displayName: string;
      demo: boolean;
    };

export class UnauthenticatedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized for this resource") {
    super(message);
    this.name = "ForbiddenError";
  }
}
