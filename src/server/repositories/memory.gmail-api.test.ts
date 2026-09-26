/**
 * The real Gmail API adapter driven through the real repository send path
 * (HTTP mocked -- nothing is sent). Proves the app-level guarantees are the
 * same as for every other provider: kill switch blocks before any call, a
 * provider failure never records success or advances the case, and
 * idempotency is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";
import type { MutationActor } from "@/lib/auth/types";
import type { RecoveryCase } from "@/contract/types";

vi.mock("server-only", () => ({}));

import { gmailApi, resetGmailApiTokenCache } from "@/adapters/gmail-api";

vi.mock("@/adapters", () => ({
  getAdapters: () => ({ email: gmailApi, whatsapp: { name: "off", send: vi.fn(), parseWebhook: () => null } }),
  isLiveWhatsAppConfigured: () => false,
}));

import { MemoryRepository } from "./memory";

const repo = new MemoryRepository();
const staff: MutationActor = { actorId: "test-staff-gmail-api", actorRole: "staff" };
const admin: MutationActor = { actorId: "test-admin-gmail-api", actorRole: "admin" };

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const providerCalls = () => fetchMock.mock.calls.length;
const sendCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("messages/send")).length;

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetGmailApiTokenCache();
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret", GOOGLE_REFRESH_TOKEN: "rtoken", GMAIL_SENDER_EMAIL: "sender@example.com" });
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes("oauth2") ? json(200, { access_token: "at", expires_in: 3599 }) : json(200, { id: "gmail-msg-1" }),
  );
  await repo.setAutomationState(true, "test reset", admin);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GMAIL_SENDER_EMAIL"]) delete process.env[k];
});

let seq = 0;
function seedActive(): string {
  const id = `case-gmailapi-${++seq}`;
  const base = mock.getCase("case-1")!;
  const debtor = mock.getDebtor(base.debtorId)!;
  mock.insertDebtor({ ...debtor, id: `deb-${id}`, name: "Gmail API Test Debtor", mobile: null, email: "debtor@example.com" });
  mock.insertCase({ ...base, id, debtorId: `deb-${id}`, status: "active", closedAt: null } as RecoveryCase);
  const inv = mock.listInvoicesForCase("case-1")[0];
  mock.insertInvoice({ ...inv, id: `inv-${id}`, caseId: id, invoiceNumber: "GAPI-001", invoiceTotal: 118000, outstandingBalance: 118000, dueDate: "2026-05-31" });
  return id;
}

describe("Gmail API through the real send path", () => {
  it("sends once, records provider 'gmail-api' with the Gmail message id, and advances the case", async () => {
    const id = seedActive();
    const r = await repo.sendInitialReminder(id, staff);
    expect(sendCalls()).toBe(1);
    const email = r.communications.find((c) => c.channel === "email")!;
    expect(email.deliveryStatus).toBe("sent");
    const [delivery] = await repo.listDeliveriesForCommunication(email.id);
    expect(delivery).toMatchObject({ provider: "gmail-api", status: "sent", adapterOutcome: "success", providerMessageId: "gmail-msg-1" });
    expect(r.case.status).not.toBe("active");
  });

  it("kill switch engaged: the Gmail API is never called (no token exchange, no send), nothing recorded", async () => {
    const id = seedActive();
    await repo.setAutomationState(false, "engage kill switch", admin);
    await expect(repo.sendInitialReminder(id, staff)).rejects.toThrow(/kill switch/i);
    expect(providerCalls()).toBe(0);
    expect(await repo.listCommunicationsForCase(id)).toHaveLength(0);
    expect(mock.getCase(id)!.status).toBe("active");
  });

  it("a Gmail API failure is recorded as failed: never 'sent', and the case is not advanced as delivered", async () => {
    const id = seedActive();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("oauth2") ? json(200, { access_token: "at", expires_in: 3599 }) : json(403, { error: { message: "denied" } }),
    );
    const r = await repo.sendInitialReminder(id, staff);
    const email = r.communications.find((c) => c.channel === "email")!;
    expect(email.deliveryStatus).toBe("failed");
    const [delivery] = await repo.listDeliveriesForCommunication(email.id);
    expect(delivery).toMatchObject({ status: "failed", adapterOutcome: "permanent_failure", provider: "gmail-api" });
    expect(r.case.status).not.toBe("initial_communication_sent");
  });

  it("idempotency unchanged: a repeated submission does not send a second email", async () => {
    const id = seedActive();
    await repo.sendInitialReminder(id, staff);
    await repo.sendInitialReminder(id, staff).catch(() => undefined);
    expect(sendCalls()).toBe(1);
  });

  it("a retryable failure is retried exactly once by the shared policy, then reported failed (no duplicate success)", async () => {
    const id = seedActive();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("oauth2") ? json(200, { access_token: "at", expires_in: 3599 }) : json(503, {}),
    );
    const r = await repo.sendInitialReminder(id, staff);
    expect(sendCalls()).toBe(2);
    expect(r.communications.find((c) => c.channel === "email")!.deliveryStatus).toBe("failed");
  });
});
