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

function paymentFormData(fields: {
  caseId: string;
  kind: string;
  amount: number;
  reference?: string | null;
  clientConfirmed?: boolean;
}): FormData {
  const fd = new FormData();
  fd.set("caseId", fields.caseId);
  fd.set("kind", fields.kind);
  fd.set("amount", String(fields.amount));
  fd.set("reference", fields.reference ?? "");
  fd.set("clientConfirmed", String(fields.clientConfirmed ?? false));
  return fd;
}

function confirmFormData(paymentId: string, caseId: string): FormData {
  const fd = new FormData();
  fd.set("paymentId", paymentId);
  fd.set("caseId", caseId);
  return fd;
}

describe("recordPaymentAction / confirmPaymentAction (real entry points)", () => {
  it("returns a generic error state (never throws) with no session, and never records a payment", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { recordPaymentAction } = await import("./payments");
    const before = mock.PAYMENTS.length;

    const result = await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId: mock.CASES[0].id, kind: "bank", amount: 1000 }),
    );
    expect(result.error).toBeTruthy();
    expect(result.payment).toBeNull();
    expect(mock.PAYMENTS.length).toBe(before); // no side effect happened
  });

  it("rejects a wrong actor type (e.g. a client session hitting a staff-only action) as state, not a throw", async () => {
    authorizeStaffMutation.mockRejectedValue(new ForbiddenError("Staff/admin session required"));
    const { recordPaymentAction } = await import("./payments");

    const result = await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId: mock.CASES[0].id, kind: "bank", amount: 1000 }),
    );
    expect(result.error).toBeTruthy();
    expect(result.payment).toBeNull();
  });

  it("rejects an unselected case (the old case-1 fallback path) without ever calling the repository", async () => {
    const { recordPaymentAction } = await import("./payments");
    const before = mock.PAYMENTS.length;

    const result = await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId: "", kind: "bank", amount: 1000 }),
    );
    expect(result.error).toBe("Select an organisation and case before recording a receipt.");
    expect(mock.PAYMENTS.length).toBe(before);
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("attributes the audit entry to the authenticated actor, never a value the caller supplied -- and never a constant", async () => {
    const { recordPaymentAction } = await import("./payments");
    const caseId = mock.CASES.find((c) => c.status === "active")?.id ?? mock.CASES[0].id;

    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId, kind: "bank", amount: 500, reference: "r1" }),
    );
    let audit = await latestAudit();
    expect(audit.action).toBe("payment.recorded");
    expect(audit.actorId).toBe(STAFF_A.actorId);
    expect(audit.actorRole).toBe(STAFF_A.actorRole);

    // Same call shape, different mocked session -- attribution must track
    // the session, proving it isn't hardcoded and (since `input` has no
    // actor-shaped field at all) cannot be forged from the request payload.
    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId, kind: "bank", amount: 500, reference: "r2" }),
    );
    audit = await latestAudit();
    expect(audit.actorId).toBe(STAFF_B.actorId);
    expect(audit.actorId).not.toBe(STAFF_A.actorId);
  });

  it("confirmPaymentAction also authorizes independently and attributes to the session actor", async () => {
    const { recordPaymentAction, confirmPaymentAction } = await import("./payments");
    const caseId = mock.CASES.find((c) => c.status === "active")?.id ?? mock.CASES[0].id;

    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { payment } = await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId, kind: "bank", amount: 750, reference: "confirm-me" }),
    );

    authorizeStaffMutation.mockRejectedValueOnce(new UnauthenticatedError());
    const rejected = await confirmPaymentAction({ confirmed: false, error: null }, confirmFormData(payment!.id, caseId));
    expect(rejected.confirmed).toBe(false);
    expect(rejected.error).toBeTruthy();

    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    const ok = await confirmPaymentAction({ confirmed: false, error: null }, confirmFormData(payment!.id, caseId));
    expect(ok.confirmed).toBe(true);
    const audit = await latestAudit();
    expect(audit.action).toBe("payment.confirmed");
    expect(audit.actorId).toBe(STAFF_B.actorId);
  });

  it("confirming an already-confirmed payment returns an error as state, not a throw (real business-rule rejection)", async () => {
    const { recordPaymentAction, confirmPaymentAction } = await import("./payments");
    const caseId = mock.CASES.find((c) => c.status === "active")?.id ?? mock.CASES[0].id;

    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { payment } = await recordPaymentAction(
      { payment: null, error: null },
      paymentFormData({ caseId, kind: "bank", amount: 250, reference: "double-confirm-me" }),
    );
    await confirmPaymentAction({ confirmed: false, error: null }, confirmFormData(payment!.id, caseId));

    const second = await confirmPaymentAction({ confirmed: false, error: null }, confirmFormData(payment!.id, caseId));
    expect(second.confirmed).toBe(false);
    expect(second.error).toBeTruthy();
  });
});

