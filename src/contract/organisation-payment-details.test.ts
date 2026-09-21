import { describe, expect, it } from "vitest";
import { UPI_ID_REGEX, organisationPaymentDetailsSchema } from "./schemas";

const OK = { upiId: "testcompany@okhdfcbank", upiPayeeName: "Test Company", reason: "Confirmed with the client" };

describe("organisationPaymentDetailsSchema", () => {
  it("accepts a valid UPI ID + payee name + reason", () => {
    const r = organisationPaymentDetailsSchema.safeParse(OK);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(OK);
  });

  it("treats both blank fields as an explicit clear (null/null)", () => {
    const r = organisationPaymentDetailsSchema.safeParse({ upiId: "", upiPayeeName: "  ", reason: "Client changed bank" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ upiId: null, upiPayeeName: null });
  });

  it("rejects a UPI ID with no payee name and a payee name with no UPI ID (both-or-neither)", () => {
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, upiPayeeName: "" }).success).toBe(false);
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, upiId: "" }).success).toBe(false);
  });

  it.each(["plainstring", "@bank", "name@", "name@1bank", "na me@bank", "name@bank@x", "a@bk", "name@b", "-x@bank"])(
    "rejects a malformed UPI ID: %s",
    (bad) => {
      expect(organisationPaymentDetailsSchema.safeParse({ ...OK, upiId: bad }).success).toBe(false);
    },
  );

  it.each(["name@upi", "first.last@okaxis", "shop_1-2@ybl", "9876500011@paytm"])("accepts a well-formed UPI ID: %s", (good) => {
    expect(UPI_ID_REGEX.test(good)).toBe(true);
  });

  it("collapses internal whitespace/newlines in the payee name so it is always a valid WhatsApp parameter", () => {
    const r = organisationPaymentDetailsSchema.safeParse({ ...OK, upiPayeeName: "  Test\n  Company\t Pvt   Ltd " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.upiPayeeName).toBe("Test Company Pvt Ltd");
  });

  it("rejects a 1-character or over-long payee name", () => {
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, upiPayeeName: "A" }).success).toBe(false);
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, upiPayeeName: "A".repeat(101) }).success).toBe(false);
  });

  it("requires a reason (the change is audited)", () => {
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, reason: "" }).success).toBe(false);
    expect(organisationPaymentDetailsSchema.safeParse({ ...OK, reason: "  " }).success).toBe(false);
  });
});
