/**
 * updateOrganisationPaymentDetailsAction: admin-only, validated server-side,
 * audited without ever writing the UPI values into the audit log, and never
 * throws across the action boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as mock from "@/lib/mock-data";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authorizeAdminMutation = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  authorizeAdminMutation: (...args: unknown[]) => authorizeAdminMutation(...args),
}));

const ADMIN = { actorId: "admin-alice", actorRole: "admin" };

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ORG_ID = "org-1";
const VALID = { organisationId: ORG_ID, upiId: "acme@okaxis", upiPayeeName: "Acme Industrial", reason: "Confirmed by client" };

beforeEach(() => {
  authorizeAdminMutation.mockReset();
  authorizeAdminMutation.mockResolvedValue(ADMIN);
  mock.updateOrganisationPaymentDetails(ORG_ID, null, null);
});
afterEach(() => vi.clearAllMocks());

describe("updateOrganisationPaymentDetailsAction", () => {
  it("saves the details, audits the change with the real admin actor, and never writes the UPI values into the audit log", async () => {
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    const auditBefore = mock.AUDIT_LOG.length;
    const result = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form(VALID));

    expect(result.error).toBeNull();
    expect(result.result?.upiId).toBe("acme@okaxis");
    expect(result.result?.upiPayeeName).toBe("Acme Industrial");
    expect(mock.getOrg(ORG_ID)?.upiId).toBe("acme@okaxis");

    // appendAudit() unshifts: the newest entry is first.
    expect(mock.AUDIT_LOG.length).toBe(auditBefore + 1);
    const entry = mock.AUDIT_LOG[0];
    expect(entry).toMatchObject({
      action: "organisation.payment_details_updated",
      entity: "organisation",
      entityId: ORG_ID,
      actorId: "admin-alice",
      actorRole: "admin",
    });
    expect(JSON.stringify(entry)).not.toContain("acme@okaxis");
    expect(JSON.stringify(entry)).not.toContain("Acme Industrial");
  });

  it("clears the details when both fields are blank", async () => {
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form(VALID));
    const cleared = await updateOrganisationPaymentDetailsAction(
      { result: null, error: null },
      form({ organisationId: ORG_ID, upiId: "", upiPayeeName: "", reason: "Client changed bank" }),
    );
    expect(cleared.error).toBeNull();
    expect(mock.getOrg(ORG_ID)?.upiId).toBeNull();
    expect(mock.getOrg(ORG_ID)?.upiPayeeName).toBeNull();
  });

  it("a non-admin session gets a controlled error and nothing changes (server-side authorization, not just a hidden UI)", async () => {
    authorizeAdminMutation.mockRejectedValue(new Error("Forbidden"));
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    const auditBefore = mock.AUDIT_LOG.length;
    const result = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form(VALID));
    expect(result.result).toBeNull();
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(mock.getOrg(ORG_ID)?.upiId).toBeNull();
    expect(mock.AUDIT_LOG.length).toBe(auditBefore);
  });

  it("rejects a malformed UPI ID before authorization is even consulted", async () => {
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    const result = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form({ ...VALID, upiId: "not-a-upi" }));
    expect(result.result).toBeNull();
    expect(result.error).toMatch(/valid UPI ID/i);
    expect(authorizeAdminMutation).not.toHaveBeenCalled();
  });

  it("rejects half-filled details and a missing reason", async () => {
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    const half = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form({ ...VALID, upiPayeeName: "" }));
    expect(half.error).toMatch(/both/i);
    const noReason = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form({ ...VALID, reason: "" }));
    expect(noReason.error).toMatch(/reason/i);
    expect(mock.getOrg(ORG_ID)?.upiId).toBeNull();
  });

  it("returns a controlled error (never throws) for an unknown organisation or a missing organisation id", async () => {
    const { updateOrganisationPaymentDetailsAction } = await import("./organisations");
    const unknown = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form({ ...VALID, organisationId: "org-does-not-exist" }));
    expect(unknown.result).toBeNull();
    expect(unknown.error).toMatch(/not found/i);
    const missing = await updateOrganisationPaymentDetailsAction({ result: null, error: null }, form({ ...VALID, organisationId: "" }));
    expect(missing.error).toBe("Missing client.");
  });
});