function automationFormData(nextEnabled: boolean, reason: string): FormData {
  const fd = new FormData();
  fd.set("nextEnabled", String(nextEnabled));
  fd.set("reason", reason);
  return fd;
}

function debtorContactFormData(debtorId: string, caseId: string, email: string, mobile: string, reason = ""): FormData {
  const fd = new FormData();
  fd.set("debtorId", debtorId);
  fd.set("caseId", caseId);
  fd.set("email", email);
  fd.set("mobile", mobile);
  fd.set("reason", reason);
  return fd;
}

describe("updateDebtorContactAction (real entry point, core-workflow remediation)", () => {
  it("staff can update a debtor's contact details", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "new-email@example.com", ""),
    );
    expect(result.error).toBeNull();
    expect(result.debtor?.email).toBe("new-email@example.com");
    expect(mock.getDebtor("deb-1")?.email).toBe("new-email@example.com");
  });

  it("admin can also update a debtor's contact details (operational staff functionality, existing role model)", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_B); // STAFF_B is an admin actor
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "admin-set@example.com", ""),
    );
    expect(result.error).toBeNull();
    expect(result.debtor?.email).toBe("admin-set@example.com");
  });

  it("client is denied -- authorizeStaffMutation rejects, returned as safe state, not a throw or a mutation", async () => {
    authorizeStaffMutation.mockRejectedValue(new ForbiddenError("Staff/admin session required"));
    const { updateDebtorContactAction } = await import("./debtor");
    const before = mock.getDebtor("deb-1")?.email;

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "client-attempt@example.com", ""),
    );
    expect(result.error).toBe("You do not have permission to change this debtor's contact details.");
    expect(result.debtor).toBeNull();
    expect(mock.getDebtor("deb-1")?.email).toBe(before); // no side effect
  });

  it("anon (unauthenticated) is denied the same way", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "anon-attempt@example.com", ""),
    );
    expect(result.error).toBeTruthy();
    expect(result.debtor).toBeNull();
  });

  it("a nonexistent debtor id is rejected cleanly -- never silently mutates an unrelated row", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-does-not-exist", "case-1", "x@example.com", ""),
    );
    expect(result.error).toBeTruthy();
    expect(result.debtor).toBeNull();
  });

  it("an invalid email is rejected client-side (schema), never reaching the repository", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");
    const before = mock.getDebtor("deb-1")?.email;

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "not-an-email", ""),
    );
    expect(result.error).toBeTruthy();
    expect(result.debtor).toBeNull();
    expect(mock.getDebtor("deb-1")?.email).toBe(before);
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("an invalid Indian mobile number is rejected the same way", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "", "12345"),
    );
    expect(result.error).toBeTruthy();
    expect(result.debtor).toBeNull();
  });

  it("both fields may be blank -- clearing contact info is allowed, not treated as invalid", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");

    const result = await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "", ""),
    );
    expect(result.error).toBeNull();
    expect(result.debtor).toEqual({ email: null, mobile: null });
  });

  it("generates an audit event, attributed to the real session actor", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");

    await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", "audited@example.com", ""),
    );
    const audit = await latestAudit();
    expect(audit.action).toBe("debtor.contact_updated");
    expect(audit.actorId).toBe(STAFF_A.actorId);
  });

  it("the audit reason does not duplicate the full email/mobile PII (change-indicator style, not raw values)", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_A);
    const { updateDebtorContactAction } = await import("./debtor");
    const secretLookingEmail = "should-not-appear-verbatim@example.com";

    await updateDebtorContactAction(
      { debtor: null, error: null },
      debtorContactFormData("deb-1", "case-1", secretLookingEmail, ""),
    );
    const audit = await latestAudit();
    expect(audit.reason ?? "").not.toContain(secretLookingEmail);
  });
});

