/**
 * A payment's business date (and therefore the WhatsApp "received on" /
 * "settled on" dates) is the IST date, whatever the wall clock says in UTC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";
import { WHATSAPP_MESSAGE_KINDS, WHATSAPP_TEMPLATES } from "@/domain/whatsapp-templates";

vi.mock("server-only", () => ({}));
const fakeEmail = { name: "fake-gmail", send: vi.fn(), parseWebhook: () => null };
const fakeWhatsapp = { name: "fake-aisensy", send: vi.fn(), parseWebhook: () => null };
vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: fakeEmail, whatsapp: fakeWhatsapp }),
  isLiveWhatsAppConfigured: () => true,
}));
import { MemoryRepository } from "./memory";

const repo = new MemoryRepository({ allowLiveWhatsApp: true });
const staff: MutationActor = { actorId: "test-staff-ist", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-ist", actorRole: "admin" };

let seq = 0;
function seedCase(total: number, outstanding: number) {
  const id = `case-ist-${++seq}`;
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  mock.insertDebtor({ ...debtor, id: `deb-${id}`, name: "IST Debtor", mobile: "9876500011", email: null });
  const kase: RecoveryCase = { ...base, id, debtorId: `deb-${id}`, status: "active", closedAt: null, principalOutstanding: outstanding, recoveredToDate: 0 };
  mock.insertCase(kase);
  const baseInvoice = mock.listInvoicesForCase("case-1")[0];
  mock.insertInvoice({ ...baseInvoice, id: `inv-${id}`, caseId: id, invoiceNumber: "IST-001", invoiceTotal: total, outstandingBalance: outstanding, dueDate: "2026-07-15" });
  return id;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const k of WHATSAPP_MESSAGE_KINDS) vi.stubEnv(WHATSAPP_TEMPLATES[k].campaignEnvVar, `Campaign ${k}`);
  fakeWhatsapp.send.mockReset();
  fakeWhatsapp.send.mockResolvedValue({ outcome: "success", providerRef: null, errorCode: null, evidenceRefs: [], nextAction: null, data: { providerMessageId: "" } });
  await repo.setAutomationState(true, "test reset", admin);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("payment received_on is the IST business date", () => {
  it.each([
    ["2026-09-20T18:29:59Z", "2026-09-20"],
    ["2026-09-20T18:30:00Z", "2026-09-21"],
    ["2026-09-20T20:00:00Z", "2026-09-21"], // 01:30 IST -- was 2026-09-20 with the UTC date
    ["2026-09-21T00:00:00Z", "2026-09-21"],
    ["2026-09-21T04:00:00Z", "2026-09-21"],
  ])("recorded at %s -> receivedOn %s", async (utc, expected) => {
    vi.setSystemTime(new Date(utc));
    const id = seedCase(100_00, 100_00);
    const { payment } = await repo.recordPayment({ caseId: id, kind: "bank", amount: 10_00, reference: null, clientConfirmed: true }, staff);
    expect(payment.receivedOn).toBe(expected);
  });

  it("the WhatsApp Payment Received / Closed messages carry the IST date even when recorded at 01:30 IST", async () => {
    vi.setSystemTime(new Date("2026-09-20T20:00:00Z")); // 01:30 IST on 21 Sep
    const id = seedCase(25_000_00, 25_000_00);
    await repo.recordPayment({ caseId: id, kind: "bank", amount: 10_000_00, reference: null, clientConfirmed: true }, staff);
    const received = (await repo.getWhatsAppOffers(id)).find((o) => o.kind === "payment_received" && o.eventKey)!;
    expect(received.detail).toMatch(/received on 21 September 2026/);

    await repo.recordPayment({ caseId: id, kind: "bank", amount: 15_000_00, reference: null, clientConfirmed: true }, staff);
    const sendRes = await repo.sendWhatsAppMessage(id, { eventKey: (await repo.getWhatsAppOffers(id)).find((o) => o.kind === "payment_closed" && o.eventKey)!.eventKey! }, staff);
    expect(sendRes.status).toBe("accepted");
    const params = fakeWhatsapp.send.mock.calls.at(-1)![0].templateParams;
    expect(params[3]).toBe(" 25,000");
    expect(params[4]).toBe("21 September 2026");
  });
});
