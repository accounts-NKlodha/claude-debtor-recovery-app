/**
 * Invoice-level reminder stage through the real repository path
 * (MemoryRepository; adapters faked -- nothing is ever sent).
 *
 * One case, three invoices A/B/C. The case status is only the coarse
 * aggregate; the durable communication history per invoice decides what may
 * be sent next. Also pins the "Total Amount Paid" rule for the Payment
 * Closed message (pre-intake payments).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";
import { escalationReadiness } from "@/domain/reminder-stage";
import { computeReminderStage } from "@/server/whatsapp-orchestrator";

vi.mock("server-only", () => ({}));

const fakeEmail = { name: "fake-gmail", send: vi.fn(), parseWebhook: () => null };
const fakeWhatsapp = { name: "fake-aisensy", send: vi.fn(), parseWebhook: () => null };
vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmail, whatsapp: fakeWhatsapp }),
  isLiveWhatsAppConfigured: () => true,
}));

import { MemoryRepository } from "./memory";

const repo = new MemoryRepository({ allowLiveWhatsApp: true });
const staff: MutationActor = { actorId: "test-staff-multi", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-multi", actorRole: "admin" };
const OK = (ref: string | null = null) => ({
  outcome: "success" as const, providerRef: ref, errorCode: null, evidenceRefs: [], nextAction: null, data: { providerMessageId: ref ?? "" },
});

const T0 = new Date("2026-09-20T05:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Campaign ${k}`);
  fakeEmail.send.mockReset();
  fakeWhatsapp.send.mockReset();
  fakeEmail.send.mockResolvedValue(OK("<e@mail>"));
  fakeWhatsapp.send.mockResolvedValue(OK());
  await repo.setAutomationState(true, "test reset", admin);
  mock.updateOrganisationPaymentDetails("org-1", "acme@okaxis", "Acme Industrial Payee");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

interface Spec { number: string; total: number; outstanding: number }
let seq = 0;
function seed(specs: Spec[], over: { email?: string | null } = {}) {
  const id = `case-multi-${++seq}`;
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  mock.insertDebtor({ ...debtor, id: `deb-${id}`, name: "Multi Customer", mobile: "9876500011", email: over.email === undefined ? null : over.email });
  const kase: RecoveryCase = {
    ...base, id, debtorId: `deb-${id}`, status: "active", closedAt: null, nextScheduledAt: null,
    principalOutstanding: specs.reduce((s, i) => s + i.outstanding, 0),
  };
  mock.insertCase(kase);
  const baseInvoice = mock.listInvoicesForCase("case-1")[0];
  const ids = specs.map((spec, i) => {
    const invId = `inv-${id}-${"abc"[i]}`;
    mock.insertInvoice({ ...baseInvoice, id: invId, caseId: id, invoiceNumber: spec.number, invoiceTotal: spec.total, outstandingBalance: spec.outstanding, dueDate: "2026-09-18" });
    return invId;
  });
  return { id, ids };
}
const three = () => seed([
  { number: "INV-A", total: 10_000_00, outstanding: 10_000_00 },
  { number: "INV-B", total: 20_000_00, outstanding: 20_000_00 },
  { number: "INV-C", total: 30_000_00, outstanding: 30_000_00 },
]);

const offers = async (id: string, kind: string) => (await repo.getWhatsAppOffers(id)).filter((o) => o.kind === kind);
const statusOf = async (id: string) => (await repo.getCase(id))!.status;
const sendFollowUp = async (id: string, invId: string) => {
  const o = (await offers(id, "followup_reminder")).find((x) => x.subject.invoiceId === invId)!;
  return repo.sendWhatsAppMessage(id, { eventKey: o.eventKey! }, staff);
};

describe("multi-invoice case: A / B / C initial reminders are independent", () => {
  it("initial A: sent once; A cannot duplicate; B and C stay independently eligible; case is initial_communication_sent", async () => {
    const { id, ids } = three();
    const [a, b, c] = ids;
    const result = await repo.sendInitialReminder(id, staff, { invoiceId: a });
    expect(result.case.status).toBe("initial_communication_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);
    expect(fakeWhatsapp.send.mock.calls[0][0].templateParams[1]).toBe("INV-A");

    // A cannot duplicate (durable history, not case status)
    await expect(repo.sendInitialReminder(id, staff, { invoiceId: a })).rejects.toThrow(/already been sent its initial reminder/);
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(1);

    const initial = await offers(id, "initial_reminder");
    const by = Object.fromEntries(initial.map((o) => [o.subject.invoiceId, o]));
    expect(by[a].status).toBe("sent");
    expect(by[b].status).toBe("available");
    expect(by[c].status).toBe("available");
  });

  it("initial B does not affect C; C can still be sent; the case only stays in the reminder stage", async () => {
    const { id, ids } = three();
    const [a, b, c] = ids;
    await repo.sendInitialReminder(id, staff, { invoiceId: a });
    const afterB = await repo.sendInitialReminder(id, staff, { invoiceId: b });
    expect(afterB.case.status).toBe("initial_communication_sent");
    const initial = Object.fromEntries((await offers(id, "initial_reminder")).map((o) => [o.subject.invoiceId, o.status]));
    expect(initial).toEqual({ [a]: "sent", [b]: "sent", [c]: "available" });

    await repo.sendInitialReminder(id, staff, { invoiceId: c });
    expect(fakeWhatsapp.send.mock.calls.map((x) => x[0].templateParams[1])).toEqual(["INV-A", "INV-B", "INV-C"]);
    expect(await statusOf(id)).toBe("initial_communication_sent");
  });

  it("without an explicit invoice choice, several outstanding invoices still refuse to guess; the last remaining one is unambiguous", async () => {
    const { id, ids } = three();
    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow(/choose the invoice/);
    await repo.sendInitialReminder(id, staff, { invoiceId: ids[0] });
    await repo.sendInitialReminder(id, staff, { invoiceId: ids[1] });
    await repo.sendInitialReminder(id, staff); // only C remains
    expect(fakeWhatsapp.send.mock.calls[2][0].templateParams[1]).toBe("INV-C");
  });

  it("the case-level email is sent at most once, even when several invoices are reminded", async () => {
    const { id: idEmail, ids: emailIds } = seed([
      { number: "E-1", total: 1_000_00, outstanding: 1_000_00 },
      { number: "E-2", total: 1_000_00, outstanding: 1_000_00 },
    ], { email: "debtor@example.com" });
    await repo.sendInitialReminder(idEmail, staff, { invoiceId: emailIds[0] });
    await repo.sendInitialReminder(idEmail, staff, { invoiceId: emailIds[1] });
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(2);
    expect(fakeEmail.send).toHaveBeenCalledTimes(1);
  });
});

describe("multi-invoice case: follow-ups are invoice-specific", () => {
  it("follow-up A is only offered after A's own 24h window; B's window is measured from B's own reminder", async () => {
    const { id, ids } = three();
    const [a, b] = ids;
    await repo.sendInitialReminder(id, staff, { invoiceId: a }); // T0
    vi.setSystemTime(hours(10));
    await repo.sendInitialReminder(id, staff, { invoiceId: b }); // T0+10h

    vi.setSystemTime(hours(25)); // A's window ended (T0+24h); B's runs until T0+34h
    const fu = Object.fromEntries((await offers(id, "followup_reminder")).map((o) => [o.subject.invoiceId, o]));
    expect(fu[a].status).toBe("available");
    expect(fu[b].status).toBe("unavailable");
    expect(fu[b].reason).toMatch(/response window runs until/);
    expect(fu[ids[2]].status).toBe("unavailable"); // C never had an initial
    expect(fu[ids[2]].reason).toMatch(/initial reminder has not been sent yet/);
  });

  it("follow-up A does not imply follow-up B; the case is not follow_up_sent until every outstanding invoice has had one", async () => {
    const { id, ids } = three();
    const [a, b, c] = ids;
    for (const inv of ids) await repo.sendInitialReminder(id, staff, { invoiceId: inv });
    vi.setSystemTime(hours(25));

    const r1 = await sendFollowUp(id, a);
    expect(r1.status).toBe("accepted");
    expect(r1.case.status).toBe("initial_communication_sent"); // B and C still owe follow-ups
    const fu1 = Object.fromEntries((await offers(id, "followup_reminder")).map((o) => [o.subject.invoiceId, o.status]));
    expect(fu1).toEqual({ [a]: "sent", [b]: "available", [c]: "available" });

    const r2 = await sendFollowUp(id, b);
    expect(r2.case.status).toBe("initial_communication_sent"); // C still owes one
    const r3 = await sendFollowUp(id, c);
    expect(r3.case.status).toBe("follow_up_sent");
    expect(r3.case.status).not.toBe("gst_eligibility_review");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(6);
  });

  it("a duplicate follow-up for the same invoice sends nothing more", async () => {
    const { id, ids } = three();
    for (const inv of ids) await repo.sendInitialReminder(id, staff, { invoiceId: inv });
    vi.setSystemTime(hours(25));
    await sendFollowUp(id, ids[0]);
    const again = await sendFollowUp(id, ids[0]);
    expect(again.status).toBe("already_sent");
    expect(fakeWhatsapp.send).toHaveBeenCalledTimes(4);
  });
});

describe("escalation cannot occur while any outstanding invoice's reminder stages are unresolved", () => {
  const readiness = async (id: string) => escalationReadiness((await computeReminderStage(repo, id)).states, new Date());

  it("blocked at every intermediate step; ready only after every invoice's follow-up AND final window", async () => {
    const { id, ids } = three();
    const [a, b, c] = ids;
    expect((await readiness(id)).ready).toBe(false);

    await repo.sendInitialReminder(id, staff, { invoiceId: a });
    let r = await readiness(id);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/INV-B has not been sent its initial reminder/);

    await repo.sendInitialReminder(id, staff, { invoiceId: b });
    await repo.sendInitialReminder(id, staff, { invoiceId: c });
    r = await readiness(id);
    expect(r.blockers.join(" ")).toMatch(/INV-A has not been sent its follow-up/);

    vi.setSystemTime(hours(25));
    await sendFollowUp(id, a);
    await sendFollowUp(id, b);
    expect((await readiness(id)).blockers.join(" ")).toMatch(/INV-C has not been sent its follow-up/);
    await sendFollowUp(id, c);
    r = await readiness(id);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/response window runs until/); // final windows still open

    vi.setSystemTime(hours(25 + 25));
    expect((await readiness(id)).ready).toBe(true);
  });

  it("a settled invoice drops out of the aggregate: only the remaining outstanding invoices gate the case", async () => {
    const { id, ids } = seed([
      { number: "S-1", total: 5_000_00, outstanding: 0 },
      { number: "S-2", total: 5_000_00, outstanding: 5_000_00 },
    ]);
    const r = await repo.sendInitialReminder(id, staff, { invoiceId: ids[1] });
    expect(r.case.status).toBe("initial_communication_sent");
    vi.setSystemTime(hours(25));
    const fu = await sendFollowUp(id, ids[1]);
    expect(fu.case.status).toBe("follow_up_sent");
  });
});

describe("Payment Closed: 'Total Amount Paid' is only ever a reliably known amount", () => {
  const closed = async (id: string) => (await offers(id, "payment_closed"))[0];
  const payAll = async (id: string, _invId: string, amount: number, kind: "bank" | "tds" | "credit_note" | "cash" = "bank") =>
    repo.recordPayment({ caseId: id, kind, amount, reference: null, clientConfirmed: true }, staff);

  it("pre-intake payment: total ₹1,00,000, only ₹60,000 recorded here -> Payment Closed is UNAVAILABLE (never shows ₹60,000 as the total paid); Received is offered instead", async () => {
    // ₹40,000 was paid before the case was opened, so the case's invoice
    // holds outstanding ₹60,000 against a ₹1,00,000 total.
    const { id, ids } = seed([{ number: "PRE-1", total: 100_000_00, outstanding: 60_000_00 }]);
    await payAll(id, ids[0], 60_000_00);
    const k = (await repo.getCase(id))!;
    // Settle the case the way the workflow does once the balance is zero.
    expect(k.principalOutstanding).toBe(0);

    const all = await repo.getWhatsAppOffers(id);
    const c = all.find((o) => o.kind === "payment_closed")!;
    expect(c.status).toBe("unavailable");
    expect(c.eventKey).toBeNull();
    expect(c.reason).toMatch(/total paid cannot be stated reliably/);
    expect(c.reason).toMatch(/Payment Received confirmation is available instead/);
    const received = all.filter((o) => o.kind === "payment_received" && o.eventKey);
    expect(received).toHaveLength(1);
    expect(received[0].status).toBe("available");
    expect(received[0].entry?.templateParams?.[3]).toBe(" 60,000"); // the payment actually received, labelled as such
    expect(received[0].entry?.templateParams?.[5]).toBe(" 0"); // remaining balance
  });

  it("recovered-only amounts are never presented as lifetime totals: no offer anywhere carries ₹60,000 as a 'total paid'", async () => {
    const { id, ids } = seed([{ number: "PRE-2", total: 100_000_00, outstanding: 60_000_00 }]);
    await payAll(id, ids[0], 60_000_00);
    const all = await repo.getWhatsAppOffers(id);
    expect(all.filter((o) => o.kind === "payment_closed" && o.entry)).toHaveLength(0);
  });

  it("TDS / credit-note settlements are not cash the debtor paid: Closed unavailable even when allocations sum to the invoice total", async () => {
    const { id, ids } = seed([{ number: "TDS-1", total: 100_000_00, outstanding: 100_000_00 }]);
    await payAll(id, ids[0], 90_000_00, "bank");
    await payAll(id, ids[0], 10_000_00, "tds");
    const c = await closed(id);
    expect(c.status).toBe("unavailable");
    expect(c.reason).toMatch(/total paid cannot be stated reliably/);
  });

  it("when bank/cash payments recorded here sum EXACTLY to the invoice total, Closed is available and states that full total", async () => {
    const { id, ids } = seed([{ number: "FULL-1", total: 100_000_00, outstanding: 100_000_00 }]);
    await payAll(id, ids[0], 40_000_00, "bank");
    await payAll(id, ids[0], 60_000_00, "cash");
    const c = await closed(id);
    expect(c.status).toBe("available");
    expect(c.entry?.templateParams?.[3]).toBe(" 1,00,000");
  });
});
