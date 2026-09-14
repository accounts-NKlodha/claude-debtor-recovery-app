/**
 * P0-1/P0-2-R1 §5: exercises the actual, public server action entry points
 * (not just the auth helpers they call) to prove every mutation
 * independently authenticates and attributes audit entries to the real
 * session -- never to anything the action's own input parameters carry.
 *
 * `@/lib/auth/session` is mocked here (see `src/lib/auth/session.test.ts`
 * for the unmocked, real-session-resolution version of these guarantees);
 * `getRepo()` is NOT mocked -- these calls run against the real
 * MemoryRepository so assertions are made against real, persisted audit
 * entries and real repository state, not a stub's recorded call args.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/types";
import { getRepo } from "@/server/repo";
import * as mock from "@/lib/mock-data";

// The real `server-only` package unconditionally throws when required
// directly outside webpack's client/server aliasing (see
// src/lib/auth/session.test.ts for the same note) -- repo.ts and
// src/lib/config/production.ts both import it.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeStaffMutation = vi.fn();
const authorizeAdminMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  authorizeStaffMutation: (...args: unknown[]) => authorizeStaffMutation(...args),
  authorizeAdminMutation: (...args: unknown[]) => authorizeAdminMutation(...args),
}));

const STAFF_A = { actorId: "staff-alice", actorRole: "staff" };
const STAFF_B = { actorId: "staff-bob", actorRole: "admin" };

async function latestAudit() {
  return (await getRepo().listAuditLog(1))[0];
}

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeAdminMutation.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("recordPaymentAction / confirmPaymentAction (real entry points)", () => {
  it("rejects an unauthenticated mutation before touching the repository", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { recordPaymentAction } = await import("./payments");
    const before = mock.PAYMENTS.length;

    await expect(
      recordPaymentAction({
        caseId: mock.CASES[0].id,
        kind: "bank",
        amount: 1000,
        reference: null,
        clientConfirmed: false,
      }),
    ).rejects.toThrow(UnauthenticatedError);
    expect(mock.PAYMENTS.length).toBe(before); // no side effect happened
  });

  it("rejects a wrong actor type (e.g. a client session hitting a staff-only action)", async () => {
    authorizeStaffMutation.mockRejectedValue(new ForbiddenError("Staff/admin session required"));
    const { recordPaymentAction } = await import("./payments");

    await expect(
      recordPaymentAction({
        caseId: mock.CASES[0].id,
        kind: "bank",
        amount: 1000,
        reference: null,
        clientConfirmed: false,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("attributes the audit entry to the authenticated actor, never a value the caller supplied -- and never a constant", async () => {
    const { recordPaymentAction } = await import("./payments");
    const caseId = mock.CASES.find((c) => c.status === "active")?.id ?? mock.CASES[0].id;

    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    await recordPaymentAction({ caseId, kind: "bank", amount: 500, reference: "r1", clientConfirmed: false });
    let audit = await latestAudit();
    expect(audit.action).toBe("payment.recorded");
    expect(audit.actorId).toBe(STAFF_A.actorId);
    expect(audit.actorRole).toBe(STAFF_A.actorRole);

    // Same call shape, different mocked session -- attribution must track
    // the session, proving it isn't hardcoded and (since `input` has no
    // actor-shaped field at all) cannot be forged from the request payload.
    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    await recordPaymentAction({ caseId, kind: "bank", amount: 500, reference: "r2", clientConfirmed: false });
    audit = await latestAudit();
    expect(audit.actorId).toBe(STAFF_B.actorId);
    expect(audit.actorId).not.toBe(STAFF_A.actorId);
  });

  it("confirmPaymentAction also authorizes independently and attributes to the session actor", async () => {
    const { recordPaymentAction, confirmPaymentAction } = await import("./payments");
    const caseId = mock.CASES.find((c) => c.status === "active")?.id ?? mock.CASES[0].id;

    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { payment } = await recordPaymentAction({
      caseId,
      kind: "bank",
      amount: 750,
      reference: "confirm-me",
      clientConfirmed: false,
    });

    authorizeStaffMutation.mockRejectedValueOnce(new UnauthenticatedError());
    await expect(confirmPaymentAction(payment.id, caseId)).rejects.toThrow(UnauthenticatedError);

    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    await confirmPaymentAction(payment.id, caseId);
    const audit = await latestAudit();
    expect(audit.action).toBe("payment.confirmed");
    expect(audit.actorId).toBe(STAFF_B.actorId);
  });
});

describe("setAutomationStateAction: admin-only privileged path (real entry point)", () => {
  it("cannot be reached through an ordinary staff authorization -- it calls authorizeAdminMutation, not authorizeStaffMutation", async () => {
    authorizeAdminMutation.mockRejectedValue(new ForbiddenError("Admin session required"));
    const { setAutomationStateAction } = await import("./settings");
    const before = mock.getAutomationEnabled();

    await expect(setAutomationStateAction(!before, "attempted by non-admin")).rejects.toThrow(ForbiddenError);
    expect(mock.getAutomationEnabled()).toBe(before); // no state change
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("succeeds for an authorized admin and attributes the audit entry to them", async () => {
    authorizeAdminMutation.mockResolvedValue(STAFF_B);
    const { setAutomationStateAction } = await import("./settings");
    const before = mock.getAutomationEnabled();

    await setAutomationStateAction(!before, "drift investigation");
    expect(mock.getAutomationEnabled()).toBe(!before);
    const audit = await latestAudit();
    expect(audit.actorId).toBe(STAFF_B.actorId);

    await setAutomationStateAction(before, "restore"); // cleanup for other tests
  });
});

describe("createOrganisationAction (real entry point): admin-only (P0-1/P0-2-R2)", () => {
  it("rejects when unauthenticated, before any validation or persistence runs", async () => {
    authorizeAdminMutation.mockRejectedValue(new UnauthenticatedError());
    const { createOrganisationAction } = await import("./organisations");
    const before = mock.ORGANISATIONS.length;

    await expect(createOrganisationAction({ garbage: true })).rejects.toThrow(UnauthenticatedError);
    expect(mock.ORGANISATIONS.length).toBe(before);
  });

  it("rejects an insufficiently-privileged staff actor -- ordinary staff cannot onboard a new client", async () => {
    authorizeAdminMutation.mockRejectedValue(new ForbiddenError("Admin session required"));
    const { createOrganisationAction } = await import("./organisations");
    const before = mock.ORGANISATIONS.length;

    await expect(
      createOrganisationAction({
        clientCode: "NKL-DENY1",
        legalEntityName: "Should Not Be Created Pvt Ltd",
        creditorGstin: null,
        udyamNumber: null,
        jitoMember: false,
        confirmDuplicateName: false,
        duplicateOverrideReason: null,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(mock.ORGANISATIONS.length).toBe(before); // no side effect happened
  });

  it("calls authorizeAdminMutation, never the weaker authorizeStaffMutation -- a browser cannot get itself treated as staff-sufficient here", async () => {
    authorizeAdminMutation.mockRejectedValue(new ForbiddenError("Admin session required"));
    const { createOrganisationAction } = await import("./organisations");

    await expect(createOrganisationAction({ garbage: true })).rejects.toThrow();
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("succeeds for an authorized admin and attributes the created organisation's audit entry to them", async () => {
    authorizeAdminMutation.mockResolvedValue(STAFF_B);
    const { createOrganisationAction } = await import("./organisations");

    const result = await createOrganisationAction({
      clientCode: `NKL-S${Date.now().toString().slice(-6)}`,
      legalEntityName: "Security Test Org Pvt Ltd",
      creditorGstin: null,
      udyamNumber: null,
      jitoMember: false,
      confirmDuplicateName: false,
      duplicateOverrideReason: null,
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");

    const audit = (await getRepo().listAuditLog(20)).find((a) => a.entityId === result.organisation.id);
    expect(audit?.actorId).toBe(STAFF_B.actorId);
  });

  it("a submitted input carrying a role-like field cannot elevate privilege -- the schema has no role/actor field at all", async () => {
    authorizeAdminMutation.mockResolvedValue(STAFF_B);
    const { createOrganisationAction } = await import("./organisations");

    const result = await createOrganisationAction({
      clientCode: `NKL-R${Date.now().toString().slice(-6)}`,
      legalEntityName: "Role Injection Attempt Pvt Ltd",
      creditorGstin: null,
      udyamNumber: null,
      jitoMember: false,
      confirmDuplicateName: false,
      duplicateOverrideReason: null,
      // Attacker-supplied fields a naive implementation might trust:
      role: "admin",
      actorId: "attacker-forged-id",
      actorRole: "admin",
    } as never);

    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    const audit = (await getRepo().listAuditLog(20)).find((a) => a.entityId === result.organisation.id);
    // Attribution still comes from the (mocked) session actor, not the payload.
    expect(audit?.actorId).toBe(STAFF_B.actorId);
    expect(audit?.actorId).not.toBe("attacker-forged-id");
  });
});

describe("hearing.ts / ocr.ts / manual-invoice.ts / bulk-import.ts: authenticate independently of src/proxy.ts", () => {
  it("prepareDdTaskAction and scheduleHearingAction both reject with no session", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { prepareDdTaskAction, scheduleHearingAction } = await import("./hearing");
    const caseId = mock.CASES[0].id;

    await expect(prepareDdTaskAction(caseId)).rejects.toThrow(UnauthenticatedError);
    await expect(scheduleHearingAction(caseId, new Date().toISOString())).rejects.toThrow(UnauthenticatedError);
  });

  it("recordDdSubmittedAction, rescheduleHearingAction and recordHearingOutcomeAction all reject with no session", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { recordDdSubmittedAction, rescheduleHearingAction, recordHearingOutcomeAction } = await import("./hearing");
    const caseId = mock.CASES[0].id;

    await expect(recordDdSubmittedAction(caseId)).rejects.toThrow(UnauthenticatedError);
    await expect(
      rescheduleHearingAction("hearing-nope", caseId, new Date().toISOString()),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      recordHearingOutcomeAction("hearing-nope", caseId, "completed", true),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("recordDebtorReplyAction rejects with no session and never records the reply", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const caseId = mock.CASES[0].id;
    const before = mock.DEBTOR_REPLIES.length;

    await expect(
      recordDebtorReplyAction(caseId, { channel: "whatsapp", rawBody: "forged reply", classification: "payment_made" }),
    ).rejects.toThrow(UnauthenticatedError);
    expect(mock.DEBTOR_REPLIES.length).toBe(before);
  });

  it("resolveWorkflowTaskAction rejects with no session and never resolves the task", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { resolveWorkflowTaskAction } = await import("./tasks");
    const task = mock.raiseTaskIfNotOpen({
      caseId: null, organisationId: mock.ORGANISATIONS[0].id, type: "policy_gate",
      title: "security-test task", waitingOn: "staff", assigneeId: null, urgent: false, dueAt: null,
    });

    await expect(resolveWorkflowTaskAction(task.id, "forged resolution")).rejects.toThrow(UnauthenticatedError);
    expect(mock.TASKS.find((t) => t.id === task.id)?.resolvedAt).toBeNull();
  });

  it("recordDebtorReplyAction attributes the audit entry to the real session actor, not any forged input field", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    const { recordDebtorReplyAction } = await import("./debtor-replies");
    const kase = mock.CASES.find((c) => c.status === "initial_communication_sent")!;

    const { reply } = await recordDebtorReplyAction(kase.id, {
      channel: "email",
      rawBody: "attribution test",
      classification: "unclear",
    });
    const audit = (await getRepo().listAuditLog(5)).find((a) => a.entityId === kase.id && a.action === "debtor_reply.recorded");
    expect(audit?.actorId).toBe(STAFF_B.actorId);
    expect(reply.reviewedById).toBe(STAFF_B.actorId);
  });

  it("correctInvoiceOcrAction rejects with no session and never touches the invoice", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { correctInvoiceOcrAction } = await import("./ocr");
    const kase = mock.CASES.find((c) => mock.listInvoicesForCase(c.id).length > 0)!;
    const invoice = mock.listInvoicesForCase(kase.id)[0];
    const before = invoice.invoiceNumber;

    await expect(
      correctInvoiceOcrAction(kase.id, invoice.id, { invoiceNumber: "FORGED-999" }),
    ).rejects.toThrow(UnauthenticatedError);
    expect(mock.listInvoicesForCase(kase.id)[0].invoiceNumber).toBe(before);
  });

  it("createCaseFromManualInvoiceAction and commitBulkImportAction reject with no session -- a browser-supplied organisationId alone cannot create cases in any tenant", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { createCaseFromManualInvoiceAction } = await import("./manual-invoice");
    const { commitBulkImportAction } = await import("./bulk-import");
    const org = mock.ORGANISATIONS[0];
    const before = mock.CASES.length;

    await expect(
      createCaseFromManualInvoiceAction(org.id, {
        debtorName: "Forged Debtor",
        debtorGstin: null,
        invoiceNumber: "FORGE-1",
        invoiceDate: "2026-01-01",
        dueDate: null,
        taxableValue: 1000,
        taxRate: 18,
        taxAmount: 180,
        invoiceTotal: 1180,
        outstandingBalance: 1180,
      }),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(commitBulkImportAction(org.id, "irrelevant,csv\n1,2")).rejects.toThrow(UnauthenticatedError);
    expect(mock.CASES.length).toBe(before);
  });
});

describe("admin/service-role bypass (P0-1/P0-2-R1 §4): no server action references createAdminClient", () => {
  it("no action file imports or calls the RLS-bypassing admin client", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const actionsDir = path.join(process.cwd(), "src/app/actions");
    const files = await fs.readdir(actionsDir);
    for (const file of files) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = await fs.readFile(path.join(actionsDir, file), "utf8");
      expect(source, `${file} must not reference createAdminClient`).not.toMatch(/createAdminClient/);
    }
  });
});
