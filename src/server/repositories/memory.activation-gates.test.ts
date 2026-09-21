/**
 * The activation path through the real repository: intake -> staff confirms
 * corrected fields -> (client certification recorded) -> active. Nothing
 * activates on OCR confirmation alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { ManualInvoiceInput } from "@/contract/schemas";

vi.mock("server-only", () => ({}));
import { MemoryRepository } from "./memory";

const repo = new MemoryRepository({ allowLiveWhatsApp: false });
const staff: MutationActor = { actorId: "staff-activation", actorRole: "staff" };
const NOW = new Date("2026-09-21T06:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

let seq = 0;
const intake = (dueDate: string | null) =>
  ({
    invoiceNumber: `ACT-${++seq}`,
    invoiceDate: "2026-06-15",
    dueDate,
    taxableValue: 21_186_44,
    taxRate: 18,
    taxAmount: 3_813_56,
    invoiceTotal: 25_000_00,
    outstandingBalance: 25_000_00,
    debtorName: "Activation Debtor",
    debtorGstin: undefined, // missing mandatory field -> correction_required (the OCR-review path)
    debtorEmail: undefined,
    debtorMobile: undefined,
  }) as unknown as ManualInvoiceInput;

async function startCase(dueDate: string | null = "2026-07-15") {
  const created = await repo.createCaseFromManualInvoice("org-1", intake(dueDate), staff);
  return { id: created.case.id, invoiceId: created.invoice.id, created };
}
const confirm = (id: string, invoiceId: string) =>
  repo.correctInvoiceOcr(id, invoiceId, { invoiceTotal: 25_000_00, outstandingBalance: 25_000_00 }, staff);

describe("activation gates", () => {
  it("intake stops at correction_required", async () => {
    const { created } = await startCase();
    expect(created.case.status).toBe("correction_required");
  });

  it("confirming the OCR fields alone does NOT activate: waits on client certification (the old bypass)", async () => {
    const { id, invoiceId } = await startCase();
    const out = await confirm(id, invoiceId);
    expect(out.case.status).toBe("under_validation");
    expect(out.case.waitingOn).toBe("client");
    expect(out.case.blocker).toMatch(/client certification/);
    expect(out.case.activatedAt).toBeFalsy();
    const gates = await repo.getActivationGates(id);
    expect(gates).toMatchObject({ clientCertified: false, staffValidated: true, ageGatePassed: true, daysOverdue: 68 });
    expect(gates.missing).toEqual(["client certification"]);
  });

  it("recording client certification (reason required, audited) completes the gates and activates", async () => {
    const { id, invoiceId } = await startCase();
    await confirm(id, invoiceId);
    await expect(repo.recordActivationGate(id, "client_certification", "  ", staff)).rejects.toThrow(/reason is required/);

    const out = await repo.recordActivationGate(id, "client_certification", "Client certified by email 21 Sep 2026", staff);
    expect(out.activated).toBe(true);
    expect(out.case.status).toBe("active");
    expect(out.case.activatedAt).toBeTruthy();
    expect(out.gates.missing).toEqual([]);
    const audit = (await repo.listAuditLog(20)).find((a) => a.action === "case.client_certified" && a.entityId === id);
    expect(audit?.actorId).toBe(staff.actorId);
    expect(audit?.reason).toBe("Client certified by email 21 Sep 2026");
  });

  it("certification recorded BEFORE the OCR confirmation is honoured by the confirmation", async () => {
    const { id, invoiceId } = await startCase();
    const early = await repo.recordActivationGate(id, "client_certification", "Certified before review", staff);
    expect(early.case.status).toBe("correction_required"); // data still unconfirmed: no state change
    expect(early.activated).toBe(false);
    const out = await confirm(id, invoiceId);
    expect(out.case.status).toBe("active");
  });

  it("the 60-day age gate cannot be recorded or waived: a young invoice keeps the case in under_validation", async () => {
    const { id, invoiceId } = await startCase("2026-09-01"); // 20 days overdue
    await repo.recordActivationGate(id, "client_certification", "Certified", staff);
    const out = await confirm(id, invoiceId);
    expect(out.case.status).toBe("under_validation");
    expect(out.case.blocker).toMatch(/60-day age gate/);
    expect(await repo.getActivationGates(id)).toMatchObject({ ageGatePassed: false, daysOverdue: 20 });
    const again = await repo.recordActivationGate(id, "staff_validation", "Validated", staff);
    expect(again.activated).toBe(false);
    expect(again.case.status).toBe("under_validation");
  });

  it("a missing due date can never satisfy the age gate", async () => {
    const { id, invoiceId } = await startCase(null);
    await repo.recordActivationGate(id, "client_certification", "Certified", staff);
    const out = await confirm(id, invoiceId);
    expect(out.case.status).toBe("under_validation");
    expect((await repo.getActivationGates(id)).ageDetail).toMatch(/no due date/);
  });

  it("staff validation of a case awaiting correction must come from confirming the fields, not a record", async () => {
    const { id } = await startCase();
    await expect(repo.recordActivationGate(id, "staff_validation", "x", staff)).rejects.toThrow(/confirming the corrected invoice fields/);
  });

  it("gates cannot be recorded on an already-activated case, and correcting an invoice later never resets its status", async () => {
    const { id, invoiceId } = await startCase();
    await repo.recordActivationGate(id, "client_certification", "Certified", staff);
    await confirm(id, invoiceId);
    expect((await repo.getCase(id))!.status).toBe("active");
    await expect(repo.recordActivationGate(id, "client_certification", "again", staff)).rejects.toThrow(/already "active"/);

    mock.mutateCase(id, { status: "initial_communication_sent" });
    const out = await confirm(id, invoiceId);
    expect(out.case.status).toBe("initial_communication_sent");
  });
});
