/**
 * TanStack Start equivalent of src/app/actions/organisations.ts (M1 Batch
 * 1). Same validation, same admin-only enforcement, same duplicate-name
 * two-step warning, same audit behavior -- only the input shape changes
 * (plain validated object instead of FormData, since there is no Next.js
 * <form action> binding here; see tanstack-actions.ts's signInFn for the
 * same convention).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeAdminMutation } from "@/lib/auth/tanstack-session";
import { createOrganisationSchema, organisationPaymentDetailsSchema } from "@/contract/schemas";
import type { Organisation } from "@/contract/types";
import type { CreateOrganisationResult } from "@/server/repository";

export interface CreateOrganisationState {
  result: CreateOrganisationResult | null;
  error: string | null;
}

export const createOrganisationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }): Promise<CreateOrganisationState> => {
    const parsed = createOrganisationSchema.safeParse(data);
    if (!parsed.success) {
      return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid client details" };
    }

    let actor;
    try {
      actor = await authorizeAdminMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.createOrganisation(parsed.data, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to add the client" };
    }
  });

export interface UpdateOrganisationPaymentDetailsState {
  result: Organisation | null;
  error: string | null;
}

export const updateOrganisationPaymentDetailsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { organisationId: string; upiId: unknown; upiPayeeName: unknown; reason: unknown })
  .handler(async ({ data }): Promise<UpdateOrganisationPaymentDetailsState> => {
    const organisationId = data.organisationId.trim();
    if (!organisationId) return { result: null, error: "Missing client." };

    const parsed = organisationPaymentDetailsSchema.safeParse({
      upiId: data.upiId,
      upiPayeeName: data.upiPayeeName,
      reason: data.reason,
    });
    if (!parsed.success) {
      return { result: null, error: parsed.error.issues[0]?.message ?? "Invalid payment details" };
    }

    let actor;
    try {
      actor = await authorizeAdminMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.updateOrganisationPaymentDetails(organisationId, parsed.data, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to save payment details" };
    }
  });
