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

/**
 * The only shape audit attribution may be written with (P0-2 requirement 10
 * / P0-1-R1 §5.5-5.6). Always produced by `actorAttribution()` from a real
 * `AuthContext` -- never constructed from a server action's own input
 * parameter, so a mutation's `input`/form payload has no field that could
 * ever be mistaken for -- or forge -- this value.
 */
export interface MutationActor {
  actorId: string;
  actorRole: string;
}

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
