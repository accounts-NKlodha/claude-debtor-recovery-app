/**
 * TanStack Start equivalent of src/app/actions/gst.ts (M1 Batch 4). Same
 * three mutations, same field-limit validation (gstComposeSchema), same
 * staff-only authorization, same fail-closed capture behavior -- the
 * repository never fabricates a portal reference; a blank staffReference
 * is rejected as a controlled business-rule error, not a crash. No real
 * GST portal automation exists in either app -- the (mocked) gstPortal
 * adapter stays mocked regardless of profile/environment
 * (src/adapters/index.ts, unchanged), so this migration performs no real
 * external send by construction.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRepo } from "@/server/repo.tanstack";
import { authorizeStaffMutation } from "@/lib/auth/tanstack-session";
import { gstComposeSchema } from "@/contract/schemas";
import type { RecoveryCase } from "@/contract/types";

export interface PrepareGstNotificationState {
  result: { case: RecoveryCase; manifestHash: string | null } | null;
  error: string | null;
}

export const prepareGstNotificationFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as {
        caseId: string;
        recipientGstin: unknown;
        subject: unknown;
        action: unknown;
        remarks: unknown;
        invoiceRecordCount: unknown;
        attachmentStorageKeys: unknown;
      },
  )
  .handler(async ({ data }): Promise<PrepareGstNotificationState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    const parsed = gstComposeSchema.safeParse({
      recipientGstin: data.recipientGstin,
      subject: data.subject,
      action: data.action,
      remarks: data.remarks,
      invoiceRecordCount: Number(data.invoiceRecordCount),
      attachmentStorageKeys: data.attachmentStorageKeys,
    });
    if (!parsed.success) {
      return { result: null, error: parsed.error.issues[0]?.message ?? "Fix field limits before continuing" };
    }

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.prepareGstNotification(data.caseId, parsed.data, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to prepare the GST pack" };
    }
  });

export interface OpenGstAssistedSessionState {
  result: { sessionUrl: string | null } | null;
  error: string | null;
}

export const openGstAssistedSessionFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string })
  .handler(async ({ data }): Promise<OpenGstAssistedSessionState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.openGstAssistedSession(data.caseId, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to open the assisted session" };
    }
  });

export interface CaptureGstFilingState {
  result: { case: RecoveryCase; referenceNumber: string | null } | null;
  error: string | null;
}

export const captureGstFilingFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => data as { caseId: string; staffReference: string })
  .handler(async ({ data }): Promise<CaptureGstFilingState> => {
    if (!data.caseId) return { result: null, error: "Missing case." };

    let actor;
    try {
      actor = await authorizeStaffMutation();
    } catch {
      return { result: null, error: "You do not have permission to perform this action." };
    }

    try {
      const repo = await getRepo();
      const result = await repo.captureGstFiling(data.caseId, data.staffReference, actor);
      return { result, error: null };
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : "Failed to capture the filing" };
    }
  });
