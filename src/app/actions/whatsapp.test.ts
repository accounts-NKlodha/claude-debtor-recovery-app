/**
 * sendWhatsAppMessageAction / recordPaymentPromiseAction: staff-only,
 * validated server-side, and always RETURN a typed state (never throw across
 * the action boundary). The browser only names an event; the server decides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeStaffMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  authorizeStaffMutation: (...args: unknown[]) => authorizeStaffMutation(...args),
}));

const sendWhatsAppMessage = vi.fn();
const recordPaymentPromise = vi.fn();
vi.mock("@/server/repo", () => ({ getRepo: () => ({ sendWhatsAppMessage, recordPaymentPromise }) }));

const STAFF = { actorId: "staff-alice", actorRole: "staff" };
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  authorizeStaffMutation.mockReset();
  authorizeStaffMutation.mockResolvedValue(STAFF);
  sendWhatsAppMessage.mockReset();
  recordPaymentPromise.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("sendWhatsAppMessageAction", () => {
  it("passes the real session actor and only the event key to the repository, and reports the outcome (accepted != delivered)", async () => {
    sendWhatsAppMessage.mockResolvedValue({ status: "accepted" });
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    const r = await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1", eventKey: "wa:followup-reminder:c1:i1:1", actorId: "forged", to: "9999999999" }));
    expect(r).toEqual({ kind: "accepted" });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith("c1", { eventKey: "wa:followup-reminder:c1:i1:1", forceRetryAfterAmbiguous: false }, STAFF);
    // No recipient / parameter / actor field from the form ever reaches the repository.
    expect(JSON.stringify(sendWhatsAppMessage.mock.calls[0])).not.toMatch(/forged|9999999999/);
  });

  it.each(["rejected", "ambiguous", "already_sent"] as const)("relays the '%s' outcome", async (status) => {
    sendWhatsAppMessage.mockResolvedValue({ status });
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    expect(await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1", eventKey: "k" }))).toEqual({ kind: status });
  });

  it("only an explicit confirmation forces a retry after an ambiguous attempt", async () => {
    sendWhatsAppMessage.mockResolvedValue({ status: "accepted" });
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1", eventKey: "k", forceRetryAfterAmbiguous: "true" }));
    expect(sendWhatsAppMessage.mock.calls[0][1].forceRetryAfterAmbiguous).toBe(true);
  });

  it("a session without staff rights gets a controlled error and nothing is sent", async () => {
    authorizeStaffMutation.mockRejectedValue(new Error("Forbidden"));
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    const r = await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1", eventKey: "k" }));
    expect(r).toEqual({ kind: "error", message: "Forbidden" });
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("a refusal from the server-side engine is returned as a message, never thrown", async () => {
    sendWhatsAppMessage.mockRejectedValue(new Error("Follow-up payment reminder not sent: the global automation kill switch is off."));
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    const r = await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1", eventKey: "k" }));
    expect(r).toEqual({ kind: "error", message: "Follow-up payment reminder not sent: the global automation kill switch is off." });
  });

  it("a missing case or event is rejected before authorization", async () => {
    const { sendWhatsAppMessageAction } = await import("./whatsapp");
    expect(await sendWhatsAppMessageAction({ kind: "idle" }, form({ caseId: "c1" }))).toEqual({ kind: "error", message: "Missing case or message." });
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
  });
});

describe("recordPaymentPromiseAction", () => {
  const VALID = { caseId: "c1", promisedOn: "2026-09-25", promisedAmount: "25,000.50", invoiceId: "", sourceReplyId: "" };

  it("converts rupees to integer paise, treats blank optionals as absent, and passes the session actor", async () => {
    recordPaymentPromise.mockResolvedValue({});
    const { recordPaymentPromiseAction } = await import("./whatsapp");
    const r = await recordPaymentPromiseAction({ kind: "idle" }, form(VALID));
    expect(r).toEqual({ kind: "saved" });
    expect(recordPaymentPromise).toHaveBeenCalledWith(
      "c1", { caseId: "c1", invoiceId: null, promisedOn: "2026-09-25", promisedAmountPaise: 2_500_050, sourceReplyId: null }, STAFF,
    );
  });

  it("accepts a promise with no amount", async () => {
    recordPaymentPromise.mockResolvedValue({});
    const { recordPaymentPromiseAction } = await import("./whatsapp");
    await recordPaymentPromiseAction({ kind: "idle" }, form({ ...VALID, promisedAmount: "" }));
    expect(recordPaymentPromise.mock.calls[0][1].promisedAmountPaise).toBeNull();
  });

  it.each([
    ["a malformed date", { promisedOn: "25/09/2026" }, /promised payment date/i],
    ["an empty date", { promisedOn: "" }, /promised payment date/i],
    ["a zero amount", { promisedAmount: "0" }, /greater than zero/],
    ["a negative amount", { promisedAmount: "-5" }, /greater than zero/],
    ["a non-numeric amount", { promisedAmount: "lots" }, /greater than zero/],
  ])("rejects %s before authorization", async (_l, over, msg) => {
    const { recordPaymentPromiseAction } = await import("./whatsapp");
    const r = await recordPaymentPromiseAction({ kind: "idle" }, form({ ...VALID, ...over }));
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(msg);
    expect(authorizeStaffMutation).not.toHaveBeenCalled();
    expect(recordPaymentPromise).not.toHaveBeenCalled();
  });

  it("a non-staff session or a repository refusal returns a controlled error", async () => {
    const { recordPaymentPromiseAction } = await import("./whatsapp");
    authorizeStaffMutation.mockRejectedValue(new Error("Forbidden"));
    expect(await recordPaymentPromiseAction({ kind: "idle" }, form(VALID))).toEqual({ kind: "error", message: "Forbidden" });
    authorizeStaffMutation.mockResolvedValue(STAFF);
    recordPaymentPromise.mockRejectedValue(new Error("The promised date cannot be in the past"));
    expect(await recordPaymentPromiseAction({ kind: "idle" }, form(VALID))).toEqual({ kind: "error", message: "The promised date cannot be in the past" });
  });
});
