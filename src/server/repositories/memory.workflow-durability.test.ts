/**
 * P0-5: durable workflow additions (workflow_tasks, DD, hearing, payment
 * allocations, debtor replies, task resolution) exercised against
 * MemoryRepository -- fast, no live DB, and the same repository interface
 * SupabaseRepository implements, so these assertions describe the
 * production-authoritative behavior too (see docs/workflow-durability).
 */
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "./memory";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";

const repo = new MemoryRepository();
const staffActor: MutationActor = { actorId: "test-staff-dd", actorRole: "staff" };

describe("MemoryRepository: DD persistence", () => {
  it("prepares a DD record, raises exactly one dd_preparation task, and updates on a second call without duplicating the task", async () => {
    const caseId = "case-7"; // msme_odr_filed in the seed data
    const { case: case1, dd: dd1 } = await repo.prepareDdTask(
      caseId,
      { amount: 100_000, payee: "MSEFC", reference: null },
      staffActor,
    );
    expect(case1.status).toBe("msefc_dd");
    expect(dd1.status).toBe("prepared");
    expect(dd1.amount).toBe(100_000);

    const openAfterFirst = (await repo.listTasksForCase(caseId)).filter((t) => !t.resolvedAt);
    const ddTasks1 = openAfterFirst.filter((t) => t.type === "dd_preparation");
    expect(ddTasks1).toHaveLength(1);

    const { dd: dd2 } = await repo.prepareDdTask(caseId, { reference: "DD-998877" }, staffActor);
    expect(dd2.amount).toBe(100_000); // unspecified fields preserved
    expect(dd2.reference).toBe("DD-998877");

    const openAfterSecond = (await repo.listTasksForCase(caseId)).filter((t) => !t.resolvedAt);
    expect(openAfterSecond.filter((t) => t.type === "dd_preparation")).toHaveLength(1); // not duplicated
  });

  it("resolves the dd_preparation task on submission, is idempotent on retry, and rejects further edits", async () => {
    const caseId = "case-8-dd-submit-test";
    mock.insertCase({ ...mock.getCase("case-7")!, id: caseId, status: "msme_odr_filed" });

    await repo.prepareDdTask(caseId, { amount: 100_000, payee: "MSEFC" }, staffActor);
    const dd = await repo.recordDdSubmitted(caseId, { submittedAt: new Date().toISOString() }, staffActor);
    expect(dd.status).toBe("submitted");

    const open = (await repo.listTasksForCase(caseId)).filter((t) => !t.resolvedAt);
    expect(open.filter((t) => t.type === "dd_preparation")).toHaveLength(0);

    const auditBefore = (await repo.listAuditLog(1))[0].id;
    const retry = await repo.recordDdSubmitted(caseId, {}, staffActor); // idempotent no-op
    expect(retry.status).toBe("submitted");
    expect((await repo.listAuditLog(1))[0].id).toBe(auditBefore); // no duplicate audit row

    await expect(repo.prepareDdTask(caseId, { amount: 200_000 }, staffActor)).rejects.toThrow(/already submitted/i);
  });
});

describe("MemoryRepository: hearing persistence", () => {
  it("schedules a hearing, raises hearing_followup, is idempotent on an exact retry, and rejects a conflicting date", async () => {
    const caseId = "case-hearing-test";
    mock.insertCase({ ...mock.getCase("case-7")!, id: caseId, status: "msefc_dd" });

    const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { case: scheduled, hearing } = await repo.scheduleHearing(
      caseId,
      { startsAtIso: startsAt, forum: "MSEFC Jaipur" },
      staffActor,
    );
    expect(scheduled.status).toBe("hearing_scheduled");
    expect(hearing.status).toBe("scheduled");
    expect(hearing.forum).toBe("MSEFC Jaipur");

    const followupTasks = (await repo.listTasksForCase(caseId)).filter(
      (t) => t.type === "hearing_followup" && !t.resolvedAt,
    );
    expect(followupTasks).toHaveLength(1);

    // exact-date retry is a no-op, not a duplicate hearing
    const retry = await repo.scheduleHearing(caseId, { startsAtIso: startsAt }, staffActor);
    expect(retry.hearing.id).toBe(hearing.id);
    expect((await repo.listHearingsForCase(caseId))).toHaveLength(1);

    // a different date while one is open must go through reschedule, not schedule again
    const otherDate = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await expect(repo.scheduleHearing(caseId, { startsAtIso: otherDate }, staffActor)).rejects.toThrow(/already scheduled/i);
  });

  it("reschedule adjourns the old occurrence and preserves history", async () => {
    const caseId = "case-hearing-reschedule-test";
    mock.insertCase({ ...mock.getCase("case-7")!, id: caseId, status: "msefc_dd" });
    const firstDate = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { hearing: first } = await repo.scheduleHearing(caseId, { startsAtIso: firstDate }, staffActor);

    const secondDate = new Date(Date.now() + 21 * 86_400_000).toISOString();
    const { case: rescheduledCase, hearing: second } = await repo.rescheduleHearing(
      first.id,
      caseId,
      { newStartsAtIso: secondDate },
      staffActor,
    );
    expect(rescheduledCase.status).toBe("hearing_scheduled");
    expect(second.rescheduledFromId).toBe(first.id);

    const all = await repo.listHearingsForCase(caseId);
    expect(all).toHaveLength(2);
    expect(all.find((h) => h.id === first.id)?.status).toBe("adjourned");
    expect(all.find((h) => h.id === second.id)?.status).toBe("scheduled");

    // rescheduling a hearing that is no longer 'scheduled' is rejected
    await expect(
      repo.rescheduleHearing(first.id, caseId, { newStartsAtIso: secondDate }, staffActor),
    ).rejects.toThrow(/not currently scheduled/i);
  });

  it("recording a recovered outcome closes the hearing task AND every other open task on the case (terminal-status invariant), and is idempotent", async () => {
    const caseId = "case-hearing-outcome-test";
    mock.insertCase({ ...mock.getCase("case-7")!, id: caseId, status: "msefc_dd" });
    const { hearing } = await repo.scheduleHearing(
      caseId,
      { startsAtIso: new Date(Date.now() + 7 * 86_400_000).toISOString() },
      staffActor,
    );
    // an unrelated open task on the same case, to prove the terminal-status
    // sweep is case-scoped and not limited to the hearing_followup task type
    mock.raiseTaskIfNotOpen({
      caseId, organisationId: "org-4", type: "staff_validation", title: "unrelated open task",
      waitingOn: "staff", assigneeId: null, urgent: false, dueAt: null,
    });

    const { case: closed } = await repo.recordHearingOutcome(
      hearing.id, caseId, { status: "completed", recovered: true }, staffActor,
    );
    expect(closed.status).toBe("recovered");

    const open = (await repo.listTasksForCase(caseId)).filter((t) => !t.resolvedAt);
    expect(open).toHaveLength(0);

    // idempotent: a second outcome call on an already-terminal hearing is a no-op, not an error
    await expect(
      repo.recordHearingOutcome(hearing.id, caseId, { status: "completed", recovered: true }, staffActor),
    ).resolves.not.toThrow();
  });
});