describe("setAutomationStateAction: admin-only privileged path (real entry point)", () => {
  it("cannot be reached through an ordinary staff authorization -- it calls authorizeAdminMutation, not authorizeStaffMutation", async () => {
    authorizeAdminMutation.mockRejectedValue(new ForbiddenError("Admin session required"));
    const { setAutomationStateAction } = await import("./settings");
    const before = mock.getAutomationEnabled();

    // Returns a generic denial as state -- never throws across the action
    // boundary (final-UAT go-live task: a thrown error here crashed the
    // client in production; see src/app/actions/settings.ts).
    const result = await setAutomationStateAction(
      { enabled: before, error: null },
      automationFormData(!before, "attempted by non-admin"),
    );
    expect(result.error).toBe("You do not have permission to change this setting.");
    expect(result.enabled).toBe(before); // no state change
    expect(mock.getAutomationEnabled()).toBe(before); // no state change
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });

  it("succeeds for an authorized admin and attributes the audit entry to them", async () => {
    authorizeAdminMutation.mockResolvedValue(STAFF_B);
    const { setAutomationStateAction } = await import("./settings");
    const before = mock.getAutomationEnabled();

    const result = await setAutomationStateAction(
      { enabled: before, error: null },
      automationFormData(!before, "drift investigation"),
    );
    expect(result.error).toBeNull();
    expect(result.enabled).toBe(!before);
    expect(mock.getAutomationEnabled()).toBe(!before);
    const audit = await latestAudit();
    expect(audit.actorId).toBe(STAFF_B.actorId);

    await setAutomationStateAction({ enabled: !before, error: null }, automationFormData(before, "restore")); // cleanup for other tests
  });

  it("rejects a missing reason as state, never touching the repository", async () => {
    authorizeAdminMutation.mockResolvedValue(STAFF_B);
    const { setAutomationStateAction } = await import("./settings");
    const before = mock.getAutomationEnabled();

    const result = await setAutomationStateAction({ enabled: before, error: null }, automationFormData(!before, "  "));
    expect(result.error).toBe("A reason is required before changing the global automation switch.");
    expect(mock.getAutomationEnabled()).toBe(before);
    expect(authorizeAdminMutation).not.toHaveBeenCalled();
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

  function reminderFormData(caseId: string, forceRetryAfterAmbiguous = false): FormData {
    const fd = new FormData();
    fd.set("caseId", caseId);
    fd.set("forceRetryAfterAmbiguous", String(forceRetryAfterAmbiguous));
    return fd;
  }

  it("sendInitialReminderAction returns a generic error state (never throws) with no session, and never records a communication or sends anything", async () => {
    authorizeStaffMutation.mockRejectedValue(new UnauthenticatedError());
    const { sendInitialReminderAction } = await import("./reminders");
    const org = mock.ORGANISATIONS[0];
    const debtor = mock.insertDebtor({
      id: "deb-security-test-reminder-unauth", organisationId: org.id, name: "Security Test Debtor Unauth",
      mobile: "9800000001", email: "security-test-unauth@example.com", gstin: null, address: null,
      contactVerified: true, totalDue: 10000,
    });
    const kase = mock.insertCase({
      id: "case-security-test-reminder-unauth", organisationId: org.id, debtorId: debtor.id, status: "active",
      automationMode: "assist", waitingOn: "system", automationStartedAt: new Date().toISOString(),
      currentStep: "active", blocker: null, nextScheduledAction: null, nextScheduledAt: null,
      eligibilityRoute: null, principalOutstanding: 10000, recoveredToDate: 0, assigneeId: null,
      groupKey: null, createdAt: new Date().toISOString(), activatedAt: new Date().toISOString(), closedAt: null,
    });
    const before = mock.COMMUNICATIONS.length;

    const result = await sendInitialReminderAction({ kind: "idle" }, reminderFormData(kase.id));
    expect(result.kind).toBe("error");
    expect(mock.COMMUNICATIONS.length).toBe(before);
  });

  it("sendInitialReminderAction attributes the audit entry to the real session actor, not any forged input", async () => {
    authorizeStaffMutation.mockResolvedValue(STAFF_B);
    const { sendInitialReminderAction } = await import("./reminders");
    const org = mock.insertOrganisation({
      id: "org-security-test-reminder", clientCode: "NKL-SECTEST-REM", legalEntityName: "Security Test Reminder Co",
      creditorGstin: null, udyamNumber: null, jitoMember: false, createdAt: new Date().toISOString(),
    });
    const debtor = mock.insertDebtor({
      id: "deb-security-test-reminder", organisationId: org.id, name: "Security Test Debtor",
      mobile: "9800000000", email: "security-test@example.com", gstin: null, address: null,
      contactVerified: true, totalDue: 10000,
    });
    const kase = mock.insertCase({
      id: "case-security-test-reminder", organisationId: org.id, debtorId: debtor.id, status: "active",
      automationMode: "assist", waitingOn: "system", automationStartedAt: new Date().toISOString(),
      currentStep: "active", blocker: null, nextScheduledAction: null, nextScheduledAt: null,
      eligibilityRoute: null, principalOutstanding: 10000, recoveredToDate: 0, assigneeId: null,
      groupKey: null, createdAt: new Date().toISOString(), activatedAt: new Date().toISOString(), closedAt: null,
    });

    await sendInitialReminderAction({ kind: "idle" }, reminderFormData(kase.id));
    const audit = (await getRepo().listAuditLog(10)).find((a) => a.entityId === kase.id && a.action === "reminder.sent");
    expect(audit?.actorId).toBe(STAFF_B.actorId);
    expect(audit?.actorId).not.toBe("attacker-forged-id");
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