describe("MemoryRepository: payment allocations", () => {
  it("confirming a full payment materializes payment_allocations, fully clears the invoice, and closes any open case tasks", async () => {
    const caseId = "case-1";
    const before = await repo.listAllocationsForCase(caseId);
    expect(before).toHaveLength(0);

    mock.raiseTaskIfNotOpen({
      caseId, organisationId: "org-1", type: "payment_confirmation", title: "pending confirmation task",
      waitingOn: "client", assigneeId: null, urgent: false, dueAt: null,
    });

    const { payment } = await repo.recordPayment(
      { caseId, kind: "bank", amount: 184_50_000, reference: "UTR-TEST-1", clientConfirmed: false },
      staffActor,
    );
    const { updatedCase } = await repo.confirmPayment(payment.id, staffActor);
    expect(updatedCase.status).toBe("recovered");
    expect(updatedCase.principalOutstanding).toBe(0);

    const allocations = await repo.listAllocationsForCase(caseId);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].amount).toBe(184_50_000);
    expect(allocations[0].paymentRecordId).toBe(payment.id);

    const invoice = (await repo.listInvoicesForCase(caseId)).find((i) => i.id === allocations[0].invoiceId);
    expect(invoice?.outstandingBalance).toBe(0);

    const open = (await repo.listTasksForCase(caseId)).filter((t) => !t.resolvedAt);
    expect(open).toHaveLength(0); // terminal-status task sweep applies here too

    await expect(repo.confirmPayment(payment.id, staffActor)).rejects.toThrow(/already confirmed/i);
  });
});

describe("MemoryRepository: debtor replies", () => {
  it("records a classified reply, drives the matching case transition, and raises the matching follow-up task exactly once", async () => {
    const caseId = "case-reply-test";
    mock.insertCase({ ...mock.getCase("case-1")!, id: caseId, status: "initial_communication_sent" });

    const { case: after, reply } = await repo.recordDebtorReply(
      caseId,
      { channel: "whatsapp", rawBody: "We already paid this on the 3rd", classification: "payment_made" },
      staffActor,
    );
    expect(after.status).toBe("payment_confirmation_required");
    expect(reply.classification).toBe("payment_made");

    const tasks1 = (await repo.listTasksForCase(caseId)).filter((t) => t.type === "payment_confirmation" && !t.resolvedAt);
    expect(tasks1).toHaveLength(1);

    // a second, differently-worded reply with the same classification does not duplicate the open task
    await repo.recordDebtorReply(
      caseId,
      { channel: "email", rawBody: "Confirming payment was made", classification: "payment_made" },
      staffActor,
    );
    const tasks2 = (await repo.listTasksForCase(caseId)).filter((t) => t.type === "payment_confirmation" && !t.resolvedAt);
    expect(tasks2).toHaveLength(1);

    expect(await repo.listDebtorRepliesForCase(caseId)).toHaveLength(2);
  });
});

describe("MemoryRepository: workflow task resolution", () => {
  it("resolves a task and is idempotent on a retry", async () => {
    const task = mock.raiseTaskIfNotOpen({
      caseId: null, organisationId: "org-1", type: "policy_gate", title: "resolve-me",
      waitingOn: "staff", assigneeId: null, urgent: false, dueAt: null,
    });
    const resolved = await repo.resolveWorkflowTask(task.id, "done", staffActor);
    expect(resolved.resolvedAt).not.toBeNull();

    const auditBefore = (await repo.listAuditLog(1))[0].id;
    const retry = await repo.resolveWorkflowTask(task.id, "done again", staffActor);
    expect(retry.resolvedAt).toBe(resolved.resolvedAt); // unchanged
    expect((await repo.listAuditLog(1))[0].id).toBe(auditBefore); // no duplicate audit row
  });

  it("rejects resolving a task that does not exist", async () => {
    await expect(repo.resolveWorkflowTask("nope", "x", staffActor)).rejects.toThrow(/not found/i);
  });
});
